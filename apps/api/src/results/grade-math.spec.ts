import { Prisma } from '@prisma/client';
import {
  bandForTotal,
  computeTotal,
  cumulativeStep,
  GradeBandLike,
  GpaRow,
  pointsHigher,
  round2,
  semesterGpa,
} from './grade-math';

/**
 * The arithmetic a transcript is computed with (docs/03 §10.3, §10.5). These
 * functions are the ONLY place grade numbers move, so their properties are
 * pinned here: a boundary band miss or a bankers'-rounding surprise would not
 * surface until a student argues a classification, long after the publish.
 */

const D = (v: string | number) => new Prisma.Decimal(v);

/** The seeded 5-point scale, as band rows. */
const BANDS: GradeBandLike[] = [
  { grade: 'A', minScore: D(70), maxScore: D(100), gradePoint: D(5) },
  { grade: 'B', minScore: D(60), maxScore: D(69), gradePoint: D(4) },
  { grade: 'C', minScore: D(50), maxScore: D(59), gradePoint: D(3) },
  { grade: 'D', minScore: D(45), maxScore: D(49), gradePoint: D(2) },
  { grade: 'E', minScore: D(40), maxScore: D(44), gradePoint: D(1) },
  { grade: 'F', minScore: D(0), maxScore: D(39), gradePoint: D(0) },
];

describe('computeTotal', () => {
  it('weights each component by score over its own max (§10.3)', () => {
    const total = computeTotal([
      { score: D(18), maxScore: D(20), weight: D(30) }, // CA: 27
      { score: D(32), maxScore: D(40), weight: D(20) }, // TEST: 16
      { score: D(41), maxScore: D(60), weight: D(50) }, // EXAM: 34.166…
    ]);
    expect(total.toDecimalPlaces(4).toString()).toBe('77.1667');
  });

  it('divides before multiplying so small scales do not truncate', () => {
    // 1 of 3 at weight 100 is 33.333…, not the (1×100)/3 a naive pipeline
    // would also give — but 2 of 3 must NOT become 66.
    const total = computeTotal([{ score: D(2), maxScore: D(3), weight: D(100) }]);
    expect(total.greaterThan(D('66.66'))).toBe(true);
    expect(total.lessThan(D('66.67'))).toBe(true);
  });

  it('is 0 for an empty component list', () => {
    expect(computeTotal([]).equals(0)).toBe(true);
  });

  it('sums to the raw score when the only component is the exam out of 100', () => {
    const total = computeTotal([{ score: D(59.5), maxScore: D(100), weight: D(100) }]);
    expect(total.toString()).toBe('59.5');
  });
});

describe('bandForTotal', () => {
  it('maps band interiors', () => {
    expect(bandForTotal(BANDS, D(75)).grade).toBe('A');
    expect(bandForTotal(BANDS, D(65)).grade).toBe('B');
    expect(bandForTotal(BANDS, D(20)).grade).toBe('F');
  });

  it('treats both band bounds as INCLUSIVE — a 70 is an A, not a B', () => {
    // The classic off-by-one: an exclusive upper bound silently re-grades every
    // score that lands exactly on a boundary.
    expect(bandForTotal(BANDS, D(70)).grade).toBe('A');
    expect(bandForTotal(BANDS, D(69)).grade).toBe('B');
    expect(bandForTotal(BANDS, D(0)).grade).toBe('F');
    expect(bandForTotal(BANDS, D(100)).grade).toBe('A');
  });

  it('grades fractional totals honestly — a 59.5 must not fall into the 59/60 gap', () => {
    // Integer band ranges are contiguous only at integer resolution; the lookup
    // must still place 59.5 (and every 69.5, 44.5 …) instead of throwing.
    expect(bandForTotal(BANDS, D('59.5')).grade).toBe('C');
    expect(bandForTotal(BANDS, D('69.5')).grade).toBe('B');
    expect(bandForTotal(BANDS, D('44.5')).grade).toBe('E');
  });

  it('throws when no band covers the total — a data bug, not a nearest-band guess', () => {
    expect(() => bandForTotal(BANDS, D(101))).toThrow(/no grade band covers/i);
  });
});

const row = (over: Partial<GpaRow> & { id: string }): GpaRow => ({
  studentRecordId: 'stu1',
  sessionId: 'ses1',
  semesterId: 'sem1',
  registrationLineId: `line-${over.id}`,
  level: 100,
  creditUnits: 3,
  gradePoint: D(4),
  passed: true,
  countsTowardCgpa: true,
  ...over,
});

