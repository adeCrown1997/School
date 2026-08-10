import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, PrismaTx } from '../prisma/prisma.service';

export interface AuditInput {
  actorId?: string | null;
  actorLabel?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Writes tamper-evident audit records. audit_events is append-only at the DB
 * level (triggers + revoked UPDATE/DELETE grants), so this service only ever
 * INSERTs. Accepts an optional transaction client so an audit row commits
 * atomically with the operation it describes.
 *
 * Audit writes must never break the business operation: a failure is logged
 * but not rethrown when called via `record`. Use `recordTx` inside a
 * transaction where atomicity IS required (the surrounding tx will roll back).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Best-effort audit outside a transaction. Never throws. */
  async record(input: AuditInput): Promise<void> {
    try {
      await this.write(this.prisma, input);
    } catch (err) {
      this.logger.error(
        `Failed to write audit event ${input.action} on ${input.entityType}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** Transactional audit — participates in (and can roll back) the caller's tx. */
  async recordTx(tx: PrismaTx, input: AuditInput): Promise<void> {
    await this.write(tx, input);
  }

  private async write(client: PrismaService | PrismaTx, input: AuditInput) {
    await client.auditEvent.create({
      data: {
        actorId: input.actorId ?? null,
        actorLabel: input.actorLabel ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: input.metadata,
        beforeData: input.before,
        afterData: input.after,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  }
}
