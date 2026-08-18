import { PrismaService } from '../prisma/prisma.service';
import { OperationsDashboardService } from './operations-dashboard.service';
import { FinanceDashboardService } from './finance-dashboard.service';
import { AuthPrincipal } from '../common/auth-principal';
import { PERMISSIONS } from '../rbac/permissions.catalog';

/**
 * Operations and finance dashboard tests. Assert the scope filter is applied
 * to every student-located query (the "no data outside your scope" rule) and
 * that money figures are computed from the ledger projections, not invented.
 */
function prismaMock(overrides: Record<string, Record<string, jest.Mock>>): PrismaService {
  const defaults: Record<string, () => unknown> = {
    count: () => 0,
    groupBy: () => [],
    findMany: () => [],
    findUnique: () => null,
    findFirst: () => null,
    aggregate: () => ({ _count: { _all: 0 }, _sum: { amount: null }, _avg: {} }),
  };
  const make = (model: string) =>
    new Proxy(
      {},
      {
        get(_t, method: string) {
          if (overrides[model]?.[method]) return overrides[model][method];
          return defaults[method] ?? (() => null);
        },
      },
    );
  const names = [
    'studentRecord',
    'studentStatus',
    'profileChangeRequest',
    'recordAmendment',
    'registration',
    'transcriptRequest',
    'clearanceRequest',
    'graduationCandidate',
    'resultWithholding',
    'importBatch',
    'application',
    'admissionOffer',
    'examPeriod',
    'examSchedule',
    'examCard',
    'examAttendance',
    'examEligibility',
    'clearanceUnit',
    'clearanceStep',
    'studentHold',
    'user',
    'invoice',
    'waiver',
    'loanClearance',
    'ledgerEntry',
    'paymentIntent',
    'semesterGpa',
    'faculty',
  ];
  const client: Record<string, unknown> = {};
  for (const name of new Set([...names, ...Object.keys(overrides)])) {
    client[name] = make(name);
  }
  return client as unknown as PrismaService;
}

function principal(
  permission: string,
  scope: AuthPrincipal['scopedPermissions'][number]['scope'] = { scopeType: 'GLOBAL' },
): AuthPrincipal {
  return {
    userId: 'u1',
    userType: 'STAFF',
    email: 'x@uni.example',
    fullName: 'X',
    permissions: [permission],
    scopedPermissions: [{ permission, scope }],
    mustChangePassword: false,
  };
}

const FACULTY_SCOPE = { scopeType: 'FACULTY' as const, facultyId: 'fac-1' };

describe('OperationsDashboardService.registryOverview', () => {
  it('scopes student-located queries and reports the registry queues', async () => {
    const prisma = prismaMock({
      studentRecord: {
        count: jest.fn().mockResolvedValue(7),
        groupBy: jest.fn().mockResolvedValue([{ activationState: 'ACTIVATED', _count: 7 }]),
      },
      profileChangeRequest: { count: jest.fn().mockResolvedValue(3) },
      recordAmendment: { count: jest.fn().mockResolvedValue(1) },
      registration: {
        groupBy: jest.fn().mockResolvedValue([{ status: 'APPROVED', _count: 4 }]),
        count: jest.fn().mockResolvedValue(2),
      },
      transcriptRequest: { groupBy: jest.fn().mockResolvedValue([{ status: 'IN_REVIEW', _count: 2 }]) },
      clearanceRequest: {
        groupBy: jest.fn().mockResolvedValue([{ isComplete: true, _count: 1 }]),
      },
      graduationCandidate: { groupBy: jest.fn().mockResolvedValue([]) },
      resultWithholding: { count: jest.fn().mockResolvedValue(0) },
      importBatch: { count: jest.fn().mockResolvedValue(1) },
    });
    const svc = new OperationsDashboardService(prisma);

    const out = await svc.registryOverview(principal(PERMISSIONS.DASHBOARD_REGISTRY_VIEW, FACULTY_SCOPE));

    const studentCalls = (prisma.studentRecord.count as jest.Mock).mock.calls;
    expect(studentCalls[0][0].where).toEqual({ OR: [{ facultyId: { in: ['fac-1'] } }] });
    const changeCall = (prisma.profileChangeRequest.count as jest.Mock).mock.calls[0][0];
    expect(changeCall.where.studentRecord).toEqual({ OR: [{ facultyId: { in: ['fac-1'] } }] });

    expect(out.students.total).toBe(7);
    expect(out.changeRequests.pending).toBe(3);
    expect(out.amendments.pending).toBe(1);
    expect(out.registrations.approvedAwaitingLock).toBe(2);
    expect(out.transcripts.open).toBe(2);
    expect(out.clearance.complete).toBe(1);
  });
});

