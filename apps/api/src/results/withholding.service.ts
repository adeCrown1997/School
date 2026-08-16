import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal } from '../common/auth-principal';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import { assertWithinScope, scopeConstraintFor, studentScopeWhere } from '../rbac/scope.util';
import { CreateWithholdingDto, ListWithholdingsQueryDto } from './dto/results.dto';

/**
 * Result withholdings (docs/03 §10.7).
 *
 * A withholding is an EXPLICIT, reversible, reasoned block on a student's
 * results — never a deletion or a hidden row. The student is told the reason;
 * a blank "result not found" would be indistinguishable from a system fault.
 * One ACTIVE withholding per (student, offering|session) pair: placing a second
 * one adds nothing but noise.
 */
@Injectable()
export class WithholdingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateWithholdingDto, actor: AuthPrincipal) {
    const record = await this.prisma.studentRecord.findUnique({
      where: { id: dto.studentRecordId },
      select: {
        id: true,
        matriculationNumber: true,
        facultyId: true,
        departmentId: true,
        programmeId: true,
      },
    });
    if (!record) throw new NotFoundException('Student record not found');
    assertWithinScope(scopeConstraintFor(actor, PERMISSIONS.RESULTS_WITHHOLD), record);

    const duplicate = await this.prisma.resultWithholding.findFirst({
      where: {
        studentRecordId: dto.studentRecordId,
        status: 'ACTIVE',
        offeringId: dto.offeringId ?? null,
        sessionId: dto.sessionId ?? null,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        'An ACTIVE withholding already covers this student and scope. Release it instead.',
      );
    }

    const withholding = await this.prisma.resultWithholding.create({
      data: {
        studentRecordId: dto.studentRecordId,
        sessionId: dto.sessionId,
        offeringId: dto.offeringId,
        reason: dto.reason,
        placedById: actor.userId,
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'results.withhold.place',
      entityType: 'ResultWithholding',
      entityId: withholding.id,
      after: {
        matriculationNumber: record.matriculationNumber,
        reason: dto.reason,
        sessionId: dto.sessionId ?? null,
        offeringId: dto.offeringId ?? null,
      },
    });
    return withholding;
  }

  async list(q: ListWithholdingsQueryDto, actor: AuthPrincipal) {
    const constraint = scopeConstraintFor(actor, PERMISSIONS.RESULTS_VIEW);
    const scopeWhere = studentScopeWhere(constraint) as Prisma.StudentRecordWhereInput | undefined;

    const where: Prisma.ResultWithholdingWhereInput = {
      studentRecordId: q.studentRecordId,
    };
    if (!q.includeReleased) where.status = 'ACTIVE';
    if (scopeWhere) where.studentRecord = scopeWhere;

    return this.prisma.resultWithholding.findMany({
      where,
      include: {
        studentRecord: {
          select: { matriculationNumber: true, surname: true, firstName: true },
        },
        offering: {
          include: { course: { select: { code: true, title: true } } },
        },
        session: { select: { id: true, name: true } },
      },
      orderBy: { placedAt: 'desc' },
    });
  }

  async release(id: string, actor: AuthPrincipal, note?: string) {
    const withholding = await this.prisma.resultWithholding.findUnique({
      where: { id },
      include: {
        studentRecord: {
          select: {
            id: true,
            matriculationNumber: true,
            facultyId: true,
            departmentId: true,
            programmeId: true,
          },
        },
      },
    });
    if (!withholding) throw new NotFoundException('Withholding not found');
    if (withholding.status === 'RELEASED') {
      throw new ConflictException('This withholding has already been released');
    }
    assertWithinScope(
      scopeConstraintFor(actor, PERMISSIONS.RESULTS_WITHHOLD),
      withholding.studentRecord,
    );
    if (withholding.placedById === actor.userId && note && note.trim().length === 0) {
      throw new BadRequestException('A note is required when releasing your own withholding');
    }

    const released = await this.prisma.resultWithholding.update({
      where: { id },
      data: { status: 'RELEASED', releasedById: actor.userId, releasedAt: new Date() },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'results.withhold.release',
      entityType: 'ResultWithholding',
      entityId: id,
      before: { status: 'ACTIVE', reason: withholding.reason },
      after: { status: 'RELEASED', note: note?.trim() || null },
    });
    return released;
  }

  /** ACTIVE withholdings covering a student's session (used by the student view,
   *  exam-card gating and transcript eligibility). */
  async activeFor(studentRecordId: string, sessionId?: string) {
    return this.prisma.resultWithholding.findMany({
      where: {
        studentRecordId,
        status: 'ACTIVE',
        ...(sessionId ? { OR: [{ sessionId }, { sessionId: null }] } : {}),
      },
      include: {
        offering: { include: { course: { select: { code: true } } } },
        session: { select: { name: true } },
      },
      orderBy: { placedAt: 'desc' },
    });
  }
}
