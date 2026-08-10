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
import {
  CreateDepartmentDto,
  CreateFacultyDto,
  CreateProgrammeDto,
  CreateSemesterDto,
  CreateSessionDto,
} from './dto/structure.dto';

/**
 * University structure service. Read methods power dropdowns everywhere (the
 * frontend NEVER hardcodes these). Write methods are audited and enforce the
 * hierarchy: a department must belong to a faculty, a programme to a
 * department. Toggling isCurrent on a session is done in a transaction so only
 * one session is ever current (also backed by a partial unique index).
 */
@Injectable()
export class StructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- Reads --------------------------------------------------------------
  async getTree() {
    const universities = await this.prisma.university.findMany({
      include: {
        faculties: {
          orderBy: { name: 'asc' },
          include: {
            departments: {
              orderBy: { name: 'asc' },
              include: { programmes: { orderBy: { name: 'asc' } } },
            },
          },
        },
      },
    });
    return universities;
  }

  listFaculties() {
    return this.prisma.faculty.findMany({ orderBy: { name: 'asc' } });
  }

  listDepartments(facultyId?: string) {
    return this.prisma.department.findMany({
      where: facultyId ? { facultyId } : undefined,
      orderBy: { name: 'asc' },
    });
  }

  listProgrammes(departmentId?: string) {
    return this.prisma.programme.findMany({
      where: departmentId ? { departmentId } : undefined,
      orderBy: { name: 'asc' },
    });
  }

  listSessions() {
    return this.prisma.academicSession.findMany({ orderBy: { name: 'desc' } });
  }

  /**
   * Semesters, ordered by session then sequence. Optionally narrowed to one
   * session (how the offerings screen populates its semester dropdown).
   */
  listSemesters(sessionId?: string) {
    return this.prisma.semester.findMany({
      where: sessionId ? { sessionId } : undefined,
      include: { session: { select: { id: true, name: true, isCurrent: true } } },
      orderBy: [{ session: { name: 'desc' } }, { sequence: 'asc' }],
    });
  }

  // --- Writes -------------------------------------------------------------
  async createFaculty(dto: CreateFacultyDto, actor: AuthPrincipal) {
    const uni = await this.prisma.university.findUnique({ where: { id: dto.universityId } });
    if (!uni) throw new BadRequestException('University not found');
    const faculty = await this.prisma.faculty.create({
      data: { universityId: dto.universityId, name: dto.name, code: dto.code.toUpperCase() },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'structure.faculty.create',
      entityType: 'Faculty',
      entityId: faculty.id,
      after: { name: faculty.name, code: faculty.code },
    });
    return faculty;
  }

  async createDepartment(dto: CreateDepartmentDto, actor: AuthPrincipal) {
    const faculty = await this.prisma.faculty.findUnique({ where: { id: dto.facultyId } });
    if (!faculty) throw new BadRequestException('Faculty not found');
    const dept = await this.prisma.department.create({
      data: { facultyId: dto.facultyId, name: dto.name, code: dto.code.toUpperCase() },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'structure.department.create',
      entityType: 'Department',
      entityId: dept.id,
      after: { name: dept.name, code: dept.code, facultyId: dept.facultyId },
    });
    return dept;
  }

  async createProgramme(dto: CreateProgrammeDto, actor: AuthPrincipal) {
    const dept = await this.prisma.department.findUnique({ where: { id: dto.departmentId } });
    if (!dept) throw new BadRequestException('Department not found');
    const programme = await this.prisma.programme.create({
      data: {
        departmentId: dto.departmentId,
        name: dto.name,
        code: dto.code.toUpperCase(),
        award: dto.award,
        durationYears: dto.durationYears,
        studyMode: dto.studyMode ?? 'FULL_TIME',
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'structure.programme.create',
      entityType: 'Programme',
      entityId: programme.id,
      after: { name: programme.name, code: programme.code, departmentId: programme.departmentId },
    });
    return programme;
  }

  async createSession(dto: CreateSessionDto, actor: AuthPrincipal) {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end <= start) throw new BadRequestException('End date must be after start date');

    const session = await this.prisma.$transaction(async (tx) => {
      if (dto.isCurrent) {
        await tx.academicSession.updateMany({
          where: { isCurrent: true },
          data: { isCurrent: false },
        });
      }
      return tx.academicSession.create({
        data: { name: dto.name, startDate: start, endDate: end, isCurrent: dto.isCurrent ?? false },
      });
    });
    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'structure.session.create',
      entityType: 'AcademicSession',
      entityId: session.id,
      after: { name: session.name, isCurrent: session.isCurrent },
    });
    return session;
  }

  async setCurrentSession(id: string, actor: AuthPrincipal) {
    const exists = await this.prisma.academicSession.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Session not found');
    await this.prisma.$transaction([
      this.prisma.academicSession.updateMany({
        where: { isCurrent: true },
        data: { isCurrent: false },
      }),
      this.prisma.academicSession.update({ where: { id }, data: { isCurrent: true } }),
    ]);
    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'structure.session.set_current',
      entityType: 'AcademicSession',
      entityId: id,
    });
    return this.prisma.academicSession.findUnique({ where: { id } });
  }

  /**
   * Validate that a (faculty, department, programme) triple is internally
   * consistent — reused by student creation + import. Throws with a precise
   * message on the first inconsistency; returns the resolved rows otherwise.
   */
  async assertAcademicHierarchy(facultyId: string, departmentId: string, programmeId: string) {
    const programme = await this.prisma.programme.findUnique({
      where: { id: programmeId },
      include: { department: { include: { faculty: true } } },
    });
    if (!programme) throw new BadRequestException('Invalid programme');
    if (programme.departmentId !== departmentId) {
      throw new BadRequestException('Programme does not belong to the selected department');
    }
    if (programme.department.facultyId !== facultyId) {
      throw new BadRequestException('Department does not belong to the selected faculty');
    }
    return programme;
  }

  // --- Semesters (Phase 2) -------------------------------------------------

  /**
   * Create a teaching period within a session. Two invariants are enforced
   * transactionally, both also backed by database constraints so a concurrent
   * writer cannot slip past the read-then-write window:
   *   • (sessionId, sequence) is unique — semesters_session_id_sequence_key;
   *   • at most ONE semester is current PER SESSION — uq_one_current_semester,
   *     a partial unique index (unlike the globally-unique current session).
   */
  async createSemester(dto: CreateSemesterDto, actor: AuthPrincipal) {
    const session = await this.prisma.academicSession.findUnique({
      where: { id: dto.sessionId },
    });
    if (!session) throw new BadRequestException('Academic session not found');

    const start = dto.startDate ? new Date(dto.startDate) : null;
    const end = dto.endDate ? new Date(dto.endDate) : null;
    if (start && end && end <= start) {
      throw new BadRequestException('End date must be after start date');
    }

    try {
      const semester = await this.prisma.$transaction(async (tx) => {
        if (dto.isCurrent) {
          // Scoped to THIS session — another session's current semester is
          // untouched (a session is a separate academic year).
          await tx.semester.updateMany({
            where: { sessionId: dto.sessionId, isCurrent: true },
            data: { isCurrent: false },
          });
        }
        return tx.semester.create({
          data: {
            sessionId: dto.sessionId,
            sequence: dto.sequence,
            name: dto.name.trim(),
            startDate: start,
            endDate: end,
            isCurrent: dto.isCurrent ?? false,
          },
        });
      });

      await this.audit.record({
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'structure.semester.create',
        entityType: 'Semester',
        entityId: semester.id,
        after: {
          sessionId: semester.sessionId,
          sequence: semester.sequence,
          name: semester.name,
          isCurrent: semester.isCurrent,
        },
      });
      return semester;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          `Semester ${dto.sequence} already exists for session ${session.name}`,
        );
      }
      throw err;
    }
  }

  /** Make one semester current, clearing any sibling within the SAME session. */
  async setCurrentSemester(id: string, actor: AuthPrincipal) {
    const semester = await this.prisma.semester.findUnique({ where: { id } });
    if (!semester) throw new NotFoundException('Semester not found');

    await this.prisma.$transaction([
      this.prisma.semester.updateMany({
        where: { sessionId: semester.sessionId, isCurrent: true },
        data: { isCurrent: false },
      }),
      this.prisma.semester.update({ where: { id }, data: { isCurrent: true } }),
    ]);
    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'structure.semester.set_current',
      entityType: 'Semester',
      entityId: id,
      after: { sessionId: semester.sessionId },
    });
    return this.prisma.semester.findUnique({ where: { id } });
  }

  /**
   * Resolve a (session, semester) pair, confirming the semester belongs to the
   * session. Shared with the offerings service so a caller can never schedule a
   * course into a semester from a different academic year.
   */
  async assertSemesterInSession(sessionId: string, semesterId: string) {
    const semester = await this.prisma.semester.findUnique({ where: { id: semesterId } });
    if (!semester) throw new BadRequestException('Invalid semester');
    if (semester.sessionId !== sessionId) {
      throw new BadRequestException('Semester does not belong to the selected session');
    }
    return semester;
  }

  /**
   * Resolve a department to its owning faculty — the input to the Phase 2
   * department-scope check (a faculty-scoped actor may author within any of its
   * departments, so the check needs the department's faculty). Returns null for
   * a university-wide record (no department), which the scope helper treats as
   * requiring GLOBAL authority.
   */
  async resolveDepartmentLocation(
    departmentId: string | null | undefined,
  ): Promise<{ departmentId: string | null; facultyId: string | null }> {
    if (!departmentId) return { departmentId: null, facultyId: null };
    const dept = await this.prisma.department.findUnique({
      where: { id: departmentId },
      select: { id: true, facultyId: true },
    });
    if (!dept) throw new BadRequestException('Department not found');
    return { departmentId: dept.id, facultyId: dept.facultyId };
  }
}
