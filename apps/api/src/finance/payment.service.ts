import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentIntentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal } from '../common/auth-principal';
import { assertWithinScope, scopeConstraintFor } from '../rbac/scope.util';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import { amountDue, classifyPayment, formatMinor } from './finance.constants';
import { RecordPaymentDto, ReversePaymentDto } from './dto/finance.dto';

/**
 * Payment posting (docs/03 §11.3).
 *
 * This v1 surface is the MANUAL posting path (bursary records a bank alert,
 * remittance advice, or a verified gateway callback). The provider-agnostic
 * webhook/polling pipeline of §11.3 is a later stage; what MUST already be
 * true here — and is — the non-negotiable money rules:
 *
 *  1. Never trust the client callback: the amount posted is whatever the
 *     provider/bank ACTUALLY received (a caller passes amountReceived), and
 *     mismatches are first-class outcomes, not silent acceptance.
 *  2. Idempotency: one ledger entry per provider reference (INV-15, a DB
 *     unique constraint) — resubmitting the same reference re-posts nothing.
 *  3. Reversals are NEW compensating ledger entries, never edits (INV-14).
 *  4. UNDER/OVER are surfaced with the exact delta (§11.3 rule 5).
 */
@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listIntents(filters: { studentRecordId?: string; invoiceId?: string; status?: string }) {
    const rows = await this.prisma.paymentIntent.findMany({
      where: {
        ...(filters.studentRecordId ? { studentRecordId: filters.studentRecordId } : {}),
        ...(filters.invoiceId ? { invoiceId: filters.invoiceId } : {}),
        ...(filters.status ? { status: filters.status as PaymentIntentStatus } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { invoice: { select: { invoiceNumber: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      amount: r.amount.toString(),
      currency: r.currency,
      provider: r.provider,
      providerReference: r.providerReference,
      status: r.status,
      discrepancyAmount: r.discrepancyAmount?.toString() ?? null,
      invoiceNumber: r.invoice?.invoiceNumber ?? null,
      paidAt: r.paidAt,
      postedAt: r.postedAt,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Record a received payment against an invoice. Writes: the PaymentIntent
   * (the attempt, permanently), one or more ledger CREDITs (PAYMENT source),
   * and refreshes the invoice's paid projection.
   *
   * Amount handling is the §11.3 rule-5 split:
   *  - EXACT: posts as PAID → POSTED_TO_LEDGER, invoice marked paid-in-full.
   *  - PARTIAL: requires `allowPartial`; posts what arrived and reports the
   *    shortfall in the message. The intent lands PARTIALLY_PAID-style
   *    (status UNDERPAID) so the shortfall is visible, not absorbed.
   *  - OVERPAYMENT: rejected on the manual path. Forwarding surplus to credit
   *    balance or refunding it is Q-17 institutional policy — silently keeping
   *    the excess would hide money the student overpaid.
   */
  async record(dto: RecordPaymentDto, actor: AuthPrincipal) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: dto.invoiceId },
      include: {
        lines: true,
        studentRecord: {
          select: { id: true, facultyId: true, departmentId: true, programmeId: true },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') {
      throw new ConflictException(
        `Only an ISSUED or PARTIALLY_PAID invoice can receive a payment (status: ${invoice.status})`,
      );
    }
    assertWithinScope(
      scopeConstraintFor(actor, PERMISSIONS.FINANCE_PAYMENT_MANAGE),
      invoice.studentRecord,
    );

    const providerReference = dto.providerReference.trim();
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { providerReference },
      select: { id: true, status: true },
    });
    if (intent) {
      throw new ConflictException(
        `Payment reference ${providerReference} has already been recorded (status ${intent.status})`,
      );
    }

    const waived = await this.prisma.waiver.aggregate({
      where: { invoiceId: dto.invoiceId, status: 'APPROVED' },
      _sum: { amount: true },
    });
    const waivedAmount = waived._sum.amount ?? 0n;
    const outstanding = amountDue(invoice.totalAmount, invoice.paidAmount + waivedAmount);

    const classification = classifyPayment(dto.amount, outstanding);
    if (classification.kind === 'PARTIAL' && !dto.allowPartial) {
      throw new BadRequestException(
        `Amount received is ${formatMinor(dto.amount)} but outstanding is ${formatMinor(outstanding)}. ` +
          'If this partial payment is intentional, re-submit with allowPartial.',
      );
    }
    if (classification.kind === 'OVERPAYMENT') {
      throw new BadRequestException(
        `Amount received (${formatMinor(dto.amount)}) exceeds the outstanding ` +
          `${formatMinor(outstanding)} by ${formatMinor(classification.delta)}. ` +
          'Post the exact amount due; surplus handling (top-up, credit-forward, refund) is a finance decision, not a posting.',
      );
    }
    if (dto.amount <= 0n) throw new BadRequestException('Payment amount must be positive');

    const provider = (dto.provider ?? 'MANUAL').toUpperCase();

    const result = await this.prisma.$transaction(async (tx) => {
      const paymentIntent = await tx.paymentIntent.create({
        data: {
          studentRecordId: invoice.studentRecordId,
          invoiceId: invoice.id,
          amount: dto.amount,
          currency: 'NGN',
          provider,
          providerReference,
          // Posted money is terminal POSTED; UNDERPAID keeps the mismatch as a
          // first-class state (discrepancyAmount carries the shortfall, §11.3
          // rule 5) while still being reversible.
          status: classification.kind === 'PARTIAL' ? 'UNDERPAID' : 'POSTED_TO_LEDGER',
          discrepancyAmount: classification.kind === 'PARTIAL' ? classification.delta : null,
          idempotencyKey: `payment:${providerReference}`,
          postedAt: new Date(),
        },
      });

      await tx.ledgerEntry.create({
        data: {
          studentRecordId: invoice.studentRecordId,
          sessionId: invoice.sessionId,
          direction: 'CREDIT',
          source: 'PAYMENT',
          amount: dto.amount,
          description: `Payment ${providerReference} posted to ${invoice.invoiceNumber}`,
          invoiceId: invoice.id,
          paymentIntentId: paymentIntent.id,
          idempotencyKey: `payment:credit:${paymentIntent.id}`,
          createdById: actor.userId,
        },
      });

      const remaining = amountDue(
        invoice.totalAmount,
        invoice.paidAmount + waivedAmount + dto.amount,
      );
      const newStatus = remaining === 0n ? 'PAID' : 'PARTIALLY_PAID';
      const updatedInvoice = await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: newStatus, paidAmount: { increment: dto.amount } },
      });

      await this.audit.recordTx(tx, {
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'finance.payment.post',
        entityType: 'PaymentIntent',
        entityId: paymentIntent.id,
        metadata: {
          invoiceId: invoice.id,
          provider,
          providerReference,
          amount: dto.amount.toString(),
          kind: classification.kind,
        },
      });

      return { paymentIntent, updatedInvoice, remaining };
    });

    return {
      intentId: result.paymentIntent.id,
      providerReference,
      posted: dto.amount.toString(),
      invoiceStatus: result.updatedInvoice.status,
      remaining: result.remaining.toString(),
      message:
        classification.kind === 'PARTIAL'
          ? `Partial payment recorded. Outstanding balance is now ${formatMinor(result.remaining)}.`
          : `Payment recorded — invoice ${invoice.invoiceNumber} is now ${result.updatedInvoice.status}.`,
    };
  }

  /**
   * Unwind a posted payment (§11.5: no refund is ever automatic — this is the
   * reviewed, audited operation). The original entry STAYS; a REVERSAL debit
   * retires the credit, and the invoice's paid projection and status unwind to
   * match. Only POSTED intents can be reversed — UNDER/FAILED/ABANDONED never
   * moved money, and REVERSED is already done.
   */
  async reverse(dto: ReversePaymentDto, actor: AuthPrincipal) {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: dto.paymentIntentId },
      include: {
        invoice: true,
        studentRecord: {
          select: { id: true, facultyId: true, departmentId: true, programmeId: true },
        },
      },
    });
    if (!intent) throw new NotFoundException('Payment intent not found');
    // Both posted states moved money: POSTED_TO_LEDGER is exact, UNDERPAID is a
    // shortfall posting. FAILED/ABANDONED/REVERSED never wrote a ledger entry.
    const postedStates: PaymentIntentStatus[] = ['POSTED_TO_LEDGER', 'UNDERPAID'];
    if (!postedStates.includes(intent.status)) {
      throw new ConflictException(
        `Only a posted payment can be reversed (status: ${intent.status})`,
      );
    }
    assertWithinScope(
      scopeConstraintFor(actor, PERMISSIONS.FINANCE_PAYMENT_MANAGE),
      intent.studentRecord,
    );

    const invoice = intent.invoice;

    // Guarded by a ledger unique constraint as well: double-reversal impossible.
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.ledgerEntry.create({
        data: {
          studentRecordId: intent.studentRecordId,
          sessionId: invoice?.sessionId ?? null,
          direction: 'DEBIT',
          source: 'REVERSAL',
          amount: intent.amount,
          description: `Reversal of payment ${intent.providerReference ?? intent.id}`,
          invoiceId: intent.invoiceId,
          idempotencyKey: `reversal:${intent.id}`,
          createdById: actor.userId,
        },
      });

      await tx.paymentIntent.update({
        where: { id: intent.id },
        data: { status: 'REVERSED' },
      });

      // Rebuild the paid projection from the REMAINING posted intents rather
      // than blind arithmetic, so concurrent postings keep the cache honest.
      let updatedInvoice: { status: string } | null = null;
      if (invoice) {
        const remaining = await tx.paymentIntent.aggregate({
          where: {
            invoiceId: invoice.id,
            status: { in: ['POSTED_TO_LEDGER', 'UNDERPAID'] },
            id: { not: intent.id },
          },
          _sum: { amount: true },
        });
        const paid = remaining._sum.amount ?? 0n;
        const status =
          paid >= invoice.totalAmount ? 'PAID' : paid > 0n ? 'PARTIALLY_PAID' : 'ISSUED';
        updatedInvoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: { paidAmount: paid, status: status as 'PAID' | 'PARTIALLY_PAID' | 'ISSUED' },
        });
      }

      await this.audit.recordTx(tx, {
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'finance.payment.reverse',
        entityType: 'PaymentIntent',
        entityId: intent.id,
        metadata: { reason: dto.reason, amount: intent.amount.toString() },
      });

      return updatedInvoice;
    });

    return {
      intentId: intent.id,
      status: 'REVERSED' as const,
      invoiceStatus: result?.status ?? null,
      reversed: intent.amount.toString(),
    };
  }
}
