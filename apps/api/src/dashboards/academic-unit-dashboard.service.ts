import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthPrincipal } from '../common/auth-principal';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import { DashboardScope, dashboardScopeFor, offeringDepartmentWhere } from './dashboards.scope';

/**
 * Academic-unit dashboards: the adviser (programme/student scope), the HOD
 * (department) and the faculty tier (faculty officer/dean). All three are
 * SCOPE-AWARE projections of student records, registrations and results — the
 * same `studentScopeWhere` authority set the registry uses, so a dashboard can
 * never show a record its holder's module permission does not reach.
 *
 * "At-risk" is DERIVED from the data the institution records — a low CGPA on
 * the most recent SemesterGpa or an adverse proposal outcome — never a stored
 * flag or a guess.
 */
@Injectable()
export class AcademicUnitDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** The adviser's slice: students, registrations and results in scope. */
  async adviserOverview(actor: AuthPrincipal) {
    const scope = dashboardScopeFor(actor, PERMISSIONS.DASHBOARD_ADVISER_VIEW);
    const shared = await this.unitStudents(scope);

    const [registrationsByStatus, results, pendingRequests, atRisk] = await Promise.all([
      this.prisma.registration.groupBy({
        by: ['status'],
        where: { studentRecord: scope.studentWhere },
        _count: true,
        orderBy: { status: 'asc' },
      }),
      this.prisma.resultBatch.groupBy({
        by: ['status'],
        where: { offering: offeringDepartmentWhere(scope) },
        _count: true,
        orderBy: { status: 'asc' },
      }),
      this.prisma.profileChangeRequest.groupBy({
        by: ['status'],
        where: {
          studentRecord: scope.studentWhere,
          status: { in: ['PENDING'] },
        },
        _count: true,
      }),
      this.atRiskStudents(scope),
    ]);

    return {
      scope: scope.summary,
      students: shared,
      registrationsByStatus: registrationsByStatus.map((g) => ({
        status: g.status,
        count: g._count,
      })),
      resultsByStatus: results.map((g) => ({ status: g.status, count: g._count })),
      pendingRequests: {
        changeRequests: pendingRequests.reduce((sum, g) => sum + g._count, 0),
      },
      atRisk,
    };
  }

  /** The department tier: statistics, teaching load and the approval queues. */
  async departmentOverview(actor: AuthPrincipal) {
    const scope = dashboardScopeFor(actor, PERMISSIONS.DASHBOARD_HOD_VIEW);
    const students = await this.unitStudents(scope);

    const [staffAllocations, offerings, registrationsByStatus, resultsByStatus] = await Promise.all(
      [
        this.departmentStaffLoad(scope),
        this.prisma.courseOffering.groupBy({
          by: ['status'],
          where: offeringDepartmentWhere(scope),
          _count: true,
          orderBy: { status: 'asc' },
        }),
        this.prisma.registration.groupBy({
          by: ['status'],
          where: { studentRecord: scope.studentWhere },
          _count: true,
          orderBy: { status: 'asc' },
        }),
        this.prisma.resultBatch.groupBy({
          by: ['status'],
          where: { offering: offeringDepartmentWhere(scope) },
          _count: true,
          orderBy: { status: 'asc' },
        }),
      ],
    );

    const pendingRegistrations =
      registrationsByStatus.find((g) => g.status === ('PENDING_APPROVAL' as const))?._count ?? 0;
    const pendingResults = resultsByStatus
      .filter((g) => g.status === ('DRAFT' as const) || g.status === ('PENDING_APPROVAL' as const))
      .reduce((sum, g) => sum + g._count, 0);

    return {
      scope: scope.summary,
      students,
      staff: {
        teachingStaff: staffAllocations.length,
        allocations: staffAllocations,
      },
      offerings: offerings.map((g) => ({ status: g.status, count: g._count })),
      registrationsByStatus: registrationsByStatus.map((g) => ({
        status: g.status,
        count: g._count,
      })),
      resultsByStatus: resultsByStatus.map((g) => ({ status: g.status, count: g._count })),
      pending: {
        registrations: pendingRegistrations,
        resultBatches: pendingResults,
      },
    };
  }

  /** The faculty tier: department summaries plus the faculty approval queues. */
  async facultyOverview(actor: AuthPrincipal) {
    const scope = dashboardScopeFor(actor, PERMISSIONS.DASHBOARD_FACULTY_VIEW);
    const students = await this.unitStudents(scope);

    const [byDepartmentRaw, registrationsByStatus, resultsByStatus] = await Promise.all([
      this.prisma.studentRecord.groupBy({
        by: ['departmentId'],
        where: scope.studentWhere,
        _count: true,
        orderBy: { departmentId: 'asc' },
      }),
      this.prisma.registration.groupBy({
        by: ['status'],
        where: { studentRecord: scope.studentWhere },
        _count: true,
        orderBy: { status: 'asc' },
      }),
      this.prisma.resultBatch.groupBy({
        by: ['status'],
        where: { offering: offeringDepartmentWhere(scope) },
        _count: true,
        orderBy: { status: 'asc' },
      }),
    ]);

    const departments = await this.prisma.department.findMany({
      where: { id: { in: byDepartmentRaw.map((d) => d.departmentId) } },
      select: { id: true, code: true, name: true },
    });
    const deptById = new Map(departments.map((d) => [d.id, d]));
    const byDepartment = byDepartmentRaw
      .map((d) => ({
        departmentId: d.departmentId,
        name: deptById.get(d.departmentId)?.name ?? 'Unknown',
        code: deptById.get(d.departmentId)?.code ?? '—',
        count: d._count,
      }))
      .sort((a, b) => b.count - a.count);

    const pendingRegistrations =
      registrationsByStatus.find((g) => g.status === ('PENDING_APPROVAL' as const))?._count ?? 0;
    const pendingResults = resultsByStatus
      .filter((g) => g.status === ('DRAFT' as const) || g.status === ('PENDING_APPROVAL' as const))
      .reduce((sum, g) => sum + g._count, 0);

    return {
      scope: scope.summary,
      students,
      byDepartment,
      registrationsByStatus: registrationsByStatus.map((g) => ({
        status: g.status,
        count: g._count,
      })),
      resultsByStatus: resultsByStatus.map((g) => ({ status: g.status, count: g._count })),
      pending: {
        registrations: pendingRegistrations,
        resultBatches: pendingResults,
      },
    };
  }

  // --- Shared projections ----------------------------------------------------

  /** Student totals + breakdowns inside the given scope. */
  private async unitStudents(scope: DashboardScope) {
    const where: Prisma.StudentRecordWhereInput = scope.studentWhere;

    const [total, byLevelRaw, byStatusRaw, byActivationRaw, avgCgpa] = await Promise.all([
      this.prisma.studentRecord.count({ where }),
      this.prisma.studentRecord.groupBy({
        by: ['currentLevel'],
        where,
        _count: true,
        orderBy: { currentLevel: 'asc' },
      }),
      this.prisma.studentRecord.groupBy({
        by: ['studentStatusId'],
        where,
        _count: true,
        orderBy: { studentStatusId: 'asc' },
      }),
      this.prisma.studentRecord.groupBy({
        by: ['activationState'],
        where,
        _count: true,
        orderBy: { activationState: 'asc' },
      }),
      this.prisma.semesterGpa.aggregate({
        where: { studentRecord: where },
        _avg: { cgpa: true },
      }),
    ]);

    const statuses = await this.prisma.studentStatus.findMany({
      where: { id: { in: byStatusRaw.map((s) => s.studentStatusId) } },
      select: { id: true, key: true, label: true },
    });
    const statusById = new Map(statuses.map((s) => [s.id, s]));

    return {
      total,
      byLevel: byLevelRaw.map((l) => ({ level: l.currentLevel, count: l._count })),
      byStatus: byStatusRaw.map((s) => ({
        key: statusById.get(s.studentStatusId)?.key ?? 'UNKNOWN',
        label: statusById.get(s.studentStatusId)?.label ?? 'Unknown',
        count: s._count,
      })),
      byActivationState: byActivationRaw.map((a) => ({
        state: a.activationState,
        count: a._count,
      })),
      averageCgpa: avgCgpa._avg.cgpa === null ? null : Number(avgCgpa._avg.cgpa),
    };
  }

  /** Distinct staff allocated to offerings in scope, with their load counts. */
  private async departmentStaffLoad(scope: DashboardScope) {
    const allocations = await this.prisma.courseAllocation.findMany({
      where: { offering: offeringDepartmentWhere(scope) },
      select: {
        staffUserId: true,
        staffUser: { select: { id: true, fullName: true, email: true, isActive: true } },
        role: true,
      },
    });
    const byStaff = new Map<
      string,
      { id: string; fullName: string; email: string; isActive: boolean; offerings: number }
    >();
    for (const a of allocations) {
      const entry = byStaff.get(a.staffUserId) ?? {
        id: a.staffUser.id,
        fullName: a.staffUser.fullName,
        email: a.staffUser.email,
        isActive: a.staffUser.isActive,
        offerings: 0,
      };
      entry.offerings += 1;
      byStaff.set(a.staffUserId, entry);
    }
    return [...byStaff.values()].sort((a, b) => b.offerings - a.offerings);
  }

  /**
   * Students in scope whose most recent CGPA falls below the low-performance
   * threshold, or whose latest progression proposal carries an adverse
   * outcome. Both signals come from the institution's own recorded data; the
   * list is bounded and ordered most-concerning-first.
   */
  private async atRiskStudents(scope: DashboardScope, limit = 8) {
    const LOW_CGPA = 1.5;

    // Most recent SemesterGpa per student in scope, then filter for the weak.
    const gpas = await this.prisma.semesterGpa.findMany({
      where: { studentRecord: scope.studentWhere },
      orderBy: [{ computedAt: 'desc' }],
      select: {
        studentRecordId: true,
        cgpa: true,
        sessionId: true,
        computedAt: true,
      },
    });
    const latestByStudent = new Map<string, { cgpa: number; computedAt: Date }>();
    for (const g of gpas) {
      if (!latestByStudent.has(g.studentRecordId)) {
        latestByStudent.set(g.studentRecordId, { cgpa: Number(g.cgpa), computedAt: g.computedAt });
      }
    }
    const lowCgpaIds = [...latestByStudent.entries()]
      .filter(([, v]) => v.cgpa < LOW_CGPA)
      .map(([id]) => id);

    const adverse = await this.prisma.progressionProposal.findMany({
      where: {
        studentRecord: scope.studentWhere,
        outcome: { in: ['REPEAT', 'PROBATION', 'WITHDRAW'] },
        status: 'PROPOSED',
      },
      select: { studentRecordId: true, outcome: true, proposedAt: true },
      orderBy: { proposedAt: 'desc' },
      take: limit * 2,
    });

    const flagged = new Set<string>([...lowCgpaIds, ...adverse.map((a) => a.studentRecordId)]);
    if (flagged.size === 0) return { thresholdCgpa: LOW_CGPA, students: [] };

    const students = await this.prisma.studentRecord.findMany({
      where: { ...scope.studentWhere, id: { in: [...flagged] } },
      select: {
        id: true,
        matriculationNumber: true,
        surname: true,
        firstName: true,
        currentLevel: true,
        programme: { select: { code: true } },
        studentStatus: { select: { key: true, label: true } },
      },
      orderBy: { surname: 'asc' },
    });

    const adverseByStudent = new Map(adverse.map((a) => [a.studentRecordId, a]));
    return {
      thresholdCgpa: LOW_CGPA,
      students: students
        .map((s) => ({
          id: s.id,
          matriculationNumber: s.matriculationNumber,
          fullName: `${s.surname} ${s.firstName}`,
          level: s.currentLevel,
          programmeCode: s.programme?.code ?? null,
          status: s.studentStatus,
          latestCgpa: latestByStudent.get(s.id)?.cgpa ?? null,
          adverseProposalOutcome: adverseByStudent.get(s.id)?.outcome ?? null,
        }))
        .sort((a, b) => (a.latestCgpa ?? 99) - (b.latestCgpa ?? 99))
        .slice(0, limit),
    };
  }
}
