import { Prisma } from '@prisma/client';

/**
 * Pure, deterministic grade computation (docs/03 §10.3, §10.5).
 *
 * Deliberately free of DB access so the arithmetic a transcript is computed
 * with can be covered by fast unit tests and reused verbatim by the
 * amendment/recompute paths — same inputs, same output, always.
 *
 * Decimal policy: all inputs are Prisma Decimals; arithmetic uses Decimal to
 * avoid the float rounding that turns an honest 59.5 into a dishonest 60. The
 * ONLY rounding in the pipeline is the final grade lookup, which compares the
 * unrounded total against inclusive band bounds.
 */

/** A grading band as stored: inclusive [minScore, maxScore] range plus points. */
export interface GradeBandLike {
  grade: string;
  minScore: Prisma.Decimal;
  maxScore: Prisma.Decimal;
  gradePoint: Prisma.Decimal;
}

export interface ComponentInput {
  /** The raw score (out of the component's own scale). */
  score: Prisma.Decimal;
  maxScore: Prisma.Decimal;
  weight: Prisma.Decimal;
}

/**
 * total_score = Σ (component_score / component_max × component_weight) (§10.3).
 * Divisions are carried at full precision and summed before any rounding, so
 * reordering components cannot change the result.
 */
export function computeTotal(components: ComponentInput[]): Prisma.Decimal {
  if (components.length === 0) return new Prisma.Decimal(0);
  return components.reduce(
    (acc, c) => acc.plus(c.score.dividedBy(c.maxScore).times(c.weight)),
    new Prisma.Decimal(0),
  );
}

/**
 * Map a total to its band. Bands are stored as integer ranges (B: 60–69) which
 * are contiguous only at integer resolution, so the lookup selects the band
 * with the GREATEST minScore not exceeding the total — equivalently, floor the
 * total and read the inclusive range. This grades fractional totals honestly:
 * a 59.5 cannot fall into the gap between 59 and 60.
 *
 * A total above the scale's ceiling is still a data bug and throws rather than
 * mapping to the top band.
 */
export function bandForTotal(bands: GradeBandLike[], total: Prisma.Decimal): GradeBandLike {
  const ceiling = bands.reduce(
    (max, b) => (b.maxScore.greaterThan(max) ? b.maxScore : max),
    bands[0].maxScore,
  );
  if (total.greaterThan(ceiling)) {
    throw new Error(`No grade band covers total score ${total.toString()}`);
  }
  let chosen: GradeBandLike | null = null;
  for (const b of bands) {
    if (!total.greaterThanOrEqualTo(b.minScore)) continue;
    if (!chosen || b.minScore.greaterThan(chosen.minScore)) chosen = b;
  }
  if (!chosen) throw new Error(`No grade band covers total score ${total.toString()}`);
  return chosen;
}

// --- GPA/CGPA (derived, INV-13) ----------------------------------------------

/** One counted grade row as the GPA engine sees it. */
export interface GpaRow {
  id: string;
  studentRecordId: string;
  sessionId: string;
  semesterId: string;
  registrationLineId: string;
  level: number;
  /** Units on the grade row (INV-6 snapshot). */
  creditUnits: number;
  /** Null when the row's mark is ABSENT/WITHHELD/MEDICAL/MALPRACTICE. */
  gradePoint: Prisma.Decimal | null;
  /** The band's minimum passing score is not stored here; the caller passes
   *  the grade letter instead and marks passes via `passed`. */
  passed: boolean;
  countsTowardCgpa: boolean;
}

/** GPA for one semester: Σ(point × units) / Σ(units) over counting rows (§10.5).
 *  Fails are counted rows (they carry points of 0), withheld/absent rows are
 *  excluded: a blank is neither a zero nor a grade. */
export function semesterGpa(rows: GpaRow[]): {
  unitsRegistered: number;
  unitsPassed: number;
  gradePoints: Prisma.Decimal;
  gpa: Prisma.Decimal;
} {
  const counting = rows.filter((r) => r.countsTowardCgpa && r.gradePoint !== null);
  const unitsRegistered = counting.reduce((s, r) => s + r.creditUnits, 0);
  const unitsPassed = counting.filter((r) => r.passed).reduce((s, r) => s + r.creditUnits, 0);
  const gradePoints = counting.reduce(
    (acc, r) => acc.plus(r.gradePoint!.times(r.creditUnits)),
    new Prisma.Decimal(0),
  );
  const gpa =
    unitsRegistered === 0 ? new Prisma.Decimal(0) : gradePoints.dividedBy(unitsRegistered);
  return { unitsRegistered, unitsPassed, gradePoints: round2(gradePoints), gpa: round2(gpa) };
}

/** CGPA over an ordered semester sequence — cumulative counters at each step. */
export function cumulativeStep(
  prior: { units: number; gradePoints: Prisma.Decimal },
  term: { units: number; gradePoints: Prisma.Decimal },
): { units: number; gradePoints: Prisma.Decimal; cgpa: Prisma.Decimal } {
  const units = prior.units + term.units;
  const gradePoints = prior.gradePoints.plus(term.gradePoints);
  const cgpa = units === 0 ? new Prisma.Decimal(0) : gradePoints.dividedBy(units);
  return { units, gradePoints: round2(gradePoints), cgpa: round2(cgpa) };
}

/** Two decimals to 2 places, rounding half up (never bankers' rounding — a
 *  grade boundary that rounds differently on different machines is a scandal). */
export function round2(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Which grade point is higher (for best-attempt dedup of repeats, Q-02). */
export function pointsHigher(a: GpaRow, b: GpaRow): number {
  if (a.gradePoint === null && b.gradePoint === null) return 0;
  if (a.gradePoint === null) return -1;
  if (b.gradePoint === null) return 1;
  return a.gradePoint.comparedTo(b.gradePoint);
}
