import {
  DEFAULT_REGISTRATION_POLICY,
  REGISTRABLE_STATUS_KEYS,
  SEAT_HOLDING_STATUSES,
  STUDENT_EDITABLE_STATUSES,
  holdsSeats,
  isLevelWithinSpread,
  maxAllowedSessions,
} from './registration.constants';

/**
 * The pure rules registration is built on. They are tested apart from the
 * services because every one of them is a POLICY STATEMENT that other code trusts
 * blindly: if `holdsSeats` is wrong the seat ledger drifts, and if
 * `isLevelWithinSpread` is wrong a 100-level student can register 400-level
 * courses. No mocks needed to prove any of it.
 */
describe('isLevelWithinSpread', () => {
  it('always allows a course at or below the student level — that is a carryover', () => {
    expect(isLevelWithinSpread(300, 300, 0)).toBe(true);
    expect(isLevelWithinSpread(300, 100, 0)).toBe(true);
  });

  /**
   * The spread is counted in LEVEL BANDS. A raw point-difference would make
   * `levelSpread: 1` mean "one point above", which refuses every 300-level course
   * to a 200-level student — the exact opposite of what the default intends.
   */
  it('allows reaching up only as far as the spread, counted in level bands', () => {
    expect(isLevelWithinSpread(200, 300, 1)).toBe(true);
    expect(isLevelWithinSpread(200, 400, 1)).toBe(false);
    expect(isLevelWithinSpread(200, 400, 2)).toBe(true);
  });

  it('with spread 0 pins the student to their own level and below', () => {
    expect(isLevelWithinSpread(200, 300, 0)).toBe(false);
    expect(isLevelWithinSpread(200, 201, 0)).toBe(false);
  });

  it('counts a partial band as a whole one, so an off-grid level cannot sneak up', () => {
    expect(isLevelWithinSpread(200, 250, 1)).toBe(true);
    expect(isLevelWithinSpread(200, 350, 1)).toBe(false);
  });
});

describe('maxAllowedSessions', () => {
  it('grants the NUC-style grace of two sessions over the programme duration', () => {
    expect(maxAllowedSessions(4)).toBe(6);
    expect(maxAllowedSessions(5)).toBe(7);
  });

  it('takes an explicit grace when an institution allows a different one', () => {
    expect(maxAllowedSessions(4, 0)).toBe(4);
  });
});

describe('holdsSeats', () => {
  it('is true for exactly the seat-holding statuses', () => {
    for (const status of SEAT_HOLDING_STATUSES) expect(holdsSeats(status)).toBe(true);
  });

  it('is false for a DRAFT, so an abandoned draft cannot hoard capacity', () => {
    expect(holdsSeats('DRAFT')).toBe(false);
  });

  it('is false once a registration is rejected or cancelled', () => {
    expect(holdsSeats('REJECTED')).toBe(false);
    expect(holdsSeats('CANCELLED')).toBe(false);
  });

  it('is false for an unknown status — an allowlist, so a new status holds nothing until decided', () => {
    expect(holdsSeats('WITHDRAWN')).toBe(false);
  });
});

describe('registration vocabularies', () => {
  it('lets a student edit only a draft or a rejected registration', () => {
    expect([...STUDENT_EDITABLE_STATUSES]).toEqual(['DRAFT', 'REJECTED']);
    expect((STUDENT_EDITABLE_STATUSES as readonly string[]).includes('APPROVED')).toBe(false);
  });

  it('admits only ACTIVE and PROBATION students to registration', () => {
    expect([...REGISTRABLE_STATUS_KEYS]).toEqual(['ACTIVE', 'PROBATION']);
    expect((REGISTRABLE_STATUS_KEYS as readonly string[]).includes('SUSPENDED')).toBe(false);
  });

  /**
   * The shipped defaults are the stricter reading of the regulations, so that an
   * institution which configures nothing is not accidentally permissive. Pinned
   * here because loosening one silently would change what every unconfigured
   * deployment enforces.
   */
  it('defaults to the strict reading of every open question', () => {
    expect(DEFAULT_REGISTRATION_POLICY).toEqual({
      prerequisiteEnforcement: 'BLOCK',
      levelSpread: 1,
      allowRepeatForUpgrade: false,
      enforceCapacity: true,
      timetableClash: 'WARN',
    });
  });
});
