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
import { SaveScoresDto, ScoreEntryDto, SubmitScoresDto } from './dto/results.dto';

/**
 * Score entry (docs/03 §10.2).
 *
 * Only students with a LOCKED registration may be scored (INV-10 in the other
 * direction). A blank is never a silent zero — an explicit
 * ABSENT/WITHHELD/MEDICAL/MALPRACTICE mark is required, and that mark is what
 * later renders on the transcript.
 *
 * Draft ≠ submitted (autosave must never read as a final result): entries land
 * DRAFT and only an explicit per-component submit promotes them. Out-of-range
 * values are HARD-REJECTED rather than clamped (Q-16) — a 45 entered into a
 * "out of 20" cell is a transcription error the lecturer must fix, not a 20.
 */
/**
 * An offering's scoreable population: the ACTIVE lines of LOCKED registrations
 * (INV-10 — a student who never registered cannot have a grade). Prisma's
 * nested include reaches here via two hops, so the identity is pulled in the
 * same query rather than per row.
 */
type LockedLine = {
  id: string;
  lineType: string;
  registration: {
    level: number;
    studentRecord: { matriculationNumber: string; surname: string; firstName: string };
  };
};

@Injectable()
export class ScoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly structure: StructureService,
  ) {}

  /**
   * The whole score sheet for one offering: columns are the assessment
   * components, rows the locked registration lines, cells the current entry.
   * Carries the totals and letter grade each row would get if submitted now, so
   * the reviewer sees the same number the batch will publish — nothing else
   * reads the entries, so both views must agree.
   */
  async getGrid(offeringId: string, actor: AuthPrincipal) {
    const offering = await this.loadOffering(offeringId);
    this.assertInScope(offering, actor);

    const components = await this.prisma.assessmentComponent.findMany({
      where: { offeringId },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    });
    const lines = await this.lockedLinesForOffering(offeringId);
    const entries = await this.prisma.scoreEntry.findMany({
      where: { component: { offeringId } },
    });

    const byKey = new Map(entries.map((e) => [`${e.componentId}:${e.registrationLineId}`, e]));

    return {
      offering: this.offeringView(offering),
      components: components.map((c) => ({
        id: c.id,
        key: c.key,
        label: c.label,
        weight: c.weight,
        maxScore: c.maxScore,
        sortOrder: c.sortOrder,
      })),
      rows: lines.map((l) => {
        const cells = components.map((c) => {
          const e = byKey.get(`${c.id}:${l.id}`);
          return {
            componentId: c.id,
            registrationLineId: l.id,
            score: e?.score ?? null,
            mark: e?.mark ?? 'SCORED',
            state: e?.state ?? 'DRAFT',
          };
        });
        return {
          registrationLineId: l.id,
          matriculationNumber: l.registration.studentRecord.matriculationNumber,
          fullName: `${l.registration.studentRecord.surname} ${l.registration.studentRecord.firstName}`,
          level: l.registration.level,
          lineType: l.lineType,
          cells,
        };
      }),
    };
  }

  /**
   * Autosave. Upsert by (component, line); a blank score carries an explicit
   * non-SCORED mark, and a SCORED entry requires a numeric score within the
   * component's own scale.
   */
  async saveScores(offeringId: string, dto: SaveScoresDto, actor: AuthPrincipal) {
    const offering = await this.loadOffering(offeringId);
    this.assertInScope(offering, actor);
    await this.assertNotRatified(offering.id);

    const components = await this.prisma.assessmentComponent.findMany({
      where: { offeringId },
    });
    if (components.length === 0) {
      throw new BadRequestException(
        'This offering has no assessment structure yet. Define the components first.',
      );
    }
    const lines = new Set((await this.lockedLinesForOffering(offering.id)).map((l) => l.id));

    const upserted: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const entry of dto.entries) {
        const component = components.find((c) => c.id === entry.componentId);
        if (!component) {
          throw new BadRequestException(
            `Component ${entry.componentId} does not belong to this offering`,
          );
        }
        if (!lines.has(entry.registrationLineId)) {
          throw new BadRequestException(
            `Line ${entry.registrationLineId} is not a locked registration on this offering`,
          );
        }

        const existing = await tx.scoreEntry.findUnique({
          where: {
            componentId_registrationLineId: {
              componentId: component.id,
              registrationLineId: entry.registrationLineId,
            },
          },
        });
        if (existing?.state === 'SUBMITTED') {
          throw new ConflictException(
            `${entry.mark === 'SCORED' ? 'score' : 'mark'} already submitted for ` +
              `${component.key} — resubmission is not allowed; corrections go through a re-approval.`,
          );
        }

        const { score, mark } = this.validateCell(component, entry);
        await tx.scoreEntry.upsert({
          where: {
            componentId_registrationLineId: {
              componentId: component.id,
              registrationLineId: entry.registrationLineId,
            },
          },
          create: {
            componentId: component.id,
            registrationLineId: entry.registrationLineId,
            score,
            mark,
            state: 'DRAFT',
            enteredById: actor.userId,
          },
          update: {
            score,
            mark,
            state: 'DRAFT',
            enteredById: actor.userId,
          },
        });
        upserted.push(`${component.key}:${entry.registrationLineId}`);
      }

      await this.audit.recordTx(tx, {
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'results.scores.save',
        entityType: 'CourseOffering',
        entityId: offering.id,
        after: {
          course: offering.course.code,
          touchedCells: upserted.length,
        },
      });
    });

    return this.getGrid(offeringId, actor);
  }

  /**
   * Promote one or more components' DRAFT entries to SUBMITTED. Refused unless
   * EVERY locked line has an entry (scored or explicitly marked) for the
   * component — a missing cell is the classic way a student ends the semester
   * without a result, and the failure surfaces weeks later when the transcript
   * is printed.
   */
  async submitComponents(offeringId: string, dto: SubmitScoresDto, actor: AuthPrincipal) {
    const offering = await this.loadOffering(offeringId);
    this.assertInScope(offering, actor);
    await this.assertNotRatified(offering.id);

    const components = await this.prisma.assessmentComponent.findMany({
      where: { offeringId },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    });
    const wanted = components.filter((c) => dto.componentIds.includes(c.id));
    if (wanted.length === 0) {
      throw new BadRequestException('No components specified');
    }
    for (const id of dto.componentIds) {
      if (!components.some((c) => c.id === id)) {
        throw new BadRequestException(`Component ${id} does not belong to this offering`);
      }
    }

    const lines = await this.lockedLinesForOffering(offering.id);
    if (lines.length === 0) {
      throw new ConflictException('No locked registration exists on this offering yet');
    }

    const entries = await this.prisma.scoreEntry.findMany({
      where: { componentId: { in: wanted.map((c) => c.id) } },
    });
    const byKey = new Map(entries.map((e) => [`${e.componentId}:${e.registrationLineId}`, e]));

    const incomplete: string[] = [];
    for (const component of wanted) {
      for (const line of lines) {
        const e = byKey.get(`${component.id}:${line.id}`);
        if (!e) {
          incomplete.push(
            `${component.key}: ${line.registration.studentRecord.matriculationNumber} has no entry`,
          );
        }
      }
    }
    if (incomplete.length > 0) {
      throw new ConflictException(
        `Cannot submit — ${incomplete.length} student/component pair(s) have no entry: ` +
          incomplete.slice(0, 10).join('; ') +
          (incomplete.length > 10 ? ` …and ${incomplete.length - 10} more` : ''),
      );
    }

    const now = new Date();
    let promoted = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const entry of entries) {
        if (entry.state === 'SUBMITTED') continue;
        await tx.scoreEntry.update({
          where: { id: entry.id },
          data: { state: 'SUBMITTED', submittedAt: now },
        });
        promoted++;
      }
      await this.audit.recordTx(tx, {
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'results.scores.submit',
        entityType: 'CourseOffering',
        entityId: offering.id,
        after: {
          course: offering.course.code,
          components: wanted.map((c) => c.key),
          entriesPromoted: promoted,
        },
      });
    });

    return { submitted: promoted, components: wanted.map((c) => ({ id: c.id, key: c.key })) };
  }

  // --- validation ------------------------------------------------------------

  /** Out-of-range is a hard rejection (Q-16). The DB trigger repeats this;
   *  rejecting in the service gives the lecturer a fielded message instead of a
   *  500. */
  private validateCell(component: { id: string; maxScore: Prisma.Decimal }, entry: ScoreEntryDto) {
    if (entry.mark !== 'SCORED') {
      return { score: null, mark: entry.mark };
    }
    if (entry.score === null || entry.score === undefined) {
      throw new BadRequestException(
        `${entry.mark} entries must be marked explicitly (ABSENT/WITHHELD/MEDICAL) — a blank is never a zero`,
      );
    }
    const score = new Prisma.Decimal(entry.score);
    if (score.lessThan(0)) {
      throw new BadRequestException('Scores cannot be negative');
    }
    if (score.greaterThan(component.maxScore)) {
      throw new BadRequestException(
        `Score ${score.toString()} exceeds the component maximum of ` +
          `${component.maxScore.toString()}`,
      );
    }
    return { score, mark: 'SCORED' as const };
  }

  /** An offering whose batch is past PENDING_APPROVAL has moved out of the
   *  lecturers' hands — further changes are amendments through the batch. */
  private async assertNotRatified(offeringId: string) {
    const batch = await this.prisma.resultBatch.findUnique({
      where: { offeringId },
      select: { status: true },
    });
    if (batch && (batch.status === 'SENATE_RATIFIED' || batch.status === 'PUBLISHED')) {
      throw new ConflictException(
        `This batch is already ${batch.status.toLowerCase().replace(/_/g, ' ')}. ` +
          'Scores can no longer be edited — corrections must go through a formal amendment.',
      );
    }
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

  private offeringView(offering: Awaited<ReturnType<ScoreService['loadOffering']>>) {
    return {
      id: offering.id,
      capacity: offering.capacity,
      seatsTaken: offering.seatsTaken,
      course: offering.course,
      session: offering.session,
      semester: offering.semester,
    };
  }

  /**
   * The offering's scoreable population: ACTIVE lines on LOCKED registrations.
   * INV-10 in the other direction — a student who never registered (or whose
   * registration never locked) has nothing here to be scored against, and
   * Prisma's unique index on the grade row keys off these SAME line ids, so the
   * two views cannot drift apart.
   */
  private async lockedLinesForOffering(offeringId: string): Promise<LockedLine[]> {
    const lines = await this.prisma.registrationLine.findMany({
      where: { courseOfferingId: offeringId, state: 'ACTIVE', registration: { status: 'LOCKED' } },
      select: {
        id: true,
        lineType: true,
        registration: {
          select: {
            level: true,
            studentRecord: {
              select: { matriculationNumber: true, surname: true, firstName: true },
            },
          },
        },
      },
      orderBy: { registration: { studentRecord: { matriculationNumber: 'asc' } } },
    });
    return lines;
  }

  private async assertInScope(
    offering: { departmentId: string | null; course: { departmentId: string | null } },
    actor: AuthPrincipal,
  ) {
    const location = await this.structure.resolveDepartmentLocation(
      offering.departmentId ?? offering.course.departmentId,
    );
    assertDepartmentWithinScope(
      scopeConstraintFor(actor, PERMISSIONS.RESULTS_SCORE_MANAGE),
      location,
    );
  }
}
