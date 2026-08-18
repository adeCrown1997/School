import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthPrincipal } from '../common/auth-principal';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import { DashboardScope, dashboardScopeFor } from './dashboards.scope';

/**
 * Operational-unit dashboards: registry (records, amendments, change requests,
 * credentials, clearance/graduation), admissions (applications, offers,
 * import batches), examinations (periods, schedules, cards, attendance),
 * the three clearance units a unit officer signs (library, student affairs,
 * hostel), and the university-wide executive views (registrar, VC).
 *
 * All student-located figures respect the actor's scope for the underlying
 * module permission; institutional figures (staff, applications, exam venues)
 * are reported in full to holders of the view permission, matching the
 * posture of the existing admin overview.
 */
@Injectable()
export class OperationsDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Registry overview: master-record health and the registry queues. */
  async registryOverview(actor: AuthPrincipal) {
    const scope = dashboardScopeFor(actor, PERMISSIONS.DASHBOARD_REGISTRY_VIEW);
    const studentWhere = scope.studentWhere;

    const [
      studentsTotal,
      byActivation,
      pendingChangeRequests,
      pendingAmendments,
      registrationsByStatus,
      registrationsPending,
      transcriptByStatus,
      clearanceByCompletion,
      graduationByStatus,
      withholdingsActive,
      importBatchesOpen,
    ] = await Promise.all([
      this.prisma.studentRecord.count({ where: studentWhere }),
      this.prisma.studentRecord.groupBy({
        by: ['activationState'],
        where: studentWhere,
        _count: true,
        orderBy: { activationState: 'asc' },
      }),
      this.prisma.profileChangeRequest.count({
        where: { studentRecord: studentWhere, status: 'PENDING' },
      }),
      this.prisma.recordAmendment.count({
        where: { studentRecord: studentWhere, status: 'PENDING' },
      }),
      this.prisma.registration.groupBy({
        by: ['status'],
        where: { studentRecord: studentWhere },
        _count: true,
        orderBy: { status: 'asc' },
      }),
      this.prisma.registration.count({
        where: { studentRecord: studentWhere, status: 'APPROVED' },
      }),
      this.prisma.transcriptRequest.groupBy({
        by: ['status'],
        where: { studentRecord: studentWhere },
        _count: true,
        orderBy: { status: 'asc' },
      }),
      this.prisma.clearanceRequest.groupBy({
        by: ['isComplete'],
        where: { studentRecord: studentWhere },
        _count: true,
      }),
      this.prisma.graduationCandidate.groupBy({
        by: ['status'],
        where: { studentRecord: studentWhere },
        _count: true,
        orderBy: { status: 'asc' },
      }),
      this.prisma.resultWithholding.count({
        where: { studentRecord: studentWhere, status: 'ACTIVE' },
      }),
      this.prisma.importBatch.count({
        where: {
          status: { in: ['UPLOADED', 'VALIDATED', 'DRY_RUN', 'AWAITING_APPROVAL'] },
        },
      }),
    ]);

    return {
      scope: scope.summary,
      students: {
        total: studentsTotal,
        byActivationState: byActivation.map((g) => ({ state: g.activationState, count: g._count })),
      },
      changeRequests: { pending: pendingChangeRequests },
      amendments: { pending: pendingAmendments },
      registrations: {
        byStatus: registrationsByStatus.map((g) => ({ status: g.status, count: g._count })),
        approvedAwaitingLock: registrationsPending,
      },
      transcripts: {
        byStatus: transcriptByStatus.map((g) => ({ status: g.status, count: g._count })),
        open: transcriptByStatus
          .filter((g) => !['DISPATCHED', 'REJECTED', 'CANCELLED'].includes(g.status))
          .reduce((sum, g) => sum + g._count, 0),
      },
      clearance: {
        complete: clearanceByCompletion.find((g) => g.isComplete)?._count ?? 0,
        inProgress: clearanceByCompletion.find((g) => !g.isComplete)?._count ?? 0,
      },
      graduation: {
        byStatus: graduationByStatus.map((g) => ({ status: g.status, count: g._count })),
      },
      withholdings: { active: withholdingsActive },
      importBatches: { open: importBatchesOpen },
    };
  }

  /** Admissions overview: the application funnel and intake statistics. */
  async admissionsOverview(actor: AuthPrincipal) {
    const scope = dashboardScopeFor(actor, PERMISSIONS.DASHBOARD_ADMISSIONS_VIEW);
    const studentWhere = scope.studentWhere;

    const [applicationsByStatus, offersByStatus, admittedByEntryMode, importOpen] =
      await Promise.all([
        this.prisma.application.groupBy({
          by: ['status'],
          _count: true,
          orderBy: { status: 'asc' },
        }),
        this.prisma.admissionOffer.groupBy({
          by: ['status'],
          _count: true,
          orderBy: { status: 'asc' },
        }),
        this.prisma.studentRecord.groupBy({
          by: ['entryMode'],
          where: studentWhere,
          _count: true,
          orderBy: { entryMode: 'asc' },
        }),
        this.prisma.importBatch.count({
          where: { status: { in: ['UPLOADED', 'VALIDATED', 'DRY_RUN', 'AWAITING_APPROVAL'] } },
        }),
      ]);

    // Applications are applicant claims, not student records — they carry no
    // protected identity and sit outside the student scope model. Reporting
    // them in full to holders of the admissions view mirrors the posture for
    // institution-wide staff figures.
    return {
      scope: scope.summary,
      applications: {
        total: applicationsByStatus.reduce((sum, g) => sum + g._count, 0),
        byStatus: applicationsByStatus.map((g) => ({ status: g.status, count: g._count })),
      },
      offers: {
        byStatus: offersByStatus.map((g) => ({ status: g.status, count: g._count })),
      },
      intake: {
        byEntryMode: admittedByEntryMode.map((g) => ({ entryMode: g.entryMode, count: g._count })),
      },
      importBatches: { open: importOpen },
    };
  }

  /** Examinations overview: periods, venue load, cards and hall attendance. */
  async examsOverview(actor: AuthPrincipal) {
    const scope = dashboardScopeFor(actor, PERMISSIONS.DASHBOARD_EXAMS_VIEW);
    const now = new Date();

    const [periods, schedules, cards, attendance, eligibilityBlocked] = await Promise.all([
      this.prisma.examPeriod.findMany({
        orderBy: { startDate: 'desc' },
        take: 5,
        include: { session: { select: { name: true } } },
      }),
      this.prisma.examSchedule.findMany({
        orderBy: { startsAt: 'asc' },
        include: {
          offering: {
            select: {
              course: { select: { code: true, title: true } },
              departmentId: true,
              department: { select: { facultyId: true } },
            },
          },
          venue: { select: { code: true, name: true, capacity: true } },
          period: { select: { name: true } },
        },
      }),
      this.prisma.examCard.groupBy({
        by: ['isValid'],
        where: { studentRecord: scope.studentWhere },
        _count: true,
      }),
      this.prisma.examAttendance.groupBy({
        by: ['status'],
        _count: true,
        orderBy: { status: 'asc' },
      }),
      this.prisma.examEligibility.count({ where: { isEligible: false } }),
    ]);

    // Exam schedules are institution-wide unless the actor's scope reaches the
    // teaching department (faculty or department grants). Programme-scoped
    // actors see only what their department scope reaches — fail closed.
    const inScope = schedules.filter((s) => {
      if (scope.unrestricted) return true;
      const deptId = s.offering.departmentId;
      const facId = s.offering.department?.facultyId ?? null;
      return (
        (deptId !== null && scope.constraint.departmentIds.includes(deptId)) ||
        (facId !== null && scope.constraint.facultyIds.includes(facId))
      );
    });

    return {
      scope: scope.summary,
      periods: periods.map((p) => ({
        id: p.id,
        name: p.name,
        session: p.session.name,
        startDate: p.startDate,
        endDate: p.endDate,
        isActive: p.isActive,
      })),
      schedules: {
        total: inScope.length,
        upcoming: inScope.filter((s) => s.startsAt > now).length,
        next: inScope
          .filter((s) => s.startsAt > now)
          .slice(0, 6)
          .map((s) => ({
            id: s.id,
            course: s.offering.course,
            venue: s.venue,
            periodName: s.period.name,
            startsAt: s.startsAt,
            seatsAllocated: s.seatsAllocated,
          })),
      },
      cards: {
        valid: cards.find((c) => c.isValid)?._count ?? 0,
        invalidated: cards.find((c) => !c.isValid)?._count ?? 0,
      },
      attendance: {
        byStatus: attendance.map((g) => ({ status: g.status, count: g._count })),
      },
      eligibility: { blocked: eligibilityBlocked },
    };
  }

  /**
   * A clearance-unit officer's dashboard: the steps for THEIR unit only.
   * `unitKey` is the configured vocabulary key (LIBRARY, STUDENT_AFFAIRS,
   * HOSTEL); the lookup fails closed if the unit does not exist yet — an
   * officer then sees an honest zero rather than another unit's queue.
   */
  async clearanceUnitOverview(actor: AuthPrincipal, permission: keyof typeof PERMISSIONS, unitKey: string) {
    const scope = dashboardScopeFor(actor, PERMISSIONS[permission]);

    const unit = await this.prisma.clearanceUnit.findFirst({
      where: { key: { equals: unitKey, mode: 'insensitive' }, isActive: true },
      select: { id: true, key: true, label: true },
    });
    if (!unit) {
      return {
        scope: scope.summary,
        unit: { key: unitKey, label: unitKey, configured: false },
        requests: { total: 0, complete: 0, inProgress: 0 },
        steps: { total: 0, pending: 0, cleared: 0, blocked: 0, waived: 0 },
        recentBlocked: [] as Array<Record<string, unknown>>,
      };
    }

    const stepWhere: Prisma.ClearanceStepWhereInput = {
      unitId: unit.id,
      request: { studentRecord: scope.studentWhere },
    };

    const [requestsTotal, requestsComplete, stepsByStatus, recentBlocked] = await Promise.all([
      this.prisma.clearanceRequest.count({ where: { studentRecord: scope.studentWhere } }),
      this.prisma.clearanceRequest.count({
        where: { studentRecord: scope.studentWhere, isComplete: true },
      }),
      this.prisma.clearanceStep.groupBy({
        by: ['status'],
        where: stepWhere,
        _count: true,
        orderBy: { status: 'asc' },
      }),
      this.prisma.clearanceStep.findMany({
        where: { ...stepWhere, status: 'BLOCKED' },
        orderBy: { signedAt: 'desc' },
        take: 6,
        include: {
          request: {
            include: {
              studentRecord: {
                select: {
                  id: true,
                  matriculationNumber: true,
                  surname: true,
                  firstName: true,
                  programme: { select: { code: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    const stepCount = (status: string) =>
      stepsByStatus.find((g) => g.status === status)?._count ?? 0;

    return {
      scope: scope.summary,
      unit: { key: unit.key, label: unit.label, configured: true },
      requests: {
        total: requestsTotal,
        complete: requestsComplete,
        inProgress: requestsTotal - requestsComplete,
      },
      steps: {
        total: stepsByStatus.reduce((sum, g) => sum + g._count, 0),
        pending: stepCount('PENDING'),
        cleared: stepCount('CLEARED'),
        blocked: stepCount('BLOCKED'),
        waived: stepCount('WAIVED'),
      },
      recentBlocked: recentBlocked.map((s) => ({
        id: s.id,
        note: s.note,
        student: {
          id: s.request.studentRecord.id,
          matriculationNumber: s.request.studentRecord.matriculationNumber,
          fullName: `${s.request.studentRecord.surname} ${s.request.studentRecord.firstName}`,
          programmeCode: s.request.studentRecord.programme?.code ?? null,
        },
      })),
    };
  }

  /**
   * University-wide overview for the registrar and the VC. The two views share
   * this projection; the caller adds their own framing (pending approvals for
   * the registrar; KPIs and alerts for the VC). Student-located figures honour
   * the actor's scope; institution-wide figures (staff, applications, venues)
   * are whole by design for GLOBAL holders.
   */
  async universityOverview(actor: AuthPrincipal, permission: keyof typeof PERMISSIONS) {
    const scope = dashboardScopeFor(actor, PERMISSIONS[permission]);
    const studentWhere = scope.studentWhere;

    const [
      students,
      byStatus,
      staff,
      applications,
      offers,
      registrations,
      results,
      finance,
      graduation,
      clearances,
      transcripts,
      activeHolds,
    ] = await Promise.all([
      this.universityStudents(scope),
      this.prisma.studentRecord.groupBy({
        by: ['studentStatusId'],
        where: studentWhere,
        _count: true,
        orderBy: { studentStatusId: 'asc' },
      }),
      this.prisma.user.groupBy({
        by: ['isActive'],
        where: { userType: 'STAFF' },
        _count: true,
      }),
      this.prisma.application.groupBy({ by: ['status'], _count: true }),
      this.prisma.admissionOffer.groupBy({ by: ['status'], _count: true }),
      this.prisma.registration.groupBy({
        by: ['status'],
        where: { studentRecord: studentWhere },
        _count: true,
        orderBy: { status: 'asc' },
      }),
      this.prisma.resultBatch.groupBy({ by: ['status'], _count: true, orderBy: { status: 'asc' } }),
      this.financeSummary(),
      this.prisma.graduationCandidate.groupBy({
        by: ['status'],
        where: { studentRecord: studentWhere },
        _count: true,
        orderBy: { status: 'asc' },
      }),
      this.prisma.clearanceRequest.groupBy({ by: ['isComplete'], _count: true }),
      this.prisma.transcriptRequest.groupBy({ by: ['status'], _count: true }),
      this.prisma.studentHold.count({
        where: { studentRecord: studentWhere, releasedAt: null },
      }),
    ]);

    return {
      scope: scope.summary,
      students,
      byStatus: await this.labelStatuses(byStatus),
      staff: {
        total: staff.reduce((sum, g) => sum + g._count, 0),
        active: staff.find((g) => g.isActive)?._count ?? 0,
      },
      admissions: {
        applications: applications.map((g) => ({ status: g.status, count: g._count })),
        offers: offers.map((g) => ({ status: g.status, count: g._count })),
      },
      academics: {
        registrations: registrations.map((g) => ({ status: g.status, count: g._count })),
        resultBatches: results.map((g) => ({ status: g.status, count: g._count })),
      },
      finance,
      graduation: {
        candidates: graduation.map((g) => ({ status: g.status, count: g._count })),
        approved: graduation.find((g) => g.status === ('APPROVED' as const))?._count ?? 0,
      },
      clearances: {
        complete: clearances.find((g) => g.isComplete)?._count ?? 0,
        inProgress: clearances.find((g) => !g.isComplete)?._count ?? 0,
      },
      transcripts: {
        byStatus: transcripts.map((g) => ({ status: g.status, count: g._count })),
      },
      alerts: {
        activeHolds,
        pendingResultBatches:
          results
            .filter((g) => g.status === ('DRAFT' as const) || g.status === ('PENDING_APPROVAL' as const))
            .reduce((sum, g) => sum + g._count, 0),
        pendingRegistrations:
          registrations.find((g) => g.status === ('PENDING_APPROVAL' as const))?._count ?? 0,
      },
    };
  }

  // --- helpers ----------------------------------------------------------------

  private async universityStudents(scope: DashboardScope) {
    const [total, byFacultyRaw, byLevelRaw, avgCgpa] = await Promise.all([
      this.prisma.studentRecord.count({ where: scope.studentWhere }),
      this.prisma.studentRecord.groupBy({
        by: ['facultyId'],
        where: scope.studentWhere,
        _count: true,
        orderBy: { facultyId: 'asc' },
      }),
      this.prisma.studentRecord.groupBy({
        by: ['currentLevel'],
        where: scope.studentWhere,
        _count: true,
        orderBy: { currentLevel: 'asc' },
      }),
      this.prisma.semesterGpa.aggregate({
        where: { studentRecord: scope.studentWhere },
        _avg: { cgpa: true },
      }),
    ]);

    const faculties = await this.prisma.faculty.findMany({
      where: { id: { in: byFacultyRaw.map((f) => f.facultyId) } },
      select: { id: true, code: true, name: true },
    });
    const facultyById = new Map(faculties.map((f) => [f.id, f]));

    return {
      total,
      byFaculty: byFacultyRaw.map((f) => ({
        facultyId: f.facultyId,
        name: facultyById.get(f.facultyId)?.name ?? 'Unknown',
        code: facultyById.get(f.facultyId)?.code ?? '—',
        count: f._count,
      })),
      byLevel: byLevelRaw.map((l) => ({ level: l.currentLevel, count: l._count })),
      averageCgpa: avgCgpa._avg.cgpa === null ? null : Number(avgCgpa._avg.cgpa),
    };
  }

  private async labelStatuses(groups: Array<{ studentStatusId: string; _count: number }>) {
    const statuses = await this.prisma.studentStatus.findMany({
      where: { id: { in: groups.map((g) => g.studentStatusId) } },
      select: { id: true, key: true, label: true },
    });
    const byId = new Map(statuses.map((s) => [s.id, s]));
    return groups
      .map((g) => ({
        key: byId.get(g.studentStatusId)?.key ?? 'UNKNOWN',
        label: byId.get(g.studentStatusId)?.label ?? 'Unknown',
        count: g._count,
      }))
      .sort((a, b) => b.count - a.count);
  }

  /** Finance roll-up for the executive views: billed vs received and the
   *  outstanding gap, as kobo digit strings (never floats). */
  private async financeSummary() {
    const groups = await this.prisma.invoice.groupBy({
      by: ['status'],
      _sum: { totalAmount: true, paidAmount: true },
      _count: { _all: true },
    });
    let billed = 0n;
    let received = 0n;
    let invoiceCount = 0;
    for (const g of groups) {
      if (g.status === 'ISSUED' || g.status === 'PARTIALLY_PAID' || g.status === 'PAID') {
        billed += g._sum.totalAmount ?? 0n;
        received += g._sum.paidAmount ?? 0n;
        invoiceCount += g._count._all;
      }
    }
    return {
      invoiceCount,
      byStatus: groups.map((g) => ({
        status: g.status,
        count: g._count._all,
        billed: (g._sum.totalAmount ?? 0n).toString(),
        paid: (g._sum.paidAmount ?? 0n).toString(),
      })),
      billed: billed.toString(),
      received: received.toString(),
      outstanding: (billed - received > 0n ? billed - received : 0n).toString(),
    };
  }
}
