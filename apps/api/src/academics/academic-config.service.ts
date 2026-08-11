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
  CreateCourseCategoryDto,
  CreateGradeScaleDto,
  CreditPolicyDto,
  GradeBandDto,
  UpdateCourseCategoryDto,
  UpdateGradeScaleBandsDto,
} from './dto/academics.dto';

/** The SystemConfig key holding min/max registrable units. Enforced at
 *  registration commit (INV-8); stored here because it is policy, not code. */
export const CREDIT_POLICY_KEY = 'academic.credit_policy';

/** Fallback used when no policy row exists yet, so registration has a defined
 *  rule on a fresh install rather than silently allowing anything. */
export const DEFAULT_CREDIT_POLICY: CreditPolicyDto = { minUnits: 15, maxUnits: 24 };

/**
 * Academic configuration: course categories, grading scales, and credit policy.
 *
 * These are all DATA rather than code, which is the point — an institution
 * renames its course categories or moves to a 4-point scale without a
 * deployment. The cost of that flexibility is that the service has to enforce
 * the coherence a hardcoded enum would have given for free, which is most of
 * what this file does.
 */
@Injectable()
export class AcademicConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- Course categories --------------------------------------------------

  listCategories(includeInactive = false) {
    return this.prisma.courseCategory.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: { _count: { select: { courses: true } } },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    });
  }

  async createCategory(dto: CreateCourseCategoryDto, actor: AuthPrincipal) {
    const key = dto.key.trim().toUpperCase();
    try {
      const category = await this.prisma.courseCategory.create({
        data: {
          key,
          label: dto.label.trim(),
          description: dto.description?.trim() || null,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      await this.audit.record({
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'academic.category.create',
        entityType: 'CourseCategory',
        entityId: category.id,
        after: { key: category.key, label: category.label },
      });
      return category;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Course category ${key} already exists`);
      }
      throw err;
    }
  }

  /**
   * The key is not updatable. Categories are referenced by reports and by an
   * institution's own regulations ("all GST courses must be passed"), so a
   * rename of the key would break the meaning of existing rows; the label is
   * the human-facing text and is freely editable.
   */
  async updateCategory(id: string, dto: UpdateCourseCategoryDto, actor: AuthPrincipal) {
    const existing = await this.prisma.courseCategory.findUnique({
      where: { id },
      include: { _count: { select: { courses: true } } },
    });
    if (!existing) throw new NotFoundException('Course category not found');

    // Deactivating a category in use would leave those courses pointing at a
    // category the UI filters out, which reads as data loss to a registrar.
    if (dto.isActive === false && existing._count.courses > 0) {
      throw new ConflictException(
        `${existing._count.courses} course(s) still use ${existing.key}. ` +
          'Re-categorise them before deactivating it.',
      );
    }

    const category = await this.prisma.courseCategory.update({
      where: { id },
      data: {
        label: dto.label?.trim(),
        description: dto.description === undefined ? undefined : dto.description.trim() || null,
        sortOrder: dto.sortOrder,
        isActive: dto.isActive,
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'academic.category.update',
      entityType: 'CourseCategory',
      entityId: id,
      before: { label: existing.label, sortOrder: existing.sortOrder, isActive: existing.isActive },
      after: { label: category.label, sortOrder: category.sortOrder, isActive: category.isActive },
    });
    return category;
  }

  // --- Grade scales -------------------------------------------------------

  listScales(includeInactive = false) {
    return this.prisma.gradeScale.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: {
        bands: { orderBy: [{ sortOrder: 'asc' }, { minScore: 'desc' }] },
        _count: { select: { gradeRecords: true } },
      },
      orderBy: [{ isDefault: 'desc' }, { key: 'asc' }],
    });
  }

  async getScale(id: string) {
    const scale = await this.prisma.gradeScale.findUnique({
      where: { id },
      include: {
        bands: { orderBy: [{ sortOrder: 'asc' }, { minScore: 'desc' }] },
        _count: { select: { gradeRecords: true } },
      },
    });
    if (!scale) throw new NotFoundException('Grade scale not found');
    return scale;
  }

  async createScale(dto: CreateGradeScaleDto, actor: AuthPrincipal) {
    const bands = this.validateBands(dto.bands);
    const key = dto.key.trim().toUpperCase();

    try {
      const scale = await this.prisma.$transaction(async (tx) => {
        const created = await tx.gradeScale.create({
          data: {
            key,
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            // The first scale on a fresh install becomes the default, because a
            // system with scales but no default cannot grade anything and the
            // failure would only surface at the first result upload.
            isDefault: (await tx.gradeScale.count()) === 0,
          },
        });
        await tx.gradeBand.createMany({
          data: bands.map((b, i) => ({ ...b, scaleId: created.id, sortOrder: b.sortOrder ?? i })),
        });
        return created;
      });

      await this.audit.record({
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'academic.gradescale.create',
        entityType: 'GradeScale',
        entityId: scale.id,
        after: {
          key: scale.key,
          name: scale.name,
          bandCount: bands.length,
          isDefault: scale.isDefault,
        },
      });
      return this.getScale(scale.id);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Grade scale ${key} already exists`);
      }
      throw err;
    }
  }

  /**
   * Replace a scale's bands.
   *
   * Refused once the scale has graded anything. Every GradeRecord pins the scale
   * it was computed against precisely so that a later revision does not
   * re-grade history — but that pin records the scale *id*, not a snapshot of
   * its bands, so editing the bands in place would still rewrite the meaning of
   * every past grade. A revised scale is therefore a NEW scale, the same
   * supersede-don't-overwrite rule the curriculum follows.
   */
  async replaceBands(id: string, dto: UpdateGradeScaleBandsDto, actor: AuthPrincipal) {
    const scale = await this.prisma.gradeScale.findUnique({
      where: { id },
      include: { bands: true, _count: { select: { gradeRecords: true } } },
    });
    if (!scale) throw new NotFoundException('Grade scale not found');

    if (scale._count.gradeRecords > 0) {
      throw new ConflictException(
        `${scale._count.gradeRecords} grade record(s) were computed against ${scale.key}. ` +
          'Create a new scale instead — editing these bands would re-grade past results.',
      );
    }

    const bands = this.validateBands(dto.bands);
    await this.prisma.$transaction(async (tx) => {
      await tx.gradeBand.deleteMany({ where: { scaleId: id } });
      await tx.gradeBand.createMany({
        data: bands.map((b, i) => ({ ...b, scaleId: id, sortOrder: b.sortOrder ?? i })),
      });
    });

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'academic.gradescale.bands.set',
      entityType: 'GradeScale',
      entityId: id,
      before: { bands: scale.bands.map((b) => ({ grade: b.grade, minScore: b.minScore })) },
      after: { bandCount: bands.length },
    });
    return this.getScale(id);
  }

  /**
   * Make a scale the default. Exactly one scale is the default at a time, so the
   * flip is a single transaction — two defaults would make "the current scale"
   * ambiguous at the moment results are computed.
   */
  async setDefaultScale(id: string, actor: AuthPrincipal) {
    const scale = await this.prisma.gradeScale.findUnique({
      where: { id },
      include: { bands: { select: { id: true } } },
    });
    if (!scale) throw new NotFoundException('Grade scale not found');
    if (!scale.isActive) throw new ConflictException('An inactive scale cannot be the default');
    if (scale.bands.length === 0) {
      throw new BadRequestException('A scale with no bands cannot be the default');
    }
    if (scale.isDefault) return scale;

    await this.prisma.$transaction([
      this.prisma.gradeScale.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.gradeScale.update({ where: { id }, data: { isDefault: true } }),
    ]);

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'academic.gradescale.set_default',
      entityType: 'GradeScale',
      entityId: id,
      after: { key: scale.key, isDefault: true },
    });
    return this.getScale(id);
  }

  /**
   * Validate a band set as a whole.
   *
   * Three properties matter, and all three are cheap to violate by hand:
   *   1. no band overlaps another, or a score maps to two grades;
   *   2. the bands COVER 0-100 with no gap, or a score maps to no grade — the
   *      failure would surface as an un-gradeable script at results time;
   *   3. grade letters are unique.
   * Higher grade points must also go with higher scores, since a scale where
   * a lower mark earns a better point is almost certainly a transcription error.
   */
  private validateBands(input: GradeBandDto[]) {
    if (input.length === 0) throw new BadRequestException('A grade scale needs at least one band');

    const bands = input.map((b) => ({
      grade: b.grade.trim().toUpperCase(),
      minScore: new Prisma.Decimal(b.minScore),
      maxScore: new Prisma.Decimal(b.maxScore),
      gradePoint: new Prisma.Decimal(b.gradePoint),
      sortOrder: b.sortOrder,
    }));

    for (const b of bands) {
      if (b.minScore.greaterThan(b.maxScore)) {
        throw new BadRequestException(
          `Band ${b.grade}: minimum score ${b.minScore} is above its maximum ${b.maxScore}`,
        );
      }
    }

    const grades = bands.map((b) => b.grade);
    const dupes = grades.filter((g, i) => grades.indexOf(g) !== i);
    if (dupes.length > 0) {
      throw new BadRequestException(`Duplicate grade(s): ${[...new Set(dupes)].join(', ')}`);
    }

    // Ascending by score makes both the overlap and the gap check a single pass.
    const sorted = [...bands].sort((a, b) => a.minScore.comparedTo(b.minScore));

    if (!sorted[0].minScore.equals(0)) {
      throw new BadRequestException(
        `Bands must start at 0 — the lowest band (${sorted[0].grade}) starts at ${sorted[0].minScore}`,
      );
    }
    const top = sorted[sorted.length - 1];
    if (!top.maxScore.equals(100)) {
      throw new BadRequestException(
        `Bands must reach 100 — the highest band (${top.grade}) ends at ${top.maxScore}`,
      );
    }

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (cur.minScore.lessThanOrEqualTo(prev.maxScore)) {
        throw new BadRequestException(
          `Bands ${prev.grade} (${prev.minScore}-${prev.maxScore}) and ` +
            `${cur.grade} (${cur.minScore}-${cur.maxScore}) overlap`,
        );
      }
      // Bands are inclusive at both ends, so consecutive bands must meet exactly:
      // 0-39 then 40-44. Anything wider leaves a score with no grade.
      if (!cur.minScore.minus(prev.maxScore).equals(1)) {
        throw new BadRequestException(
          `Gap between ${prev.grade} (ends ${prev.maxScore}) and ` +
            `${cur.grade} (starts ${cur.minScore}) — every score from 0 to 100 must map to a grade`,
        );
      }
      if (cur.gradePoint.lessThan(prev.gradePoint)) {
        throw new BadRequestException(
          `${cur.grade} scores higher than ${prev.grade} but carries fewer grade points ` +
            `(${cur.gradePoint} vs ${prev.gradePoint})`,
        );
      }
    }

    return bands;
  }

  // --- Credit policy ------------------------------------------------------

  /** Read the policy, falling back to the documented default. */
  async getCreditPolicy(): Promise<CreditPolicyDto & { isDefault: boolean }> {
    const row = await this.prisma.systemConfig.findUnique({ where: { key: CREDIT_POLICY_KEY } });
    if (!row) return { ...DEFAULT_CREDIT_POLICY, isDefault: true };

    // SystemConfig.value is Json, so anything could be in there — a hand-edited
    // row must not crash registration. Fall back if the shape is wrong.
    const v = row.value as Partial<CreditPolicyDto> | null;
    if (
      !v ||
      typeof v.minUnits !== 'number' ||
      typeof v.maxUnits !== 'number' ||
      v.minUnits > v.maxUnits
    ) {
      return { ...DEFAULT_CREDIT_POLICY, isDefault: true };
    }
    return { minUnits: v.minUnits, maxUnits: v.maxUnits, isDefault: false };
  }

  async setCreditPolicy(dto: CreditPolicyDto, actor: AuthPrincipal) {
    if (dto.minUnits > dto.maxUnits) {
      throw new BadRequestException(
        `Minimum units (${dto.minUnits}) cannot exceed the maximum (${dto.maxUnits})`,
      );
    }
    const before = await this.getCreditPolicy();

    const value = { minUnits: dto.minUnits, maxUnits: dto.maxUnits };
    await this.prisma.systemConfig.upsert({
      where: { key: CREDIT_POLICY_KEY },
      create: {
        key: CREDIT_POLICY_KEY,
        value,
        description: 'Min/max credit units registrable per semester (INV-8)',
        updatedById: actor.userId,
      },
      update: { value, updatedById: actor.userId },
    });

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'academic.credit_policy.set',
      entityType: 'SystemConfig',
      entityId: CREDIT_POLICY_KEY,
      before: { minUnits: before.minUnits, maxUnits: before.maxUnits },
      after: value,
    });
    return { ...value, isDefault: false };
  }
}
