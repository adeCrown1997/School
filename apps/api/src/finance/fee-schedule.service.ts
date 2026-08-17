import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal } from '../common/auth-principal';
import { minorFromString } from './finance.constants';
import { CreateFeeScheduleDto, FeeItemDto, UpdateFeeScheduleDto } from './dto/finance.dto';

/**
 * Fee schedules & items (docs/03 §11.2). A schedule is one programme's fee
 * structure for a session: a set of fee items (tuition, faculty due, ICT levy…)
 * plus the clearance threshold the invoices cut from it inherit.
 *
 * The lifecycle asymmetry the service enforces: schedules are freely editable
 * while DRAFT-equivalent (no issued invoice yet), but once an invoice references
 * them their items are FROZEN — §11.2 says a fee structure may not mutate
 * mid-collection, and invoice lines snapshot their amounts at issue anyway
 * (INV: snapshot at issue).
 */
@Injectable()
export class FeeScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(includeInactive = false) {
    const schedules = await this.prisma.feeSchedule.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: {
        programme: { select: { id: true, code: true, name: true } },
        session: { select: { id: true, name: true } },
        Semester: { select: { id: true, name: true } },
        items: { orderBy: [{ sortOrder: 'asc' }, { feeType: 'asc' }] },
      },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(
      schedules.map(async (s) => ({ ...s, invoiceCount: await this.countInvoiced(s.id) })),
    );
  }

  async get(id: string) {
    const schedule = await this.prisma.feeSchedule.findUnique({
      where: { id },
      include: {
        programme: { select: { id: true, code: true, name: true } },
        session: { select: { id: true, name: true } },
        Semester: { select: { id: true, name: true } },
        items: { orderBy: [{ sortOrder: 'asc' }, { feeType: 'asc' }] },
      },
    });
    if (!schedule) throw new NotFoundException('Fee schedule not found');
    return { ...schedule, invoiceCount: await this.countInvoiced(id) };
  }

  /** Invoices cut from a schedule (through their snapshotted fee items). */
  private countInvoiced(scheduleId: string): Promise<number> {
    return this.prisma.invoice.count({
      where: {
        lines: { some: { feeItem: { scheduleId } } },
        status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] },
      },
    });
  }

  /** A session-scoped schedule for a programme must not duplicate. */
  async create(dto: CreateFeeScheduleDto, actor: AuthPrincipal) {
    const { items } = dto;
    if (!items.length) throw new BadRequestException('A fee schedule needs at least one fee item');

    const programme = await this.prisma.programme.findUnique({
      where: { id: dto.programmeId },
      select: { id: true, code: true },
    });
    if (!programme) throw new NotFoundException('Programme not found');

    await this.assertItems(items, dto.programmeId, dto.sessionId, dto.semesterId);

    const schedule = await this.prisma.feeSchedule.create({
      data: {
        programmeId: dto.programmeId,
        name: dto.name.trim(),
        sessionId: dto.sessionId ?? null,
        semesterId: dto.semesterId ?? null,
        clearanceThresholdBps: dto.clearanceThresholdBps ?? 10000,
        isActive: dto.isActive ?? true,
        items: {
          create: items.map((item, i) => ({
            feeType: item.feeType.trim().toUpperCase(),
            label: item.label.trim(),
            amount: BigInt(item.amount),
            isMandatory: item.isMandatory ?? true,
            sortOrder: item.sortOrder ?? i,
          })),
        },
      },
      include: { items: true },
    });

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'finance.schedule.create',
      entityType: 'FeeSchedule',
      entityId: schedule.id,
      after: { programme: programme.code, items: schedule.items.length },
    });
    return schedule;
  }

  /** Name / threshold / active flag only — the items move through updateItems. */
  async update(id: string, dto: UpdateFeeScheduleDto, actor: AuthPrincipal) {
    const existing = await this.get(id);
    const before = {
      name: existing.name,
      clearanceThresholdBps: existing.clearanceThresholdBps,
      isActive: existing.isActive,
    };

    const updated = await this.prisma.feeSchedule.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.clearanceThresholdBps !== undefined
          ? { clearanceThresholdBps: dto.clearanceThresholdBps }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: { items: true },
    });

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'finance.schedule.update',
      entityType: 'FeeSchedule',
      entityId: id,
      before,
      after: {
        name: updated.name,
        clearanceThresholdBps: updated.clearanceThresholdBps,
        isActive: updated.isActive,
      },
    });
    return updated;
  }

  /**
   * Whole-set replacement of a schedule's items. Allowed only while nothing has
   * been invoiced against the schedule — otherwise the ledger's snapshot at the
   * invoice would diverge from the structure that issued it.
   */
  async updateItems(id: string, items: FeeItemDto[], actor: AuthPrincipal) {
    const existing = await this.get(id);
    const invoiced = await this.countInvoiced(id);
    if (invoiced > 0) {
      throw new ConflictException(
        `${invoiced} invoice(s) already reference this schedule — its items are frozen. Create a new schedule for the revised structure.`,
      );
    }
    if (!items.length) throw new BadRequestException('A fee schedule needs at least one fee item');
    await this.assertItems(
      items,
      existing.programmeId,
      existing.sessionId ?? undefined,
      existing.semesterId ?? undefined,
    );

    const schedule = await this.prisma.$transaction(async (tx) => {
      await tx.feeItem.deleteMany({ where: { scheduleId: id } });
      await tx.feeItem.createMany({
        data: items.map((item, i) => ({
          scheduleId: id,
          feeType: item.feeType.trim().toUpperCase(),
          label: item.label.trim(),
          amount: BigInt(item.amount),
          isMandatory: item.isMandatory ?? true,
          sortOrder: item.sortOrder ?? i,
        })),
      });
      return tx.feeSchedule.findUnique({
        where: { id },
        include: { items: { orderBy: [{ sortOrder: 'asc' }, { feeType: 'asc' }] } },
      });
    });

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'finance.schedule.replaceItems',
      entityType: 'FeeSchedule',
      entityId: id,
      before: { itemTypes: existing.items.map((i) => i.feeType) },
      after: { itemTypes: (schedule?.items ?? []).map((i) => i.feeType) },
    });
    return schedule;
  }

  /** feeType must be unique per schedule and the amount must be valid. */
  private async assertItems(
    items: FeeItemDto[],
    programmeId: string,
    sessionId?: string,
    semesterId?: string,
  ): Promise<void> {
    const types = items.map((i) => i.feeType.trim().toUpperCase());
    if (new Set(types).size !== types.length) {
      throw new BadRequestException('feeType must be unique within a schedule');
    }
    for (const item of items) {
      const amount = minorFromString(item.amount);
      if (amount <= 0n) {
        throw new BadRequestException(`Fee item ${item.feeType}: amount must be positive`);
      }
    }

    const duplicate = await this.prisma.feeSchedule.findFirst({
      where: {
        programmeId,
        // Null-safe matching: an open-ended schedule (no session) collides with
        // a session-specific one for the same programme.
        sessionId: sessionId ?? null,
        semesterId: semesterId ?? null,
      },
      select: { id: true, name: true },
    });
    if (duplicate) {
      throw new ConflictException(`Fee schedule "${duplicate.name}" already covers this scope`);
    }
  }
}
