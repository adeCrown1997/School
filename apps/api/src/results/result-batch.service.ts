import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ScopeType, ScoreMark } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StructureService } from '../structure/structure.service';
import { AuthPrincipal } from '../common/auth-principal';
import { PERMISSIONS, PermissionKey } from '../rbac/permissions.catalog';
import {
  assertDepartmentWithinScope,
  scopeConstraintFor,
  ScopeConstraint,
} from '../rbac/scope.util';
import { CGPA_REPEAT_POLICY_KEY } from '../academics/academic-config.constants';
import {
  bandForTotal,
  computeTotal,
  cumulativeStep,
  GradeBandLike,
  round2,
  semesterGpa,
} from './grade-math';
import { DecideResultBatchDto, PublishResultBatchDto } from './dto/results.dto';

/**
 * The result batch: one offering's results moving through approval together
 * (docs/03 §10.4). This is where raw scores become grades, grades become
 * immutable, and the grade point totals propagate into GPA/CGPA.
 *
 * Lifecycle:
 *   DRAFT ──submit──▶ PENDING_APPROVAL ──[stage chain]──▶ SENATE_RATIFIED
 *     ▲                       │                          │
 *     └─────────reject────────┘               publish (dual control)
 *                                                        ▼
 *                                                    PUBLISHED ──▶ immutable (INV-12)
 *
 * Invariants upheld here:
 *   • Publication is DUAL CONTROL (two distinct actors; the DB CHECK repeats it).
 *   • A published grade row is never updated — the DB trigger forbids it; the
 *     only lawful change is a superseding amendment version (§10.6).
 *   • The CGPA is DERIVED (INV-13): every publish recomputes the affected
 *     students' semester projections from scratch, never hand-edits them.
 *   • Q-02 (dilution vs best-grade on a repeat) has NO default: both models
 *     materially change a CGPA, so publish refuses to guess when the same line
 *     grades twice and no policy row says which counts.
 */
