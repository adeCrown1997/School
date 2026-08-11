import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AcademicSession,
  ApprovalDecision,
  Prisma,
  RegistrationExceptionType,
  RegistrationLineType,
  RegistrationStatus,
  ScopeType,
  Semester,
} from '@prisma/client';
import { PrismaService, PrismaTx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal } from '../common/auth-principal';
import { AcademicConfigService } from '../academics/academic-config.service';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import {
  ScopeConstraint,
  assertWithinScope,
  scopeConstraintFor,
  studentScopeWhere,
} from '../rbac/scope.util';
import { CourseListResult, CourseListService } from './course-list.service';
import { EligibilityService } from './eligibility.service';
import { RegistrationPolicyService } from './registration-policy.service';
import {
  STUDENT_EDITABLE_STATUSES,
  holdsSeats,
  isLevelWithinSpread,
} from './registration.constants';

/**
 * Everything a mutation needs to decide whether it is allowed and what it moves:
 * where the student sits (scope), what is already on the registration (seats,
 * units, carryovers) and who has signed (separation of duties). One include, so
 * add / drop / submit / decide / lock all reason over the same object rather than
 * each loading a slightly different subset and disagreeing at the margins.
 */
const MUTATION_INCLUDE = {
  studentRecord: {
    select: {
      id: true,
      matriculationNumber: true,
      currentLevel: true,
      facultyId: true,
      departmentId: true,
      programmeId: true,
    },
  },
  lines: {
    include: {
      courseOffering: {
        select: {
          id: true,
          courseId: true,
          capacity: true,
          seatsTaken: true,
          status: true,
          course: { select: { id: true, code: true, title: true, level: true, creditUnits: true } },
        },
      },
    },
  },
  approvals: { include: { stage: { select: { id: true, key: true, sequence: true } } } },
} satisfies Prisma.RegistrationInclude;

type MutableRegistration = Prisma.RegistrationGetPayload<{ include: typeof MUTATION_INCLUDE }>;
type MutableLine = MutableRegistration['lines'][number];

/** The subset of an approved exception the lifecycle actually consults. */
interface ApprovedException {
  id: string;
  exceptionType: RegistrationExceptionType;
  parameters: Prisma.JsonValue | null;
  reason: string;
}

