import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthPrincipal } from '../common/auth-principal';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import { dashboardScopeFor } from './dashboards.scope';

/**
 * The bursary dashboard. Finance is institution-wide (the bursary's
 * finance.view is granted at GLOBAL scope), so revenue and ledger figures are
 * whole figures; anything that reaches a student is still constrained to the
 * actor's scope so the shape of the response never widens an actor's reach.
 *
 * Revenue is billed vs received straight from the invoice ledger projections,
 * outstanding = still-live billed totals minus posted payments minus approved
 * waivers (the same derivation as the /finance/overview read side), and the
 * recent-transaction stream is the ledger itself.
 */
@Injectable()
export class FinanceDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(actor: AuthPrincipal, sessionId?: string) {
    const scope = dashboardScopeFor(actor, PERMISSIONS.DASHBOARD_BURSAR_VIEW);
    const invoiceWhere: Prisma.InvoiceWhereInput = {
      studentRecord: scope.studentWhere,
      ...(sessionId ? { sessionId } : {}),
    };

    const [statusGroups, liveInvoices, pendingWaivers, pendingLoans, recentTransactions] =
      await Promise.all([
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
            studentRecord: scope.studentWhere,
            ...(sessionId ? { invoice: { sessionId } } : {}),
          },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.prisma.loanClearance.count({
          where: { status: 'PENDING', studentRecord: scope.studentWhere },
        }),
        this.prisma.ledgerEntry.findMany({
          where: { studentRecord: scope.studentWhere, ...(sessionId ? { sessionId } : {}) },
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: {
            id: true,
            direction: true,
            source: true,
            amount: true,
            description: true,
            createdAt: true,
            invoice: { select: { invoiceNumber: true } },
            studentRecord: { select: { matriculationNumber: true } },
          },
        }),
      ]);

    let billed = 0n;
    let received = 0n;
    for (const g of statusGroups) {
      if (g.status === 'ISSUED' || g.status === 'PARTIALLY_PAID' || g.status === 'PAID') {
        billed += g._sum.totalAmount ?? 0n;
        received += g._sum.paidAmount ?? 0n;
      }
    }

    const waived = liveInvoices.length
      ? (
          await this.prisma.waiver.aggregate({
            where: { status: 'APPROVED', invoiceId: { in: liveInvoices.map((i) => i.id) } },
            _sum: { amount: true },
          })
        )._sum.amount ?? 0n
      : 0n;

    // Payment-verification queue: intents the provider says are settled but the
    // ledger has not posted yet. These are the bursary's "verify" actions.
    const verificationQueue = await this.prisma.paymentIntent.groupBy({
      by: ['status'],
      where: {
        studentRecord: scope.studentWhere,
        status: { in: ['PAID', 'UNDERPAID', 'OVERPAID'] },
      },
      _count: true,
      orderBy: { status: 'asc' },
    });

    const outstanding = billed - received - waived;

    return {
      scope: scope.summary,
      revenue: {
        billed: billed.toString(),
        received: received.toString(),
        waived: waived.toString(),
        outstanding: (outstanding > 0n ? outstanding : 0n).toString(),
      },
      invoices: {
        byStatus: statusGroups.map((g) => ({
          status: g.status,
          count: g._count._all,
          billed: (g._sum.totalAmount ?? 0n).toString(),
          paid: (g._sum.paidAmount ?? 0n).toString(),
        })),
      },
      recentTransactions: recentTransactions.map((t) => ({
        id: t.id,
        direction: t.direction,
        source: t.source,
        amount: t.amount.toString(),
        description: t.description,
        invoiceNumber: t.invoice?.invoiceNumber ?? null,
        matriculationNumber: t.studentRecord.matriculationNumber,
        createdAt: t.createdAt,
      })),
      verification: {
        awaitingLedgerPost: verificationQueue.map((g) => ({
          status: g.status,
          count: g._count,
        })),
      },
      pendingActions: {
        waivers: {
          count: pendingWaivers._count._all,
          amount: (pendingWaivers._sum.amount ?? 0n).toString(),
        },
        loanClearances: pendingLoans,
      },
    };
  }
}
