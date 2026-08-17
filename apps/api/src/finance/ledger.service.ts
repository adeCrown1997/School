import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BPS_FULL, ClearanceVerdict, clearanceVerdict } from './finance.constants';

/**
 * The read side of the append-only ledger (INV-14). Balances are NEVER stored —
 * they are sums over ledger_entries computed at read time, so a corrupt balance
 * is a computing bug, not a data-integrity incident. Every write to the ledger
 * lives in the invoice / payment / waiver services instead; this service only
 * derives.
 */
export interface LedgerSums {
  debits: bigint;
  credits: bigint;
  /** credits − debits; non-negative means paid in full. */
  balance: bigint;
}

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Σ DEBIT and Σ CREDIT for one student, optionally bounded to a session.
   * Grouping by direction in a single query keeps the two sides consistent
   * even while payments post concurrently.
   */
  async sums(studentRecordId: string, sessionId?: string): Promise<LedgerSums> {
    const groups = await this.prisma.ledgerEntry.groupBy({
      by: ['direction'],
      where: { studentRecordId, ...(sessionId ? { sessionId } : {}) },
      _sum: { amount: true },
    });
    const debits = groups.find((g) => g.direction === 'DEBIT')?._sum.amount ?? 0n;
    const credits = groups.find((g) => g.direction === 'CREDIT')?._sum.amount ?? 0n;
    return { debits, credits, balance: credits - debits };
  }

  /**
   * The §11.4 fee-clearance verdict for a student in a session: a DERIVED
   * query over invoices, approved waivers and approved loan clearances —
   * never a stored flag (INV-16). The threshold comes from the fee schedule
   * the invoice lines were cut from (the most demanding one), defaulting to
   * full payment when no schedule is linked (Q-17 leaves no default).
   */
  async clearance(studentRecordId: string, sessionId: string): Promise<ClearanceVerdict> {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        studentRecordId,
        sessionId,
        status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] },
      },
      select: {
        id: true,
        totalAmount: true,
        paidAmount: true,
        lines: {
          select: {
            feeItem: { select: { schedule: { select: { clearanceThresholdBps: true } } } },
          },
        },
      },
    });

    if (invoices.length === 0) {
      return clearanceVerdict({ invoices: [], loanCovered: 0n, thresholdBps: BPS_FULL });
    }

    const waivedRows = await this.prisma.waiver.groupBy({
      by: ['invoiceId'],
      where: {
        studentRecordId,
        status: 'APPROVED',
        invoice: { sessionId }, // waivers are pinned to an invoice → session
      },
      _sum: { amount: true },
    });
    const waivedByInvoice = new Map(
      waivedRows.map((w) => [w.invoiceId as string, w._sum.amount ?? 0n]),
    );

    const loan = await this.prisma.loanClearance.aggregate({
      where: { studentRecordId, sessionId, status: 'APPROVED' },
      _sum: { amountCovered: true },
    });

    // The strictest applicable threshold governs: if two schedules meet on one
    // student, the higher floor must not be undercut (fail closed).
    const thresholds = invoices
      .flatMap((i) => i.lines.map((l) => l.feeItem?.schedule?.clearanceThresholdBps ?? null))
      .filter((t): t is number => t !== null);
    const thresholdBps = thresholds.length ? Math.max(...thresholds) : BPS_FULL;

    return clearanceVerdict({
      invoices: invoices.map((i) => ({
        totalAmount: i.totalAmount,
        paidAmount: i.paidAmount,
        waivedAmount: waivedByInvoice.get(i.id) ?? 0n,
      })),
      loanCovered: loan._sum.amountCovered ?? 0n,
      thresholdBps,
    });
  }

  /** The student's ledger history, newest first, bigint-safe for the wire. */
  async entries(studentRecordId: string, sessionId?: string, take = 100) {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { studentRecordId, ...(sessionId ? { sessionId } : {}) },
      orderBy: { createdAt: 'desc' },
      take,
      include: { invoice: { select: { invoiceNumber: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      direction: r.direction,
      source: r.source,
      amount: r.amount.toString(),
      description: r.description,
      invoiceNumber: r.invoice?.invoiceNumber ?? null,
      createdAt: r.createdAt,
    }));
  }

  /**
   * The bursary dashboard: billed vs received, outstanding receivables and the
   * waiver pipeline, optionally bounded to one session. All derived — the
   * ledger and the invoice statuses are the inputs, nothing stored here.
   */
  async overview(sessionId?: string) {
    const invoiceWhere = sessionId ? { sessionId } : {};
    const [statusGroups, liveInvoices, pendingWaivers, activeLoans] = await Promise.all([
      this.prisma.invoice.groupBy({
        by: ['status'],
        where: invoiceWhere,
        _sum: { totalAmount: true, paidAmount: true },
        _count: { _all: true },
      }),
      this.prisma.invoice.findMany({
        where: { ...invoiceWhere, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] } },
        select: { id: true },
      }),
      this.prisma.waiver.aggregate({
        where: {
          status: 'PENDING',
          ...(sessionId ? { invoice: { sessionId } } : {}),
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.loanClearance.count({
        where: { status: 'APPROVED', ...(sessionId ? { sessionId } : {}) },
      }),
    ]);

    const byStatus = Object.fromEntries(
      statusGroups.map((g) => [
        g.status,
        {
          count: g._count._all,
          billed: (g._sum.totalAmount ?? 0n).toString(),
          paid: (g._sum.paidAmount ?? 0n).toString(),
        },
      ]),
    );

    // Outstanding = still-live billed totals minus their posted payments.
    // Waivers are subtracted invoice-by-invoice via the clearance input shape.
    let billed = 0n;
    let received = 0n;
    for (const g of statusGroups) {
      if (g.status === 'ISSUED' || g.status === 'PARTIALLY_PAID' || g.status === 'PAID') {
        billed += g._sum.totalAmount ?? 0n;
        received += g._sum.paidAmount ?? 0n;
      }
    }
    const waived = liveInvoices.length
      ? await this.prisma.waiver.aggregate({
          where: {
            status: 'APPROVED',
            invoiceId: { in: liveInvoices.map((i) => i.id) },
          },
          _sum: { amount: true },
        })
      : { _sum: { amount: null } };
    const outstanding = billed - received - (waived._sum.amount ?? 0n);

    return {
      invoices: byStatus,
      billed: billed.toString(),
      received: received.toString(),
      waived: (waived._sum.amount ?? 0n).toString(),
      outstanding: (outstanding > 0n ? outstanding : 0n).toString(),
      pendingWaivers: {
        count: pendingWaivers._count._all,
        amount: (pendingWaivers._sum.amount ?? 0n).toString(),
      },
      approvedLoanClearances: activeLoans,
    };
  }

  /** One student's money picture: identity, session sums and recent entries. */
  async studentLedger(studentRecordId: string, sessionId?: string) {
    const student = await this.loadStudent(studentRecordId);
    const [sums, ledgerEntries, invoices, waivers] = await Promise.all([
      this.sums(studentRecordId, sessionId),
      this.entries(studentRecordId, sessionId, 100),
      this.prisma.invoice.findMany({
        where: { studentRecordId, ...(sessionId ? { sessionId } : {}) },
        orderBy: { createdAt: 'desc' },
        include: {
          session: { select: { id: true, name: true } },
          semester: { select: { name: true, sequence: true } },
        },
      }),
      this.prisma.waiver.findMany({
        where: { studentRecordId },
        orderBy: { createdAt: 'desc' },
        include: { invoice: { select: { invoiceNumber: true } } },
      }),
    ]);
    return {
      student: {
        id: student.id,
        matriculationNumber: student.matriculationNumber,
        name: [student.surname, student.firstName, student.otherNames].filter(Boolean).join(' '),
      },
      sums: {
        debits: sums.debits.toString(),
        credits: sums.credits.toString(),
        balance: sums.balance.toString(),
      },
      entries: ledgerEntries,
      invoices: invoices.map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        status: i.status,
        totalAmount: i.totalAmount.toString(),
        paidAmount: i.paidAmount.toString(),
        issuedAt: i.issuedAt,
        dueAt: i.dueAt,
        session: i.session,
        semester: i.semester,
      })),
      waivers: waivers.map((w) => ({
        id: w.id,
        invoiceNumber: w.invoice?.invoiceNumber ?? null,
        feeType: w.feeType,
        amount: w.amount.toString(),
        reason: w.reason,
        status: w.status,
        createdAt: w.createdAt,
      })),
    };
  }

  /** Clearance verdict with human-readable context for the staff view. */
  async clearanceFor(studentRecordId: string, sessionId: string) {
    const [student, verdict, session] = await Promise.all([
      this.loadStudent(studentRecordId),
      this.clearance(studentRecordId, sessionId),
      this.prisma.academicSession.findUnique({
        where: { id: sessionId },
        select: { id: true, name: true },
      }),
    ]);
    if (!session) throw new NotFoundException('Academic session not found');
    return {
      student: {
        id: student.id,
        matriculationNumber: student.matriculationNumber,
        name: [student.surname, student.firstName, student.otherNames].filter(Boolean).join(' '),
      },
      session,
      invoiced: verdict.invoiced,
      cleared: verdict.cleared,
      billed: verdict.billed.toString(),
      covered: verdict.covered.toString(),
      shortfall: verdict.shortfall.toString(),
    };
  }

  /** Load a student record's scope-free identity or 404. */
  async loadStudent(studentRecordId: string) {
    const student = await this.prisma.studentRecord.findUnique({
      where: { id: studentRecordId },
      select: {
        id: true,
        matriculationNumber: true,
        surname: true,
        firstName: true,
        otherNames: true,
        programmeId: true,
        facultyId: true,
        departmentId: true,
      },
    });
    if (!student) throw new NotFoundException('Student record not found');
    return student;
  }
}
