import { PrismaService } from '../prisma/prisma.service';
import { LecturerDashboardService } from './lecturer-dashboard.service';
import { AcademicUnitDashboardService } from './academic-unit-dashboard.service';
import { AuthPrincipal } from '../common/auth-principal';
import { PERMISSIONS } from '../rbac/permissions.catalog';

/**
 * Service-level dashboard tests with a mocked Prisma client. The goal is to
 * prove each overview (a) only touches the actor's own scope/allocations and
 * (b) derives figures from the mock's data instead of inventing numbers.
 */
function prismaMock(overrides: Record<string, Record<string, jest.Mock>>): PrismaService {
  const defaults: Record<string, () => unknown> = {
    count: () => 0,
    groupBy: () => [],
    findMany: () => [],
    findUnique: () => null,
    findFirst: () => null,
    aggregate: () => ({ _count: { _all: 0 }, _sum: {}, _avg: { cgpa: null } }),
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
  const modelNames = [
    'studentRecord',
    'studentStatus',
    'registration',
    'registrationLine',
    'resultBatch',
    'courseOffering',
    'courseAllocation',
    'scoreEntry',
    'calendarWindow',
    'examSchedule',
    'profileChangeRequest',
    'semesterGpa',
    'progressionProposal',
    'department',
    'faculty',
    'examPeriod',
    'examCard',
    'examAttendance',
    'examEligibility',
    'clearanceUnit',
    'clearanceRequest',
    'clearanceStep',
    'application',
    'admissionOffer',
    'importBatch',
    'transcriptRequest',
    'graduationCandidate',
    'resultWithholding',
    'recordAmendment',
    'studentHold',
    'user',
    'invoice',
    'waiver',
    'loanClearance',
    'ledgerEntry',
    'paymentIntent',
  ];
  const client: Record<string, unknown> = {};
  for (const name of new Set([...modelNames, ...Object.keys(overrides)])) {
    client[name] = make(name);
  }
  return client as unknown as PrismaService;
}

function principal(
  permission: string,
  scope: AuthPrincipal['scopedPermissions'][number]['scope'] = { scopeType: 'GLOBAL' },
  userId = 'staff-1',
): AuthPrincipal {
  return {
    userId,
    userType: 'STAFF',
    email: 'x@uni.example',
    fullName: 'Test Staff',
    permissions: [permission],
    scopedPermissions: [{ permission, scope }],
    mustChangePassword: false,
  };
}

const DEPT = { scopeType: 'DEPARTMENT' as const, departmentId: 'dept-1' };

describe('LecturerDashboardService.lecturerOverview', () => {
  it('lists only the caller-allocated offerings with live enrolment counts', async () => {
    const prisma = prismaMock({
      courseAllocation: {
        findMany: jest.fn().mockResolvedValue([
          {
            offeringId: 'o1',
            role: 'LECTURER',
            offering: {
              id: 'o1',
              status: 'OPEN',
              capacity: 100,
              course: {
                id: 'c1',
                code: 'CSC101',
                title: 'Intro',
                creditUnits: 3,
                level: 100,
                category: null,
              },
              session: { name: '2024/2025' },
              semester: { id: 's1', name: 'First Semester', sequence: 1 },
              department: { code: 'CSC', name: 'Computer Science' },
              assessmentComponents: [],
              resultBatches: [],
            },
          },
        ]),
      },
      registrationLine: {
        groupBy: jest.fn().mockResolvedValue([{ courseOfferingId: 'o1', _count: 42 }]),
      },
      scoreEntry: {
        groupBy: jest.fn().mockResolvedValue([{ state: 'SUBMITTED', _count: 40 }]),
        findMany: jest.fn().mockResolvedValue([{ component: { offeringId: 'o1' } }]),
      },
      resultBatch: { count: jest.fn().mockResolvedValue(0) },
      examSchedule: { findMany: jest.fn().mockResolvedValue([]) },
      calendarWindow: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const svc = new LecturerDashboardService(prisma);

    const out = await svc.lecturerOverview(principal(PERMISSIONS.DASHBOARD_LECTURER_VIEW));

    expect(out.allocations.count).toBe(1);
    expect(out.allocations.totalEnrolled).toBe(42);
    expect(out.allocations.items[0].course.code).toBe('CSC101');
    expect(out.allocations.items[0].enrolled).toBe(42);
    expect(out.pendingResults.submittedScoreEntries).toBe(40);
    // Querying allocations is per-staff — the actor's own id, never a scope.
    expect(prisma.courseAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ staffUserId: 'staff-1' }) }),
    );
  });

  it('returns honest zeros for a lecturer with no allocations', async () => {
    const svc = new LecturerDashboardService(prismaMock({}));
    const out = await svc.lecturerOverview(principal(PERMISSIONS.DASHBOARD_LECTURER_VIEW));
    expect(out.allocations.count).toBe(0);
    expect(out.allocations.totalEnrolled).toBe(0);
    expect(out.courseMaterials).toEqual([]);
    expect(out.upcoming.exams).toEqual([]);
  });
});

