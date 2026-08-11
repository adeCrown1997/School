import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RegistrationLineType, RequirementType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  EXCLUSION_REASONS,
  ExclusionReason,
  FAILING_GRADES,
  OUTSTANDING_MARKS,
  RegistrationPolicy,
  UNDECIDED_MARKS,
} from './registration.constants';
import { RegistrationPolicyService } from './registration-policy.service';

/**
 * Course-list construction (docs/03 §9.2):
 *
 *   Available = curriculum requirements for (curriculum_version, level, semester)
 *             + CARRYOVERS  (failed, not yet passed — auto-included)
 *             + eligible electives per curriculum rules
 *             − courses already passed
 *             − courses whose prerequisites are unsatisfied
 *
 * Two things shape the whole file.
 *
 * FIRST, the list is built against OFFERINGS, not courses. A curriculum
 * requirement is an intention; an offering is the thing a student can actually
 * sit in. A requirement with no open offering this semester is therefore not
 * silently dropped — it is reported in `excluded` with NO_OFFERING, because that
 * is an administrative omission the department can fix, and a student staring at
 * a short list has no other way to discover it.
 *
 * SECOND, exclusions are returned rather than filtered away. "Why is MTH 201 not
 * on my list" is the single most common registration support question, and the
 * answer is always in the data — passed, not offered, prerequisite unmet. Saying
 * so costs one array and removes the conversation.
 */
export interface UnmetPrerequisite {
  courseId: string;
  code: string;
  title: string;
  /** The grade the prerequisite demands, when it demands more than a bare pass. */
  minGrade: string | null;
  status: 'NOT_TAKEN' | 'NOT_PASSED' | 'GRADE_TOO_LOW' | 'RESULT_PENDING';
  message: string;
}

export interface CourseListItem {
  offeringId: string;
  courseId: string;
  code: string;
  title: string;
  courseLevel: number;
  /** Effective units: the curriculum's override if it set one, else the course's. */
  creditUnits: number;
  categoryKey: string | null;
  departmentId: string | null;
  /** What this line would be if registered — drives Q-02 repeat handling later. */
  lineType: RegistrationLineType;
  /** Null for a carryover from another level: it is outstanding, not part of
   *  THIS semester's requirement set. */
  requirementType: RequirementType | null;
  electiveGroup: string | null;
  /** Carryovers arrive ticked (R5). */
  preSelected: boolean;
  /** False for carryovers: R5 requires a retake at the next opportunity, and
   *  removal needs an adviser-approved CARRYOVER_REMOVAL exception. */
  removable: boolean;
  alreadyRegistered: boolean;
  attempts: number;
  lastGrade: string | null;
  prerequisites: {
    satisfied: boolean;
    unmet: UnmetPrerequisite[];
    enforcement: RegistrationPolicy['prerequisiteEnforcement'];
  };
  capacity: {
    capacity: number | null;
    seatsTaken: number;
    /** Null when uncapped — distinct from 0, which means full. */
    seatsAvailable: number | null;
    isFull: boolean;
  };
  /** False when the policy BLOCKS this item outright (unmet prerequisite, or a
   *  full offering where capacity is enforced). */
  selectable: boolean;
  warnings: string[];
}

export interface ExcludedCourse {
  courseId: string;
  code: string;
  title: string;
  reason: ExclusionReason;
  message: string;
}

export interface CourseListResult {
  level: number;
  semesterSequence: number;
  curriculumVersion: { id: string; name: string; status: string } | null;
  items: CourseListItem[];
  excluded: ExcludedCourse[];
  electiveGroups: Array<{ group: string; offered: number }>;
  totals: {
    preSelectedUnits: number;
    selectableUnits: number;
    carryoverCount: number;
    carryoverUnits: number;
  };
  policy: RegistrationPolicy;
  /** Conditions that are nobody's fault but change what the list means. */
  warnings: string[];
}

/** How a past attempt at a course resolved. */
type Outcome = 'PASSED' | 'OUTSTANDING' | 'UNDECIDED';