describe('semesterGpa', () => {
  it('is the unit-weighted mean of the grade points (§10.5)', () => {
    const g = semesterGpa([
      row({ id: 'a', creditUnits: 3, gradePoint: D(5) }),
      row({ id: 'b', creditUnits: 2, gradePoint: D(4) }),
    ]);
    // (5×3 + 4×2) / 5 = 4.60
    expect(g.gpa.toString()).toBe('4.6');
    expect(g.unitsRegistered).toBe(5);
    expect(g.unitsPassed).toBe(5);
    expect(g.gradePoints.toString()).toBe('23');
  });

  it('counts failures (0 points) in the denominator — a fail drags the GPA', () => {
    const g = semesterGpa([
      row({ id: 'a', creditUnits: 3, gradePoint: D(5), passed: true }),
      row({ id: 'f', creditUnits: 3, gradePoint: D(0), passed: false }),
    ]);
    expect(g.gpa.toString()).toBe('2.5');
    expect(g.unitsRegistered).toBe(6);
    expect(g.unitsPassed).toBe(3);
  });

  it('excludes rows with no grade point — ABSENT is neither a zero nor a grade', () => {
    const g = semesterGpa([
      row({ id: 'a', creditUnits: 3, gradePoint: D(5), passed: true }),
      row({ id: 'absent', creditUnits: 3, gradePoint: null, passed: false }),
    ]);
    expect(g.unitsRegistered).toBe(3);
    expect(g.gpa.toString()).toBe('5');
  });

  it('excludes rows the repeat policy took out of the CGPA (Q-02)', () => {
    const g = semesterGpa([
      row({ id: 'a', creditUnits: 3, gradePoint: D(2), passed: true }),
      row({ id: 'excluded', creditUnits: 3, gradePoint: D(5), countsTowardCgpa: false }),
    ]);
    expect(g.unitsRegistered).toBe(3);
    expect(g.gpa.toString()).toBe('2');
  });

  it('is 0 with nothing counting, not a division fault', () => {
    const g = semesterGpa([row({ id: 'absent', gradePoint: null, passed: false })]);
    expect(g.unitsRegistered).toBe(0);
    expect(g.gpa.equals(0)).toBe(true);
  });
});

describe('cumulativeStep', () => {
  it('accumulates units and grade points across terms', () => {
    const s1 = cumulativeStep({ units: 0, gradePoints: D(0) }, { units: 5, gradePoints: D(23) });
    expect(s1.cgpa.toString()).toBe('4.6');
    const s2 = cumulativeStep(
      { units: s1.units, gradePoints: s1.gradePoints },
      { units: 4, gradePoints: D(12) },
    );
    expect(s2.units).toBe(9);
    expect(s2.cgpa.toString()).toBe('3.89'); // 35 / 9
  });

  it('is 0 when nothing has counted yet', () => {
    const s = cumulativeStep({ units: 0, gradePoints: D(0) }, { units: 0, gradePoints: D(0) });
    expect(s.cgpa.equals(0)).toBe(true);
  });
});

describe('round2', () => {
  it('rounds half UP — a boundary must round the same on every machine', () => {
    expect(round2(D('2.345')).toString()).toBe('2.35');
    expect(round2(D('2.344')).toString()).toBe('2.34');
    expect(round2(D('59.995')).toString()).toBe('60'); // and that is why inputs stay unrounded
  });

  it('never uses bankers rounding (2.125 → 2.13, not 2.12)', () => {
    expect(round2(D('2.125')).toString()).toBe('2.13');
  });
});

describe('pointsHigher', () => {
  it('orders by grade point, with null as the floor', () => {
    const a = row({ id: 'a', gradePoint: D(4) });
    const b = row({ id: 'b', gradePoint: D(2) });
    const n = row({ id: 'n', gradePoint: null, passed: false });
    expect(pointsHigher(a, b)).toBeGreaterThan(0);
    expect(pointsHigher(b, a)).toBeLessThan(0);
    expect(pointsHigher(a, a)).toBe(0);
    expect(pointsHigher(n, b)).toBeLessThan(0);
    expect(pointsHigher(n, n)).toBe(0);
  });
});
