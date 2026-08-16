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
import { AssessmentComponentDto, SetAssessmentComponentsDto } from './dto/results.dto';

/**
 * Assessment structure (docs/03 §10.1 — HOD-owned, INV-11).
 *
 * Weightings are FIXED BY THE DEPARTMENT when the course is allocated, and the
 * lecturer who enters scores cannot change them. This service is the one writer
 * of the component set; ScoreService only reads it.
 *
 * Three coherence rules, all enforced in one place:
 *   • the whole set must sum to EXACTLY 100 — the DB repeats this with a
 *     deferred constraint trigger (guards.sql §18), so a partial total cannot
 *     survive a crash here either;
 *   • the set is replaced WHOLESALE, never patched — a piecemeal edit leaves a
 *     moment where weights do not sum to 100, a state no submission may see;
 *   • once any score is SUBMITTED the structure is locked — changing weights
 *     after marking has started would re-scale students' marks behind their
 *     back (the audit trail cannot undo what never happened explicitly).
 */
@Injectable()
export class AssessmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly structure: StructureService,
  ) {}

  /** Component list for one offering; readable by anyone who may enter or
   *  manage scores on it — the lecturer cannot score blind. */
  async listComponents(offeringId: string, actor: AuthPrincipal, permission: PermissionKey) {
    const offering = await this.loadOffering(offeringId);
    this.assertCanManage(offering, actor, permission);
    return this.prisma.assessmentComponent.findMany({
      where: { offeringId },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    });
  }

  /**
   * Replace the whole component set. `components: []` removes all components,
   * but only while nothing has been submitted — the check is below.
   */
  async setComponents(offeringId: string, dto: SetAssessmentComponentsDto, actor: AuthPrincipal) {
    const offering = await this.loadOffering(offeringId);
    this.assertCanManage(offering, actor, PERMISSIONS.RESULTS_ASSESS_MANAGE);

    const validated = this.validateComponents(dto.components);

    const submittedCount = await this.prisma.scoreEntry.count({
      where: { component: { offeringId }, state: 'SUBMITTED' },
    });
    if (submittedCount > 0) {
      throw new ConflictException(
        `${submittedCount} score(s) have already been submitted against this offering. ` +
          'Assessment weights cannot change after marking has started — ' +
          "a correction now would re-scale students' marks without their knowledge.",
      );
    }

    const keys = dto.components.map((c) => c.key.trim().toUpperCase());
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (dupes.length > 0) {
      throw new BadRequestException(
        `Duplicate component key(s): ${[...new Set(dupes)].join(', ')}`,
      );
    }

    const total = validated.reduce((sum, c) => sum + c.weight, 0);
    // 1e-9 tolerance: 30 + 30 + 40 is fine; 33.33 × 3 + 0.01 is not an integer
    // percent and would drift the final mark either way.
    if (Math.abs(total - 100) > 1e-9) {
      throw new BadRequestException(
        `Component weights total ${total} — they must sum to exactly 100 (INV-11).`,
      );
    }

    const before = await this.prisma.assessmentComponent.findMany({
      where: { offeringId },
      select: { key: true, weight: true, maxScore: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.scoreEntry.deleteMany({ where: { component: { offeringId } } });
      await tx.assessmentComponent.deleteMany({ where: { offeringId } });
      await tx.assessmentComponent.createMany({
        data: validated.map((c, i) => ({
          offeringId,
          key: c.key,
          label: c.label,
          weight: new Prisma.Decimal(c.weight),
          maxScore: new Prisma.Decimal(c.maxScore),
          sortOrder: c.sortOrder ?? i,
          createdById: actor.userId,
        })),
      });
      await this.audit.recordTx(tx, {
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'results.assess.set',
        entityType: 'CourseOffering',
        entityId: offeringId,
        before: {
          components: before.map((b) => ({ key: b.key, weight: b.weight.toString() })),
        },
        after: {
          components: validated.map((c) => ({
            key: c.key,
            weight: c.weight,
            maxScore: c.maxScore,
          })),
        },
      });
    });

    return this.prisma.assessmentComponent.findMany({
      where: { offeringId },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    });
  }

  private validateComponents(input: AssessmentComponentDto[]) {
    if (input.length === 0) return [];
    return input.map((c, i) => {
      const key = c.key.trim().toUpperCase();
      if (c.weight <= 0) {
        throw new BadRequestException(`Component ${key || i + 1}: weight must be positive`);
      }
      if (c.maxScore <= 0) {
        throw new BadRequestException(`Component ${key || i + 1}: maxScore must be positive`);
      }
      return {
        key,
        label: c.label.trim(),
        weight: c.weight,
        maxScore: c.maxScore,
        sortOrder: c.sortOrder,
      };
    });
  }

  private async loadOffering(offeringId: string) {
    const offering = await this.prisma.courseOffering.findUnique({
      where: { id: offeringId },
      include: {
        course: { select: { id: true, code: true, title: true, departmentId: true } },
        session: { select: { id: true, name: true } },
        semester: { select: { id: true, name: true, sequence: true } },
      },
    });
    if (!offering) throw new NotFoundException('Course offering not found');
    return offering;
  }

  private async assertCanManage(
    offering: { departmentId: string | null; course: { departmentId: string | null } },
    actor: AuthPrincipal,
    permission: PermissionKey,
  ) {
    const location = await this.structure.resolveDepartmentLocation(
      offering.departmentId ?? offering.course.departmentId,
    );
    assertDepartmentWithinScope(scopeConstraintFor(actor, permission), location);
  }
}
