/**
 * Registration constants and pure helpers.
 *
 * Decorator-free and dependency-free on purpose: the Prisma seed runs under
 * `ts-node/register/transpile-only` without reflect-metadata, so anything it
 * shares with the `@Injectable()` services has to live in a plain module. The
 * gate reason codes also belong to the API contract — the web client switches on
 * them — so they need one definition, not one per call site.
 */

/**
 * Student statuses that permit registration (docs/03 §9.1 GATE 1).
 *
 * An allowlist, not a denylist. A status added later — INTERMISSION,
 * RUSTICATED — must default to "cannot register" until someone decides
 * otherwise; a denylist would silently let it through. PROBATION is included
 * ahead of the progression module that creates it: a student on probation is
 * still studying, and barring them from registering is what makes probation
 * indistinguishable from suspension.
 */
export const REGISTRABLE_STATUS_KEYS = ['ACTIVE', 'PROBATION'] as const;

/**
 * Machine-readable gate identifiers, ordered as §9.1 evaluates them. The client
 * renders per-gate guidance from these, so they are part of the API contract and
 * must not be renamed casually.
 */
export const ELIGIBILITY_GATES = {
  ACCOUNT: 'ACCOUNT',
  WINDOW: 'WINDOW',
  FEE_CLEARANCE: 'FEE_CLEARANCE',
  HOLDS: 'HOLDS',
  DURATION: 'DURATION',
} as const;

export type EligibilityGateKey = (typeof ELIGIBILITY_GATES)[keyof typeof ELIGIBILITY_GATES];

/**
 * A registration is editable by the student only in these states. APPROVED is
 * excluded: once the chain has signed off, a silent edit would invalidate the
 * approval it already carries.
 */
export const STUDENT_EDITABLE_STATUSES = ['DRAFT', 'REJECTED'] as const;

/**
 * Statuses in which an ACTIVE line HOLDS A SEAT.
 *
 * The single definition of that boundary. A DRAFT deliberately holds nothing —
 * see the header of registration.service.ts — so every transition across this
 * set must claim or release, and a reader can check the rule in one place
 * instead of inferring it from six call sites.
 */
export const SEAT_HOLDING_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'LOCKED'] as const;

/** True when a registration in this status is holding seats for its lines. */
export function holdsSeats(status: string): boolean {
  return (SEAT_HOLDING_STATUSES as readonly string[]).includes(status);
}

/**
 * Grade letters that do NOT clear a course, used to find carryovers.
 *
 * Derived from the grade scale at runtime wherever possible — a band whose
 * gradePoint is zero is a fail on any scale, which is the check the code
 * actually applies. This list is the fallback for records written before a scale
 * was pinned, and matches the seeded 5-point scale.
 */
export const FAILING_GRADES = ['F'] as const;

/**
 * Default unit bounds if the credit policy has not been configured. Mirrors
 * DEFAULT_CREDIT_POLICY in academic-config.constants; kept as a named import
 * there rather than duplicated, so this file only documents where it comes from.
 */
export const UNIT_POLICY_SOURCE = 'academic.credit_policy' as const;

/**
 * SystemConfig key holding the registration policy — the open questions docs/03
 * §9.2/§9.3 explicitly leaves to the institution.
 *
 * Kept separate from `academic.credit_policy` because the two have different
 * owners in practice: unit bounds are a senate/NUC matter that rarely moves,
 * while these are operational switches a registrar may flip between sessions.
 */
export const REGISTRATION_POLICY_KEY = 'registration.policy' as const;

export interface RegistrationPolicy {
  /** Q-11. BLOCK refuses a course with unmet prerequisites; WARN lists it with
   *  the warning attached and lets the approval chain judge. */
  prerequisiteEnforcement: 'BLOCK' | 'WARN';
  /** Q-11. How many levels ABOVE their own a student may reach (see
   *  isLevelWithinSpread). Reaching down is always allowed. */
  levelSpread: number;
  /** Q-02. Whether a passed course may be retaken to improve the grade. Off by
   *  default: most Nigerian regulations only permit a retake of a failure, and
   *  allowing it silently would change what a CGPA means. */
  allowRepeatForUpgrade: boolean;
  /** Q-13. Whether a full offering refuses the line or merely warns. Capacity is
   *  only meaningful where the institution actually caps courses. */
  enforceCapacity: boolean;
  /** Q-13. Timetable clashes: block the submission or flag it for the adviser. */
  timetableClash: 'BLOCK' | 'WARN';
}

