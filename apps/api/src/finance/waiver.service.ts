import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal } from '../common/auth-principal';
import { assertWithinScope, scopeConstraintFor, studentScopeWhere } from '../rbac/scope.util';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import {
  CreateWaiverDto,
  DecideWaiverDto,
  ListWaiversQueryDto,
  RecordLoanClearanceDto,
} from './dto/finance.dto';

/**
 * Waivers & loan clearances (docs/03 §11.4).
 *
 * SOD is structural here: chk_waiver_sod in guards.sql rejects a waiver whose
 * approver equals its requester, so a single actor can never both raise and
 * approve a reduction. The service mirrors it pre-flight for a clear message.
 * On APPROVE, the waiver becomes money: a WAIVER CREDIT ledger entry is posted
 * under the waiver's idempotency key so a double-approve cannot double-credit.
 */
@Injectable()
export class WaiverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- Waivers -------------------------------------------------------------------

  async list(q: ListWaiversQueryDto, actor: AuthPrincipal) {
    const scope = studentScopeWhere(scopeConstraintFor(actor, PERMISSIONS.FINANCE_VIEW));
    const rows = await this.prisma.waiver.findMany({
      where: {
        ...(scope ? { studentRecord: scope } : {}),
        ...(q.studentRecordId ? { studentRecordId: q.studentRecordId } : {}),
        ...(q.status
          ? { status: q.status as 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' }
          : {}),
        ...(q.includeDecided ? {} : { status: { not: 'CANCELLED' } }),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        studentRecord: {
          select: { id: true, matriculationNumber: true, surname: true, firstName: true },
        },
        invoice: { select: { id: true, invoiceNumber: true, sessionId: true } },
      },
    });

    // requested/approved are bare UUID columns (no User relation), so resolve
    // display names in one query.
    const userIds = [
      ...new Set(
        rows
          .flatMap((r) => [r.requestedById, r.approvedById])
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.fullName]));

    return rows.map((w) => ({
      id: w.id,
      student: {
        id: w.studentRecord.id,
        matriculationNumber: w.studentRecord.matriculationNumber,
        name: [w.studentRecord.surname, w.studentRecord.firstName].filter(Boolean).join(' '),
      },
      invoiceNumber: w.invoice?.invoiceNumber ?? null,
      sessionId: w.invoice?.sessionId ?? w.academicSessionId ?? null,
      feeType: w.feeType,
      amount: w.amount.toString(),
      reason: w.reason,
      status: w.status,
      requestedByName: nameById.get(w.requestedById) ?? null,
      approvedByName: w.approvedById ? (nameById.get(w.approvedById) ?? null) : null,
      decisionNote: w.decisionNote,
      decidedAt: w.decidedAt,
      appliedAt: w.appliedAt,
      createdAt: w.createdAt,
    }));
  }

  async create(dto: CreateWaiverDto, actor: AuthPrincipal) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: dto.invoiceId },
      include: {
        studentRecord: {
          select: { id: true, facultyId: true, departmentId: true, programmeId: true },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.studentRecordId !== dto.studentRecordId) {
      throw new BadRequestException("The waiver must target the invoice's own student");
    }
    if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') {
      throw new ConflictException(
        `Waivers attach to live charges (status: ${invoice.status}) — issue the invoice first`,
      );
    }
    assertWithinScope(
      scopeConstraintFor(actor, PERMISSIONS.FINANCE_WAIVER_MANAGE),
      invoice.studentRecord,
    );

    if (dto.amount <= 0n) throw new BadRequestException('Waiver amount must be positive');
    const outstanding = invoice.totalAmount - invoice.paidAmount;
    if (dto.amount > outstanding) {
      throw new BadRequestException(
        `Waiver exceeds the outstanding balance of ${outstanding.toString()} minor units`,
      );
    }

    try {
      const waiver = await this.prisma.waiver.create({
        data: {
          studentRecordId: dto.studentRecordId,
          invoiceId: dto.invoiceId,
          academicSessionId: invoice.sessionId,
          feeType: dto.feeType?.trim() || null,
          amount: dto.amount,
          reason: dto.reason.trim(),
          status: 'PENDING',
          requestedById: actor.userId,
        },
      });
      await this.audit.record({
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'finance.waiver.request',
        entityType: 'Waiver',
        entityId: waiver.id,
        metadata: { invoiceId: dto.invoiceId, amount: dto.amount.toString() },
      });
      return waiver;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new BadRequestException(
          'The invoice or student record for this waiver no longer exists',
        );
      }
      throw err;
    }
  }

  /**
   * Approve or reject a PENDING waiver. Approval posts the WAIVER CREDIT to the
   * ledger and flips the invoice projection:
   *   paid + waived ≥ total ⇒ PAID, else PARTIALLY_PAID (if anything paid).
   * Rejection is final and audited — nothing posts.
   */
  async decide(id: string, dto: DecideWaiverDto, actor: AuthPrincipal) {
    const waiver = await this.prisma.waiver.findUnique({
      where: { id },
      include: { invoice: true },
    });
    if (!waiver) throw new NotFoundException('Waiver not found');
    if (waiver.status !== 'PENDING') {
      throw new ConflictException(`Waiver is already ${waiver.status.toLowerCase()}`);
    }
    // Service pre-flight + DB CHECK: the approver must be a different person
    // from the requester (docs/02 §5.4, chk_waiver_sod).
    if (waiver.requestedById === actor.userId) {
      throw new ForbiddenException(
        'You requested this waiver — a different officer must approve it (separation of duties)',
      );
    }

    const invoice = waiver.invoice;
    const now = new Date();

    if (dto.decision === 'REJECTED') {
      await this.prisma.$transaction(async (tx) => {
        await tx.waiver.update({
          where: { id },
          data: {
            status: 'REJECTED',
            approvedById: actor.userId,
            decisionNote: dto.decisionNote ?? null,
            decidedAt: now,
          },
        });
        await this.audit.recordTx(tx, {
          actorId: actor.userId,
          actorLabel: actor.email,
          action: 'finance.waiver.reject',
          entityType: 'Waiver',
          entityId: id,
          metadata: { note: dto.decisionNote ?? null },
        });
      });
      return { id, status: 'REJECTED' as const, posted: false };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.waiver.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedById: actor.userId,
          decisionNote: dto.decisionNote ?? null,
          decidedAt: now,
          appliedAt: now,
        },
      });

      let invoiceStatus: string | null = null;
      if (invoice) {
        await tx.ledgerEntry.create({
          data: {
            studentRecordId: waiver.studentRecordId,
            sessionId: invoice.sessionId,
            direction: 'CREDIT',
            source: 'WAIVER',
            amount: waiver.amount,
            description: `Waiver approved on ${invoice.invoiceNumber}${waiver.feeType ? ` (${waiver.feeType})` : ''}`,
            invoiceId: invoice.id,
            idempotencyKey: `waiver:credit:${waiver.id}`,
            createdById: actor.userId,
          },
        });

        const waivedSum = await tx.waiver.aggregate({
          where: { invoiceId: invoice.id, status: 'APPROVED' },
          _sum: { amount: true },
        });
        const covered = invoice.paidAmount + (waivedSum._sum.amount ?? 0n);
        const newStatus =
          covered >= invoice.totalAmount
            ? 'PAID'
            : invoice.paidAmount > 0n
              ? 'PARTIALLY_PAID'
              : invoice.status;
        const updated = await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: newStatus as 'PAID' | 'PARTIALLY_PAID' | 'ISSUED' },
        });
        invoiceStatus = updated.status;
      }

      await this.audit.recordTx(tx, {
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'finance.waiver.approve',
        entityType: 'Waiver',
        entityId: id,
        metadata: {
          amount: waiver.amount.toString(),
          requesterId: waiver.requestedById,
          invoiceStatus,
        },
      });
      return { invoiceStatus };
    });

    return { id, status: 'APPROVED' as const, posted: true, invoiceStatus: result.invoiceStatus };
  }

  /** Withdraw a waiver that has not been decided. */
  async cancel(id: string, actor: AuthPrincipal, reason: string) {
    const waiver = await this.prisma.waiver.findUnique({ where: { id } });
    if (!waiver) throw new NotFoundException('Waiver not found');
    if (waiver.status !== 'PENDING') {
      throw new ConflictException(
        `Only a pending waiver can be cancelled (status: ${waiver.status})`,
      );
    }
    if (waiver.requestedById !== actor.userId) {
      throw new ForbiddenException('Only the requesting officer can cancel a pending waiver');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.waiver.update({
        where: { id },
        data: { status: 'CANCELLED', decisionNote: reason, decidedAt: new Date() },
      });
      await this.audit.recordTx(tx, {
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'finance.waiver.cancel',
        entityType: 'Waiver',
        entityId: id,
        metadata: { reason },
      });
    });
    return { id, status: 'CANCELLED' as const };
  }

  // --- Loan clearances (Q-39) ----------------------------------------------------

  async listLoanClearances(studentRecordId?: string) {
    const rows = await this.prisma.loanClearance.findMany({
      where: studentRecordId ? { studentRecordId } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        studentRecord: {
          select: { id: true, matriculationNumber: true, surname: true, firstName: true },
        },
        session: { select: { id: true, name: true } },
      },
    });
    const recorderIds = [...new Set(rows.map((r) => r.recordedById).filter(Boolean) as string[])];
    const recorders = recorderIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: recorderIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const nameById = new Map(recorders.map((u) => [u.id, u.fullName]));
    return rows.map((l) => ({
      id: l.id,
      student: {
        id: l.studentRecord.id,
        matriculationNumber: l.studentRecord.matriculationNumber,
        name: [l.studentRecord.surname, l.studentRecord.firstName].filter(Boolean).join(' '),
      },
      session: { id: l.session.id, name: l.session.name },
      loanProvider: l.loanProvider,
      reference: l.reference,
      amountCovered: l.amountCovered.toString(),
      validFrom: l.validFrom,
      validTo: l.validTo,
      status: l.status,
      recordedByName: l.recordedById ? (nameById.get(l.recordedById) ?? null) : null,
      createdAt: l.createdAt,
    }));
  }

  /**
   * Record a third-party education-loan clearance (NELFUND etc.). The clearance
   * is money-equivalent for the session: once APPROVED it feeds the same
   * derived fee-clearance check (INV-16 / Q-39). It is PENDING on entry and
   * approved by a DIFFERENT officer than the recorder — the same SOD posture
   * as waivers, enforced here (the table has no approver column, so the
   * approver is recorded in the audit trail, which is append-only).
   */
  async recordLoanClearance(dto: RecordLoanClearanceDto, actor: AuthPrincipal) {
    const student = await this.prisma.studentRecord.findUnique({
      where: { id: dto.studentRecordId },
      select: { id: true, facultyId: true, departmentId: true, programmeId: true },
    });
    if (!student) throw new NotFoundException('Student record not found');
    assertWithinScope(scopeConstraintFor(actor, PERMISSIONS.FINANCE_WAIVER_MANAGE), student);
    if (dto.amountCovered <= 0n) throw new BadRequestException('amountCovered must be positive');

    const validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    const validTo = dto.validTo ? new Date(dto.validTo) : null;
    if (
      (dto.validFrom && Number.isNaN(validFrom?.getTime())) ||
      (dto.validTo && Number.isNaN(validTo?.getTime()))
    ) {
      throw new BadRequestException('validFrom/validTo must be valid ISO dates');
    }
    if (validFrom && validTo && validTo < validFrom) {
      throw new BadRequestException('validTo must not precede validFrom');
    }

    try {
      const clearance = await this.prisma.loanClearance.create({
        data: {
          studentRecordId: dto.studentRecordId,
          sessionId: dto.sessionId,
          loanProvider: dto.loanProvider.trim().toUpperCase(),
          reference: dto.reference.trim(),
          amountCovered: dto.amountCovered,
          validFrom,
          validTo,
          status: 'PENDING',
          recordedById: actor.userId,
        },
      });
      await this.audit.record({
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'finance.loan.record',
        entityType: 'LoanClearance',
        entityId: clearance.id,
        metadata: { provider: clearance.loanProvider, reference: clearance.reference },
      });
      return clearance;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Loan reference ${dto.reference} is already recorded`);
      }
      throw err;
    }
  }

  /** Approve/record an APPROVED clearance (approver ≠ recorder). */
  async approveLoanClearance(id: string, actor: AuthPrincipal, note?: string) {
    const loan = await this.prisma.loanClearance.findUnique({ where: { id } });
    if (!loan) throw new NotFoundException('Loan clearance not found');
    if (loan.status !== 'PENDING') {
      throw new ConflictException(`Loan clearance is already ${loan.status.toLowerCase()}`);
    }
    if (loan.recordedById === actor.userId) {
      throw new ForbiddenException(
        'You recorded this loan clearance — a different officer must approve it (separation of duties)',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.loanClearance.update({ where: { id }, data: { status: 'APPROVED' } });
      // The table carries no approver column; the audit row is the permanent
      // record of the second signature (append-only, hash-chained).
      await this.audit.recordTx(tx, {
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'finance.loan.approve',
        entityType: 'LoanClearance',
        entityId: id,
        metadata: { recorderId: loan.recordedById, note: note ?? null },
      });
    });
    return { id, status: 'APPROVED' as const };
  }
}