interface CourseHistory {
  attempts: number;
  outcome: Outcome;
  lastGrade: string | null;
  bestGradePoint: Prisma.Decimal | null;
}

@Injectable()
export class CourseListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: RegistrationPolicyService,
  ) {}

  /**
   * Build the list for one student in one semester.
   *
   * Deliberately does NOT check eligibility. A student who is barred by a fee
   * hold still needs to see what they would be registering — the list is what
   * makes the refusal concrete, and hiding it produces "I cannot see my courses"
   * on top of the hold. EligibilityService guards the commit; this is a read.
   */
  async build(
    studentRecordId: string,
    sessionId: string,
    semesterId: string,
  ): Promise<CourseListResult> {
    const [student, semester, policy] = await Promise.all([
      this.prisma.studentRecord.findUnique({
        where: { id: studentRecordId },
        select: {
          id: true,
          currentLevel: true,
          curriculumVersionId: true,
          curriculumVersion: { select: { id: true, name: true, status: true } },
        },
      }),
      this.prisma.semester.findUnique({
        where: { id: semesterId },
        select: { id: true, sequence: true, name: true, sessionId: true },
      }),
      this.policyService.get(),
    ]);
    if (!student) throw new NotFoundException('Student record not found');
    if (!semester) throw new NotFoundException('Semester not found');
    if (semester.sessionId !== sessionId) {
      // Not a not-found: both rows exist, they just do not belong together, and
      // the requirement lookup keys on the semester's SEQUENCE while offerings
      // key on the session — mismatched, they would silently return a plausible
      // but wrong list.
      throw new NotFoundException(`${semester.name} does not belong to the requested session`);
    }

    const warnings: string[] = [];
    if (!student.curriculumVersionId) {
      warnings.push(
        'No curriculum version is pinned to your record, so this list contains only outstanding ' +
          'courses. Contact your department to have your curriculum assigned.',
      );
    } else if (student.curriculumVersion?.status !== 'PUBLISHED') {
      warnings.push(
        `Your curriculum (${student.curriculumVersion?.name}) is ${student.curriculumVersion?.status?.toLowerCase()}, ` +
          'not published. The list may change once it is approved.',
      );
    }

    // --- the two sources of candidates ------------------------------------
    const requirements = student.curriculumVersionId
      ? await this.prisma.curriculumRequirement.findMany({
          where: {
            curriculumVersionId: student.curriculumVersionId,
            level: student.currentLevel,
            semesterSequence: semester.sequence,
          },
          select: {
            courseId: true,
            requirementType: true,
            creditUnits: true,
            electiveGroup: true,
          },
        })
      : [];

    if (student.curriculumVersionId && requirements.length === 0) {
      warnings.push(
        `Your curriculum defines no courses for ${student.currentLevel} level, ${semester.name}. ` +
          'Only outstanding courses are listed.',
      );
    }

    const history = await this.loadHistory(studentRecordId);
    const gradePoints = await this.loadGradePointsByLetter();

    // A carryover is any course previously taken and not yet passed. Drawn from
    // the WHOLE history rather than from this semester's requirement set — the
    // failure was two levels ago, which is precisely why it is a carryover.
    const carryoverIds = [...history.entries()]
      .filter(([, h]) => h.outcome === 'OUTSTANDING')
      .map(([courseId]) => courseId);

    const requirementByCourse = new Map(requirements.map((r) => [r.courseId, r]));
    const candidateIds = [...new Set([...requirementByCourse.keys(), ...carryoverIds])];
    if (candidateIds.length === 0) {
      return this.emptyResult(student.currentLevel, semester.sequence, student, policy, warnings);
    }

    // --- resolve the candidates into offerings ----------------------------
    const [courses, offerings, existingLines] = await Promise.all([
      this.prisma.course.findMany({
        where: { id: { in: candidateIds } },
        select: {
          id: true,
          code: true,
          title: true,
          creditUnits: true,
          level: true,
          isActive: true,
          departmentId: true,
          category: { select: { key: true } },
          prerequisites: {
            select: {
              minGrade: true,
              prerequisiteCourse: { select: { id: true, code: true, title: true } },
            },
          },
        },
      }),
      // Only OPEN offerings. DRAFT is not yet published to students and CLOSED
      // has stopped taking registrations; either would put a course on the list
      // that the commit would then refuse.
      this.prisma.courseOffering.findMany({
        where: { sessionId, semesterId, status: 'OPEN', courseId: { in: candidateIds } },
        select: { id: true, courseId: true, capacity: true, seatsTaken: true },
      }),
      // What the student already has, so the client can render the list with the
      // current selection intact rather than as a fresh sheet.
      this.prisma.registrationLine.findMany({
        where: {
          state: 'ACTIVE',
          registration: { studentRecordId, semesterId },
        },
        select: { courseOfferingId: true },
      }),
    ]);

    const courseById = new Map(courses.map((c) => [c.id, c]));
    const offeringByCourse = new Map(offerings.map((o) => [o.courseId, o]));
    const registeredOfferings = new Set(existingLines.map((l) => l.courseOfferingId));

    const items: CourseListItem[] = [];
    const excluded: ExcludedCourse[] = [];

    for (const courseId of candidateIds) {
      const course = courseById.get(courseId);
      if (!course) continue; // referenced course deleted — nothing to say about it

      const past = history.get(courseId);
      const isCarryover = past?.outcome === 'OUTSTANDING';
      const requirement = requirementByCourse.get(courseId);

      // Subtractions first, in the order that gives the most useful message.
      if (past?.outcome === 'PASSED' && !policy.allowRepeatForUpgrade) {
        excluded.push({
          courseId,
          code: course.code,
          title: course.title,
          reason: EXCLUSION_REASONS.ALREADY_PASSED,
          message: `You passed ${course.code}${past.lastGrade ? ` with a ${past.lastGrade}` : ''}.`,
        });
        continue;
      }
      if (past?.outcome === 'UNDECIDED') {
        excluded.push({
          courseId,
          code: course.code,
          title: course.title,
          reason: EXCLUSION_REASONS.RESULT_PENDING,
          message:
            `Your ${course.code} result is not yet released, so it cannot be treated as passed ` +
            'or as a carryover. It will appear once the result is published.',
        });
        continue;
      }
      if (!course.isActive) {
        excluded.push({
          courseId,
          code: course.code,
          title: course.title,
          reason: EXCLUSION_REASONS.COURSE_INACTIVE,
          message: `${course.code} has been withdrawn from the catalogue. Your department must advise on a replacement.`,
        });
        continue;
      }

      const offering = offeringByCourse.get(courseId);
      if (!offering) {
        excluded.push({
          courseId,
          code: course.code,
          title: course.title,
          reason: EXCLUSION_REASONS.NO_OFFERING,
          message: isCarryover
            ? `${course.code} is a carryover but is not being offered in ${semester.name}. ` +
              'You will retake it at the next opportunity.'
            : `${course.code} has no open offering in ${semester.name}. Contact your department.`,
        });
        continue;
      }

      const unmet = this.unmetPrerequisites(course.prerequisites, history, gradePoints);
      const prereqBlocks = unmet.length > 0 && policy.prerequisiteEnforcement === 'BLOCK';
      if (prereqBlocks) {
        excluded.push({
          courseId,
          code: course.code,
          title: course.title,
          reason: EXCLUSION_REASONS.PREREQUISITE_UNMET,
          message:
            `${course.code} requires ${unmet.map((u) => u.code).join(', ')}. ` +
            `${unmet[0].message} An override needs departmental approval.`,
        });
        continue;
      }

      const seatsAvailable =
        offering.capacity === null ? null : Math.max(0, offering.capacity - offering.seatsTaken);
      const isFull = seatsAvailable === 0;
      const capacityBlocks = isFull && policy.enforceCapacity;

      const itemWarnings: string[] = [];
      if (unmet.length > 0) {
        itemWarnings.push(
          `Prerequisite not satisfied: ${unmet.map((u) => u.code).join(', ')}. ` +
            'Your adviser will see this when reviewing your registration.',
        );
      }
      if (isFull) {
        itemWarnings.push(
          policy.enforceCapacity
            ? `${course.code} is full (${offering.seatsTaken}/${offering.capacity}).`
            : `${course.code} is over its nominal capacity (${offering.seatsTaken}/${offering.capacity}).`,
        );
      }
      if (past?.outcome === 'PASSED') {
        itemWarnings.push(
          `You already passed ${course.code}${past.lastGrade ? ` with a ${past.lastGrade}` : ''}. ` +
            'Retaking it will be recorded as a repeat.',
        );
      }

      items.push({
        offeringId: offering.id,
        courseId,
        code: course.code,
        title: course.title,
        courseLevel: course.level,
        creditUnits: requirement?.creditUnits ?? course.creditUnits,
        categoryKey: course.category?.key ?? null,
        departmentId: course.departmentId,
        lineType: this.lineTypeFor(past?.outcome, requirement?.requirementType),
        requirementType: requirement?.requirementType ?? null,
        electiveGroup: requirement?.electiveGroup ?? null,
        preSelected: isCarryover || requirement?.requirementType === RequirementType.COMPULSORY,
        removable: !isCarryover,
        alreadyRegistered: registeredOfferings.has(offering.id),
        attempts: past?.attempts ?? 0,
        lastGrade: past?.lastGrade ?? null,
        prerequisites: {
          satisfied: unmet.length === 0,
          unmet,
          enforcement: policy.prerequisiteEnforcement,
        },
        capacity: {
          capacity: offering.capacity,
          seatsTaken: offering.seatsTaken,
          seatsAvailable,
          isFull,
        },
        selectable: !capacityBlocks,
        warnings: itemWarnings,
      });
    }

    // Carryovers first — R5 makes them the priority and the student should not
    // have to hunt for them — then compulsory, then by code so the order is
    // stable between reloads.
    const rank = (i: CourseListItem) =>
      i.lineType === RegistrationLineType.CARRYOVER
        ? 0
        : i.requirementType === RequirementType.COMPULSORY
          ? 1
          : 2;
    items.sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code));
    excluded.sort((a, b) => a.code.localeCompare(b.code));

    const groups = new Map<string, number>();
    for (const i of items) {
      if (i.electiveGroup) groups.set(i.electiveGroup, (groups.get(i.electiveGroup) ?? 0) + 1);
    }

    const carryovers = items.filter((i) => i.lineType === RegistrationLineType.CARRYOVER);
    return {
      level: student.currentLevel,
      semesterSequence: semester.sequence,
      curriculumVersion: student.curriculumVersion ?? null,
      items,
      excluded,
      electiveGroups: [...groups.entries()]
        .map(([group, offered]) => ({ group, offered }))
        .sort((a, b) => a.group.localeCompare(b.group)),
      totals: {
        preSelectedUnits: this.sumUnits(items.filter((i) => i.preSelected && i.selectable)),
        selectableUnits: this.sumUnits(items.filter((i) => i.selectable)),
        carryoverCount: carryovers.length,
        carryoverUnits: this.sumUnits(carryovers),
      },
      policy,
      warnings,
    };
  }

  // --- history -------------------------------------------------------------

  /**
   * Collapse the grade history into one verdict per course.
   *
   * Only CURRENT records count (`supersededById: null`) — INV-12 keeps the
   * earlier version of an amended result on the transcript, and reading both
   * would double-count the attempt. Only PUBLISHED records decide, for two
   * reasons: an unpublished record is not a result the student may act on, and
   * listing a course as a carryover before results are released would leak the
   * mark through the back door.
   */
  private async loadHistory(studentRecordId: string): Promise<Map<string, CourseHistory>> {
    const records = await this.prisma.gradeRecord.findMany({
      where: { studentRecordId, supersededById: null },
      select: {
        courseId: true,
        grade: true,
        gradePoint: true,
        mark: true,
        publishedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const history = new Map<string, CourseHistory>();
    for (const r of records) {
      const prior = history.get(r.courseId);
      history.set(r.courseId, {
        attempts: (prior?.attempts ?? 0) + 1,
        // A pass is permanent: once any attempt passed, the course is passed
        // whatever a later attempt did. OUTSTANDING beats UNDECIDED because a
        // known failure is actionable and a withheld result is not.
        outcome: this.strongerOutcome(prior?.outcome, this.outcomeOf(r)),
        lastGrade: r.grade ?? prior?.lastGrade ?? null,
        bestGradePoint: this.maxDecimal(prior?.bestGradePoint ?? null, r.gradePoint),
      });
    }
    return history;
  }

  private outcomeOf(r: {
    grade: string | null;
    gradePoint: Prisma.Decimal | null;
    mark: string;
    publishedAt: Date | null;
  }): Outcome {
    if (!r.publishedAt) return 'UNDECIDED';
    if ((UNDECIDED_MARKS as readonly string[]).includes(r.mark)) return 'UNDECIDED';
    if ((OUTSTANDING_MARKS as readonly string[]).includes(r.mark)) return 'OUTSTANDING';
    // A zero grade point is a fail on any scale, which is why the test is
    // arithmetic rather than a letter comparison; FAILING_GRADES is only the
    // fallback for a record written without a point.
    if (r.gradePoint !== null) return r.gradePoint.greaterThan(0) ? 'PASSED' : 'OUTSTANDING';
    if (r.grade) {
      return (FAILING_GRADES as readonly string[]).includes(r.grade.toUpperCase())
        ? 'OUTSTANDING'
        : 'PASSED';
    }
    return 'UNDECIDED';
  }

  private strongerOutcome(prior: Outcome | undefined, next: Outcome): Outcome {
    const order: Record<Outcome, number> = { PASSED: 3, OUTSTANDING: 2, UNDECIDED: 1 };
    if (!prior) return next;
    return order[next] > order[prior] ? next : prior;
  }

  // --- prerequisites -------------------------------------------------------

  /**
   * Prerequisite verdict for ONE course, for the paths that do not go through
   * the list: a staff member adding an off-list course on a student's behalf,
   * and re-validation at submission (the list a student saw may be minutes old,
   * and a result published in between changes the answer).
   */
  async prerequisiteStatus(
    studentRecordId: string,
    courseId: string,
  ): Promise<{ satisfied: boolean; unmet: UnmetPrerequisite[] }> {
    const [course, history, gradePoints] = await Promise.all([
      this.prisma.course.findUnique({
        where: { id: courseId },
        select: {
          prerequisites: {
            select: {
              minGrade: true,
              prerequisiteCourse: { select: { id: true, code: true, title: true } },
            },
          },
        },
      }),
      this.loadHistory(studentRecordId),
      this.loadGradePointsByLetter(),
    ]);
    if (!course) throw new NotFoundException('Course not found');

    const unmet = this.unmetPrerequisites(course.prerequisites, history, gradePoints);
    return { satisfied: unmet.length === 0, unmet };
  }

  /**
   * Which of a course's prerequisites are not satisfied, and why.
   *
   * `minGrade` is compared on GRADE POINTS, not letters: 'B' > 'C' only because
   * of where they sit on a scale, and an institution on a 4-point scale uses the
   * same letters for different points. Where the demanded letter is not in the
   * default scale — a legacy grade, or a scale replaced since — the requirement
   * degrades to "must have passed", which is the weaker but never wrong reading.
   */
  private unmetPrerequisites(
    prerequisites: Array<{
      minGrade: string | null;
      prerequisiteCourse: { id: string; code: string; title: string };
    }>,
    history: Map<string, CourseHistory>,
    gradePoints: Map<string, Prisma.Decimal>,
  ): UnmetPrerequisite[] {
    const unmet: UnmetPrerequisite[] = [];

    for (const p of prerequisites) {
      const c = p.prerequisiteCourse;
      const past = history.get(c.id);
      const base = { courseId: c.id, code: c.code, title: c.title, minGrade: p.minGrade };

      if (!past) {
        unmet.push({
          ...base,
          status: 'NOT_TAKEN',
          message: `You have not taken ${c.code} (${c.title}).`,
        });
        continue;
      }
      if (past.outcome === 'UNDECIDED') {
        unmet.push({
          ...base,
          status: 'RESULT_PENDING',
          message: `Your ${c.code} result has not been released yet.`,
        });
        continue;
      }
      if (past.outcome === 'OUTSTANDING') {
        unmet.push({
          ...base,
          status: 'NOT_PASSED',
          message: `You have not passed ${c.code}.`,
        });
        continue;
      }

      if (p.minGrade) {
        const required = gradePoints.get(p.minGrade.trim().toUpperCase());
        if (required && past.bestGradePoint && past.bestGradePoint.lessThan(required)) {
          unmet.push({
            ...base,
            status: 'GRADE_TOO_LOW',
            message:
              `${c.code} must be passed at ${p.minGrade} or better; ` +
              `your best grade is ${past.lastGrade ?? 'below that'}.`,
          });
        }
      }
    }
    return unmet;
  }

  /**
   * Letter → grade point, from the DEFAULT scale. The default is the right
   * source here because a prerequisite's `minGrade` is written by a curriculum
   * author in today's terms, not in the terms of whatever scale graded the
   * student years ago. Falls back to the highest point any active scale gives
   * the letter, so a system with no default still answers.
   */
  private async loadGradePointsByLetter(): Promise<Map<string, Prisma.Decimal>> {
    const bands = await this.prisma.gradeBand.findMany({
      where: { scale: { isActive: true } },
      select: { grade: true, gradePoint: true, scale: { select: { isDefault: true } } },
    });

    const fromDefault = new Map<string, Prisma.Decimal>();
    const fromAny = new Map<string, Prisma.Decimal>();
    for (const b of bands) {
      const key = b.grade.toUpperCase();
      if (b.scale.isDefault) fromDefault.set(key, b.gradePoint);
      fromAny.set(key, this.maxDecimal(fromAny.get(key) ?? null, b.gradePoint) ?? b.gradePoint);
    }
    return fromDefault.size > 0 ? fromDefault : fromAny;
  }

  // --- small helpers -------------------------------------------------------

  private lineTypeFor(
    outcome: Outcome | undefined,
    requirementType: RequirementType | undefined,
  ): RegistrationLineType {
    if (outcome === 'OUTSTANDING') return RegistrationLineType.CARRYOVER;
    // Registering a course already passed is only reachable when the policy
    // permits repeat-for-upgrade, and it is a REPEAT rather than a carryover:
    // Q-02 turns on that distinction when the CGPA is computed.
    if (outcome === 'PASSED') return RegistrationLineType.REPEAT;
    if (requirementType === RequirementType.ELECTIVE) return RegistrationLineType.ELECTIVE;
    return RegistrationLineType.NEW;
  }

  private sumUnits(items: CourseListItem[]): number {
    return items.reduce((total, i) => total + i.creditUnits, 0);
  }

  private maxDecimal(a: Prisma.Decimal | null, b: Prisma.Decimal | null): Prisma.Decimal | null {
    if (!a) return b;
    if (!b) return a;
    return a.greaterThan(b) ? a : b;
  }

  private emptyResult(
    level: number,
    semesterSequence: number,
    student: { curriculumVersion: { id: string; name: string; status: string } | null },
    policy: RegistrationPolicy,
    warnings: string[],
  ): CourseListResult {
    return {
      level,
      semesterSequence,
      curriculumVersion: student.curriculumVersion,
      items: [],
      excluded: [],
      electiveGroups: [],
      totals: { preSelectedUnits: 0, selectableUnits: 0, carryoverCount: 0, carryoverUnits: 0 },
      policy,
      warnings,
    };
  }
}
