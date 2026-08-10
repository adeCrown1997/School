import {
  INestApplication,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Wraps PrismaClient with Nest lifecycle hooks and the amendment helper — the
 * ONLY path through which protected student-record columns may change.
 *
 * Enforcement note: the application DB role is granted UPDATE on NON-protected
 * columns only, so it cannot write protected identity columns directly. The
 * amendment goes through a SECURITY DEFINER SQL function (eportal_amend_student,
 * see guards.sql) that runs with owner privileges, sets a transaction-local GUC
 * (`eportal.amendment_id`) the guard trigger checks, and whitelists the columns
 * it may touch. Because amendStudentRecord() is the sole caller in the app, any
 * code path that does not go through it is physically unable to mutate protected
 * fields — both by grant (L1) and by trigger (L2).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async enableShutdownHooks(app: INestApplication): Promise<void> {
    process.on('beforeExit', () => {
      void app.close();
    });
  }

  /**
   * Apply an approved amendment to protected student-record columns via the
   * SECURITY DEFINER function eportal_amend_student(). MUST be called inside a
   * transaction (`tx`) so the amendment, its GUC unlock, and the caller's audit
   * write commit atomically.
   *
   * @param changesSnake  protected columns to set, keyed by SNAKE_CASE db column
   *                      name (only whitelisted keys are accepted DB-side).
   *                      A key mapped to `undefined` should be omitted by the
   *                      caller; present keys are applied (null clears the
   *                      nullable ones the function allows).
   *
   * Callers must still write an AuditEvent describing the amendment — the
   * function unlocks the trigger and applies the change; it does not record
   * business intent.
   */
  async amendStudentRecord(
    tx: PrismaTx,
    recordId: string,
    changesSnake: Record<string, unknown>,
    amendmentId: string,
    actorId: string,
  ): Promise<void> {
    const json = JSON.stringify(changesSnake);
    await tx.$executeRaw`SELECT eportal_amend_student(${recordId}::uuid, ${json}::jsonb, ${amendmentId}, ${actorId}::uuid)`;
  }
}

/**
 * The transactional Prisma handle passed to $transaction callbacks. Exposed as
 * a type so services can accept either the root client or a tx client.
 */
export type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