/**
 * Defaults chosen to be the STRICTER reading wherever the sources disagree, so
 * that an institution which never configures anything still gets the rules its
 * regulations most likely already contain — and a deliberate relaxation is a
 * recorded configuration change rather than a forgotten default. Timetable
 * clash is the exception: the exam/timetable module is Phase 3, so there is no
 * slot data to block on yet.
 */
export const DEFAULT_REGISTRATION_POLICY: RegistrationPolicy = {
  prerequisiteEnforcement: 'BLOCK',
  levelSpread: 1,
  allowRepeatForUpgrade: false,
  enforceCapacity: true,
  timetableClash: 'WARN',
};

/**
 * Why a course the student might have expected is not on their list. Machine
 * codes because the client groups by them; the accompanying message carries the
 * specifics.
 */
export const EXCLUSION_REASONS = {
  ALREADY_PASSED: 'ALREADY_PASSED',
  NO_OFFERING: 'NO_OFFERING',
  PREREQUISITE_UNMET: 'PREREQUISITE_UNMET',
  RESULT_PENDING: 'RESULT_PENDING',
  COURSE_INACTIVE: 'COURSE_INACTIVE',
} as const;

export type ExclusionReason = (typeof EXCLUSION_REASONS)[keyof typeof EXCLUSION_REASONS];

/**
 * Marks that are NOT a result yet (docs/03 §10). A withheld result is undecided
 * — the university is holding it, usually over fees — and neither a pass nor a
 * failure. Treating it as either would be a guess with consequences: as a pass
 * it hides a course the student must retake, as a failure it forces a retake of
 * a course they may well have passed.
 */
export const UNDECIDED_MARKS = ['WITHHELD'] as const;

/**
 * Marks that mean the course was not passed and must be taken again. ABSENT and
 * MALPRACTICE carry no score but are definitively not passes; MEDICAL is an
 * approved absence, which still leaves the course outstanding.
 */
export const OUTSTANDING_MARKS = ['ABSENT', 'MALPRACTICE', 'MEDICAL'] as const;

/**
 * The size of one level band. Nigerian levels are counted in hundreds — 100, 200,
 * 300 — so "one level above" is a difference of 100, not of 1. Named because the
 * spread arithmetic below is meaningless without it, and a deployment that ever
 * numbers levels 1..4 has one constant to change rather than a subtraction to
 * find.
 */
export const LEVEL_BAND = 100;

/** True when a level is within the spread a student may register across. */
export function isLevelWithinSpread(
  studentLevel: number,
  courseLevel: number,
  spread: number,
): boolean {
  // Registering BELOW your level is always legitimate — that is what a carryover
  // is. Only reaching UP is bounded, because a 100-level student taking 400-level
  // courses has skipped the prerequisite chain the curriculum encodes.
  if (courseLevel <= studentLevel) return true;
  // Compared in BANDS, not raw points: `levelSpread: 1` means "one level above",
  // and a raw subtraction would read it as one point and refuse every course a
  // student could plausibly reach.
  const bandsUp = Math.ceil((courseLevel - studentLevel) / LEVEL_BAND);
  return bandsUp <= spread;
}

/**
 * The maximum number of sessions a programme may be spread over (§8.4).
 * Nigerian practice is the standard duration plus a grace of the same order —
 * NUC caps a 4-year degree at 6 sessions. Expressed as a function so the rule is
 * visible in one place rather than inlined at the gate.
 */
export function maxAllowedSessions(durationYears: number, graceYears = 2): number {
  return durationYears + graceYears;
}