describe('AcademicUnitDashboardService', () => {
  it('adviser overview: applies the actor-SCOPED student filter to registrations', async () => {
    const prisma = prismaMock({
      studentRecord: {
        count: jest.fn().mockResolvedValue(12),
        groupBy: jest.fn().mockResolvedValue([]),
        // at-risk lookup returns the flagged low-CGPA student inside scope.
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'st-1',
            matriculationNumber: 'CSC/2024/001',
            surname: 'Ade',
            firstName: 'Bola',
            currentLevel: 100,
            programme: { code: 'CSC-BSC' },
            studentStatus: { key: 'ACTIVE', label: 'Active' },
          },
        ]),
      },
      registration: {
        groupBy: jest.fn().mockResolvedValue([{ status: 'PENDING_APPROVAL', _count: 3 }]),
      },
      resultBatch: { groupBy: jest.fn().mockResolvedValue([]) },
      profileChangeRequest: { groupBy: jest.fn().mockResolvedValue([{ status: 'PENDING', _count: 2 }]) },
      semesterGpa: {
        findMany: jest.fn().mockResolvedValue([
          { studentRecordId: 'st-1', cgpa: '1.10', computedAt: new Date() },
        ]),
        aggregate: jest.fn().mockResolvedValue({ _avg: { cgpa: null } }),
      },
      progressionProposal: { findMany: jest.fn().mockResolvedValue([]) },
      studentStatus: { findMany: jest.fn().mockResolvedValue([]) },
    });

    const svc = new AcademicUnitDashboardService(prisma);
    const out = await svc.adviserOverview(principal(PERMISSIONS.DASHBOARD_ADVISER_VIEW, DEPT));

    // Registrations must be queried INSIDE the adviser's department scope.
    const regCall = (prisma.registration.groupBy as jest.Mock).mock.calls[0][0];
    expect(regCall.where.studentRecord).toEqual({ OR: [{ departmentId: { in: ['dept-1'] } }] });
    expect(out.students.total).toBe(12);
    expect(out.scope.unrestricted).toBe(false);
    expect(out.pendingRequests.changeRequests).toBe(2);
    expect(out.atRisk.students[0].latestCgpa).toBeLessThan(1.5);
    expect(out.atRisk.students[0].matriculationNumber).toBe('CSC/2024/001');
  });

  it('department overview: staff load counts distinct allocated lecturers', async () => {
    const prisma = prismaMock({
      studentRecord: { count: jest.fn().mockResolvedValue(0), groupBy: jest.fn().mockResolvedValue([]) },
      courseAllocation: {
        findMany: jest.fn().mockResolvedValue([
          {
            staffUserId: 't1',
            role: 'LECTURER',
            staffUser: { id: 't1', fullName: 'One', email: 'o@u', isActive: true },
          },
          {
            staffUserId: 't1',
            role: 'LECTURER',
            staffUser: { id: 't1', fullName: 'One', email: 'o@u', isActive: true },
          },
          {
            staffUserId: 't2',
            role: 'COORDINATOR',
            staffUser: { id: 't2', fullName: 'Two', email: 't@u', isActive: true },
          },
        ]),
      },
      courseOffering: { groupBy: jest.fn().mockResolvedValue([{ status: 'OPEN', _count: 5 }]) },
      registration: { groupBy: jest.fn().mockResolvedValue([]) },
      resultBatch: { groupBy: jest.fn().mockResolvedValue([]) },
    });
    const svc = new AcademicUnitDashboardService(prisma);
    const out = await svc.departmentOverview(principal(PERMISSIONS.DASHBOARD_HOD_VIEW, DEPT));

    expect(out.staff.teachingStaff).toBe(2);
    expect(out.staff.allocations[0]).toMatchObject({ fullName: 'One', offerings: 2 });
    expect(out.offerings).toEqual([{ status: 'OPEN', count: 5 }]);
  });

  it('faculty overview: surfaces per-department student distribution', async () => {
    const prisma = prismaMock({
      studentRecord: {
        count: jest.fn().mockResolvedValue(3),
        // `groupBy` is used for several dimensions; answer per `by` key.
        groupBy: jest.fn().mockImplementation((args: { by: string[] }) => {
          if (args.by.includes('departmentId')) {
            return Promise.resolve([
              { departmentId: 'd1', _count: 2 },
              { departmentId: 'd2', _count: 1 },
            ]);
          }
          return Promise.resolve([]);
        }),
      },
      studentStatus: { findMany: jest.fn().mockResolvedValue([]) },
      semesterGpa: { aggregate: jest.fn().mockResolvedValue({ _avg: { cgpa: null } }) },
      department: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'd1', code: 'CSC', name: 'Computer Science' },
          { id: 'd2', code: 'MTH', name: 'Mathematics' },
        ]),
      },
      registration: { groupBy: jest.fn().mockResolvedValue([]) },
      resultBatch: { groupBy: jest.fn().mockResolvedValue([]) },
    });
    const svc = new AcademicUnitDashboardService(prisma);
    const out = await svc.facultyOverview(
      principal(PERMISSIONS.DASHBOARD_FACULTY_VIEW, { scopeType: 'FACULTY', facultyId: 'f1' }),
    );

    expect(out.byDepartment).toEqual([
      { departmentId: 'd1', name: 'Computer Science', code: 'CSC', count: 2 },
      { departmentId: 'd2', name: 'Mathematics', code: 'MTH', count: 1 },
    ]);
  });
});
