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
import { PERMISSIONS, PermissionKey } from '../rbac/permissions.catalog';
import { assertDepartmentWithinScope, scopeConstraintFor } from '../rbac/scope.util';
import {
  CreateCurriculumVersionDto,
  SetRequirementsDto,
  UpdateCurriculumVersionDto,
} from './dto/academics.dto';

/**
 * Curriculum versions.
 *
 * The governing rule is that a PUBLISHED version is FROZEN. Students are
 * assessed against the version in force when they were admitted (INV-7), so
 * editing a published version would retroactively change what a student in
 * their final year was required to pass. Corrections are made by creating a new
 * version effective from a later session — the same supersede-don't-overwrite
 * pattern used for grades and documents.
 */
@Injectable()
export class CurriculumService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly structure: StructureService,
  ) {}

  // --- Reads --------------------------------------------------------------

  list(filter: { programmeId?: string; status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' }) {
    return this.prisma.curriculumVersion.findMany({
      where: {
        programmeId: filter.programmeId,
        status: filter.status,
      },
      include: {
        programme: { select: { id: true, code: true, name: true, departmentId: true } },
        effectiveFromSession: { select: { id: true, name: true } },
        _count: { select: { requirements: true } },
      },
      orderBy: [{ programme: { code: 'asc' } }, { effectiveFromSession: { name: 'desc' } }],
    });
  }

  async get(id: string) {
    const version = await this.prisma.curriculumVersion.findUnique({
      where: { id },
      include: {
        programme: { select: { id: true, code: true, name: true, departmentId: true } },
        effectiveFromSession: { select: { id: true, name: true } },
        requirements: {
          include: {
            course: {
              select: { id: true, code: true, title: true, creditUnits: true, isActive: true },
            },
          },
          orderBy: [{ level: 'asc' }, { semesterSequence: 'asc' }, { course: { code: 'asc' } }],
        },
      },
    });
    if (!version) throw new NotFoundException('Curriculum version not found');
    return { ...version, summary: this.summarize(version.requirements) };
  }

  // --- Writes -------------------------------------------------------------

  async create(dto: CreateCurriculumVersionDto, actor: AuthPrincipal) {
    const programme = await this.loadProgramme(dto.programmeId);
    await this.assertCanAuthor(programme.departmentId, actor, PERMISSIONS.CURRICULUM_MANAGE);

    const session = await this.prisma.academicSession.findUnique({
      where: { id: dto.effectiveFromSessionId },
    });
    if (!session) throw new BadRequestException('Effective-from session not found');

    try {
      const version = await this.prisma.curriculumVersion.create({
        data: {
          programmeId: dto.programmeId,
          name: dto.name.trim(),
          effectiveFromSessionId: dto.effectiveFromSessionId,
          notes: dto.notes?.trim() || null,
          createdById: actor.userId,
        },
      });
      await this.audit.record({
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'curriculum.create',
        entityType: 'CurriculumVersion',
        entityId: version.id,
        after: {
          programmeId: version.programmeId,
          name: version.name,
          effectiveFromSessionId: version.effectiveFromSessionId,
          status: version.status,
        },
      });
      return version;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          `${programme.code} already has a curriculum version effective from ${session.name}`,
        );
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateCurriculumVersionDto, actor: AuthPrincipal) {
    const version = await this.loadEditable(id, actor);

    const updated = await this.prisma.curriculumVersion.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        notes: dto.notes === undefined ? undefined : dto.notes.trim() || null,
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'curriculum.update',
      entityType: 'CurriculumVersion',
      entityId: id,
      before: { name: version.name, notes: version.notes },
      after: { name: updated.name, notes: updated.notes },
    });
    return updated;
  }

  /**
   * Replace the requirement set wholesale. Editing a curriculum is a bulk
   * operation — a course moves from 200 to 300 level and two electives are
   * swapped in one sitting — so the API takes the full intended state rather
   * than a sequence of add/remove calls that would leave the version invalid
   * between them.
   */
  async setRequirements(id: string, dto: SetRequirementsDto, actor: AuthPrincipal) {
    const version = await this.loadEditable(id, actor);

    const courseIds = dto.requirements.map((r) => r.courseId);
    const duplicates = courseIds.filter((c, i) => courseIds.indexOf(c) !== i);
    if (duplicates.length > 0) {
      throw new BadRequestException('A course may appear only once in a curriculum version');
    }

    // Every referenced course must exist and be active: a curriculum pointing at
    // a retired course cannot be satisfied.
    const courses = await this.prisma.course.findMany({
      where: { id: { in: courseIds } },
      select: { id: true, code: true, isActive: true, creditUnits: true },
    });
    if (courses.length !== courseIds.length) {
      const found = new Set(courses.map((c) => c.id));
      const missing = courseIds.filter((c) => !found.has(c));
      throw new BadRequestException(`Unknown course id(s): ${missing.join(', ')}`);
    }
    const inactive = courses.filter((c) => !c.isActive);
    if (inactive.length > 0) {
      throw new BadRequestException(
        `Inactive course(s) cannot be required: ${inactive.map((c) => c.code).join(', ')}`,
      );
    }

    // An elective group of one is a compulsory course wearing a disguise; it
    // usually means the author forgot the alternatives.
    const groups = new Map<string, number>();
    for (const r of dto.requirements) {
      if (r.requirementType === 'ELECTIVE' && r.electiveGroup) {
        groups.set(r.electiveGroup, (groups.get(r.electiveGroup) ?? 0) + 1);
      }
    }
    const lonely = [...groups.entries()].filter(([, n]) => n < 2).map(([g]) => g);
    if (lonely.length > 0) {
      throw new BadRequestException(
        `Elective group(s) with only one course offer no choice: ${lonely.join(', ')}`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.curriculumRequirement.deleteMany({ where: { curriculumVersionId: id } });
      if (dto.requirements.length > 0) {
        await tx.curriculumRequirement.createMany({
          data: dto.requirements.map((r) => ({
            curriculumVersionId: id,
            courseId: r.courseId,
            level: r.level,
            semesterSequence: r.semesterSequence,
            requirementType: r.requirementType,
            creditUnits: r.creditUnits ?? null,
            electiveGroup: r.electiveGroup?.trim() || null,
          })),
        });
      }
      return tx.curriculumRequirement.findMany({
        where: { curriculumVersionId: id },
        include: { course: { select: { id: true, code: true, creditUnits: true } } },
      });
    });

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'curriculum.requirements.set',
      entityType: 'CurriculumVersion',
      entityId: id,
      after: {
        programmeId: version.programmeId,
        requirementCount: result.length,
        totalUnits: this.summarize(result).totalUnits,
      },
    });
    return { requirements: result, summary: this.summarize(result) };
  }

  /**
   * Publish: freeze the version and make it the one students are assessed
   * against. Publishing an empty curriculum is refused — it would silently
   * evaluate every student as having no requirements to meet.
   */
  async publish(id: string, actor: AuthPrincipal) {
    const version = await this.prisma.curriculumVersion.findUnique({
      where: { id },
      include: {
        programme: { select: { id: true, code: true, departmentId: true } },
        requirements: { include: { course: { select: { creditUnits: true } } } },
      },
    });
    if (!version) throw new NotFoundException('Curriculum version not found');
    // Publishing is checked against CURRICULUM_PUBLISH, not CURRICULUM_MANAGE:
    // drafting a curriculum and freezing one are separate authorities, so a
    // department officer can prepare a version that only a dean can enact.
    await this.assertCanAuthor(
      version.programme.departmentId,
      actor,
      PERMISSIONS.CURRICULUM_PUBLISH,
    );

    if (version.status === 'PUBLISHED') {
      throw new ConflictException('This version is already published');
    }
    if (version.status === 'ARCHIVED') {
      throw new ConflictException('An archived version cannot be published');
    }
    if (version.requirements.length === 0) {
      throw new BadRequestException('Cannot publish a curriculum with no requirements');
    }

    const published = await this.prisma.curriculumVersion.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'curriculum.publish',
      entityType: 'CurriculumVersion',
      entityId: id,
      before: { status: version.status },
      after: {
        status: published.status,
        publishedAt: published.publishedAt,
        requirementCount: version.requirements.length,
        totalUnits: this.summarize(version.requirements).totalUnits,
      },
    });
    return published;
  }

  /** Archive a superseded version. Archived versions stay readable forever —
   *  a graduate's record is only interpretable against the curriculum they were
   *  admitted under. */
  async archive(id: string, actor: AuthPrincipal) {
    const version = await this.prisma.curriculumVersion.findUnique({
      where: { id },
      include: { programme: { select: { departmentId: true } } },
    });
    if (!version) throw new NotFoundException('Curriculum version not found');
    await this.assertCanAuthor(
      version.programme.departmentId,
      actor,
      PERMISSIONS.CURRICULUM_PUBLISH,
    );

    if (version.status !== 'PUBLISHED') {
      throw new ConflictException('Only a published version can be archived');
    }
    const pinned = await this.prisma.studentRecord.count({ where: { curriculumVersionId: id } });

    const archived = await this.prisma.curriculumVersion.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'curriculum.archive',
      entityType: 'CurriculumVersion',
      entityId: id,
      before: { status: version.status },
      // Archiving does NOT unpin the students already assessed against it; the
      // count is recorded so the effect is visible in review.
      after: { status: archived.status, pinnedStudentCount: pinned },
    });
    return archived;
  }

  // --- Helpers ------------------------------------------------------------

  /** Load a version and assert it is both in scope and still editable. */
  private async loadEditable(id: string, actor: AuthPrincipal) {
    const version = await this.prisma.curriculumVersion.findUnique({
      where: { id },
      include: { programme: { select: { id: true, code: true, departmentId: true } } },
    });
    if (!version) throw new NotFoundException('Curriculum version not found');
    await this.assertCanAuthor(
      version.programme.departmentId,
      actor,
      PERMISSIONS.CURRICULUM_MANAGE,
    );

    if (version.status !== 'DRAFT') {
      throw new ConflictException(
        `A ${version.status.toLowerCase()} curriculum is frozen (INV-7). ` +
          'Create a new version effective from a later session instead.',
      );
    }
    return version;
  }

  private async loadProgramme(programmeId: string) {
    const programme = await this.prisma.programme.findUnique({ where: { id: programmeId } });
    if (!programme) throw new BadRequestException('Programme not found');
    return programme;
  }

  private async assertCanAuthor(
    departmentId: string | null | undefined,
    actor: AuthPrincipal,
    permission: PermissionKey,
  ) {
    const location = await this.structure.resolveDepartmentLocation(departmentId);
    assertDepartmentWithinScope(scopeConstraintFor(actor, permission), location);
  }

  /**
   * Unit totals per level. Uses the requirement's override where present, else
   * the course's own units — the same precedence registration will apply, so
   * what an administrator sees here is what a student will be held to.
   */
  private summarize(
    requirements: Array<{
      level: number;
      creditUnits: number | null;
      requirementType: string;
      course: { creditUnits: number };
    }>,
  ) {
    const byLevel = new Map<number, { compulsory: number; elective: number; total: number }>();
    let totalUnits = 0;

    for (const r of requirements) {
      const units = r.creditUnits ?? r.course.creditUnits;
      const entry = byLevel.get(r.level) ?? { compulsory: 0, elective: 0, total: 0 };
      if (r.requirementType === 'COMPULSORY') entry.compulsory += units;
      else entry.elective += units;
      entry.total += units;
      byLevel.set(r.level, entry);
      totalUnits += units;
    }

    return {
      totalUnits,
      requirementCount: requirements.length,
      byLevel: [...byLevel.entries()]
        .sort(([a], [b]) => a - b)
        .map(([level, v]) => ({ level, ...v })),
    };
  }
}
