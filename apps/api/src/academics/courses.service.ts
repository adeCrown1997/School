import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, PrismaTx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StructureService } from '../structure/structure.service';
import { AuthPrincipal } from '../common/auth-principal';
import { PERMISSIONS, PermissionKey } from '../rbac/permissions.catalog';
import { assertDepartmentWithinScope, scopeConstraintFor } from '../rbac/scope.util';
import {
  AddPrerequisiteDto,
  AddRelationshipDto,
  CreateCourseDto,
  SetCourseActiveDto,
  UpdateCourseDto,
} from './dto/academics.dto';

/** Courses are referenced by transcripts forever, so they are deactivated, never
 *  deleted. Everything here is scope-checked against the owning department. */
@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly structure: StructureService,
  ) {}

  // --- Reads --------------------------------------------------------------

  /**
   * Catalogue listing. Reads are NOT scope-narrowed: a lecturer must be able to
   * see a prerequisite owned by another department, and the catalogue is public
   * information within the university. Writes are where scope bites.
   */
  async list(filter: {
    departmentId?: string;
    categoryId?: string;
    level?: number;
    q?: string;
    includeInactive?: boolean;
  }) {
    const where: Prisma.CourseWhereInput = {};
    if (filter.departmentId) where.departmentId = filter.departmentId;
    if (filter.categoryId) where.categoryId = filter.categoryId;
    if (filter.level !== undefined) where.level = filter.level;
    if (!filter.includeInactive) where.isActive = true;
    if (filter.q?.trim()) {
      const q = filter.q.trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { title: { contains: q, mode: 'insensitive' } },
      ];
    }

    return this.prisma.course.findMany({
      where,
      include: {
        category: { select: { id: true, key: true, label: true } },
        department: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ level: 'asc' }, { code: 'asc' }],
    });
  }

  async get(id: string) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, key: true, label: true } },
        department: { select: { id: true, code: true, name: true } },
        prerequisites: {
          include: {
            prerequisiteCourse: {
              select: { id: true, code: true, title: true, creditUnits: true },
            },
          },
        },
        relationshipsFrom: {
          include: { relatedCourse: { select: { id: true, code: true, title: true } } },
        },
      },
    });
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  // --- Writes -------------------------------------------------------------

  async create(dto: CreateCourseDto, actor: AuthPrincipal) {
    await this.assertCanAuthor(dto.departmentId, actor, PERMISSIONS.COURSES_CREATE);
    if (dto.categoryId) await this.assertCategory(dto.categoryId);

    const code = dto.code.trim().toUpperCase();
    try {
      const course = await this.prisma.course.create({
        data: {
          code,
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          creditUnits: dto.creditUnits,
          level: dto.level,
          categoryId: dto.categoryId ?? null,
          departmentId: dto.departmentId ?? null,
          createdById: actor.userId,
        },
      });
      await this.audit.record({
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'course.create',
        entityType: 'Course',
        entityId: course.id,
        after: {
          code: course.code,
          title: course.title,
          creditUnits: course.creditUnits,
          level: course.level,
          departmentId: course.departmentId,
        },
      });
      return course;
    } catch (err) {
      throw this.mapDuplicate(err, `Course ${code} already exists`);
    }
  }

  async update(id: string, dto: UpdateCourseDto, actor: AuthPrincipal) {
    const existing = await this.prisma.course.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Course not found');

    // Scope is checked against BOTH sides when a course is being moved, so a
    // department admin cannot push a course into a department it does not own.
    await this.assertCanAuthor(existing.departmentId, actor, PERMISSIONS.COURSES_UPDATE);
    if (dto.departmentId !== undefined && dto.departmentId !== existing.departmentId) {
      await this.assertCanAuthor(dto.departmentId, actor, PERMISSIONS.COURSES_UPDATE);
    }
    if (dto.categoryId) await this.assertCategory(dto.categoryId);

    // Changing credit units does not rewrite history: committed registration
    // lines carry their own copy (INV-6). Say so in the audit trail.
    const unitsChanged = dto.creditUnits !== undefined && dto.creditUnits !== existing.creditUnits;

    const course = await this.prisma.course.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        description: dto.description === undefined ? undefined : dto.description.trim() || null,
        creditUnits: dto.creditUnits,
        level: dto.level,
        categoryId: dto.categoryId,
        departmentId: dto.departmentId,
      },
    });

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'course.update',
      entityType: 'Course',
      entityId: id,
      before: {
        title: existing.title,
        creditUnits: existing.creditUnits,
        level: existing.level,
        categoryId: existing.categoryId,
        departmentId: existing.departmentId,
      },
      after: {
        title: course.title,
        creditUnits: course.creditUnits,
        level: course.level,
        categoryId: course.categoryId,
        departmentId: course.departmentId,
        ...(unitsChanged ? { note: 'Committed registration lines keep their copied units' } : {}),
      },
    });
    return course;
  }

  /**
   * Deactivation is the only removal. A course with OPEN offerings cannot be
   * deactivated — students may be mid-registration against it.
   */
  async setActive(id: string, dto: SetCourseActiveDto, actor: AuthPrincipal) {
    const existing = await this.prisma.course.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Course not found');
    await this.assertCanAuthor(existing.departmentId, actor, PERMISSIONS.COURSES_DEACTIVATE);

    if (!dto.isActive) {
      const openOfferings = await this.prisma.courseOffering.count({
        where: { courseId: id, status: 'OPEN' },
      });
      if (openOfferings > 0) {
        throw new ConflictException(
          `Cannot deactivate: ${openOfferings} open offering(s) reference this course. Close them first.`,
        );
      }
    }

    const course = await this.prisma.course.update({
      where: { id },
      data: { isActive: dto.isActive },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: dto.isActive ? 'course.reactivate' : 'course.deactivate',
      entityType: 'Course',
      entityId: id,
      before: { isActive: existing.isActive },
      after: { isActive: course.isActive, reason: dto.reason ?? null },
    });
    return course;
  }

  // --- Prerequisites ------------------------------------------------------

  /**
   * Add a prerequisite edge, rejecting anything that would create a cycle.
   *
   * Cycle detection is done in the SERVICE rather than the database because the
   * graph is small, the check needs a readable error naming the offending chain,
   * and a recursive CHECK constraint is not expressible in Postgres. The read
   * and the write share one transaction, so two concurrent additions cannot
   * combine into a cycle that neither saw alone.
   */
  async addPrerequisite(courseId: string, dto: AddPrerequisiteDto, actor: AuthPrincipal) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found');
    await this.assertCanAuthor(course.departmentId, actor, PERMISSIONS.COURSES_UPDATE);

    if (courseId === dto.prerequisiteCourseId) {
      throw new BadRequestException('A course cannot be its own prerequisite');
    }
    const prereq = await this.prisma.course.findUnique({
      where: { id: dto.prerequisiteCourseId },
      select: { id: true, code: true, isActive: true },
    });
    if (!prereq) throw new BadRequestException('Prerequisite course not found');
    if (!prereq.isActive) {
      throw new BadRequestException(`${prereq.code} is inactive and cannot be a prerequisite`);
    }
    if (dto.minGrade) await this.assertGradeExists(dto.minGrade);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const cycle = await this.findCycle(tx, courseId, dto.prerequisiteCourseId);
        if (cycle) {
          throw new BadRequestException(
            `This would create a circular prerequisite chain: ${cycle.join(' → ')}`,
          );
        }
        return tx.coursePrerequisite.create({
          data: {
            courseId,
            prerequisiteCourseId: dto.prerequisiteCourseId,
            minGrade: dto.minGrade?.trim().toUpperCase() || null,
          },
        });
      });

      await this.audit.record({
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'course.prerequisite.add',
        entityType: 'Course',
        entityId: courseId,
        after: { prerequisiteCourseId: dto.prerequisiteCourseId, minGrade: created.minGrade },
      });
      return created;
    } catch (err) {
      throw this.mapDuplicate(err, `${prereq.code} is already a prerequisite`);
    }
  }

  async removePrerequisite(courseId: string, prerequisiteId: string, actor: AuthPrincipal) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found');
    await this.assertCanAuthor(course.departmentId, actor, PERMISSIONS.COURSES_UPDATE);

    const row = await this.prisma.coursePrerequisite.findUnique({ where: { id: prerequisiteId } });
    if (!row || row.courseId !== courseId) {
      throw new NotFoundException('Prerequisite not found on this course');
    }

    await this.prisma.coursePrerequisite.delete({ where: { id: prerequisiteId } });
    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'course.prerequisite.remove',
      entityType: 'Course',
      entityId: courseId,
      before: { prerequisiteCourseId: row.prerequisiteCourseId, minGrade: row.minGrade },
    });
    return { removed: true };
  }

  /**
   * Walk the prerequisite graph UPWARDS from `from`, looking for `target`.
   *
   * Adding "courseId requires prereqId" is safe unless prereqId already depends
   * (transitively) on courseId. So we start at prereqId and follow its own
   * prerequisites; reaching courseId means the new edge closes a loop. Returns
   * the offending chain in course codes for the error message, or null.
   */
  private async findCycle(tx: PrismaTx, target: string, from: string): Promise<string[] | null> {
    const codeOf = new Map<string, string>();
    const seen = new Set<string>([from]);
    // Each frontier entry carries the path that reached it, so the error can
    // name the actual chain rather than just asserting a cycle exists.
    let frontier: Array<{ id: string; path: string[] }> = [{ id: from, path: [from] }];

    while (frontier.length > 0) {
      const ids = frontier.map((f) => f.id);
      const edges = await tx.coursePrerequisite.findMany({
        where: { courseId: { in: ids } },
        select: {
          courseId: true,
          prerequisiteCourseId: true,
          prerequisiteCourse: { select: { code: true } },
          course: { select: { code: true } },
        },
      });
      if (edges.length === 0) return null;

      for (const e of edges) {
        codeOf.set(e.courseId, e.course.code);
        codeOf.set(e.prerequisiteCourseId, e.prerequisiteCourse.code);
      }

      const next: Array<{ id: string; path: string[] }> = [];
      for (const e of edges) {
        const parent = frontier.find((f) => f.id === e.courseId);
        if (!parent) continue;
        const path = [...parent.path, e.prerequisiteCourseId];

        if (e.prerequisiteCourseId === target) {
          const targetCode =
            codeOf.get(target) ??
            (await tx.course.findUnique({ where: { id: target }, select: { code: true } }))?.code ??
            target;
          return [targetCode, ...path.map((p) => codeOf.get(p) ?? p)];
        }
        if (!seen.has(e.prerequisiteCourseId)) {
          seen.add(e.prerequisiteCourseId);
          next.push({ id: e.prerequisiteCourseId, path });
        }
      }
      frontier = next;
    }
    return null;
  }

  // --- Relationships ------------------------------------------------------

  /**
   * Equivalences/exclusions are symmetric in meaning but stored as one directed
   * row per direction, so both are written together. RECOMMENDED is genuinely
   * one-way and is not mirrored.
   */
  async addRelationship(courseId: string, dto: AddRelationshipDto, actor: AuthPrincipal) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found');
    await this.assertCanAuthor(course.departmentId, actor, PERMISSIONS.COURSES_UPDATE);

    if (courseId === dto.relatedCourseId) {
      throw new BadRequestException('A course cannot be related to itself');
    }
    const related = await this.prisma.course.findUnique({
      where: { id: dto.relatedCourseId },
      select: { id: true, code: true },
    });
    if (!related) throw new BadRequestException('Related course not found');

    const mirrored = dto.type === 'EQUIVALENT' || dto.type === 'EXCLUSION';
    try {
      const rows = await this.prisma.$transaction(async (tx) => {
        const forward = await tx.courseRelationship.create({
          data: {
            courseId,
            relatedCourseId: dto.relatedCourseId,
            type: dto.type,
            note: dto.note?.trim() || null,
          },
        });
        if (mirrored) {
          await tx.courseRelationship.upsert({
            where: {
              courseId_relatedCourseId_type: {
                courseId: dto.relatedCourseId,
                relatedCourseId: courseId,
                type: dto.type,
              },
            },
            create: {
              courseId: dto.relatedCourseId,
              relatedCourseId: courseId,
              type: dto.type,
              note: dto.note?.trim() || null,
            },
            update: {},
          });
        }
        return forward;
      });

      await this.audit.record({
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'course.relationship.add',
        entityType: 'Course',
        entityId: courseId,
        after: { relatedCourseId: dto.relatedCourseId, type: dto.type, mirrored },
      });
      return rows;
    } catch (err) {
      throw this.mapDuplicate(err, `${related.code} is already linked as ${dto.type}`);
    }
  }

  async removeRelationship(courseId: string, relationshipId: string, actor: AuthPrincipal) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found');
    await this.assertCanAuthor(course.departmentId, actor, PERMISSIONS.COURSES_UPDATE);

    const row = await this.prisma.courseRelationship.findUnique({ where: { id: relationshipId } });
    if (!row || row.courseId !== courseId) {
      throw new NotFoundException('Relationship not found on this course');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.courseRelationship.delete({ where: { id: relationshipId } });
      if (row.type === 'EQUIVALENT' || row.type === 'EXCLUSION') {
        await tx.courseRelationship.deleteMany({
          where: {
            courseId: row.relatedCourseId,
            relatedCourseId: row.courseId,
            type: row.type,
          },
        });
      }
    });

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'course.relationship.remove',
      entityType: 'Course',
      entityId: courseId,
      before: { relatedCourseId: row.relatedCourseId, type: row.type },
    });
    return { removed: true };
  }

  // --- Helpers ------------------------------------------------------------

  /**
   * Resolve the owning department and confirm the actor may write there.
   *
   * The permission is passed in rather than fixed, because scope is granted PER
   * PERMISSION: an actor may hold courses.update across a whole faculty but
   * courses.deactivate only in one department. Checking the wrong key would
   * silently widen authority.
   */
  private async assertCanAuthor(
    departmentId: string | null | undefined,
    actor: AuthPrincipal,
    permission: PermissionKey,
  ) {
    const location = await this.structure.resolveDepartmentLocation(departmentId);
    assertDepartmentWithinScope(scopeConstraintFor(actor, permission), location);
  }

  private async assertCategory(categoryId: string) {
    const category = await this.prisma.courseCategory.findUnique({ where: { id: categoryId } });
    if (!category) throw new BadRequestException('Course category not found');
    if (!category.isActive) throw new BadRequestException('Course category is inactive');
  }

  /** A minimum grade must exist on the default scale — a typo like "Z" would
   *  otherwise silently make the prerequisite unsatisfiable. */
  private async assertGradeExists(grade: string) {
    const normalized = grade.trim().toUpperCase();
    const band = await this.prisma.gradeBand.findFirst({
      where: { grade: normalized, scale: { isDefault: true, isActive: true } },
      select: { id: true },
    });
    if (!band) {
      throw new BadRequestException(`Grade "${normalized}" is not defined on the default scale`);
    }
  }

  private mapDuplicate(err: unknown, message: string) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException(message);
    }
    return err;
  }
}