/**
 * The registration lifecycle (docs/03 §9.4–§9.6).
 *
 * THE ONE INVARIANT THAT SHAPES EVERYTHING: a seat is held by an ACTIVE line on
 * a registration in PENDING_APPROVAL, APPROVED or LOCKED — and by nothing else.
 * A DRAFT holds no seats. That choice follows §9.4's "the whole registration
 * commit runs in one transaction", and it is the difference between capacity
 * meaning something and capacity being hoarded by abandoned drafts on
 * registration day. The cost is honest and small: a student may be told at
 * submission that a course filled while they were choosing, which is true, and
 * the message says which one.
 *
 * Every state transition that crosses that boundary therefore moves seats:
 *
 *   submit   DRAFT|REJECTED → PENDING_APPROVAL   claim every active line
 *   reject   PENDING_APPROVAL → REJECTED         release every active line
 *   approve  PENDING_APPROVAL → APPROVED         seats stay held
 *   lock     APPROVED → LOCKED                   seats stay held, lines freeze
 *   drop     (while held)                        release that one seat
 *   add      (while held, staff only)            claim that one seat
 *
 * The claim itself is the atomic conditional UPDATE of §9.4 — no application
 * lock, correct across any number of nodes — issued in ASCENDING OFFERING ID
 * order so two students submitting overlapping lists cannot deadlock.
 */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly eligibility: EligibilityService,
    private readonly courseList: CourseListService,
    private readonly policyService: RegistrationPolicyService,
    private readonly academicConfig: AcademicConfigService,
  ) {}

  // --- period resolution ---------------------------------------------------

  /**
   * Resolve which (session, semester) a request means.
   *
   * Both ids are optional so a student's app can ask "my registration" without
   * knowing the calendar; the current session and its current semester answer.
   * A missing current period is reported as such rather than silently defaulting
   * to the newest row — registering into the wrong semester is far worse than
   * being told the calendar is not set.
   */
  async resolvePeriod(
    sessionId?: string | null,
    semesterId?: string | null,
  ): Promise<{ session: AcademicSession; semester: Semester }> {
    if (semesterId) {
      const semester = await this.prisma.semester.findUnique({
        where: { id: semesterId },
        include: { session: true },
      });
      if (!semester) throw new NotFoundException('Semester not found');
      if (sessionId && semester.sessionId !== sessionId) {
        throw new BadRequestException(`${semester.name} does not belong to the requested session`);
      }
      const { session, ...rest } = semester;
      return { session, semester: rest };
    }

    const session = sessionId
      ? await this.prisma.academicSession.findUnique({ where: { id: sessionId } })
      : await this.prisma.academicSession.findFirst({ where: { isCurrent: true } });
    if (!session) {
      throw new NotFoundException(
        sessionId
          ? 'Academic session not found'
          : 'No academic session is marked current. Contact the registry.',
      );
    }

    const semester = await this.prisma.semester.findFirst({
      where: { sessionId: session.id, isCurrent: true },
      orderBy: { sequence: 'asc' },
    });
    if (!semester) {
      throw new NotFoundException(`No semester is marked current in ${session.name}.`);
    }
    return { session, semester };
  }

  // --- reads ---------------------------------------------------------------

  /** The shape every registration response uses, so a slip, a staff review and
   *  the student's own view are never subtly different documents. */
  private static readonly DETAIL_INCLUDE = {
    studentRecord: {
      select: {
        id: true,
        matriculationNumber: true,
        surname: true,
        firstName: true,
        otherNames: true,
        currentLevel: true,
        facultyId: true,
        departmentId: true,
        programmeId: true,
        programme: { select: { id: true, code: true, name: true } },
        department: { select: { id: true, name: true } },
      },
    },
    session: { select: { id: true, name: true } },
    semester: { select: { id: true, name: true, sequence: true } },
    curriculumVersion: { select: { id: true, name: true, status: true } },
    lines: {
      include: {
        courseOffering: {
          select: {
            id: true,
            capacity: true,
            seatsTaken: true,
            status: true,
            course: {
              select: { id: true, code: true, title: true, level: true, creditUnits: true },
            },
          },
        },
      },
      orderBy: { addedAt: 'asc' },
    },
    approvals: {
      include: { stage: { select: { id: true, key: true, name: true, sequence: true } } },
      orderBy: { decidedAt: 'asc' },
    },
    exceptions: { orderBy: { createdAt: 'desc' } },
  } satisfies Prisma.RegistrationInclude;

  private detail(id: string) {
    return this.prisma.registration.findUniqueOrThrow({
      where: { id },
      include: RegistrationService.DETAIL_INCLUDE,
    });
  }

  /**
   * Everything the registration screen needs in one round trip: the gates, the
   * available courses and the registration itself if one exists.
   *
   * Composed here rather than in the controller because the three parts must
   * describe the SAME period — resolved once — and a client that fetched them
   * separately could straddle a semester rollover.
   */
  async context(studentRecordId: string, sessionId?: string | null, semesterId?: string | null) {
    const { session, semester } = await this.resolvePeriod(sessionId, semesterId);
    const [eligibility, courses, registration] = await Promise.all([
      this.eligibility.evaluate(studentRecordId, session.id, semester.id),
      this.courseList.build(studentRecordId, session.id, semester.id),
      this.prisma.registration.findUnique({
        where: { studentRecordId_semesterId: { studentRecordId, semesterId: semester.id } },
        include: RegistrationService.DETAIL_INCLUDE,
      }),
    ]);
    return {
      session: { id: session.id, name: session.name },
      semester: { id: semester.id, name: semester.name, sequence: semester.sequence },
      eligibility,
      courses,
      registration,
    };
  }

  /**
   * Staff list, narrowed to the actor's scope. An HOD sees their department, a
   * faculty officer their faculty, a registry officer everything — enforced by
   * the same `studentScopeWhere` the student directory uses, so there is one
   * definition of "in my scope" rather than one per module.
   */
  async list(
    actor: AuthPrincipal,
    filters: {
      sessionId?: string;
      semesterId?: string;
      status?: RegistrationStatus;
      level?: number;
      departmentId?: string;
      programmeId?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const scopeWhere = studentScopeWhere(scopeConstraintFor(actor, PERMISSIONS.REGISTRATION_VIEW));
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));

    const where: Prisma.RegistrationWhereInput = {
      sessionId: filters.sessionId,
      semesterId: filters.semesterId,
      status: filters.status,
      level: filters.level,
      studentRecord: {
        ...(scopeWhere as Prisma.StudentRecordWhereInput | undefined),
        departmentId: filters.departmentId,
        programmeId: filters.programmeId,
        ...(filters.search
          ? {
              OR: [
                { matriculationNumber: { contains: filters.search, mode: 'insensitive' } },
                { surname: { contains: filters.search, mode: 'insensitive' } },
                { firstName: { contains: filters.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
    };

    const [total, rows] = await Promise.all([
      this.prisma.registration.count({ where }),
      this.prisma.registration.findMany({
        where,
        include: {
          studentRecord: {
            select: {
              id: true,
              matriculationNumber: true,
              surname: true,
              firstName: true,
              currentLevel: true,
              programme: { select: { code: true } },
            },
          },
          semester: { select: { id: true, name: true, sequence: true } },
          _count: { select: { lines: true, approvals: true } },
        },
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { items: rows, total, page, pageSize };
  }

  /** One registration, for staff. Scope-checked against the STUDENT's location,
   *  which is where authority over a registration actually comes from. */
  async findOneForStaff(id: string, actor: AuthPrincipal) {
    const registration = await this.prisma.registration.findUnique({
      where: { id },
      include: RegistrationService.DETAIL_INCLUDE,
    });
    if (!registration) throw new NotFoundException('Registration not found');
    assertWithinScope(
      scopeConstraintFor(actor, PERMISSIONS.REGISTRATION_VIEW),
      registration.studentRecord,
    );
    return registration;
  }

  /**
   * The full registration screen for a student, viewed by STAFF. Scope-checked on
   * the student record — an adviser may look into their own department, not the
   * one next door — and otherwise identical to what the student sees, which is
   * what makes a support conversation possible at all.
   */
  async contextForStaff(
    studentRecordId: string,
    actor: AuthPrincipal,
    sessionId?: string | null,
    semesterId?: string | null,
  ) {
    const student = await this.prisma.studentRecord.findUnique({
      where: { id: studentRecordId },
      select: { facultyId: true, departmentId: true, programmeId: true },
    });
    if (!student) throw new NotFoundException('Student record not found');
    assertWithinScope(scopeConstraintFor(actor, PERMISSIONS.REGISTRATION_VIEW), student);
    return this.context(studentRecordId, sessionId, semesterId);
  }

  /**
   * The caller's own student record id, or a refusal.
   *
   * Self-service authority is OWNERSHIP, not permission: the /me routes carry no
   * @RequirePermissions, so this is the check that makes them safe. A staff
   * principal has no student record and gets a clear "not for you" rather than a
   * confusing empty result.
   */
  ownRecordId(actor: AuthPrincipal): string {
    if (!actor.studentRecordId) {
      throw new ForbiddenException('This endpoint is for students. Use /registrations instead.');
    }
    return actor.studentRecordId;
  }

  /** A student's own registrations, newest semester first. */
  async listOwn(studentRecordId: string) {
    return this.prisma.registration.findMany({
      where: { studentRecordId },
      include: {
        session: { select: { id: true, name: true } },
        semester: { select: { id: true, name: true, sequence: true } },
        _count: { select: { lines: true } },
      },
      orderBy: [{ session: { startDate: 'desc' } }, { semester: { sequence: 'desc' } }],
    });
  }

  /** One of the caller's own registrations. Ownership, not scope. */
  async findOneForStudent(id: string, actor: AuthPrincipal) {
    const studentRecordId = this.ownRecordId(actor);
    const registration = await this.prisma.registration.findUnique({
      where: { id },
      include: RegistrationService.DETAIL_INCLUDE,
    });
    if (!registration || registration.studentRecordId !== studentRecordId) {
      // Deliberately the same answer for "does not exist" and "is not yours":
      // the alternative tells a stranger that a given id is a real registration.
      throw new NotFoundException('Registration not found');
    }
    return registration;
  }

  // --- draft ---------------------------------------------------------------

  /**
   * Open (or return) the student's draft for a semester.
   *
   * Eligibility is asserted only when a draft is CREATED. Returning an existing
   * one is a read, and a student who has since acquired a fee hold still needs
   * to see the registration the hold is blocking.
   *
   * `level` and `curriculumVersionId` are snapshotted here (INV-7). Both are
   * refreshed at submission, which is the authoritative moment — a student
   * promoted between opening a draft and submitting it registers at their new
   * level, not the level they happened to hold when they first clicked.
   */
  async openDraft(
    studentRecordId: string,
    actor: AuthPrincipal,
    sessionId?: string | null,
    semesterId?: string | null,
  ) {
    const { session, semester } = await this.resolvePeriod(sessionId, semesterId);

    const existing = await this.prisma.registration.findUnique({
      where: { studentRecordId_semesterId: { studentRecordId, semesterId: semester.id } },
      select: { id: true },
    });
    if (existing) return this.detail(existing.id);

    const report = await this.eligibility.assertCanRegister(
      studentRecordId,
      session.id,
      semester.id,
    );

    try {
      const created = await this.prisma.registration.create({
        data: {
          studentRecordId,
          sessionId: session.id,
          semesterId: semester.id,
          level: report.student.level,
          curriculumVersionId: report.student.curriculumVersionId,
          status: RegistrationStatus.DRAFT,
        },
      });
      await this.audit.record({
        actorId: actor.userId,
        actorLabel: actor.email,
        action: 'registration.draft.open',
        entityType: 'Registration',
        entityId: created.id,
        after: {
          matriculationNumber: report.student.matriculationNumber,
          session: session.name,
          semester: semester.name,
          level: created.level,
        },
      });
      return this.detail(created.id);
    } catch (err) {
      // Two tabs, one student: the unique (student, semester) constraint means
      // the loser of the race should get the winner's draft, not an error.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const row = await this.prisma.registration.findUniqueOrThrow({
          where: { studentRecordId_semesterId: { studentRecordId, semesterId: semester.id } },
          select: { id: true },
        });
        return this.detail(row.id);
      }
      throw err;
    }
  }

  // --- add / drop ----------------------------------------------------------

  /**
   * Add one or more offerings.
   *
   * The STUDENT path validates against the course list of §9.2 rather than
   * re-deriving the rules: the list is the contract of what may be selected, and
   * checking against anything else would let a student register a course they
   * were never shown. The STAFF path (registration.manage) may reach outside the
   * list — an adviser placing a substitute course is a real operation — but is
   * still held to the offering being open, the level spread, and prerequisites
   * unless an approved override covers them.
   *
   * Adding is idempotent: an offering already on the registration as an ACTIVE
   * line is skipped rather than rejected, so a retried request cannot fail
   * halfway through a multi-course add.
   */
  async addCourses(
    registrationId: string,
    offeringIds: string[],
    actor: AuthPrincipal,
    opts: { onBehalf?: boolean } = {},
  ) {
    const onBehalf = opts.onBehalf === true;
    const reg = await this.loadForMutation(registrationId);
    this.assertActorMayEdit(reg, actor, onBehalf);

    const wanted = [...new Set(offeringIds)];
    if (wanted.length === 0) throw new BadRequestException('No courses were supplied');

    const activeLines = reg.lines.filter((l) => l.state === 'ACTIVE');
    const alreadyActive = new Set(activeLines.map((l) => l.courseOfferingId));

    const list = await this.courseList.build(reg.studentRecordId, reg.sessionId, reg.semesterId);
    const byOffering = new Map(list.items.map((i) => [i.offeringId, i]));
    const exceptions = await this.approvedExceptions(reg.id, reg.studentRecordId, reg.sessionId);

    const toAdd: Array<{
      offeringId: string;
      creditUnits: number;
      lineType: RegistrationLineType;
      exceptionId: string | null;
      code: string;
    }> = [];

    for (const offeringId of wanted) {
      if (alreadyActive.has(offeringId)) continue;

      const item = byOffering.get(offeringId);
      if (!item) {
        toAdd.push(await this.validateOffListOffering(reg, offeringId, onBehalf, list, exceptions));
        continue;
      }
      if (!item.selectable) {
        throw new ConflictException(
          item.warnings[0] ?? `${item.code} cannot be registered at the moment.`,
        );
      }
      const override =
        item.prerequisites.satisfied === false
          ? this.findOverride(exceptions, 'PREREQUISITE_OVERRIDE', item.courseId)
          : null;
      toAdd.push({
        offeringId,
        creditUnits: item.creditUnits,
        lineType: item.lineType,
        exceptionId: override?.id ?? null,
        code: item.code,
      });
    }

    if (toAdd.length === 0) return this.detail(registrationId);

    // Cap checked on the way in, not only at submission: a student who builds a
    // 40-unit draft and is refused at the end has wasted the whole session's
    // most stressful ten minutes.
    const { maxUnits } = await this.effectiveUnitBounds(reg, exceptions);
    const projected =
      activeLines.reduce((t, l) => t + l.creditUnits, 0) +
      toAdd.reduce((t, l) => t + l.creditUnits, 0);
    if (projected > maxUnits) {
      throw new BadRequestException(
        `Adding ${toAdd.map((l) => l.code).join(', ')} would take you to ${projected} units, ` +
          `above the maximum of ${maxUnits}. Drop something first, or request a unit override.`,
      );
    }

    const holds = holdsSeats(reg.status);
    try {
      await this.prisma.$transaction(
        async (tx) => {
          // Ascending offering id — the same order submit uses, so an add on a
          // held registration cannot deadlock against a concurrent submit.
          for (const line of [...toAdd].sort((a, b) => a.offeringId.localeCompare(b.offeringId))) {
            if (holds) await this.claimSeat(tx, line.offeringId, line.code);
            await tx.registrationLine.create({
              data: {
                registrationId,
                courseOfferingId: line.offeringId,
                creditUnits: line.creditUnits,
                lineType: line.lineType,
                exceptionId: line.exceptionId,
              },
            });
          }
          const total = await this.recomputeTotals(tx, registrationId);
          await this.audit.recordTx(tx, {
            actorId: actor.userId,
            actorLabel: actor.email,
            action: onBehalf ? 'registration.line.add.on_behalf' : 'registration.line.add',
            entityType: 'Registration',
            entityId: registrationId,
            metadata: {
              matriculationNumber: reg.studentRecord.matriculationNumber,
              courses: toAdd.map((l) => l.code),
              seatsClaimed: holds,
              totalUnits: total,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (err) {
      // The partial unique index (registration, offering) WHERE state='ACTIVE'
      // is the last line of defence against a double-tap that slipped past the
      // in-memory check.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('That course is already on this registration');
      }
      throw err;
    }
    return this.detail(registrationId);
  }

  /**
   * Drop a line. The line is marked DROPPED rather than deleted — a dropped
   * course is part of the registration's history, and the partial unique index
   * exists precisely so it can sit beside a later re-add of the same offering.
   *
   * Carryovers are the interesting case. R5 requires a retake at the next
   * opportunity, so a student may not drop one. Removal is a documented
   * exception (CARRYOVER_REMOVAL), and the authority to allow it belongs to
   * whoever holds registration.exception.review — the same officer who would
   * rule on the written request. Until the exception workflow ships, that holder
   * may drop it directly, and the audit line records the override explicitly so
   * the decision is not invisible.
   */
  async dropLine(
    registrationId: string,
    lineId: string,
    actor: AuthPrincipal,
    opts: { onBehalf?: boolean; reason?: string } = {},
  ) {
    const onBehalf = opts.onBehalf === true;
    const reg = await this.loadForMutation(registrationId);
    this.assertActorMayEdit(reg, actor, onBehalf);

    const line = reg.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException('Registration line not found');
    if (line.state === 'DROPPED') return this.detail(registrationId);

    let overrideId: string | null = null;
    if (line.lineType === RegistrationLineType.CARRYOVER) {
      const approved = this.findOverride(
        await this.approvedExceptions(reg.id, reg.studentRecordId, reg.sessionId),
        'CARRYOVER_REMOVAL',
        line.courseOffering.courseId,
      );
      overrideId = approved?.id ?? null;
      if (!overrideId) {
        if (!onBehalf || !actor.permissions.includes(PERMISSIONS.REGISTRATION_EXCEPTION_REVIEW)) {
          throw new ForbiddenException(
            `${line.courseOffering.course.code} is a carryover and must be retaken. ` +
              'Removing it requires approval from the registry.',
          );
        }
      }
    }

    const holds = holdsSeats(reg.status);
    await this.prisma.$transaction(
      async (tx) => {
        await tx.registrationLine.update({
          where: { id: lineId },
          data: {
            state: 'DROPPED',
            droppedAt: new Date(),
            droppedById: actor.userId,
            exceptionId: overrideId ?? line.exceptionId,
          },
        });
        if (holds) await this.releaseSeat(tx, line.courseOfferingId);
        const total = await this.recomputeTotals(tx, registrationId);
        await this.audit.recordTx(tx, {
          actorId: actor.userId,
          actorLabel: actor.email,
          action: onBehalf ? 'registration.line.drop.on_behalf' : 'registration.line.drop',
          entityType: 'Registration',
          entityId: registrationId,
          metadata: {
            matriculationNumber: reg.studentRecord.matriculationNumber,
            course: line.courseOffering.course.code,
            lineType: line.lineType,
            seatReleased: holds,
            totalUnits: total,
            reason: opts.reason ?? null,
            carryoverOverride:
              line.lineType === RegistrationLineType.CARRYOVER
                ? (overrideId ?? 'exercised_by_exception_reviewer')
                : null,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    return this.detail(registrationId);
  }

  // --- submit --------------------------------------------------------------

  /**
   * Submit for approval: DRAFT|REJECTED → PENDING_APPROVAL. The moment every seat
   * is claimed (§9.4), and the moment everything advisory becomes enforcing.
   *
   * Three things are re-checked here even though the client already saw them,
   * because the draft may be hours old: eligibility (a hold can land in between),
   * prerequisites (a result published overnight changes the answer), and the unit
   * bounds. The alternative — trusting the course list the student was shown — is
   * how a registration ends up approved for a course its owner may not take.
   *
   * A repeat submission of an already-submitted registration is a SUCCESS, not a
   * conflict: the response was lost, the student pressed the button again, and the
   * honest answer is the registration they already have. `idempotencyKey` is
   * recorded for the same reason at the storage layer.
   */
  async submit(
    registrationId: string,
    actor: AuthPrincipal,
    opts: { idempotencyKey?: string; onBehalf?: boolean } = {},
  ) {
    const onBehalf = opts.onBehalf === true;
    const reg = await this.loadForMutation(registrationId);

    if (reg.status === RegistrationStatus.PENDING_APPROVAL) return this.detail(registrationId);
    if (!(STUDENT_EDITABLE_STATUSES as readonly string[]).includes(reg.status)) {
      throw new ConflictException(
        `This registration is ${reg.status.toLowerCase().replace(/_/g, ' ')} and cannot be submitted again.`,
      );
    }
    this.assertActorMayEdit(reg, actor, onBehalf);

    const report = await this.eligibility.assertCanRegister(
      reg.studentRecordId,
      reg.sessionId,
      reg.semesterId,
    );

    const activeLines = reg.lines.filter((l) => l.state === 'ACTIVE');
    if (activeLines.length === 0) {
      throw new BadRequestException('Add at least one course before submitting.');
    }

    const exceptions = await this.approvedExceptions(reg.id, reg.studentRecordId, reg.sessionId);
    await this.assertPrerequisitesStillHold(reg, activeLines, exceptions);

    const totalUnits = activeLines.reduce((t, l) => t + l.creditUnits, 0);
    // Fresh bounds, not the snapshot: the snapshot is what a submission WRITES,
    // and reading it back would let a stale draft carry last session's policy.
    const bounds = await this.effectiveUnitBounds(reg, exceptions, { fresh: true });
    if (totalUnits > bounds.maxUnits) {
      throw new BadRequestException(
        `You have registered ${totalUnits} units, above the maximum of ${bounds.maxUnits}. ` +
          'Drop a course, or obtain an approved unit override.',
      );
    }
    if (totalUnits < bounds.minUnits) {
      throw new BadRequestException(
        `You have registered ${totalUnits} units, below the minimum of ${bounds.minUnits}. ` +
          'Add more courses — or, if your programme leaves you fewer units than that, ' +
          'ask your department for an approved unit override.',
      );
    }

    const now = new Date();
    try {
      await this.prisma.$transaction(
        async (tx) => {
          // Re-read inside the transaction: two tabs, one student, one submit
          // each. The loser must be told, not silently allowed to claim a second
          // round of seats.
          const fresh = await tx.registration.findUniqueOrThrow({
            where: { id: registrationId },
            select: { status: true },
          });
          if (!(STUDENT_EDITABLE_STATUSES as readonly string[]).includes(fresh.status)) {
            throw new ConflictException('This registration was already submitted a moment ago.');
          }

          // A resubmission after rejection is a NEW approval cycle; last cycle's
          // signatures must not count towards it. They survive in the append-only
          // audit log, which is where a history belongs.
          await tx.registrationApproval.deleteMany({ where: { registrationId } });

          for (const line of this.inClaimOrder(activeLines)) {
            await this.claimSeat(tx, line.courseOfferingId, line.courseOffering.course.code);
          }

          await tx.registration.update({
            where: { id: registrationId },
            data: {
              status: RegistrationStatus.PENDING_APPROVAL,
              submittedAt: now,
              totalUnits,
              minUnits: bounds.minUnits,
              maxUnits: bounds.maxUnits,
              // Refreshed at the authoritative moment (INV-7/INV-8): a student
              // promoted since opening the draft registers at their new level.
              level: report.student.level,
              curriculumVersionId: report.student.curriculumVersionId,
              rejectReason: null,
              idempotencyKey: opts.idempotencyKey ?? undefined,
            },
          });

          await this.audit.recordTx(tx, {
            actorId: actor.userId,
            actorLabel: actor.email,
            action: onBehalf ? 'registration.submit.on_behalf' : 'registration.submit',
            entityType: 'Registration',
            entityId: registrationId,
            before: { status: reg.status },
            after: {
              status: RegistrationStatus.PENDING_APPROVAL,
              matriculationNumber: reg.studentRecord.matriculationNumber,
              level: report.student.level,
              totalUnits,
              minUnits: bounds.minUnits,
              maxUnits: bounds.maxUnits,
              unitOverrideId: bounds.overrideId,
              courses: activeLines.map((l) => l.courseOffering.course.code),
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (err) {
      // The unique idempotency key raced: another attempt with the same key won,
      // so return what it produced rather than reporting a failure the caller
      // cannot act on.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        opts.idempotencyKey
      ) {
        const twin = await this.prisma.registration.findUnique({
          where: { idempotencyKey: opts.idempotencyKey },
          select: { id: true },
        });
        if (twin) return this.detail(twin.id);
      }
      throw err;
    }
    return this.detail(registrationId);
  }

  // --- approval ------------------------------------------------------------

  /**
   * Record one stage's decision (§9.6).
   *
   * The chain is DATA, not code: the active REGISTRATION `ApprovalStage` rows in
   * `sequence` order. An institution that wants adviser → HOD → dean adds a row;
   * one that wants a single adviser signature deletes two. The actor must hold the
   * stage's required role AT A SCOPE THAT CONTAINS THE STUDENT — holding "HOD" in
   * another department is not authority here.
   *
   * A rejection releases every seat immediately rather than at some later sweep:
   * a rejected registration holds nothing, and the seat belongs to whoever is
   * still choosing.
   */
  async decide(
    registrationId: string,
    actor: AuthPrincipal,
    input: { decision: ApprovalDecision; comment?: string },
  ) {
    const reg = await this.loadForMutation(registrationId);
    if (reg.status !== RegistrationStatus.PENDING_APPROVAL) {
      throw new ConflictException(
        `Only a registration awaiting approval can be decided; this one is ` +
          `${reg.status.toLowerCase().replace(/_/g, ' ')}.`,
      );
    }
    if (actor.studentRecordId && actor.studentRecordId === reg.studentRecordId) {
      throw new ForbiddenException('You cannot approve your own registration');
    }
    const comment = input.comment?.trim() || null;
    if (input.decision === 'REJECTED' && !comment) {
      throw new BadRequestException(
        'A rejection must say why — the student has to know what to fix before resubmitting.',
      );
    }

    const stages = await this.prisma.approvalStage.findMany({
      where: { domain: 'REGISTRATION', isActive: true },
      orderBy: { sequence: 'asc' },
    });
    if (stages.length === 0) {
      throw new ConflictException(
        'No registration approval chain is configured, so nothing can be approved. ' +
          'Contact the registry.',
      );
    }

    const decided = new Map(reg.approvals.map((a) => [a.stageId, a]));
    const stage = stages.find((s) => decided.get(s.id)?.decision !== 'APPROVED');
    if (!stage) {
      throw new ConflictException('Every approval stage has already approved this registration.');
    }
    // docs/02 §5.4. Checked across the WHOLE cycle rather than only the previous
    // stage: someone who is both course adviser and acting HOD must hand the
    // second signature to someone else, or the chain is one person twice.
    if (reg.approvals.some((a) => a.decidedById === actor.userId)) {
      throw new ForbiddenException(
        'You have already acted on this registration at an earlier stage',
      );
    }
    await this.assertStageAuthority(stage, reg.studentRecord, actor);

    const approving = input.decision === 'APPROVED';
    const isFinal = stages[stages.length - 1].id === stage.id;
    const activeLines = reg.lines.filter((l) => l.state === 'ACTIVE');
    const now = new Date();

    try {
      await this.prisma.$transaction(
        async (tx) => {
          const fresh = await tx.registration.findUniqueOrThrow({
            where: { id: registrationId },
            select: { status: true },
          });
          if (fresh.status !== RegistrationStatus.PENDING_APPROVAL) {
            throw new ConflictException('This registration was decided a moment ago.');
          }

          await tx.registrationApproval.create({
            data: {
              registrationId,
              stageId: stage.id,
              decision: input.decision,
              comment,
              decidedById: actor.userId,
              decidedAt: now,
            },
          });

          if (!approving) {
            for (const line of this.inClaimOrder(activeLines)) {
              await this.releaseSeat(tx, line.courseOfferingId);
            }
            await tx.registration.update({
              where: { id: registrationId },
              data: {
                status: RegistrationStatus.REJECTED,
                rejectReason: comment,
                approvedAt: null,
              },
            });
          } else if (isFinal) {
            await tx.registration.update({
              where: { id: registrationId },
              data: { status: RegistrationStatus.APPROVED, approvedAt: now },
            });
          }

          await this.audit.recordTx(tx, {
            actorId: actor.userId,
            actorLabel: actor.email,
            action: approving ? 'registration.approve' : 'registration.reject',
            entityType: 'Registration',
            entityId: registrationId,
            before: { status: RegistrationStatus.PENDING_APPROVAL },
            after: {
              status: approving
                ? isFinal
                  ? RegistrationStatus.APPROVED
                  : RegistrationStatus.PENDING_APPROVAL
                : RegistrationStatus.REJECTED,
              stage: stage.key,
              sequence: stage.sequence,
              finalStage: isFinal,
              comment,
              matriculationNumber: reg.studentRecord.matriculationNumber,
              seatsReleased: approving ? 0 : activeLines.length,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (err) {
      // One decision per stage per registration (@@unique): two approvers hitting
      // the same stage at once, and the second is told so.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`${stage.key} has already been decided on this registration`);
      }
      throw err;
    }
    return this.detail(registrationId);
  }

  // --- lock ----------------------------------------------------------------

  /**
   * APPROVED → LOCKED: the point of no return (INV-9). Lines become immutable —
   * enforced by assertActorMayEdit, which refuses every mutation on a LOCKED
   * registration — and the credit units already snapshotted on each line become
   * the numbers the semester is graded against.
   *
   * Seats stay held; a locked registration is the strongest possible claim on
   * one. Slip generation and exam-eligibility creation hang off this transition
   * and belong to Phase 3, so the transition is written now and stays a single
   * point to extend.
   */
  async lock(registrationId: string, actor: AuthPrincipal) {
    const reg = await this.loadForMutation(registrationId);
    if (reg.status === RegistrationStatus.LOCKED) return this.detail(registrationId);
    if (reg.status !== RegistrationStatus.APPROVED) {
      throw new ConflictException(
        `Only an approved registration can be locked; this one is ` +
          `${reg.status.toLowerCase().replace(/_/g, ' ')}.`,
      );
    }
    assertWithinScope(scopeConstraintFor(actor, PERMISSIONS.REGISTRATION_LOCK), reg.studentRecord);

    // Four eyes on an irreversible step: whoever gave the final approval does not
    // also get to close the door on it.
    const finalApproval = [...reg.approvals].sort((a, b) => b.stage.sequence - a.stage.sequence)[0];
    if (finalApproval && finalApproval.decidedById === actor.userId) {
      throw new ForbiddenException(
        'You gave the final approval on this registration, so someone else must lock it',
      );
    }

    const now = new Date();
    await this.prisma.$transaction(
      async (tx) => {
        const fresh = await tx.registration.findUniqueOrThrow({
          where: { id: registrationId },
          select: { status: true },
        });
        if (fresh.status !== RegistrationStatus.APPROVED) {
          throw new ConflictException('This registration is no longer in an approved state.');
        }
        await tx.registration.update({
          where: { id: registrationId },
          data: { status: RegistrationStatus.LOCKED, lockedAt: now, lockedById: actor.userId },
        });
        await this.audit.recordTx(tx, {
          actorId: actor.userId,
          actorLabel: actor.email,
          action: 'registration.lock',
          entityType: 'Registration',
          entityId: registrationId,
          before: { status: RegistrationStatus.APPROVED },
          after: {
            status: RegistrationStatus.LOCKED,
            matriculationNumber: reg.studentRecord.matriculationNumber,
            totalUnits: reg.totalUnits,
            courses: reg.lines
              .filter((l) => l.state === 'ACTIVE')
              .map((l) => l.courseOffering.course.code),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    return this.detail(registrationId);
  }

  // --- authority and loading -----------------------------------------------

  private async loadForMutation(registrationId: string): Promise<MutableRegistration> {
    const reg = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: MUTATION_INCLUDE,
    });
    if (!reg) throw new NotFoundException('Registration not found');
    return reg;
  }

  /**
   * Who may change this registration, and when.
   *
   * LOCKED is refused for everyone including the registry (INV-9): undoing a lock
   * is an amendment with its own trail, not an edit. A student may only touch
   * their OWN registration and only while it is DRAFT or REJECTED — once it is
   * with an approver, a silent edit would change what is being approved. Staff go
   * through scope: authority over a registration comes from authority over the
   * student, which is the same rule the student directory uses.
   */
  private assertActorMayEdit(reg: MutableRegistration, actor: AuthPrincipal, onBehalf: boolean) {
    if (reg.status === RegistrationStatus.LOCKED) {
      throw new ForbiddenException(
        'This registration is locked. Changes now require an approved amendment from the registry.',
      );
    }
    if (reg.status === RegistrationStatus.CANCELLED) {
      throw new ConflictException('This registration has been cancelled.');
    }

    if (onBehalf) {
      assertWithinScope(
        scopeConstraintFor(actor, PERMISSIONS.REGISTRATION_MANAGE),
        reg.studentRecord,
      );
      return;
    }

    if (actor.studentRecordId !== reg.studentRecordId) {
      throw new ForbiddenException('This registration does not belong to you');
    }
    if (!(STUDENT_EDITABLE_STATUSES as readonly string[]).includes(reg.status)) {
      throw new ConflictException(
        reg.status === RegistrationStatus.PENDING_APPROVAL
          ? 'Your registration is awaiting approval. Ask your course adviser to return it if you need a change.'
          : 'Your registration has been approved and can no longer be changed by you.',
      );
    }
  }

  /**
   * Seat claims and releases are issued in ASCENDING OFFERING ID order (§9.4).
   * Two students submitting overlapping lists then take the row locks in the same
   * sequence, so neither can hold what the other needs — the cheapest possible
   * deadlock avoidance, and it needs no coordination between nodes.
   */
  private inClaimOrder(lines: MutableLine[]): MutableLine[] {
    return [...lines].sort((a, b) => a.courseOfferingId.localeCompare(b.courseOfferingId));
  }

  /**
   * Does the actor hold this stage's role at a scope containing the student?
   *
   * The stage names a ROLE, so the check is against role assignments rather than
   * the flattened permission set: "the HOD of THIS department approves", not
   * "anyone who can approve something". A stage with no required role falls back
   * to the domain permission's own scope, which is how a single-signature setup
   * works without inventing a role for it.
   */
  private async assertStageAuthority(
    stage: { key: string; requiredRoleId: string | null },
    student: { facultyId: string; departmentId: string; programmeId: string },
    actor: AuthPrincipal,
  ) {
    if (!stage.requiredRoleId) {
      assertWithinScope(scopeConstraintFor(actor, PERMISSIONS.REGISTRATION_APPROVE), student);
      return;
    }
    const assignments = await this.prisma.roleAssignment.findMany({
      where: { userId: actor.userId, roleId: stage.requiredRoleId },
      select: { scopeType: true, facultyId: true, departmentId: true, programmeId: true },
    });
    if (assignments.length === 0) {
      throw new ForbiddenException(`Only the ${stage.key} may act at this approval stage`);
    }
    assertWithinScope(this.constraintFromAssignments(assignments), student);
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

  // --- seats ---------------------------------------------------------------

  /**
   * The atomic conditional claim of §9.4, verbatim:
   *
   *   UPDATE course_offerings SET seats_taken = seats_taken + 1
   *    WHERE id = $1 AND (capacity IS NULL OR seats_taken < capacity)
   *   RETURNING seats_taken
   *
   * Zero rows returned means full. No SELECT-then-UPDATE, no advisory lock, no
   * application-level mutex — the row lock the UPDATE already takes is the whole
   * mechanism, and it is correct across any number of API nodes.
   *
   * Note that the condition is NOT optional even when `enforceCapacity` is off:
   * `chk_offering_seats` in guards.sql makes seats_taken > capacity impossible at
   * the storage layer. So the policy switch decides WHEN a full course is refused
   * — early, at selection, or here at commit — never whether capacity binds.
   */
  private async claimSeat(tx: PrismaTx, offeringId: string, code: string): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ seats_taken: number }>>`
      UPDATE course_offerings
         SET seats_taken = seats_taken + 1
       WHERE id = ${offeringId}::uuid
         AND (capacity IS NULL OR seats_taken < capacity)
      RETURNING seats_taken`;
    if (rows.length === 0) {
      throw new ConflictException(
        `${code} filled up while you were registering. Remove it and pick another course.`,
      );
    }
    return Number(rows[0].seats_taken);
  }

  /**
   * Release one seat. Guarded with `seats_taken > 0` so a double release — a
   * retried request, a hand-fixed row — cannot drive the counter negative and trip
   * `chk_offering_seats`, which would abort a transaction that is otherwise doing
   * exactly the right thing.
   */
  private async releaseSeat(tx: PrismaTx, offeringId: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE course_offerings
         SET seats_taken = seats_taken - 1
       WHERE id = ${offeringId}::uuid
         AND seats_taken > 0`;
  }

  /** Recompute the denormalized unit total from the ACTIVE lines and return it. */
  private async recomputeTotals(tx: PrismaTx, registrationId: string): Promise<number> {
    const agg = await tx.registrationLine.aggregate({
      where: { registrationId, state: 'ACTIVE' },
      _sum: { creditUnits: true },
    });
    const totalUnits = agg._sum.creditUnits ?? 0;
    await tx.registration.update({ where: { id: registrationId }, data: { totalUnits } });
    return totalUnits;
  }

  // --- exceptions and bounds ------------------------------------------------

  /**
   * The approved, unexpired exceptions that can affect this registration.
   *
   * Session-wide exceptions (registrationId null) count too: a unit override
   * granted for the year should not have to be re-granted per semester. Expiry is
   * honoured because an open-ended override is an unlocked back door — the schema
   * says so, and reading it any other way would make expiresAt decorative.
   */
  private async approvedExceptions(
    registrationId: string,
    studentRecordId: string,
    sessionId: string,
  ): Promise<ApprovedException[]> {
    const now = new Date();
    return this.prisma.registrationException.findMany({
      where: {
        studentRecordId,
        sessionId,
        status: 'APPROVED',
        OR: [{ registrationId }, { registrationId: null }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
      },
      select: { id: true, exceptionType: true, parameters: true, reason: true },
      orderBy: { decidedAt: 'desc' },
    });
  }

  /**
   * The approved exception of a given type covering a course, if any.
   *
   * `parameters.courseId` (or `courseIds`) narrows an override to specific
   * courses; an override that names none covers the registration as a whole,
   * which is the shape a blanket decision takes ("this student may exceed the cap
   * this semester"). Unit overrides carry no course at all.
   */
  private findOverride(
    exceptions: ApprovedException[],
    type: RegistrationExceptionType,
    courseId?: string | null,
  ): ApprovedException | null {
    return (
      exceptions.find((e) => {
        if (e.exceptionType !== type) return false;
        if (!courseId) return true;
        const p = (e.parameters ?? {}) as { courseId?: unknown; courseIds?: unknown };
        if (typeof p.courseId === 'string') return p.courseId === courseId;
        if (Array.isArray(p.courseIds)) return p.courseIds.includes(courseId);
        return true;
      }) ?? null
    );
  }

  /**
   * The unit bounds in force, after any approved override.
   *
   * An override may only RELAX: raise the ceiling, lower the floor. An "override"
   * that tightened a bound would be a policy change wearing a student's name, and
   * policy changes belong in `academic.credit_policy` where everyone can see them.
   * The floor is what overrides exist for in practice — the final-year student with
   * six units left to graduate cannot reach a 15-unit minimum and must not be
   * refused registration for it.
   */
  private async effectiveUnitBounds(
    reg: MutableRegistration,
    exceptions: ApprovedException[],
    opts: { fresh?: boolean } = {},
  ): Promise<{ minUnits: number; maxUnits: number; overrideId: string | null }> {
    let minUnits: number;
    let maxUnits: number;
    if (!opts.fresh && reg.minUnits !== null && reg.maxUnits !== null) {
      minUnits = reg.minUnits;
      maxUnits = reg.maxUnits;
    } else {
      const policy = await this.academicConfig.getCreditPolicy();
      minUnits = policy.minUnits;
      maxUnits = policy.maxUnits;
    }

    const override = this.findOverride(exceptions, 'UNIT_OVERRIDE');
    if (override) {
      const p = (override.parameters ?? {}) as { minUnits?: unknown; maxUnits?: unknown };
      if (typeof p.maxUnits === 'number' && Number.isInteger(p.maxUnits) && p.maxUnits > maxUnits) {
        maxUnits = p.maxUnits;
      }
      if (
        typeof p.minUnits === 'number' &&
        Number.isInteger(p.minUnits) &&
        p.minUnits >= 0 &&
        p.minUnits < minUnits
      ) {
        minUnits = p.minUnits;
      }
    }
    return { minUnits, maxUnits, overrideId: override?.id ?? null };
  }

  // --- off-list adds and re-validation ---------------------------------------

  /**
   * The staff-only path for an offering the §9.2 list did not include.
   *
   * This exists because real registration includes cases the curriculum does not
   * describe: a substitute for a course not running this session, an elective from
   * another department, a course a transfer student needs out of sequence. A
   * STUDENT gets no such path — they are told why the course is not on their list,
   * using the list's own exclusion message, so the answer is specific rather than
   * "not allowed".
   *
   * Staff are still held to the checks that protect the record itself: the
   * offering must be OPEN in this exact session and semester, the course active,
   * the level within the configured spread, and prerequisites satisfied unless an
   * approved override covers them or policy only warns.
   */
  private async validateOffListOffering(
    reg: MutableRegistration,
    offeringId: string,
    onBehalf: boolean,
    list: CourseListResult,
    exceptions: ApprovedException[],
  ): Promise<{
    offeringId: string;
    creditUnits: number;
    lineType: RegistrationLineType;
    exceptionId: string | null;
    code: string;
  }> {
    const offering = await this.prisma.courseOffering.findUnique({
      where: { id: offeringId },
      select: {
        id: true,
        sessionId: true,
        semesterId: true,
        status: true,
        course: {
          select: { id: true, code: true, level: true, creditUnits: true, isActive: true },
        },
      },
    });
    if (!offering) throw new NotFoundException('Course offering not found');
    const excluded = list.excluded.find((e) => e.courseId === offering.course.id);

    if (!onBehalf) {
      throw new ConflictException(
        excluded
          ? excluded.message
          : `${offering.course.code} is not on your available course list for this semester. ` +
              'Ask your course adviser if you believe it should be.',
      );
    }

    if (offering.sessionId !== reg.sessionId || offering.semesterId !== reg.semesterId) {
      throw new BadRequestException(
        `${offering.course.code} is offered in a different session or semester`,
      );
    }
    if (offering.status !== 'OPEN') {
      throw new ConflictException(
        `${offering.course.code} is not open for registration (offering is ${offering.status.toLowerCase()})`,
      );
    }
    if (!offering.course.isActive) {
      throw new ConflictException(`${offering.course.code} has been retired from the catalogue`);
    }
    if (!isLevelWithinSpread(reg.level, offering.course.level, list.policy.levelSpread)) {
      throw new BadRequestException(
        `${offering.course.code} is ${offering.course.level} level, more than ` +
          `${list.policy.levelSpread} level(s) above a ${reg.level} level student. ` +
          'A wider reach needs the level spread raised in registration policy.',
      );
    }

    const override = this.findOverride(exceptions, 'PREREQUISITE_OVERRIDE', offering.course.id);
    if (!override && list.policy.prerequisiteEnforcement === 'BLOCK') {
      const verdict = await this.courseList.prerequisiteStatus(
        reg.studentRecordId,
        offering.course.id,
      );
      if (!verdict.satisfied) {
        throw new ConflictException(
          `${offering.course.code} has unmet prerequisites: ` +
            `${verdict.unmet.map((u) => `${u.code} — ${u.message}`).join('; ')}`,
        );
      }
    }

    return {
      offeringId,
      creditUnits: offering.course.creditUnits,
      // A course already passed is a REPEAT; anything else added off-list is NEW.
      // A carryover would have appeared on the list, so it cannot arrive here.
      lineType:
        excluded?.reason === 'ALREADY_PASSED'
          ? RegistrationLineType.REPEAT
          : RegistrationLineType.NEW,
      exceptionId: override?.id ?? null,
      code: offering.course.code,
    };
  }

  /**
   * Re-check prerequisites at submission. The list a student saw may be hours old,
   * and a result published in between can turn a satisfied prerequisite into an
   * unmet one — better to say so now than to have an approver discover it, or
   * worse, not discover it.
   *
   * Lines already carrying an exception are skipped: that is what the exception
   * bought. Runs only under BLOCK enforcement; under WARN the approval chain is
   * the one meant to judge.
   */
  private async assertPrerequisitesStillHold(
    reg: MutableRegistration,
    activeLines: MutableLine[],
    exceptions: ApprovedException[],
  ): Promise<void> {
    const policy = await this.policyService.get();
    if (policy.prerequisiteEnforcement !== 'BLOCK') return;

    const failures: string[] = [];
    for (const line of activeLines) {
      if (line.exceptionId) continue;
      if (this.findOverride(exceptions, 'PREREQUISITE_OVERRIDE', line.courseOffering.courseId)) {
        continue;
      }
      const verdict = await this.courseList.prerequisiteStatus(
        reg.studentRecordId,
        line.courseOffering.courseId,
      );
      if (!verdict.satisfied) {
        failures.push(
          `${line.courseOffering.course.code} (needs ${verdict.unmet.map((u) => u.code).join(', ')})`,
        );
      }
    }
    if (failures.length > 0) {
      throw new ConflictException(
        `Prerequisites are no longer satisfied for ${failures.join('; ')}. ` +
          'Remove the course, or ask your department for a prerequisite override.',
      );
    }
  }
}
