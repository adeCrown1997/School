import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../finance/ledger.service';
import { CalendarService } from './calendar.service';
import { EligibilityReport, EligibilityService, GateResult } from './eligibility.service';

/**
 * The five gates of §9.1. What is proven here is mostly about HONESTY of the
 * answer rather than mere pass/fail:
 *
 *   • every gate is evaluated, so a student sees all their blockers in one trip;
 *   • a gate that cannot be decided (fee clearance, with no invoice issued)
 *     reports notEnforced instead of quietly passing — nobody should later mistake
 *     an unbuilt gate for a satisfied one;
 *   • assertCanRegister refuses on the same data the display used, so a client
 *     that skips the check gains nothing.
 */
const ACTIVE = { key: 'ACTIVE', label: 'Active', isTerminal: false };

const student = (over: Record<string, unknown> = {}) => ({
  id: 'stu1',
  matriculationNumber: 'CSC/2024/001',
  surname: 'Balogun',
  firstName: 'Ada',
  otherNames: null,
  currentLevel: 100,
  facultyId: 'fac-sci',
  departmentId: 'dep-csc',
  programmeId: 'prog-csc',
  curriculumVersionId: 'cv1',
  activationState: 'ACTIVATED',
  studentStatus: ACTIVE,
  programme: { id: 'prog-csc', code: 'CSC', durationYears: 4, isActive: true },
  admissionSession: { id: 'ses1', name: '2024/2025', startDate: new Date('2024-09-01T00:00:00Z') },
  userAccount: { id: 'u1', isActive: true },
  holds: [],
  ...over,
});

const session = (over: Record<string, unknown> = {}) => ({
  id: 'ses1',
  name: '2024/2025',
  startDate: new Date('2024-09-01T00:00:00Z'),
  state: 'OPEN',
  ...over,
});

function build(
  over: {
    student?: Record<string, unknown> | null;
    session?: Record<string, unknown> | null;
    /** The fee-clearance verdict to return; default = no invoice issued. */
    clearance?: { invoiced?: boolean; cleared?: boolean; shortfall?: bigint };
    windowOpen?: boolean;
  } = {},
) {
  const prisma = {
    studentRecord: {
      findUnique: jest
        .fn()
        .mockResolvedValue(over.student === null ? null : (over.student ?? student())),
    },
    academicSession: {
      findUnique: jest
        .fn()
        .mockResolvedValue(over.session === null ? null : (over.session ?? session())),
    },
  } as unknown as PrismaService;

  const open = over.windowOpen !== false;
  const calendar = {
    isWindowOpen: jest.fn().mockResolvedValue(
      open
        ? {
            isOpen: true,
            window: { id: 'w1', opensAt: new Date(), closesAt: new Date() },
            reason: null,
            message: null,
          }
        : {
            isOpen: false,
            window: null,
            reason: 'CLOSED',
            message: 'Registration closed on 2026-01-31 23:59 UTC.',
          },
    ),
  } as unknown as CalendarService;

  // Gate 3's query lives in LedgerService (INV-16): registration asks one
  // derived question instead of re-summing the tables itself.
  const c = over.clearance ?? {};
  const ledger = {
    clearance: jest.fn().mockResolvedValue({
      invoiced: c.invoiced ?? false,
      cleared: c.cleared ?? false,
      shortfall: c.shortfall ?? 0n,
      billed: 0n,
      covered: 0n,
    }),
  } as unknown as LedgerService;

  return { service: new EligibilityService(prisma, calendar, ledger), prisma, calendar, ledger };
}

const gate = (report: EligibilityReport, key: string): GateResult =>
  report.gates.find((g) => g.gate === key)!;

