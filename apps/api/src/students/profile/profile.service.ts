import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Gender, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuthPrincipal } from '../../common/auth-principal';
import { PERMISSIONS } from '../../rbac/permissions.catalog';
import { assertWithinScope, scopeConstraintFor, studentScopeWhere } from '../../rbac/scope.util';
import { Paginated } from '../../common/pagination';
import { StudentsService } from '../students.service';
import {
  CreateChangeRequestDto,
  ListChangeRequestsQueryDto,
  ReviewChangeRequestDto,
  StudentCorrectableField,
  UpdateOwnProfileDto,
} from './dto/profile.dto';
import { RequestContext } from '../../auth/auth.service';

/** The identity fields a student may raise a correction for → the master-record
 *  column they map to (the DB amendment function whitelists the same columns). */
const CORRECTABLE_TO_RECORD: Record<StudentCorrectableField, string> = {
  surname: 'surname',
  firstName: 'firstName',
  otherNames: 'otherNames',
  dateOfBirth: 'dateOfBirth',
  gender: 'gender',
  jambRegistrationNumber: 'jambRegistrationNumber',
};

/**
 * Student self-service (own contact profile) + the protected-field CHANGE
 * REQUEST workflow. This is the ONLY route by which a student influences their
 * master record, and it never mutates identity directly: a student SUBMITS a
 * request; a Registry officer with distinct identity (separation of duties)
 * APPROVES it, at which point the correction is applied through the same
 * amendment function the DB trigger requires. Contact data (StudentProfile) is
 * Class S — freely student-editable and never part of identity.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly students: StudentsService,
  ) {}

  // --- Student self-service ----------------------------------------------

  /** The caller's OWN record (read-only identity) + editable contact profile. */
  async getOwnProfile(actor: AuthPrincipal) {
    const recordId = this.requireOwnRecord(actor);
    const record = await this.prisma.studentRecord.findUnique({
      where: { id: recordId },
      select: {
        id: true,
        studentId: true,
        matriculationNumber: true,
        jambRegistrationNumber: true,
        surname: true,
        firstName: true,
        otherNames: true,
        dateOfBirth: true,
        gender: true,
        currentLevel: true,
        activationState: true,
        faculty: { select: { id: true, name: true, code: true } },
        department: { select: { id: true, name: true, code: true } },
        programme: { select: { id: true, name: true, code: true } },
        admissionSession: { select: { id: true, name: true } },
        studentStatus: { select: { key: true, label: true } },
        profile: true,
      },
    });
    if (!record) throw new NotFoundException('Student record not found');
    return record;
  }

  /** Upsert the caller's OWN contact profile (never touches the master record). */
  async updateOwnProfile(actor: AuthPrincipal, dto: UpdateOwnProfileDto, ctx: RequestContext) {
    const recordId = this.requireOwnRecord(actor);

    const data = {
      phone: dto.phone?.trim() ?? undefined,
      personalEmail: dto.personalEmail?.trim().toLowerCase() ?? undefined,
      addressLine: dto.addressLine?.trim() ?? undefined,
      city: dto.city?.trim() ?? undefined,
      state: dto.state?.trim() ?? undefined,
      country: dto.country?.trim() ?? undefined,
      emergencyContactName: dto.emergencyContactName?.trim() ?? undefined,
      emergencyContactPhone: dto.emergencyContactPhone?.trim() ?? undefined,
      emergencyContactRelation: dto.emergencyContactRelation?.trim() ?? undefined,
    } satisfies Prisma.StudentProfileUpdateInput;

    const profile = await this.prisma.studentProfile.upsert({
      where: { studentRecordId: recordId },
      update: data,
      create: { studentRecordId: recordId, ...data },
    });

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'student.profile.update',
      entityType: 'StudentProfile',
      entityId: profile.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return profile;
  }

  /** Raise a correction request for a protected identity field (own record). */
  async createChangeRequest(
    actor: AuthPrincipal,
    dto: CreateChangeRequestDto,
    ctx: RequestContext,
  ) {
    const recordId = this.requireOwnRecord(actor);
    const field = CORRECTABLE_TO_RECORD[dto.fieldKey];

    const record = await this.prisma.studentRecord.findUnique({ where: { id: recordId } });
    if (!record) throw new NotFoundException('Student record not found');

    const requested = dto.requestedValue.trim();
    const currentValue = this.readCurrent(record as Record<string, unknown>, dto.fieldKey);
    // Validate the shape of the requested value up-front (approval will re-coerce).
    this.coerceRequested(dto.fieldKey, requested);
    if (currentValue !== null && currentValue === requested) {
      throw new BadRequestException('The requested value matches the current value');
    }

    const openExisting = await this.prisma.profileChangeRequest.findFirst({
      where: { studentRecordId: recordId, fieldKey: field, status: 'PENDING' },
      select: { id: true },
    });
    if (openExisting) {
      throw new ConflictException('You already have a pending request for this field');
    }

    const created = await this.prisma.profileChangeRequest.create({
      data: {
        studentRecordId: recordId,
        requestedById: actor.userId,
        fieldKey: field,
        currentValue,
        requestedValue: requested,
        reason: dto.reason.trim(),
        documentKey: dto.documentKey?.trim() ?? null,
        status: 'PENDING',
      },
    });

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'change_request.create',
      entityType: 'ProfileChangeRequest',
      entityId: created.id,
      metadata: { fieldKey: field },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return created;
  }

  /** The caller's own change requests (most recent first). */
  async listOwnChangeRequests(actor: AuthPrincipal): Promise<unknown[]> {
    const recordId = this.requireOwnRecord(actor);
    return this.prisma.profileChangeRequest.findMany({
      where: { studentRecordId: recordId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Cancel a PENDING request the caller raised. */
  async cancelOwnChangeRequest(actor: AuthPrincipal, id: string, ctx: RequestContext) {
    const recordId = this.requireOwnRecord(actor);
    const cr = await this.prisma.profileChangeRequest.findUnique({ where: { id } });
    if (!cr || cr.studentRecordId !== recordId) {
      throw new NotFoundException('Change request not found');
    }
    if (cr.status !== 'PENDING') {
      throw new BadRequestException('Only a pending request can be cancelled');
    }
    const updated = await this.prisma.profileChangeRequest.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'change_request.cancel',
      entityType: 'ProfileChangeRequest',
      entityId: id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return updated;
  }

  // --- Registry review ----------------------------------------------------

  /** Paginated change requests visible within the reviewer's scope. */
  async listChangeRequests(
    query: ListChangeRequestsQueryDto,
    actor: AuthPrincipal,
  ): Promise<Paginated<unknown>> {
    const constraint = scopeConstraintFor(actor, PERMISSIONS.CHANGE_REQUESTS_VIEW);
    const scopeWhere = studentScopeWhere(constraint);

    const filters: Prisma.ProfileChangeRequestWhereInput = {};
    if (query.status) filters.status = query.status;
    if (query.studentRecordId) filters.studentRecordId = query.studentRecordId;
    if (query.fieldKey) filters.fieldKey = query.fieldKey;
    if (scopeWhere) {
      filters.studentRecord = scopeWhere as Prisma.StudentRecordWhereInput;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.profileChangeRequest.findMany({
        where: filters,
        orderBy: { createdAt: query.status === 'PENDING' ? 'asc' : 'desc' },
        include: {
          studentRecord: {
            select: { id: true, matriculationNumber: true, surname: true, firstName: true },
          },
        },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.profileChangeRequest.count({ where: filters }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /**
   * Approve or reject a pending request. Approval applies the correction through
   * StudentsService.applyProtectedAmendment (the sole protected-write path) and
   * marks the request APPROVED IN THE SAME TRANSACTION, so the record change and
   * its resolution commit atomically. Separation of duties (reviewer ≠ requester)
   * is enforced here AND by a DB CHECK constraint.
   */
  async reviewChangeRequest(
    id: string,
    dto: ReviewChangeRequestDto,
    actor: AuthPrincipal,
    ctx: RequestContext,
  ) {
    const cr = await this.prisma.profileChangeRequest.findUnique({
      where: { id },
      include: {
        studentRecord: { select: { facultyId: true, departmentId: true, programmeId: true } },
      },
    });
    if (!cr) throw new NotFoundException('Change request not found');
    if (cr.status !== 'PENDING') {
      throw new BadRequestException('This request has already been decided');
    }
    if (cr.requestedById === actor.userId) {
      throw new ForbiddenException(
        'You cannot review your own change request (separation of duties)',
      );
    }

    assertWithinScope(scopeConstraintFor(actor, PERMISSIONS.CHANGE_REQUESTS_REVIEW), {
      facultyId: cr.studentRecord.facultyId,
      departmentId: cr.studentRecord.departmentId,
      programmeId: cr.studentRecord.programmeId,
    });

    const reviewNote = dto.reviewNote?.trim() || null;

    if (dto.decision === 'REJECT') {
      const updated = await this.prisma.profileChangeRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          reviewedById: actor.userId,
          reviewNote,
          reviewedAt: new Date(),
        },
      });
      await this.audit.record({
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'change_request.reject',
        entityType: 'ProfileChangeRequest',
        entityId: id,
        metadata: { fieldKey: cr.fieldKey },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated;
    }

    // APPROVE — coerce the stored text to a typed value and amend atomically.
    const field = cr.fieldKey as StudentCorrectableField;
    const value = this.coerceRequested(field, cr.requestedValue);

    await this.students.applyProtectedAmendment(
      cr.studentRecordId,
      { [field]: value },
      {
        action: 'change_request.approve',
        reason: reviewNote ?? undefined,
        changeRequestId: id,
      },
      actor,
      async (tx) => {
        await tx.profileChangeRequest.update({
          where: { id },
          data: {
            status: 'APPROVED',
            reviewedById: actor.userId,
            reviewNote,
            reviewedAt: new Date(),
          },
        });
      },
    );

    return this.prisma.profileChangeRequest.findUnique({ where: { id } });
  }

  // --- Internals ----------------------------------------------------------

  private requireOwnRecord(actor: AuthPrincipal): string {
    if (!actor.studentRecordId) {
      throw new ForbiddenException('This action is only available to a student account');
    }
    return actor.studentRecordId;
  }

  /** Read the current value of a correctable field as a display string. */
  private readCurrent(
    record: Record<string, unknown>,
    field: StudentCorrectableField,
  ): string | null {
    const raw = record[CORRECTABLE_TO_RECORD[field]];
    if (raw === null || raw === undefined) return null;
    if (raw instanceof Date) return raw.toISOString().slice(0, 10);
    return String(raw);
  }

  /**
   * Validate + coerce a requested text value to the type the master record and
   * amendment function expect. Throws BadRequestException on malformed input.
   */
  private coerceRequested(field: StudentCorrectableField, value: string): unknown {
    switch (field) {
      case 'dateOfBirth': {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date of birth');
        if (d.getTime() > Date.now()) {
          throw new BadRequestException('Date of birth cannot be in the future');
        }
        return d;
      }
      case 'gender': {
        const upper = value.toUpperCase();
        if (!(Object.values(Gender) as string[]).includes(upper)) {
          throw new BadRequestException('Invalid gender value');
        }
        return upper;
      }
      default:
        return value;
    }
  }
}