@Injectable()
export class ResultBatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly structure: StructureService,
  ) {}

  // --- reads -----------------------------------------------------------------

  /**
   * Open (or fetch, idempotently) the DRAFT batch for one offering. The batch
   * PINS the default grade scale at creation (docs/03 §10.3), so a later scale
   * edit cannot re-grade an in-flight batch; there is one live batch per
   * offering (@@unique), which is what makes the idempotent return safe.
   */
  async openBatch(offeringId: string, actor: AuthPrincipal) {
    const offering = await this.prisma.courseOffering.findUnique({
      where: { id: offeringId },
      include: {
        course: { select: { id: true, code: true, departmentId: true } },
      },
    });
    if (!offering) throw new NotFoundException('Course offering not found');
    this.assertInBatchScope(
      {
        offering: {
          departmentId: offering.departmentId ?? offering.course.departmentId,
          course: offering.course,
        },
      },
      actor,
      PERMISSIONS.RESULTS_SCORE_MANAGE,
    );

    const existing = await this.prisma.resultBatch.findUnique({ where: { offeringId } });
    if (existing)
      return this.detailWithPermission(existing.id, actor, PERMISSIONS.RESULTS_SCORE_MANAGE);

    const scale = await this.prisma.gradeScale.findFirst({
      where: { isDefault: true, isActive: true },
      select: { id: true },
    });
    if (!scale) {
      throw new ConflictException(
        'No default grade scale is configured. Set one under Academic configuration before opening a result batch.',
      );
    }

    const batch = await this.prisma.resultBatch.create({
      data: {
        offeringId,
        sessionId: offering.sessionId,
        semesterId: offering.semesterId,
        gradeScaleId: scale.id,
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'results.batch.open',
      entityType: 'ResultBatch',
      entityId: batch.id,
      after: { course: offering.course.code, gradeScaleId: scale.id },
    });
    return this.detailWithPermission(batch.id, actor, PERMISSIONS.RESULTS_SCORE_MANAGE);
  }

  /**
   * Batch-by-offering for someone who holds score.manage but not results.view —
   * the score-entry screen needs to show WHERE in the lifecycle the sheet is.
   * Returns 404 (not an empty success) when the batch does not exist yet: the
   * UI offers to open it from there.
   */
  async detailForOffering(offeringId: string, actor: AuthPrincipal) {
    const batch = await this.prisma.resultBatch.findUnique({ where: { offeringId } });
    if (!batch) throw new NotFoundException('No result batch exists for this offering yet');
    return this.detailWithPermission(batch.id, actor, PERMISSIONS.RESULTS_SCORE_MANAGE);
  }

  async list(
    filter: { sessionId?: string; semesterId?: string; status?: string },
    actor: AuthPrincipal,
  ) {
    const where: Prisma.ResultBatchWhereInput = {
      sessionId: filter.sessionId,
      semesterId: filter.semesterId,
    };
    if (filter.status) {
      where.status = filter.status as Prisma.ResultBatchWhereInput['status'];
    }
    // Scope narrowing: batches belong to a department-owned offering, so the
    // same department-scope engine as offerings applies.
    const constraint = scopeConstraintFor(actor, PERMISSIONS.RESULTS_VIEW);
    if (!constraint.unrestricted) {
      const deptFilter: Prisma.ResultBatchWhereInput['offering'] = {
        OR: [
          ...(constraint.departmentIds.length
            ? [{ departmentId: { in: constraint.departmentIds } }]
            : []),
          ...(constraint.facultyIds.length
            ? [{ department: { facultyId: { in: constraint.facultyIds } } }]
            : []),
        ],
      };
      if (deptFilter.OR?.length === 0) {
        // Holds the permission at no usable scope → fail closed, see studentScopeWhere.
        deptFilter.OR = [{ departmentId: '00000000-0000-0000-0000-000000000000' }];
      }
      where.offering = deptFilter;
    }

    return this.prisma.resultBatch.findMany({
      where,
      include: {
        offering: {
          include: {
            course: { select: { id: true, code: true, title: true } },
            semester: { select: { id: true, name: true, sequence: true } },
          },
        },
        session: { select: { id: true, name: true } },
        gradeScale: { select: { id: true, key: true, name: true } },
        _count: { select: { gradeRecords: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async detail(batchId: string, actor: AuthPrincipal) {
    return this.detailWithPermission(batchId, actor, PERMISSIONS.RESULTS_VIEW);
  }

  /**
   * The detail read, scoped by a CALLER-CHOSEN permission. Lifecycle methods
   * (open/submit/approve/publish) hand back the batch after acting; scoping that
   * hand-off by results.view would 403 the lecturer who holds results.score.manage
   * but not results.view — the two views must use whatever authority the caller
   * just exercised.
   */
  private async detailWithPermission(
    batchId: string,
    actor: AuthPrincipal,
    permission: PermissionKey,
  ) {
    const batch = await this.prisma.resultBatch.findUnique({
      where: { id: batchId },
      include: {
        offering: {
          include: {
            course: {
              select: { id: true, code: true, title: true, creditUnits: true, departmentId: true },
            },
            semester: { select: { id: true, name: true, sequence: true } },
          },
        },
        session: { select: { id: true, name: true } },
        semester: { select: { id: true, name: true, sequence: true } },
        gradeScale: { include: { bands: { orderBy: [{ sortOrder: 'asc' }] } } },
        approvals: {
          include: { stage: { select: { key: true, name: true, sequence: true } } },
          orderBy: { stage: { sequence: 'asc' } },
        },
        gradeRecords: {
          include: { course: { select: { code: true, title: true } } },
          orderBy: { publishedAt: 'desc' },
        },
      },
    });
    if (!batch) throw new NotFoundException('Result batch not found');
    this.assertInBatchScope(batch, actor, permission);
    return batch;
  }

  // --- compute (the preview that is also the payload) --------------------------

  /**
   * Grade every registered student from their SUBMITTED entries, against the
   * batch's pinned scale (§10.3). This is pure computation — reading the same
   * rows a publish would write — so the reviewer literally sees the numbers
   * they are approving, and nothing is recomputed differently at publish.
   *
   * A student missing a component is REPORTED, not zeroed: a blank that
   * silently becomes 0 is precisely the transcript scandal marks management
   * exists to prevent.
   */
  async compute(
    batchId: string,
    actor: AuthPrincipal,
    permission: PermissionKey = PERMISSIONS.RESULTS_VIEW,
  ) {
    const batch = await this.prisma.resultBatch.findUnique({
      where: { id: batchId },
      include: {
        offering: { include: { course: { select: { code: true, departmentId: true } } } },
        gradeScale: { include: { bands: { orderBy: [{ sortOrder: 'asc' }] } } },
      },
    });
    if (!batch) throw new NotFoundException('Result batch not found');
    this.assertInBatchScope(batch, actor, permission);

    const components = await this.prisma.assessmentComponent.findMany({
      where: { offeringId: batch.offeringId },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    });
    if (components.length === 0) {
      throw new ConflictException(
        'This offering has no assessment structure — define components first.',
      );
    }

    const lines = await this.prisma.registrationLine.findMany({
      where: {
        courseOfferingId: batch.offeringId,
        state: 'ACTIVE',
        registration: { status: 'LOCKED' },
      },
      select: {
        id: true,
        registration: {
          select: {
            level: true,
            studentRecord: {
              select: { id: true, matriculationNumber: true, surname: true, firstName: true },
            },
          },
        },
      },
    });

    const entries = await this.prisma.scoreEntry.findMany({
      where: { component: { offeringId: batch.offeringId }, state: 'SUBMITTED' },
    });
    const byKey = new Map(entries.map((e) => [`${e.componentId}:${e.registrationLineId}`, e]));

    const bands = batch.gradeScale.bands.map((b) => ({
      grade: b.grade,
      minScore: b.minScore,
      maxScore: b.maxScore,
      gradePoint: b.gradePoint,
    }));

    const rows = lines.map((l) => {
      const parts: Array<{
        score: Prisma.Decimal;
        maxScore: Prisma.Decimal;
        weight: Prisma.Decimal;
      }> = [];
      const missing: string[] = [];
      let unscoredMark: string | null = null;

      for (const c of components) {
        const e = byKey.get(`${c.id}:${l.id}`);
        if (!e) {
          missing.push(c.key);
          continue;
        }
        if (e.mark !== 'SCORED' || e.score === null) {
          unscoredMark = e.mark;
          continue;
        }
        parts.push({ score: e.score, maxScore: c.maxScore, weight: c.weight });
      }

      const student = l.registration.studentRecord;
      if (missing.length > 0) {
        return {
          registrationLineId: l.id,
          matriculationNumber: student.matriculationNumber,
          fullName: `${student.surname} ${student.firstName}`,
          level: l.registration.level,
          status: 'INCOMPLETE' as const,
          reason: `Missing submitted entry for: ${missing.join(', ')}`,
          totalScore: null,
          grade: null,
          gradePoint: null,
          mark: null,
        };
      }
      if (unscoredMark) {
        return {
          registrationLineId: l.id,
          matriculationNumber: student.matriculationNumber,
          fullName: `${student.surname} ${student.firstName}`,
          level: l.registration.level,
          status: 'MARKED' as const,
          reason: unscoredMark,
          totalScore: null,
          grade: null,
          gradePoint: null,
          mark: unscoredMark,
        };
      }

      const total = computeTotal(parts);
      const band = bandForTotal(bands, total);
      const passing = band.gradePoint.greaterThan(0);
      return {
        registrationLineId: l.id,
        matriculationNumber: student.matriculationNumber,
        fullName: `${student.surname} ${student.firstName}`,
        level: l.registration.level,
        status: 'OK' as const,
        reason: null,
        totalScore: round2(total),
        grade: band.grade,
        gradePoint: band.gradePoint,
        mark: 'SCORED',
        passed: passing,
      };
    });

    return {
      offering: batch.offering.course.code,
      batchStatus: batch.status,
      graded: rows.filter((r) => r.status === 'OK').length,
      incomplete: rows.filter((r) => r.status === 'INCOMPLETE').length,
      marked: rows.filter((r) => r.status === 'MARKED').length,
      rows,
    };
  }

  // --- DRAFT → PENDING_APPROVAL ---------------------------------------------

  async submit(batchId: string, actor: AuthPrincipal) {
    const batch = await this.loadMutable(batchId);
    this.assertInBatchScope(batch, actor, PERMISSIONS.RESULTS_SCORE_MANAGE);

    if (batch.status !== 'DRAFT' && batch.status !== 'REJECTED') {
      throw new ConflictException(
        `Only a draft or rejected batch can be submitted; this one is ` +
          `${batch.status.toLowerCase().replace(/_/g, ' ')}.`,
      );
    }

    // Nothing goes for approval incomplete: the preview is the gate. Scope is
    // SCORE_MANAGE here because submit is a lecturer action, not a view read.
    const preview = await this.compute(batchId, actor, PERMISSIONS.RESULTS_SCORE_MANAGE);
    if (preview.incomplete > 0) {
      throw new ConflictException(
        `${preview.incomplete} student(s) have unsubmitted component(s). ` +
          'Every entry must be submitted before the batch can move for approval.',
      );
    }

    const now = new Date();
    const resubmission = batch.status === 'REJECTED';
    await this.prisma.$transaction(async (tx) => {
      // A resubmission after rejection is a NEW approval cycle: last cycle's
      // signatures must not count toward the corrected batch (and the
      // per-stage unique would otherwise block every stage they already
      // decided). They survive in the audit trail.
      if (resubmission) {
        await tx.resultApproval.deleteMany({ where: { batchId } });
      }
      await tx.resultBatch.update({
        where: { id: batchId },
        data: { status: 'PENDING_APPROVAL', submittedAt: now, rejectReason: null },
      });
      await this.audit.recordTx(tx, {
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'results.batch.submit',
        entityType: 'ResultBatch',
        entityId: batchId,
        before: { status: batch.status },
        after: { status: 'PENDING_APPROVAL', graded: preview.graded, marked: preview.marked },
      });
    });
    return this.detailWithPermission(batchId, actor, PERMISSIONS.RESULTS_SCORE_MANAGE);
  }

  // --- approval chain (§10.4) -------------------------------------------------

  /**
   * One stage's decision. The stage order and required roles are DATA
   * (RESULT-domain ApprovalStage rows), the actor may not sign two stages
   * (§5.4), and a rejection returns the batch to the lecturer with a mandatory
   * reason.
   */
  async decide(batchId: string, actor: AuthPrincipal, input: DecideResultBatchDto) {
    const batch = await this.loadMutable(batchId);
    this.assertInBatchScope(batch, actor, PERMISSIONS.RESULTS_APPROVE);

    if (batch.status !== 'PENDING_APPROVAL') {
      throw new ConflictException(
        `Only a batch awaiting approval can be decided; this one is ` +
          `${batch.status.toLowerCase().replace(/_/g, ' ')}.`,
      );
    }
    const comment = input.comment?.trim() || null;
    if (input.decision === 'REJECTED' && !comment) {
      throw new BadRequestException(
        'A rejection must say why — the lecturer needs it to correct the batch.',
      );
    }

    const stages = await this.prisma.approvalStage.findMany({
      where: { domain: 'RESULT', isActive: true },
      orderBy: { sequence: 'asc' },
    });
    if (stages.length === 0) {
      throw new ConflictException('No result approval chain is configured. Contact the registry.');
    }

    const approvals = batch.approvals;
    const decided = new Map(approvals.map((a) => [a.stageId, a]));
    const stage = stages.find((s) => decided.get(s.id)?.decision !== 'APPROVED');
    if (!stage) {
      throw new ConflictException('Every approval stage has already passed on this batch.');
    }
    // §5.4 checked across the whole cycle: an actor who already signed an
    // earlier stage cannot sign a later one on the same batch.
    if (approvals.some((a) => a.decidedById === actor.userId)) {
      throw new ForbiddenException('You have already acted on this batch at an earlier stage');
    }
    await this.assertStageAuthority(stage, batch, actor);

    const approving = input.decision === 'APPROVED';
    const isFinal = stages[stages.length - 1].id === stage.id;
    const now = new Date();

    try {
      await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.resultBatch.findUniqueOrThrow({
          where: { id: batchId },
          select: { status: true },
        });
        if (fresh.status !== 'PENDING_APPROVAL') {
          throw new ConflictException('This batch was decided a moment ago.');
        }

        await tx.resultApproval.create({
          data: {
            batchId,
            stageId: stage.id,
            decision: input.decision,
            comment,
            decidedById: actor.userId,
            decidedAt: now,
          },
        });

        if (!approving) {
          await tx.resultBatch.update({
            where: { id: batchId },
            data: { status: 'REJECTED', rejectReason: comment },
          });
        } else if (isFinal) {
          await tx.resultBatch.update({
            where: { id: batchId },
            data: { status: 'SENATE_RATIFIED', ratifiedAt: now },
          });
        }

        await this.audit.recordTx(tx, {
          actorId: actor.userId,
          actorLabel: actor.email,
          action: approving ? 'results.batch.approve' : 'results.batch.reject',
          entityType: 'ResultBatch',
          entityId: batchId,
          before: { status: 'PENDING_APPROVAL' },
          after: {
            status: approving ? (isFinal ? 'SENATE_RATIFIED' : 'PENDING_APPROVAL') : 'REJECTED',
            stage: stage.key,
            sequence: stage.sequence,
            finalStage: isFinal,
            comment,
          },
        });
      });
    } catch (err) {
      // One decision per stage per batch (@@unique).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`${stage.key} has already been decided on this batch`);
      }
      throw err;
    }
    return this.detail(batchId, actor);
  }

  // --- publication (dual control) ---------------------------------------------

  /**
   * PUBLISHED is what makes results student-visible and grade rows immutable.
   * It takes TWO signatures from two distinct people (the DB CHECK enforces the
   * distinctness). On the second signature the batch:
   *   1. writes a GradeRecord per line (a supersede-version if the line graded
   *      before — INV-12, never an UPDATE of the old row);
   *   2. recomputes GPA/CGPA for each affected student from scratch — these are
   *      DERIVED projections (INV-13), not hand-set columns.
   */
  async publish(batchId: string, actor: AuthPrincipal, dto: PublishResultBatchDto) {
    const batch = await this.loadMutable(batchId);
    this.assertInBatchScope(batch, actor, PERMISSIONS.RESULTS_PUBLISH);

    if (batch.status === 'PUBLISHED') return this.detail(batchId, actor);
    if (batch.status !== 'SENATE_RATIFIED') {
      throw new ConflictException(
        `Only a ratified batch can be published; this one is ` +
          `${batch.status.toLowerCase().replace(/_/g, ' ')}.`,
      );
    }

    const isSecondSigner = batch.publishedById !== null;
    if (isSecondSigner && batch.publishedById === actor.userId) {
      throw new ForbiddenException(
        'You recorded the first publish signature — dual control requires a second person to confirm.',
      );
    }
    const comment = dto.comment?.trim() || null;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.resultBatch.findUniqueOrThrow({
        where: { id: batchId },
        select: { status: true, publishedById: true, publishedAt: true },
      });
      if (fresh.status !== 'SENATE_RATIFIED') {
        throw new ConflictException('This batch is no longer in a ratified state.');
      }

      if (!fresh.publishedById) {
        // First co-signature. Grades are not written yet — the batch is only
        // "committed" by the second actor. Keeping the write on the second
        // signature means a first signer seeing wrong preview values cannot
        // publish unilaterally.
        await tx.resultBatch.update({
          where: { id: batchId },
          data: { publishedById: actor.userId },
        });
        await this.audit.recordTx(tx, {
          actorId: actor.userId,
          actorLabel: actor.email,
          action: 'results.batch.publish.request',
          entityType: 'ResultBatch',
          entityId: batchId,
          after: { status: fresh.status, comment },
        });
        return;
      }

      // Second co-signature: write the grades and the derived GPAs.
      const preview = await this.computeRows(tx, batch);
      const incomplete = preview.filter((r) => r.status === 'INCOMPLETE');
      if (incomplete.length > 0) {
        throw new ConflictException(
          `${incomplete.length} student(s) are missing submitted entries — publication refused.`,
        );
      }

      const affectedStudents = new Set<string>();
      for (const row of preview) {
        if (row.status !== 'OK') {
          // ABSENT/WITHHELD/MEDICAL/MALPRACTICE rows still get a record: the
          // transcript renders the explicit mark rather than a gap, and the
          // withholding is reviewable as a row.
          await this.writeGradeRecord(tx, batch, row, now);
          affectedStudents.add(row.studentRecordId);
          continue;
        }
        await this.writeGradeRecord(tx, batch, row, now);
        affectedStudents.add(row.studentRecordId);
      }

      await tx.resultBatch.update({
        where: { id: batchId },
        data: { status: 'PUBLISHED', publishedAt: now, publishCosignerId: actor.userId },
      });

      for (const studentId of affectedStudents) {
        await this.recomputeStudentGpas(tx, studentId);
      }

      await this.audit.recordTx(tx, {
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'results.batch.publish',
        entityType: 'ResultBatch',
        entityId: batchId,
        before: { status: 'SENATE_RATIFIED' },
        after: {
          status: 'PUBLISHED',
          grades: preview.length,
          affectedStudents: affectedStudents.size,
        },
      });
    });

    return this.detail(batchId, actor);
  }

  // --- writing grade rows (never updating a published one) --------------------

  private async writeGradeRecord(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0] extends never
      ? never
      : Prisma.TransactionClient,
    batch: {
      id: string;
      offeringId: string;
      sessionId: string;
      semesterId: string;
      gradeScaleId: string;
      offering: { courseId: string };
    },
    row: ComputedRow,
    now: Date,
  ) {
    // If this line graded before, this is a repeat: supersede the old row and
    // write a new version. The old row is RETAINED with its history (INV-12);
    // the partial index uq_grade_current_per_line keeps at most one current.
    const current = await tx.gradeRecord.findFirst({
      where: { registrationLineId: row.registrationLineId, supersededById: null },
      select: { id: true, version: true },
    });

    const created = await tx.gradeRecord.create({
      data: {
        studentRecordId: row.studentRecordId,
        registrationLineId: row.registrationLineId,
        batchId: batch.id,
        offeringId: batch.offeringId,
        courseId: batch.offering.courseId,
        sessionId: batch.sessionId,
        semesterId: batch.semesterId,
        totalScore: row.totalScore,
        grade: row.grade,
        gradePoint: row.gradePoint,
        creditUnits: row.creditUnits,
        mark: row.mark ?? 'SCORED',
        gradeScaleId: batch.gradeScaleId,
        countsTowardCgpa: row.countsTowardCgpa,
        isCarryover: row.isCarryover,
        version: current ? current.version + 1 : 1,
        publishedAt: now,
      },
    });

    if (current) {
      // Setting ONLY superseded_by is the one update the published-grade
      // guard trigger explicitly permits.
      await tx.gradeRecord.update({
        where: { id: current.id },
        data: { supersededById: created.id },
      });
    }
    return created;
  }

  // --- GPA recomputation (INV-13: derived, never hand-written) ------------------

  /**
   * Rebuild a student's semester GPAs and running CGPA from their CURRENT
   * (non-superseded) grade records, oldest semester first.
   *
   * Q-02 has NO default: when a line grades twice (a retake), dilution and
   * best-grade produce different CGPAs, and guessing would silently misclassify
   * the degree. If a policy row (system_config `academic.cgpa_repeat_policy`,
   * value `{ "policy": "DILUTION" | "BEST_GRADE" }`) is present it is applied;
   * otherwise publication refuses at the first repeat. The institution must
   * choose explicitly before a repeat is graded.
   */
  private async recomputeStudentGpas(tx: Prisma.TransactionClient, studentRecordId: string) {
    const current = await tx.gradeRecord.findMany({
      where: { studentRecordId, supersededById: null },
      include: {
        registrationLine: { select: { id: true, registration: { select: { level: true } } } },
      },
    });
    if (current.length === 0) return;

    // A current row with version > 1 means the line graded before and this is a
    // retake — the only situation where Q-02 matters.
    const hasRepeat = current.some((r) => r.version > 1);
    let repeatPolicy: 'DILUTION' | 'BEST_GRADE' | null = null;
    if (hasRepeat) {
      const cfg = await tx.systemConfig.findUnique({ where: { key: CGPA_REPEAT_POLICY_KEY } });
      const v = cfg?.value as { policy?: unknown } | null;
      if (v?.policy === 'DILUTION' || v?.policy === 'BEST_GRADE') repeatPolicy = v.policy;
      if (!repeatPolicy) {
        throw new ConflictException(
          'This student has a repeated course. The CGPA treatment of repeats ' +
            '(dilution vs best-grade, Q-02) has not been decided — set the academic.' +
            'cgpa_repeat_policy system config to DILUTION or BEST_GRADE before ' +
            'publishing a repeat. Picking wrong silently misclassifies degrees.',
        );
      }
    }

    // Bucket by semester; under BEST_GRADE only the highest attempt of each
    // line counts toward the CGPA (the others stay visible on the transcript,
    // excluded from the denominator).
    const bestByLine = new Map<string, (typeof current)[number]>();
    if (repeatPolicy === 'BEST_GRADE') {
      for (const row of current) {
        const held = bestByLine.get(row.registrationLineId);
        if (!held) {
          bestByLine.set(row.registrationLineId, row);
          continue;
        }
        const heldPts = held.gradePoint?.toNumber() ?? -1;
        const rowPts = row.gradePoint?.toNumber() ?? -1;
        if (rowPts >= heldPts) bestByLine.set(row.registrationLineId, row);
      }
    }

    interface TermRow {
      id: string;
      studentRecordId: string;
      sessionId: string;
      semesterId: string;
      registrationLineId: string;
      level: number;
      creditUnits: number;
      gradePoint: Prisma.Decimal | null;
      passed: boolean;
      countsTowardCgpa: boolean;
    }
    const terms = new Map<string, { sessionId: string; rows: TermRow[] }>();
    for (const r of current) {
      const excluded =
        repeatPolicy === 'BEST_GRADE' && bestByLine.get(r.registrationLineId)?.id !== r.id;
      const passed = r.gradePoint !== null && r.gradePoint.greaterThan(0);
      const term = terms.get(r.semesterId) ?? { sessionId: r.sessionId, rows: [] };
      term.rows.push({
        id: r.id,
        studentRecordId: r.studentRecordId,
        sessionId: r.sessionId,
        semesterId: r.semesterId,
        registrationLineId: r.registrationLineId,
        level: r.registrationLine.registration.level,
        creditUnits: r.creditUnits,
        gradePoint: r.gradePoint,
        passed,
        countsTowardCgpa: !excluded && r.countsTowardCgpa,
      });
      terms.set(r.semesterId, term);
    }

    // Chronological order: session start date, then semester sequence.
    const semesterMeta = await tx.semester.findMany({
      where: { id: { in: [...terms.keys()] } },
      select: { id: true, sequence: true, session: { select: { startDate: true } } },
    });
    const orderBySemester = new Map(
      semesterMeta.map((s, i) => [
        s.id,
        { i, sequence: s.sequence, start: s.session.startDate.getTime() },
      ]),
    );
    const sortedTerms = [...terms.entries()]
      .sort((a, b) => {
        const ma = orderBySemester.get(a[0]);
        const mb = orderBySemester.get(b[0]);
        if (!ma || !mb) return 0;
        if (ma.start !== mb.start) return ma.start - mb.start;
        return ma.sequence - mb.sequence;
      })
      .map(([, v]) => v);

    let cumulativeUnits = 0;
    let cumulativeGradePoints = new Prisma.Decimal(0);
    for (const term of sortedTerms) {
      const level = Math.max(0, ...term.rows.map((r) => r.level));
      const g = semesterGpa(term.rows);
      const step = cumulativeStep(
        { units: cumulativeUnits, gradePoints: cumulativeGradePoints },
        { units: g.unitsRegistered, gradePoints: g.gradePoints },
      );
      cumulativeUnits = step.units;
      cumulativeGradePoints = step.gradePoints;

      await tx.semesterGpa.upsert({
        where: {
          studentRecordId_semesterId: { studentRecordId, semesterId: term.rows[0].semesterId },
        },
        create: {
          studentRecordId,
          sessionId: term.sessionId,
          semesterId: term.rows[0].semesterId,
          level,
          unitsRegistered: g.unitsRegistered,
          unitsPassed: g.unitsPassed,
          gradePoints: g.gradePoints,
          gpa: g.gpa,
          cumulativeUnits: step.units,
          cumulativeGradePoints: step.gradePoints,
          cgpa: step.cgpa,
        },
        update: {
          level,
          unitsRegistered: g.unitsRegistered,
          unitsPassed: g.unitsPassed,
          gradePoints: g.gradePoints,
          gpa: g.gpa,
          cumulativeUnits: step.units,
          cumulativeGradePoints: step.gradePoints,
          cgpa: step.cgpa,
        },
      });
    }
  }

  /** The publish path recomputes inside its own transaction so the preview and
   *  the write cannot diverge. */
  private async computeRows(
    tx: Prisma.TransactionClient,
    batch: Awaited<ReturnType<ResultBatchService['loadMutable']>>,
  ) {
    const components = await tx.assessmentComponent.findMany({
      where: { offeringId: batch.offeringId },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    });
    const lines = await tx.registrationLine.findMany({
      where: {
        courseOfferingId: batch.offeringId,
        state: 'ACTIVE',
        registration: { status: 'LOCKED' },
      },
      select: {
        id: true,
        creditUnits: true,
        lineType: true,
        registration: {
          select: {
            level: true,
            studentRecord: { select: { id: true, matriculationNumber: true } },
          },
        },
      },
    });
    const entries = await tx.scoreEntry.findMany({
      where: { component: { offeringId: batch.offeringId }, state: 'SUBMITTED' },
    });
    const byKey = new Map(entries.map((e) => [`${e.componentId}:${e.registrationLineId}`, e]));
    const bands: GradeBandLike[] = batch.gradeScale.bands.map((b) => ({
      grade: b.grade,
      minScore: b.minScore,
      maxScore: b.maxScore,
      gradePoint: b.gradePoint,
    }));

    const rows: ComputedRow[] = [];
    for (const l of lines) {
      const missing: string[] = [];
      let unscoredMark: ScoreMark | null = null;
      const parts: Array<{
        score: Prisma.Decimal;
        maxScore: Prisma.Decimal;
        weight: Prisma.Decimal;
      }> = [];
      for (const c of components) {
        const e = byKey.get(`${c.id}:${l.id}`);
        if (!e) {
          missing.push(c.key);
          continue;
        }
        if (e.mark !== 'SCORED' || e.score === null) {
          unscoredMark = e.mark;
          continue;
        }
        parts.push({ score: e.score, maxScore: c.maxScore, weight: c.weight });
      }

      const base = {
        registrationLineId: l.id,
        studentRecordId: l.registration.studentRecord.id,
        matriculationNumber: l.registration.studentRecord.matriculationNumber,
        creditUnits: l.creditUnits,
        isCarryover: l.lineType === 'CARRYOVER',
        countsTowardCgpa: true,
      };

      if (missing.length > 0) {
        rows.push({
          ...base,
          status: 'INCOMPLETE',
          totalScore: null,
          grade: null,
          gradePoint: null,
          mark: null,
        });
        continue;
      }
      if (unscoredMark) {
        rows.push({
          ...base,
          status: 'MARKED',
          totalScore: null,
          grade: null,
          gradePoint: null,
          mark: unscoredMark,
        });
        continue;
      }
      const total = computeTotal(parts);
      const band = bandForTotal(bands, total);
      // A retake of a failed course only counts under DILUTION; under
      // BEST_GRADE the best attempt counts and is resolved in the GPA pass.
      const retake = l.lineType === 'REPEAT';
      rows.push({
        ...base,
        status: 'OK',
        totalScore: round2(total),
        grade: band.grade,
        gradePoint: band.gradePoint,
        mark: 'SCORED',
        countsTowardCgpa: !(retake && band.gradePoint.lessThanOrEqualTo(0)),
      });
    }
    return rows;
  }

  // --- authority -------------------------------------------------------------

  private async loadMutable(batchId: string) {
    const batch = await this.prisma.resultBatch.findUnique({
      where: { id: batchId },
      include: {
        offering: {
          include: {
            course: { select: { code: true, departmentId: true } },
          },
        },
        gradeScale: { include: { bands: { orderBy: [{ sortOrder: 'asc' }] } } },
        approvals: { include: { stage: { select: { id: true, key: true, sequence: true } } } },
      },
    });
    if (!batch) throw new NotFoundException('Result batch not found');
    return batch;
  }

  private async assertInBatchScope(
    batch: { offering: { departmentId: string | null; course: { departmentId: string | null } } },
    actor: AuthPrincipal,
    permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS],
  ) {
    const location = await this.structure.resolveDepartmentLocation(
      batch.offering.departmentId ?? batch.offering.course.departmentId,
    );
    assertDepartmentWithinScope(scopeConstraintFor(actor, permission), location);
  }

  private async assertStageAuthority(
    stage: { key: string; requiredRoleId: string | null; scopeKind: ScopeType },
    batch: { offering: { departmentId: string | null; course: { departmentId: string | null } } },
    actor: AuthPrincipal,
  ) {
    // Result batches belong to a DEPARTMENT-owned offering, so the actor must
    // hold the stage's required role at a scope containing that department.
    const location = await this.structure.resolveDepartmentLocation(
      batch.offering.departmentId ?? batch.offering.course.departmentId,
    );

    if (!stage.requiredRoleId) {
      // Single-signature setup: fall back to the results.approve permission's scope.
      assertDepartmentWithinScope(scopeConstraintFor(actor, PERMISSIONS.RESULTS_APPROVE), location);
      return;
    }
    const assignments = await this.prisma.roleAssignment.findMany({
      where: { userId: actor.userId, roleId: stage.requiredRoleId },
      select: { scopeType: true, facultyId: true, departmentId: true, programmeId: true },
    });
    if (assignments.length === 0) {
      throw new ForbiddenException(`Only the ${stage.key} may act at this approval stage`);
    }
    assertDepartmentWithinScope(this.constraintFromAssignments(assignments), location);
  }

  private constraintFromAssignments(
    rows: Array<{
      scopeType: ScopeType;
      facultyId: string | null;
      departmentId: string | null;
      programmeId: string | null;
    }>,
  ): ScopeConstraint {
    const c: ScopeConstraint = {
      unrestricted: false,
      facultyIds: [],
      departmentIds: [],
      programmeIds: [],
    };
    for (const r of rows) {
      if (r.scopeType === 'GLOBAL') c.unrestricted = true;
      if (r.facultyId) c.facultyIds.push(r.facultyId);
      if (r.departmentId) c.departmentIds.push(r.departmentId);
      if (r.programmeId) c.programmeIds.push(r.programmeId);
    }
    return c;
  }
}

interface ComputedRow {
  registrationLineId: string;
  studentRecordId: string;
  matriculationNumber: string;
  creditUnits: number;
  isCarryover: boolean;
  countsTowardCgpa: boolean;
  status: 'OK' | 'MARKED' | 'INCOMPLETE';
  totalScore: Prisma.Decimal | null;
  grade: string | null;
  gradePoint: Prisma.Decimal | null;
  mark: ScoreMark | null;
}
