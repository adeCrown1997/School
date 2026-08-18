import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthPrincipal } from '../common/auth-principal';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import { dashboardScopeFor, idFilterOrNone, offeringDepartmentWhere, type IdFilter } from './dashboards.scope';

/**
 * Teaching-load dashboards. A lecturer's world is defined by their
 * CourseAllocations — the authorization input for score entry (§10.2): only
 * offerings allocated to them appear, with class sizes (real enrolment counts,
 * never the stored seatsTaken cache), assessment readiness, score-entry status
 * and upcoming activity computed live. Project/SIWES coordinators instead see
 * the project / industrial-training offerings inside their scope.
 *
 * Every figure is a count or aggregate from the database — nothing is
 * fabricated, and an empty allocation yields an honest zero rather than sample
 * data.
 */
@Injectable()
export class LecturerDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** A lecturer's own teaching overview, keyed to their allocations. */
  async lecturerOverview(actor: AuthPrincipal) {
    const allocations = await this.prisma.courseAllocation.findMany({
      where: { staffUserId: actor.userId },
      include: {
        offering: {
          include: {
            course: {
              select: {
                id: true,
                code: true,
                title: true,
                creditUnits: true,
                level: true,
                category: { select: { key: true, label: true } },
              },
            },
            session: { select: { name: true } },
            semester: { select: { id: true, name: true, sequence: true } },
            department: { select: { code: true, name: true } },
            assessmentComponents: { select: { id: true, weight: true } },
            resultBatches: { select: { status: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const offeringIds = allocations.map((a) => a.offeringId);
    const offeringFilter = idFilterOrNone(offeringIds);

    // Class sizes come from ACTIVE registration lines — the real enrolment
    // figure, not the denormalized seatsTaken cache.
    const [classSizes, scoreStates, submittedOfferings, batchesPending, attendance, upcoming] =
      await Promise.all([
        this.prisma.registrationLine.groupBy({
          by: ['courseOfferingId'],
          where: { courseOfferingId: offeringFilter, state: 'ACTIVE' },
          _count: true,
        }),
        this.prisma.scoreEntry.groupBy({
          by: ['state'],
          where: { component: { offeringId: offeringFilter } },
          _count: true,
        }),
        this.prisma.scoreEntry.findMany({
          where: { component: { offeringId: offeringFilter }, state: 'SUBMITTED' },
          select: { component: { select: { offeringId: true } } },
        }),
        this.prisma.resultBatch.count({
          where: { offeringId: offeringFilter, status: { in: ['DRAFT', 'PENDING_APPROVAL'] } },
        }),
        this.examAttendance(offeringFilter),
        this.upcomingActivity(actor, offeringFilter),
      ]);

    const sizeByOffering = new Map(classSizes.map((c) => [c.courseOfferingId, c._count]));
    const submittedOfferingIds = new Set(submittedOfferings.map((s) => s.component.offeringId));
    const draftScoreEntries =
      scoreStates.find((s) => s.state === 'DRAFT' as const)?._count ?? 0;
    const submittedScoreEntries =
      scoreStates.find((s) => s.state === 'SUBMITTED' as const)?._count ?? 0;

    let totalEnrolled = 0;
    const courses = allocations.map((a) => {
      const o = a.offering;
      const enrolled = sizeByOffering.get(o.id) ?? 0;
      totalEnrolled += enrolled;
      const totalWeight = o.assessmentComponents.reduce((sum, c) => sum + Number(c.weight), 0);
      return {
        offeringId: o.id,
        role: a.role,
        course: o.course,
        session: o.session,
        semester: o.semester,
        department: o.department,
        offeringStatus: o.status,
        capacity: o.capacity,
        enrolled,
        assessment: {
          components: o.assessmentComponents.length,
          totalWeight,
          weightComplete: Math.round(totalWeight) === 100,
        },
        scores: {
          submitted: submittedOfferingIds.has(o.id),
        },
        resultBatchStatus: o.resultBatches[0]?.status ?? null,
      };
    });

    return {
      allocations: {
        count: courses.length,
        totalEnrolled,
        items: courses,
      },
      courseMaterials: courses.map((c) => ({
        offeringId: c.offeringId,
        courseCode: c.course.code,
        courseTitle: c.course.title,
        creditUnits: c.course.creditUnits,
        assessmentDefined: c.assessment.components > 0,
        weightComplete: c.assessment.weightComplete,
      })),
      attendance,
      pendingResults: {
        draftScoreEntries,
        submittedScoreEntries,
        offeringsWithSubmittedScores: submittedOfferingIds.size,
        batchesAwaitingApproval: batchesPending,
      },
      upcoming,
    };
  }

  /**
   * Project/SIWES coordinator overview: the project and industrial-training
   * offerings inside the actor's scope, their enrolment and the registration
   * pipeline around them. The PROJECT / SIWES category keys are the configured
   * vocabulary shipped by the seed; an institution's own categories flow
   * through unchanged.
   */
  async projectOverview(actor: AuthPrincipal) {
    const scope = dashboardScopeFor(actor, PERMISSIONS.DASHBOARD_PROJECT_VIEW);
    const offeringWhere = offeringDepartmentWhere(scope);

    const offerings = await this.prisma.courseOffering.findMany({
      where: {
        ...offeringWhere,
        course: { category: { key: { in: ['PROJECT', 'SIWES'] } } },
      },
      include: {
        course: {
          select: {
            id: true,
            code: true,
            title: true,
            creditUnits: true,
            level: true,
            category: { select: { key: true, label: true } },
          },
        },
        session: { select: { name: true } },
        semester: { select: { id: true, name: true, sequence: true } },
        department: { select: { code: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const offeringIds = offerings.map((o) => o.id);
    const offeringFilter = idFilterOrNone(offeringIds);

    const [enrolment, regByStatus] = await Promise.all([
      this.prisma.registrationLine.groupBy({
        by: ['courseOfferingId'],
        where: { courseOfferingId: offeringFilter, state: 'ACTIVE' },
        _count: true,
      }),
      this.prisma.registration.groupBy({
        by: ['status'],
        where: {
          studentRecord: scope.studentWhere,
          lines: { some: { courseOfferingId: offeringFilter, state: 'ACTIVE' } },
        },
        _count: true,
        orderBy: { status: 'asc' },
      }),
    ]);

    const sizeByOffering = new Map(enrolment.map((e) => [e.courseOfferingId, e._count]));
    let totalEnrolled = 0;
    for (const v of sizeByOffering.values()) totalEnrolled += v;

    return {
      scope: scope.summary,
      offerings: offerings.map((o) => ({
        offeringId: o.id,
        course: o.course,
        session: o.session,
        semester: o.semester,
        department: o.department,
        offeringStatus: o.status,
        capacity: o.capacity,
        enrolled: sizeByOffering.get(o.id) ?? 0,
      })),
      totals: { offerings: offerings.length, totalEnrolled },
      registrationsByStatus: regByStatus.map((r) => ({ status: r.status, count: r._count })),
    };
  }

  /** Exam-hall attendance recorded on the actor's offerings (§12.3). */
  private async examAttendance(offeringFilter: IdFilter) {
    const schedules = await this.prisma.examSchedule.findMany({
      where: { offeringId: offeringFilter },
      include: {
        offering: { select: { course: { select: { code: true, title: true } } } },
        venue: { select: { name: true, code: true } },
        period: { select: { name: true } },
        attendances: { select: { id: true, status: true } },
      },
      orderBy: { startsAt: 'asc' },
      take: 20,
    });
    const now = new Date();
    return {
      schedules: schedules.map((s) => ({
        id: s.id,
        course: s.offering.course,
        venue: s.venue,
        period: s.period.name,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        attendance: {
          recorded: s.attendances.length,
          present: s.attendances.filter((a) => a.status === 'PRESENT').length,
          absent: s.attendances.filter((a) => a.status === 'ABSENT').length,
        },
        isUpcoming: s.startsAt > now,
      })),
      upcoming: schedules.filter((s) => s.startsAt > now).length,
    };
  }

  /** Upcoming academic activity: open and next calendar windows in the actor's
   *  scope (department-level windows, or university-wide ones), plus the next
   *  exams on their offerings. */
  private async upcomingActivity(
    actor: AuthPrincipal,
    offeringFilter: IdFilter,
  ) {
    const scope = dashboardScopeFor(actor, PERMISSIONS.DASHBOARD_LECTURER_VIEW);
    const now = new Date();

    const windowScopes: Prisma.CalendarWindowWhereInput['OR'] = [{ scopeType: 'GLOBAL' }];
    if (scope.constraint.facultyIds.length) {
      windowScopes.push({ facultyId: { in: scope.constraint.facultyIds } });
    }
    if (scope.constraint.departmentIds.length) {
      windowScopes.push({ departmentId: { in: scope.constraint.departmentIds } });
    }

    const [windows, nextExams] = await Promise.all([
      this.prisma.calendarWindow.findMany({
        where: { isActive: true, closesAt: { gte: now }, OR: windowScopes },
        include: {
          session: { select: { name: true } },
          semester: { select: { name: true } },
        },
        orderBy: { opensAt: 'asc' },
        take: 8,
      }),
      this.prisma.examSchedule.findMany({
        where: { offeringId: offeringFilter, startsAt: { gte: now } },
        include: {
          offering: { select: { course: { select: { code: true, title: true } } } },
          venue: { select: { code: true, name: true } },
        },
        orderBy: { startsAt: 'asc' },
        take: 5,
      }),
    ]);

    return {
      windows: windows.map((w) => ({
        id: w.id,
        windowType: w.windowType,
        opensAt: w.opensAt,
        closesAt: w.closesAt,
        session: w.session.name,
        semester: w.semester?.name ?? null,
        isOpenNow: w.opensAt <= now && w.closesAt >= now,
      })),
      exams: nextExams.map((e) => ({
        id: e.id,
        course: e.offering.course,
        venue: e.venue,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
      })),
    };
  }
}