describe('EligibilityService.evaluate', () => {
  it('passes an activated, unencumbered student inside the window', async () => {
    const { service } = build();
    const report = await service.evaluate('stu1', 'ses1', 'sem1');
    expect(report.eligible).toBe(true);
    expect(gate(report, 'ACCOUNT').passed).toBe(true);
    expect(gate(report, 'WINDOW').passed).toBe(true);
    expect(gate(report, 'HOLDS').passed).toBe(true);
    expect(gate(report, 'DURATION').passed).toBe(true);
  });

  it('resolves the student context the caller needs anyway', async () => {
    const { service } = build();
    const report = await service.evaluate('stu1', 'ses1', 'sem1');
    expect(report.student).toMatchObject({
      matriculationNumber: 'CSC/2024/001',
      fullName: 'Balogun Ada',
      level: 100,
      curriculumVersionId: 'cv1',
    });
  });

  /** The support-load argument: one trip, the whole picture. */
  it('reports every blocker rather than short-circuiting at the first', async () => {
    const { service } = build({
      student: student({
        activationState: 'PENDING',
        userAccount: null,
        holds: [{ holdType: 'DISCIPLINARY', reason: 'Pending panel decision' }],
      }),
      windowOpen: false,
    });
    const report = await service.evaluate('stu1', 'ses1', 'sem1');
    const failed = report.gates
      .filter((g) => !g.passed && g.notEnforced !== true)
      .map((g) => g.gate);
    expect(failed).toEqual(['ACCOUNT', 'WINDOW', 'HOLDS']);
  });

  it('reports a missing student and a missing session distinctly', async () => {
    await expect(
      build({ student: null }).service.evaluate('ghost', 'ses1', 'sem1'),
    ).rejects.toThrow(/student record not found/i);
    await expect(
      build({ session: null }).service.evaluate('stu1', 'ghost', 'sem1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('asks the calendar with the student’s own scope and the given instant', async () => {
    const { service, calendar } = build();
    const at = new Date('2026-01-10T09:00:00Z');
    await service.evaluate('stu1', 'ses1', 'sem1', at);
    expect(calendar.isWindowOpen).toHaveBeenCalledWith(
      'REGISTRATION',
      'ses1',
      'sem1',
      { facultyId: 'fac-sci', departmentId: 'dep-csc', programmeId: 'prog-csc' },
      at,
    );
  });

  it('surfaces the window’s own refusal message verbatim', async () => {
    const { service } = build({ windowOpen: false });
    const report = await service.evaluate('stu1', 'ses1', 'sem1');
    expect(gate(report, 'WINDOW').message).toMatch(/closed on 2026-01-31/);
  });

  describe('gate 1: account and status', () => {
    it('refuses an unactivated record', async () => {
      const { service } = build({
        student: student({ activationState: 'PENDING', userAccount: null }),
      });
      const report = await service.evaluate('stu1', 'ses1', 'sem1');
      expect(gate(report, 'ACCOUNT').message).toMatch(/not activated/i);
    });

    it('refuses a deactivated login', async () => {
      const { service } = build({
        student: student({ userAccount: { id: 'u1', isActive: false } }),
      });
      const report = await service.evaluate('stu1', 'ses1', 'sem1');
      expect(gate(report, 'ACCOUNT').message).toMatch(/deactivated/i);
    });

    /** A graduate should be told they graduated, not given the generic status line. */
    it('names a terminal status before falling back to the allowlist', async () => {
      const { service } = build({
        student: student({
          studentStatus: { key: 'GRADUATED', label: 'Graduated', isTerminal: true },
        }),
      });
      const report = await service.evaluate('stu1', 'ses1', 'sem1');
      expect(gate(report, 'ACCOUNT').message).toMatch(/graduated, which ends registration/i);
    });

    it('refuses a status that is not on the allowlist', async () => {
      const { service } = build({
        student: student({
          studentStatus: { key: 'SUSPENDED', label: 'Suspended', isTerminal: false },
        }),
      });
      const report = await service.evaluate('stu1', 'ses1', 'sem1');
      expect(gate(report, 'ACCOUNT').message).toMatch(
        /not open to students with status Suspended/i,
      );
    });

    it('admits a student on probation — probation is not suspension', async () => {
      const { service } = build({
        student: student({
          studentStatus: { key: 'PROBATION', label: 'Probation', isTerminal: false },
        }),
      });
      const report = await service.evaluate('stu1', 'ses1', 'sem1');
      expect(gate(report, 'ACCOUNT').passed).toBe(true);
    });
  });

  describe('gate 3: fee clearance', () => {
    it('is NOT ENFORCED when no invoice has been issued, and does not block', async () => {
      const { service } = build();
      const report = await service.evaluate('stu1', 'ses1', 'sem1');
      const fees = gate(report, 'FEE_CLEARANCE');
      expect(fees).toMatchObject({ passed: false, notEnforced: true });
      expect(report.eligible).toBe(true);
    });

    it('passes a settled invoice', async () => {
      const { service } = build({ clearance: { invoiced: true, cleared: true } });
      const report = await service.evaluate('stu1', 'ses1', 'sem1');
      expect(gate(report, 'FEE_CLEARANCE').passed).toBe(true);
    });

    it('fails an outstanding balance and quotes it in naira', async () => {
      const { service } = build({
        clearance: { invoiced: true, cleared: false, shortfall: 29_999_50n },
      });
      const report = await service.evaluate('stu1', 'ses1', 'sem1');
      expect(gate(report, 'FEE_CLEARANCE').passed).toBe(false);
      expect(gate(report, 'FEE_CLEARANCE').message).toContain('₦29,999.50');
      expect(report.eligible).toBe(false);
    });

    /** §11.4/Q-39: clearance is a query into finance — waiver/loan coverage is
     *  computed there, and the result rides back as `cleared`. */
    it('passes when the derived verdict says waived/loan cover suffices', async () => {
      const { service, ledger } = build({ clearance: { invoiced: true, cleared: true } });
      const report = await service.evaluate('stu1', 'ses1', 'sem1');
      expect(gate(report, 'FEE_CLEARANCE').passed).toBe(true);
      expect(ledger.clearance).toHaveBeenCalledWith('stu1', 'ses1');
    });

    it('mentions waiver or loan clearance as the way out when unpaid', async () => {
      const { service } = build({
        clearance: { invoiced: true, cleared: false, shortfall: 10_000_00n },
      });
      const report = await service.evaluate('stu1', 'ses1', 'sem1');
      expect(gate(report, 'FEE_CLEARANCE').message).toMatch(/waiver or loan clearance/i);
    });
  });

  describe('gate 4: holds', () => {
    it('names the hold types so the student knows which office to visit', async () => {
      const { service } = build({
        student: student({
          holds: [
            { holdType: 'LIBRARY', reason: 'Unreturned books' },
            { holdType: 'FINANCE', reason: 'Bounced payment' },
          ],
        }),
      });
      const report = await service.evaluate('stu1', 'ses1', 'sem1');
      expect(gate(report, 'HOLDS').message).toMatch(/LIBRARY, FINANCE/);
      expect(gate(report, 'HOLDS').message).toMatch(/Unreturned books/);
    });

    it('only considers live holds that block registration', async () => {
      const { service, prisma } = build();
      await service.evaluate('stu1', 'ses1', 'sem1');
      const include = (prisma.studentRecord.findUnique as jest.Mock).mock.calls[0][0].include;
      expect(include.holds.where).toEqual({ releasedAt: null, blocksRegistration: true });
    });
  });

  describe('gate 5: maximum duration', () => {
    it('passes a student inside the allowed span', async () => {
      const { service } = build({
        session: session({ name: '2028/2029', startDate: new Date('2028-09-01T00:00:00Z') }),
      });
      const report = await service.evaluate('stu1', 'ses1', 'sem1');
      expect(gate(report, 'DURATION').passed).toBe(true);
    });

    /** 4-year programme, 6 sessions allowed, admitted 2024/2025 → 2030/2031 is the 7th. */
    it('fails a student who has exhausted duration plus grace', async () => {
      const { service } = build({
        session: session({ name: '2030/2031', startDate: new Date('2030-09-01T00:00:00Z') }),
      });
      const report = await service.evaluate('stu1', 'ses1', 'sem1');
      expect(gate(report, 'DURATION').passed).toBe(false);
      expect(gate(report, 'DURATION').message).toMatch(/allows 6 sessions/);
      expect(gate(report, 'DURATION').message).toMatch(/approved extension/i);
    });
  });
});

describe('EligibilityService.assertCanRegister', () => {
  it('returns the report when every gate passes', async () => {
    const { service } = build();
    await expect(service.assertCanRegister('stu1', 'ses1', 'sem1')).resolves.toMatchObject({
      eligible: true,
    });
  });

  it('throws with the first blocking reason and the count of the rest', async () => {
    const { service } = build({
      student: student({
        activationState: 'PENDING',
        userAccount: null,
        holds: [{ holdType: 'LIBRARY', reason: 'Unreturned books' }],
      }),
    });
    await expect(service.assertCanRegister('stu1', 'ses1', 'sem1')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.assertCanRegister('stu1', 'ses1', 'sem1')).rejects.toThrow(
      /not activated yet.*\(and 1 other issue\(s\)\)/i,
    );
  });

  it('carries the machine code and per-gate details for the client', async () => {
    const { service } = build({ windowOpen: false });
    const err = await service.assertCanRegister('stu1', 'ses1', 'sem1').catch((e) => e);
    expect(err.getResponse()).toMatchObject({
      code: 'REGISTRATION_NOT_ELIGIBLE',
      details: [{ gate: 'WINDOW' }],
    });
  });

  it('does not refuse on an undecidable gate alone', async () => {
    const { service } = build();
    await expect(service.assertCanRegister('stu1', 'ses1', 'sem1')).resolves.toBeDefined();
  });
});