describe('OperationsDashboardService.clearanceUnitOverview', () => {
  it('returns zeros and configured:false when the clearance unit does not exist', async () => {
    const prisma = prismaMock({
      clearanceUnit: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const svc = new OperationsDashboardService(prisma);
    const out = await svc.clearanceUnitOverview(
      principal(PERMISSIONS.DASHBOARD_LIBRARY_VIEW),
      'DASHBOARD_LIBRARY_VIEW',
      'LIBRARY',
    );
    expect(out.unit.configured).toBe(false);
    expect(out.steps.total).toBe(0);
    expect(out.requests.total).toBe(0);
  });

  it('sums step verdicts for the unit only', async () => {
    const prisma = prismaMock({
      clearanceUnit: {
        findFirst: jest.fn().mockResolvedValue({ id: 'u-lib', key: 'LIBRARY', label: 'Library' }),
      },
      clearanceRequest: {
        count: jest.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(2),
      },
      clearanceStep: {
        groupBy: jest.fn().mockResolvedValue([
          { status: 'PENDING', _count: 3 },
          { status: 'CLEARED', _count: 2 },
        ]),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const svc = new OperationsDashboardService(prisma);
    const out = await svc.clearanceUnitOverview(
      principal(PERMISSIONS.DASHBOARD_LIBRARY_VIEW),
      'DASHBOARD_LIBRARY_VIEW',
      'LIBRARY',
    );
    expect(out.unit.label).toBe('Library');
    expect(out.steps.pending).toBe(3);
    expect(out.steps.cleared).toBe(2);
    expect(out.steps.blocked).toBe(0);
    // Steps are always filtered to THIS unit.
    const stepCall = (prisma.clearanceStep.groupBy as jest.Mock).mock.calls[0][0];
    expect(stepCall.where.unitId).toBe('u-lib');
  });
});

describe('FinanceDashboardService.overview', () => {
  it('derives revenue from invoice projections and the waiver sum', async () => {
    const prisma = prismaMock({
      invoice: {
        groupBy: jest.fn().mockResolvedValue([
          {
            status: 'ISSUED',
            _count: { _all: 2 },
            _sum: { totalAmount: 100_000n, paidAmount: 40_000n },
          },
          {
            status: 'PAID',
            _count: { _all: 1 },
            _sum: { totalAmount: 50_000n, paidAmount: 50_000n },
          },
        ]),
        findMany: jest.fn().mockResolvedValue([{ id: 'inv-1' }, { id: 'inv-2' }, { id: 'inv-3' }]),
      },
      waiver: {
        aggregate: jest
          .fn()
          .mockResolvedValueOnce({ _sum: { amount: null }, _count: { _all: 1 } }) // pending
          .mockResolvedValueOnce({ _sum: { amount: 10_000n } }), // approved on live
      },
      loanClearance: { count: jest.fn().mockResolvedValue(1) },
      ledgerEntry: { findMany: jest.fn().mockResolvedValue([]) },
      paymentIntent: {
        groupBy: jest.fn().mockResolvedValue([{ status: 'PAID', _count: 2 }]),
      },
    });
    const svc = new FinanceDashboardService(prisma);
    const out = await svc.overview(principal(PERMISSIONS.DASHBOARD_BURSAR_VIEW));

    expect(out.revenue.billed).toBe('150000');
    expect(out.revenue.received).toBe('90000');
    expect(out.revenue.waived).toBe('10000');
    expect(out.revenue.outstanding).toBe('50000');
    expect(out.pendingActions.waivers.count).toBe(1);
    expect(out.verification.awaitingLedgerPost).toEqual([{ status: 'PAID', count: 2 }]);
  });

  it('never reports a negative outstanding balance', async () => {
    const prisma = prismaMock({
      invoice: {
        groupBy: jest.fn().mockResolvedValue([
          {
            status: 'PAID',
            _count: { _all: 1 },
            _sum: { totalAmount: 10_000n, paidAmount: 20_000n }, // overpaid
          },
        ]),
        findMany: jest.fn().mockResolvedValue([{ id: 'inv-1' }]),
      },
      waiver: {
        aggregate: jest
          .fn()
          .mockResolvedValueOnce({ _sum: { amount: null }, _count: { _all: 0 } })
          .mockResolvedValueOnce({ _sum: { amount: 0n } }),
      },
      loanClearance: { count: jest.fn().mockResolvedValue(0) },
      ledgerEntry: { findMany: jest.fn().mockResolvedValue([]) },
      paymentIntent: { groupBy: jest.fn().mockResolvedValue([]) },
    });
    const svc = new FinanceDashboardService(prisma);
    const out = await svc.overview(principal(PERMISSIONS.DASHBOARD_BURSAR_VIEW));
    expect(out.revenue.outstanding).toBe('0');
  });
});
