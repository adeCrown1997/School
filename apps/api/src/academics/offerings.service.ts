import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StructureService } from '../structure/structure.service';
import { AuthPrincipal } from '../common/auth-principal';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import { assertDepartmentWithinScope, scopeConstraintFor } from '../rbac/scope.util';
import { CreateOfferingDto, UpdateOfferingDto } from './dto/academics.dto';

/**
 * Course offerings — a course made available in one semester of one session.
 *
 * This is the DEFINITION side only. Registration against an offering (and the
 * seat accounting that goes with it) belongs to the registration module, which
 * is why nothing here ever writes `seatsTaken`: that counter is maintained
 * where seats are actually claimed, under the CHECK constraint in guards.sql
 * that forbids it exceeding capacity. Treating it as read-only here keeps a
 * single writer for the value and avoids two code paths disagreeing about it.
 *
 * The lifecycle is DRAFT → OPEN → CLOSED. DRAFT is invisible to students; OPEN
 * accepts registration; CLOSED stops it without deleting anything, because
 * registration lines reference the offering permanently.
 */
@Injectable()
export class OfferingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly structure: StructureService,
  ) {}

  // --- Reads --------------------------------------------------------------

  /**
   * Reads are not scope-narrowed, for the same reason as the course catalogue:
   * a student registering for a service course taught by another department must
   * be able to see it. `status` defaults to unfiltered so administrators can see
   * their own drafts; callers serving students pass status=OPEN.
   */
  async list(filter: {
    sessionId?: string;
    semesterId?: string;
    courseId?: string;
    departmentId?: string;
    status?: 'DRAFT' | 'OPEN' | 'CLOSED';
    q?: string;
  }) {
    const where: Prisma.CourseOfferingWhereInput = {
      sessionId: filter.sessionId,
      semesterId: filter.semesterId,
      courseId: filter.courseId,
      departmentId: filter.departmentId,
      status: filter.status,
    };
    if (filter.q?.trim()) {
      const q = filter.q.trim();
      where.course = {
        OR: [
          { code: { contains: q, mode: 'insensitive' } },
          { title: { contains: q, mode: 'insensitive' } },
        ],
      };
    }

    const rows = await this.prisma.courseOffering.findMany({
      where,
      include: {
        course: {
          select: { id: true, code: true, title: true, creditUnits: true, level: true },
        },
        session: { select: { id: true, name: true } },
        semester: { select: { id: true, name: true, sequence: true } },
        department: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ semester: { sequence: 'asc' } }, { course: { code: 'asc' } }],
    });
    return rows.map((r) => this.withAvailability(r));
  }

  async get(id: string) {
    const offering = await this.prisma.courseOffering.findUnique({
      where: { id },
      include: {
        course: {
          select: { id: true, code: true, title: true, creditUnits: true, level: true },
        },
        session: { select: { id: true, name: true } },
        semester: { select: { id: true, name: true, sequence: true } },
        department: { select: { id: true, code: true, name: true } },
      },
    });
    if (!offering) throw new NotFoundException('Course offering not found');
    return this.withAvailability(offering);
  }

  // --- Writes -------------------------------------------------------------

  async create(dto: CreateOfferingDto, actor: AuthPrincipal) {
    const course = await this.prisma.course.findUnique({
      where: { id: dto.courseId },
      select: { id: true, code: true, isActive: true, departmentId: true },
    });
    if (!course) throw new BadRequestException('Course not found');
    if (!course.isActive) {
      throw new BadRequestException(`${course.code} is inactive and cannot be offered`);
    }

    // Authority follows the TEACHING department where one is given, else the
    // course's owner. A department cannot mount a course on another's timetable.
    await this.assertCanManage(dto.departmentId ?? course.departmentId, actor);

    const semester = await this.assertSemesterInSession(dto.semesterId, dto.sessionId);

    try {
      const offering = await this.prisma.courseOffering.create({
        data: {
          courseId: dto.courseId,
          sessionId: dto.sessionId,
          semesterId: dto.semesterId,
          departmentId: dto.departmentId ?? course.departmentId,
          capacity: dto.capacity ?? null,
          createdById: actor.userId,
        },
      });
      await this.audit.record({
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'offering.create',
        entityType: 'CourseOffering',
        entityId: offering.id,
        after: {
          courseId: offering.courseId,
          sessionId: offering.sessionId,
          semesterId: offering.semesterId,
          departmentId: offering.departmentId,
          capacity: offering.capacity,
          status: offering.status,
        },
      });
      return offering;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          `${course.code} is already offered in ${semester.name} of this session`,
        );
      }
      throw err;
    }
  }

  /**
   * Update capacity, teaching department or status.
   *
   * Two rules that are easy to get wrong and expensive to get wrong:
   *   • capacity may not be cut below seats already taken — that would put the
   *     offering in a state the DB CHECK forbids and strand registered students;
   *   • the course and session cannot be changed at all. Moving an offering
   *     would silently re-point every registration line attached to it, so a
   *     mistake is corrected by closing this offering and creating another.
   */
  async update(id: string, dto: UpdateOfferingDto, actor: AuthPrincipal) {
    const existing = await this.prisma.courseOffering.findUnique({
      where: { id },
      include: { course: { select: { code: true, departmentId: true } } },
    });
    if (!existing) throw new NotFoundException('Course offering not found');

    await this.assertCanManage(existing.departmentId ?? existing.course.departmentId, actor);
    if (dto.departmentId !== undefined && dto.departmentId !== existing.departmentId) {
      await this.assertCanManage(dto.departmentId, actor);
    }

    if (dto.capacity !== undefined && dto.capacity !== null && dto.capacity < existing.seatsTaken) {
      throw new ConflictException(
        `Capacity cannot be set below the ${existing.seatsTaken} seat(s) already taken. ` +
          'Close the offering instead if it must stop accepting registrations.',
      );
    }
    if (dto.status) this.assertStatusTransition(existing.status, dto.status, existing.capacity);

    const offering = await this.prisma.courseOffering.update({
      where: { id },
      data: {
        departmentId: dto.departmentId,
        capacity: dto.capacity,
        status: dto.status,
      },
    });

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: dto.status && dto.status !== existing.status ? 'offering.status' : 'offering.update',
      entityType: 'CourseOffering',
      entityId: id,
      before: {
        departmentId: existing.departmentId,
        capacity: existing.capacity,
        status: existing.status,
      },
      after: {
        departmentId: offering.departmentId,
        capacity: offering.capacity,
        status: offering.status,
        seatsTaken: offering.seatsTaken,
      },
    });
    return this.get(id);
  }

  /**
   * Bulk-create offerings for a whole semester from a published curriculum.
   *
   * Mounting a semester's timetable one course at a time is both tedious and
   * error-prone — a missed course means students cannot register for a
   * compulsory paper. The curriculum already states what must be taught, so it
   * is the natural source. Only PUBLISHED versions are used: a draft is not yet
   * the university's position on what a cohort must pass.
   *
   * Existing offerings are left untouched rather than overwritten, so this is
   * safe to re-run after adding a course to the curriculum.
   */
  async generateFromCurriculum(
    input: {
      curriculumVersionId: string;
      sessionId: string;
      semesterId: string;
      capacity?: number;
    },
    actor: AuthPrincipal,
  ) {
    const version = await this.prisma.curriculumVersion.findUnique({
      where: { id: input.curriculumVersionId },
      include: {
        programme: { select: { id: true, code: true, departmentId: true } },
        requirements: {
          include: { course: { select: { id: true, code: true, isActive: true } } },
        },
      },
    });
    if (!version) throw new NotFoundException('Curriculum version not found');
    await this.assertCanManage(version.programme.departmentId, actor);

    if (version.status !== 'PUBLISHED') {
      throw new ConflictException(
        `Only a published curriculum can drive offerings (this one is ${version.status.toLowerCase()})`,
      );
    }

    const semester = await this.assertSemesterInSession(input.semesterId, input.sessionId);

    // The curriculum places each course in a specific semester of the programme
    // (1 = first, 2 = second). Only that slice belongs on this timetable.
    const due = version.requirements.filter((r) => r.semesterSequence === semester.sequence);
    const skippedInactive = due.filter((r) => !r.course.isActive).map((r) => r.course.code);
    const candidates = due.filter((r) => r.course.isActive);

    if (candidates.length === 0) {
      throw new BadRequestException(
        `${version.programme.code} has no active courses for semester ${semester.sequence} ` +
          'in this curriculum version',
      );
    }

    const existing = await this.prisma.courseOffering.findMany({
      where: {
        sessionId: input.sessionId,
        semesterId: input.semesterId,
        courseId: { in: candidates.map((r) => r.courseId) },
      },
      select: { courseId: true },
    });
    const already = new Set(existing.map((e) => e.courseId));
    const toCreate = candidates.filter((r) => !already.has(r.courseId));

    if (toCreate.length > 0) {
      await this.prisma.courseOffering.createMany({
        data: toCreate.map((r) => ({
          courseId: r.courseId,
          sessionId: input.sessionId,
          semesterId: input.semesterId,
          departmentId: version.programme.departmentId,
          capacity: input.capacity ?? null,
          createdById: actor.userId,
        })),
        skipDuplicates: true,
      });
    }

    const result = {
      created: toCreate.length,
      alreadyPresent: already.size,
      skippedInactive,
      semester: { id: semester.id, name: semester.name, sequence: semester.sequence },
    };

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'offering.generate',
      entityType: 'CurriculumVersion',
      entityId: version.id,
      after: {
        programmeId: version.programme.id,
        sessionId: input.sessionId,
        semesterId: input.semesterId,
        ...result,
      },
    });
    return result;
  }

  // --- Helpers ------------------------------------------------------------

  /**
   * A DRAFT offering may be deleted, because nothing can have registered
   * against it yet. Anything past DRAFT is closed, never removed.
   */
  async remove(id: string, actor: AuthPrincipal) {
    const existing = await this.prisma.courseOffering.findUnique({
      where: { id },
      include: { course: { select: { code: true, departmentId: true } } },
    });
    if (!existing) throw new NotFoundException('Course offering not found');
    await this.assertCanManage(existing.departmentId ?? existing.course.departmentId, actor);

    if (existing.status !== 'DRAFT') {
      throw new ConflictException(
        `Only a draft offering can be deleted. Set status to CLOSED instead — ` +
          'registration lines reference this offering permanently.',
      );
    }
    // Belt and braces: the status check should already imply this, but a seat
    // counter above zero means something registered, and the DB would refuse
    // the delete anyway (onDelete: Restrict). A clear message beats a FK error.
    if (existing.seatsTaken > 0) {
      throw new ConflictException('This offering has registrations and cannot be deleted');
    }

    await this.prisma.courseOffering.delete({ where: { id } });
    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'offering.delete',
      entityType: 'CourseOffering',
      entityId: id,
      before: {
        courseId: existing.courseId,
        sessionId: existing.sessionId,
        semesterId: existing.semesterId,
        status: existing.status,
      },
    });
    return { removed: true };
  }

  /**
   * The semester must belong to the session named in the request. Without this
   * an offering could be pinned to 2024/2025 while carrying a semester from
   * 2023/2024, and every downstream query that joins one or the other would
   * disagree about when the course ran.
   */
  private async assertSemesterInSession(semesterId: string, sessionId: string) {
    const semester = await this.prisma.semester.findUnique({
      where: { id: semesterId },
      include: { session: { select: { id: true, name: true, state: true } } },
    });
    if (!semester) throw new BadRequestException('Semester not found');
    if (semester.sessionId !== sessionId) {
      throw new BadRequestException(
        `Semester "${semester.name}" belongs to ${semester.session.name}, not the session given`,
      );
    }
    if (semester.session.state === 'CLOSED' || semester.session.state === 'ARCHIVED') {
      throw new ConflictException(
        `${semester.session.name} is ${semester.session.state.toLowerCase()}; ` +
          'offerings cannot be added to a session that has ended',
      );
    }
    return semester;
  }

  /**
   * Guard the lifecycle. Reopening a CLOSED offering is allowed — an add/drop
   * window genuinely gets extended — but going back to DRAFT is not, since
   * DRAFT means "not yet visible" and students may already have registered.
   */
  private assertStatusTransition(
    from: 'DRAFT' | 'OPEN' | 'CLOSED',
    to: 'DRAFT' | 'OPEN' | 'CLOSED',
    capacity: number | null,
  ) {
    if (from === to) return;
    if (to === 'DRAFT' && from !== 'DRAFT') {
      throw new ConflictException(
        'An offering cannot return to draft once published. Close it instead.',
      );
    }
    // Capacity zero is the documented way to say "defined but closed to
    // registration", so opening one would advertise a course nobody can take.
    if (to === 'OPEN' && capacity === 0) {
      throw new BadRequestException(
        'Capacity is zero — set a capacity (or null for uncapped) before opening',
      );
    }
  }

  private async assertCanManage(departmentId: string | null | undefined, actor: AuthPrincipal) {
    const location = await this.structure.resolveDepartmentLocation(departmentId);
    assertDepartmentWithinScope(scopeConstraintFor(actor, PERMISSIONS.OFFERINGS_MANAGE), location);
  }

  /** Seats remaining, derived rather than stored — a stored copy is one more
   *  thing that can drift from `capacity - seatsTaken`. Null capacity is
   *  uncapped, so there is no meaningful number to report. */
  private withAvailability<T extends { capacity: number | null; seatsTaken: number }>(row: T) {
    return {
      ...row,
      seatsAvailable: row.capacity === null ? null : Math.max(0, row.capacity - row.seatsTaken),
      isFull: row.capacity === null ? false : row.seatsTaken >= row.capacity,
    };
  }
}
