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
  return courseLevel - studentLevel <= spread;
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
