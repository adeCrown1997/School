import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal } from '../common/auth-principal';
import { scopeConstraintFor, studentScopeWhere, assertWithinScope } from '../rbac/scope.util';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import { GenerateInvoicesDto, IssueInvoiceDto } from './dto/finance.dto';

/** Invoicing (docs/03 §11.2). See the module doc for the money rules this
 *  service enforces with the ledger. */
@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- Queries ----------------------------------------------------------------

  async list(
    filters: {
      sessionId?: string;
      semesterId?: string;
      studentRecordId?: string;
      status?: string;
    },
    actor: AuthPrincipal,
    page: number,
    pageSize: number,
  ) {
    const scope = studentScopeWhere(scopeConstraintFor(actor, PERMISSIONS.FINANCE_VIEW));
    const student = filters.studentRecordId ? { studentRecordId: filters.studentRecordId } : {};
    const where = {
      ...(scope ? { studentRecord: scope } : {}),
      ...student,
      ...(filters.sessionId ? { sessionId: filters.sessionId } : {}),
      ...(filters.semesterId ? { semesterId: filters.semesterId } : {}),
      ...(filters.status ? { status: filters.status as InvoiceStatus } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: this.invoiceInclude(),
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return { items: rows.map((r) => this.serialize(r)), total };
  }

  async get(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        ...this.invoiceInclude(),
        ledgerEntries: { orderBy: { createdAt: 'asc' } },
        waivers: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const base = this.serialize(invoice);
    const waived = invoice.waivers
      .filter((w) => w.status === 'APPROVED')
      .reduce((acc, w) => acc + w.amount, 0n);
    return {
      ...base,
      waivedAmount: waived.toString(),
      outstanding: largestZero(invoice.totalAmount - invoice.paidAmount - waived).toString(),
      ledger: invoice.ledgerEntries.map((e) => ({
        id: e.id,
        direction: e.direction,
        source: e.source,
        amount: e.amount.toString(),
        description: e.description,
        createdAt: e.createdAt,
      })),
      waivers: invoice.waivers.map((w) => ({
        id: w.id,
        feeType: w.feeType,
        amount: w.amount.toString(),
        reason: w.reason,
        status: w.status,
        decisionNote: w.decisionNote,
        requestedAt: w.createdAt,
        decidedAt: w.decidedAt,
      })),
    };
  }

  // --- Generation (§11.2) -------------------------------------------------------

  /**
   * Cut DRAFT invoices from a schedule for every billable student (or an
   * explicit list). Mandatory AND optional items are billed — the mandatory
   * flag informs clearance, not billing. Lines SNAPSHOT the schedule amounts
   * (INV: snapshot at issue), so a later fee revision never restates a bill.
   */
  async generate(dto: GenerateInvoicesDto, actor: AuthPrincipal) {
    const schedule = await this.prisma.feeSchedule.findUnique({
      where: { id: dto.scheduleId },
      include: {
        items: { orderBy: [{ sortOrder: 'asc' as const }, { feeType: 'asc' as const }] },
        session: { select: { id: true, name: true } },
        Semester: { select: { id: true } },
      },
    });
    if (!schedule) throw new NotFoundException('Fee schedule not found');
    if (!schedule.items.length) {
      throw new BadRequestException('The schedule has no fee items to bill');
    }

    const sessionId = dto.sessionId ?? schedule.sessionId ?? null;
    if (!sessionId) {
      throw new BadRequestException(
        'This schedule is not pinned to a session — pass sessionId explicitly.',
      );
    }
    const session = await this.prisma.academicSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Academic session not found');
    const semesterId = dto.semesterId ?? schedule.semesterId ?? null;

    const activeStatuses = await this.prisma.studentStatus.findMany({
      where: { isTerminal: false },
      select: { id: true },
    });

    const students = dto.studentRecordIds
      ? await this.prisma.studentRecord.findMany({
          where: { id: { in: dto.studentRecordIds } },
          select: { id: true, programmeId: true, facultyId: true, departmentId: true },
        })
      : await this.prisma.studentRecord.findMany({
          where: {
            programmeId: schedule.programmeId,
            studentStatusId: { in: activeStatuses.map((s) => s.id) },
          },
          select: { id: true, programmeId: true, facultyId: true, departmentId: true },
        });

    if (!students.length) {
      throw new NotFoundException('No billable students matched the scope');
    }

    const existing = await this.prisma.invoice.findMany({
      where: {
        studentRecordId: { in: students.map((s) => s.id) },
        sessionId,
        ...(semesterId ? { semesterId } : {}),
        status: { in: ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID'] },
      },
      select: { studentRecordId: true },
    });
    const alreadyBilled = new Set(existing.map((i) => i.studentRecordId));

    const toBill = students.filter((s) => !alreadyBilled.has(s.id));
    const skipped = students.length - toBill.length;
    if (skipped > 0 && !dto.skipExisting) {
      throw new ConflictException(
        `${skipped} student(s) already have an invoice for this period. Re-run with skipExisting to bill only the unbilled ${toBill.length}.`,
      );
    }
    if (!toBill.length) {
      throw new ConflictException('Every student in the scope is already billed for this period');
    }

    // Scope check for explicit lists: an actor may only hand-pick students
    // within their own scope (bursary is GLOBAL, narrow grants stay narrow).
    const constraint = scopeConstraintFor(actor, PERMISSIONS.FINANCE_INVOICE_MANAGE);
    for (const s of toBill) assertWithinScope(constraint, s);

    const total = schedule.items.reduce((acc, i) => acc + i.amount, 0n);

    const created = await this.prisma.$transaction(async (tx) => {
      const rows = [];
      for (const s of toBill) {
        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber: this.mintInvoiceNumber(session.name),
            studentRecordId: s.id,
            sessionId,
            semesterId,
            status: 'DRAFT',
            totalAmount: total,
            paidAmount: 0n,
            lines: {
              create: schedule.items.map((item) => ({
                feeItemId: item.id,
                description: item.label,
                quantity: 1,
                unitAmount: item.amount,
                amount: item.amount,
              })),
            },
          },
        });
        rows.push(invoice);
      }
      await this.audit.recordTx(tx, {
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'finance.invoice.generate',
        entityType: 'FeeSchedule',
        entityId: schedule.id,
        metadata: {
          sessionId,
          semesterId,
          count: rows.length,
          skippedExisting: skipped,
          totalPerInvoice: total.toString(),
        },
      });
      return rows;
    });

    return {
      sessionId,
      semesterId,
      created: created.length,
      skippedExisting: skipped,
      totalPerInvoice: total.toString(),
      invoiceIds: created.map((i) => i.id),
    };
  }

  /**
   * DRAFT → ISSUED. This is the moment the demand becomes real: the serial is
   * minted, the due date fixed, and the ledger is charged (DEBIT, source
   * INVOICE, idempotency-keyed to the invoice so a retry cannot double-charge).
   */
  async issue(id: string, dto: IssueInvoiceDto | undefined, actor: AuthPrincipal) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        studentRecord: {
          select: { id: true, facultyId: true, departmentId: true, programmeId: true },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== 'DRAFT') {
      throw new ConflictException(`Only a DRAFT invoice can be issued (status: ${invoice.status})`);
    }
    assertWithinScope(
      scopeConstraintFor(actor, PERMISSIONS.FINANCE_INVOICE_MANAGE),
      invoice.studentRecord,
    );

    const dueAt = dto?.dueAt ? new Date(dto.dueAt) : null;
    if (dto?.dueAt && Number.isNaN(dueAt?.getTime())) {
      throw new BadRequestException('dueAt must be a valid ISO date');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.invoice.update({
        where: { id },
        data: { status: 'ISSUED', issuedAt: new Date(), dueAt },
        include: this.invoiceInclude(),
      });
      await tx.ledgerEntry.create({
        data: {
          studentRecordId: invoice.studentRecordId,
          sessionId: invoice.sessionId,
          direction: 'DEBIT',
          source: 'INVOICE',
          amount: invoice.totalAmount,
          description: `Invoice ${invoice.invoiceNumber} issued`,
          invoiceId: id,
          idempotencyKey: `invoice:debit:${id}`,
          createdById: actor.userId,
        },
      });
      await this.audit.recordTx(tx, {
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'finance.invoice.issue',
        entityType: 'Invoice',
        entityId: id,
        before: { status: 'DRAFT' },
        after: { status: 'ISSUED', dueAt: dueAt?.toISOString() ?? null },
      });
      return row;
    });
    return this.serialize(updated);
  }

  /**
   * Withdraw a bill. DRAFTs die quietly (no ledger entry was ever written);
   * ISSUED bills get a compensating CREDIT so the derived balance drops back —
   * the ledger is append-only (INV-14), so "unissue" means a new entry, never a
   * deletion. An invoice with ANY payment or approved waiver against it cannot
   * be cancelled: money or promises moved, and those unwind through reversals /
   * waiver rejections, not a status change.
   */
  async cancel(id: string, actor: AuthPrincipal, reason: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        studentRecord: {
          select: { id: true, facultyId: true, departmentId: true, programmeId: true },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    assertWithinScope(
      scopeConstraintFor(actor, PERMISSIONS.FINANCE_INVOICE_MANAGE),
      invoice.studentRecord,
    );

    if (invoice.status === 'PAID') {
      throw new ConflictException('A paid invoice cannot be cancelled — post a reversal instead');
    }
    if (invoice.status === 'CANCELLED' || invoice.status === 'VOID') {
      throw new ConflictException(`Invoice is already ${invoice.status.toLowerCase()}`);
    }

    const touched =
      invoice.paidAmount > 0n ||
      (await this.prisma.waiver.count({
        where: { invoiceId: id, status: { in: ['PENDING', 'APPROVED'] } },
      })) > 0;
    if (touched && invoice.status !== 'DRAFT') {
      throw new ConflictException(
        'A payment or waiver is attached to this invoice — it cannot be cancelled. ' +
          'Reverse the payment and reject pending waivers first.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.invoice.update({ where: { id }, data: { status: 'CANCELLED' } });
      if (invoice.status === 'ISSUED') {
        // Compensate the charge posted at issue.
        await tx.ledgerEntry.create({
          data: {
            studentRecordId: invoice.studentRecordId,
            sessionId: invoice.sessionId,
            direction: 'CREDIT',
            source: 'INVOICE',
            amount: invoice.totalAmount,
            description: `Invoice ${invoice.invoiceNumber} cancelled — charge reversed`,
            invoiceId: id,
            idempotencyKey: `invoice:cancel:${id}`,
            createdById: actor.userId,
          },
        });
      }
      await this.audit.recordTx(tx, {
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'finance.invoice.cancel',
        entityType: 'Invoice',
        entityId: id,
        before: { status: invoice.status },
        after: { status: 'CANCELLED', reason },
      });
    });
    return { id, status: 'CANCELLED' as const };
  }

  // --- Helpers ------------------------------------------------------------------

  private invoiceInclude() {
    return {
      studentRecord: {
        select: { id: true, matriculationNumber: true, surname: true, firstName: true },
      },
      session: { select: { id: true, name: true } },
      semester: { select: { id: true, name: true, sequence: true } },
      lines: {
        orderBy: { id: 'asc' as const },
        select: {
          id: true,
          description: true,
          quantity: true,
          unitAmount: true,
          amount: true,
          feeItem: { select: { feeType: true } },
        },
      },
    };
  }

  /** Serial name, citable by the student at any counter: INV/<session>/<rand>. */
  private mintInvoiceNumber(sessionName: string): string {
    const digits = sessionName.replace(/\D/g, '');
    return `INV/${digits}/${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  private serialize(invoice: SerializedSource) {
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      dueAt: invoice.dueAt,
      totalAmount: invoice.totalAmount.toString(),
      paidAmount: invoice.paidAmount.toString(),
      student: {
        id: invoice.studentRecord.id,
        matriculationNumber: invoice.studentRecord.matriculationNumber,
        name: [invoice.studentRecord.surname, invoice.studentRecord.firstName]
          .filter(Boolean)
          .join(' '),
      },
      session: invoice.session ? { id: invoice.session.id, name: invoice.session.name } : null,
      semester: invoice.semester
        ? {
            id: invoice.semester.id,
            name: invoice.semester.name,
            sequence: invoice.semester.sequence,
          }
        : null,
      lines: invoice.lines.map((l) => ({
        id: l.id,
        description: l.description,
        quantity: l.quantity,
        unitAmount: l.unitAmount.toString(),
        amount: l.amount.toString(),
        feeType: l.feeItem?.feeType ?? null,
      })),
      createdAt: invoice.createdAt,
    };
  }
}

/** The shape of an invoice row fetched with invoiceInclude(). Declared here
 *  (instead of importing the generated Prisma namespace type) so the serializer
 *  stays readable while remaining type-checked against the include. */
interface SerializedSource {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  issuedAt: Date | null;
  dueAt: Date | null;
  totalAmount: bigint;
  paidAmount: bigint;
  createdAt: Date;
  studentRecord: {
    id: string;
    matriculationNumber: string;
    surname: string;
    firstName: string;
  };
  session: { id: string; name: string } | null;
  semester: { id: string; name: string; sequence: number } | null;
  lines: Array<{
    id: string;
    description: string;
    quantity: number;
    unitAmount: bigint;
    amount: bigint;
    feeItem?: { feeType: string } | null;
  }>;
}

function largestZero(value: bigint): bigint {
  return value > 0n ? value : 0n;
}
