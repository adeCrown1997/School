import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal } from '../common/auth-principal';
import { RecordReconciliationDto } from './dto/finance.dto';

/**
 * Daily settlement reconciliation (docs/03 §11.3 rule 7, §11.5). Webhooks and
 * polling prove individual payments; reconciliation proves the provider's own
 * books agree with ours. Discrepancies are SURFACED — money received by the
 * provider but never posted is exactly what this catches.
 *
 * v1 scope: the bursary enters the provider's settlement totals for a day
 * (file upload of the report is deferred — reportFileId is nullable), and the
 * service computes the ledger side from posted payment intents.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(provider?: string) {
    const rows = await this.prisma.paymentReconciliation.findMany({
      where: provider ? { provider } : {},
      orderBy: { settlementDate: 'desc' },
      take: 100,
    });
    return rows.map((r) => this.serialize(r));
  }

  /**
   * Record one day's provider settlement. The ledger side is computed, never
   * supplied: Σ of posted intents (PAID/POSTED/UNDERPAID, excluding reversed)
   * whose provider matches, paid on the settlement date. providerTotal −
   * ledgerTotal is the discrepancy, and it is stored verbatim — a zero is
   * stored as 0, never as "not checked".
   */
  async record(dto: RecordReconciliationDto, actor: AuthPrincipal) {
    const provider = dto.provider.trim().toUpperCase();
    const settlementDate = new Date(dto.settlementDate);
    if (Number.isNaN(settlementDate.getTime())) {
      throw new ConflictException('settlementDate must be a valid date');
    }
    let providerTotal: bigint;
    try {
      providerTotal = BigInt(dto.providerTotal);
    } catch {
      throw new ConflictException('providerTotal must be an integer in minor units');
    }

    const dayStart = new Date(settlementDate);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const ledger = await this.prisma.paymentIntent.aggregate({
      where: {
        provider,
        status: { in: ['POSTED_TO_LEDGER', 'UNDERPAID'] },
        paidAt: { gte: dayStart, lt: dayEnd },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const ledgerTotal = ledger._sum.amount ?? 0n;
    const matchedCount = ledger._count._all;
    const discrepancy = providerTotal - ledgerTotal;

    // A mismatch is stored verbatim and surfaced — never quietly marked clean.
    // The row stays PENDING until an officer resolves it (§11.5).
    const status = discrepancy === 0n ? 'APPROVED' : 'PENDING';

    const row = await this.prisma.$transaction(async (tx) => {
      const recon = await tx.paymentReconciliation.upsert({
        where: { provider_settlementDate: { provider, settlementDate: dayStart } },
        create: {
          provider,
          settlementDate: dayStart,
          providerTotal,
          ledgerTotal,
          discrepancy,
          matchedCount,
          unmatchedCount: discrepancy !== 0n ? 1 : 0,
          status,
          reconciledById: actor.userId,
          reconciledAt: new Date(),
          notes: dto.notes ?? null,
        },
        update: {
          providerTotal,
          ledgerTotal,
          discrepancy,
          matchedCount,
          unmatchedCount: discrepancy !== 0n ? 1 : 0,
          status,
          reconciledById: actor.userId,
          reconciledAt: new Date(),
          notes: dto.notes ?? null,
        },
      });
      await this.audit.recordTx(tx, {
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'finance.reconciliation.record',
        entityType: 'PaymentReconciliation',
        entityId: recon.id,
        metadata: {
          provider,
          settlementDate: dayStart.toISOString(),
          providerTotal: providerTotal.toString(),
          ledgerTotal: ledgerTotal.toString(),
          discrepancy: discrepancy.toString(),
        },
      });
      return recon;
    });

    if (discrepancy !== 0n) {
      throw new ConflictException(
        `Reconciliation recorded with a discrepancy of ${discrepancy.toString()} minor units — ` +
          'provider settlement does not match posted payments. Review before trusting this day.',
      );
    }
    return this.serialize(row);
  }

  /** Resolve the discrepancy after manual review, with an explanation. */
  async resolve(id: string, actor: AuthPrincipal, notes: string) {
    const row = await this.prisma.paymentReconciliation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Reconciliation record not found');
    if (row.status !== 'PENDING') {
      throw new ConflictException('Only a pending (discrepant) reconciliation can be resolved');
    }
    const resolved = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.paymentReconciliation.update({
        where: { id },
        data: { status: 'APPROVED', reconciledById: actor.userId, reconciledAt: new Date(), notes },
      });
      await this.audit.recordTx(tx, {
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'finance.reconciliation.resolve',
        entityType: 'PaymentReconciliation',
        entityId: id,
        metadata: { discrepancy: row.discrepancy.toString(), notes },
      });
      return updated;
    });
    return this.serialize(resolved);
  }

  private serialize(r: {
    id: string;
    provider: string;
    settlementDate: Date;
    providerTotal: bigint;
    ledgerTotal: bigint;
    discrepancy: bigint;
    matchedCount: number;
    unmatchedCount: number;
    status: string;
    reconciledAt: Date | null;
    notes: string | null;
    createdAt: Date;
  }) {
    return {
      id: r.id,
      provider: r.provider,
      settlementDate: r.settlementDate,
      providerTotal: r.providerTotal.toString(),
      ledgerTotal: r.ledgerTotal.toString(),
      discrepancy: r.discrepancy.toString(),
      matchedCount: r.matchedCount,
      unmatchedCount: r.unmatchedCount,
      status: r.status,
      reconciledAt: r.reconciledAt,
      notes: r.notes,
      createdAt: r.createdAt,
    };
  }
}
