import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ActivationState, ChangeRequestStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthPrincipal } from '../common/auth-principal';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import { scopeConstraintFor, studentScopeWhere } from '../rbac/scope.util';

/**
 * Dashboard metrics. Every value returned here is COMPUTED FROM THE DATABASE on
 * each request — nothing is fabricated, cached, or hardcoded. The administrative
 * overview is SCOPE-AWARE: student figures are constrained to the records the
 * caller is authorised to see (via their DASHBOARD_ADMIN_VIEW scope), so a
 * faculty-scoped admin never sees counts for records outside their remit. The
 * student overview is OWNERSHIP-bound to the caller's own linked record.
 */
@Injectable()
export class DashboardsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Administrative overview. Student-identity figures are limited to the caller's
   * scope for DASHBOARD_ADMIN_VIEW; organisation-wide staff figures (which carry
   * no student identity) are reported in full for holders of the permission.
   */
  async adminOverview(actor: AuthPrincipal) {
    const constraint = scopeConstraintFor(actor, PERMISSIONS.DASHBOARD_ADMIN_VIEW);
    const scopeWhere = studentScopeWhere(constraint) as Prisma.StudentRecordWhereInput | undefined;
    const studentWhere: Prisma.StudentRecordWhereInput = scopeWhere ?? {};

    // Pending change requests, limited to the same student scope.
    const changeRequestWhere: Prisma.ProfileChangeRequestWhereInput = {
      status: ChangeRequestStatus.PENDING,
    };
    if (scopeWhere) changeRequestWhere.studentRecord = scopeWhere;

    // Aggregates computed concurrently. groupBy keeps precise per-call typing
    // when awaited directly (a raw $transaction tuple widens _count).
    const [studentsTotal, byActivation, byStatusRaw, byFacultyRaw, staffTotal, staffActive] =
      await Promise.all([
        this.prisma.studentRecord.count({ where: studentWhere }),
        this.prisma.studentRecord.groupBy({
          by: ['activationState'],
          where: studentWhere,
          _count: true,
          orderBy: { activationState: 'asc' },
        }),
        this.prisma.studentRecord.groupBy({
          by: ['studentStatusId'],
          where: studentWhere,
          _count: true,
          orderBy: { studentStatusId: 'asc' },
        }),
        this.prisma.studentRecord.groupBy({
          by: ['facultyId'],
          where: studentWhere,
          _count: true,
          orderBy: { facultyId: 'asc' },
        }),
        this.prisma.user.count({ where: { userType: 'STAFF' } }),
        this.prisma.user.count({ where: { userType: 'STAFF', isActive: true } }),
      ]);

    const pendingChangeRequests = await this.prisma.profileChangeRequest.count({
      where: changeRequestWhere,
    });

    // Zero-fill every activation state so the client always sees the full set.
    const studentsByActivationState = Object.fromEntries(
      Object.values(ActivationState).map((state) => [
        state,
        byActivation.find((r) => r.activationState === state)?._count ?? 0,
      ]),
    ) as Record<ActivationState, number>;

    // Attach human labels to status/faculty breakdowns via a follow-up lookup.
    const statuses = await this.prisma.studentStatus.findMany({
      where: { id: { in: byStatusRaw.map((r) => r.studentStatusId) } },
      select: { id: true, key: true, label: true },
    });
    const statusById = new Map(statuses.map((s) => [s.id, s]));
    const studentsByStatus = byStatusRaw
      .map((r) => ({
        key: statusById.get(r.studentStatusId)?.key ?? 'UNKNOWN',
        label: statusById.get(r.studentStatusId)?.label ?? 'Unknown',
        count: r._count,
      }))
      .sort((a, b) => b.count - a.count);

    const faculties = await this.prisma.faculty.findMany({
      where: { id: { in: byFacultyRaw.map((r) => r.facultyId) } },
      select: { id: true, name: true, code: true },
    });
    const facultyById = new Map(faculties.map((f) => [f.id, f]));
    const studentsByFaculty = byFacultyRaw
      .map((r) => ({
        facultyId: r.facultyId,
        name: facultyById.get(r.facultyId)?.name ?? 'Unknown',
        code: facultyById.get(r.facultyId)?.code ?? '—',
        count: r._count,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      scope: {
        unrestricted: constraint.unrestricted,
        facultyIds: constraint.facultyIds,
        departmentIds: constraint.departmentIds,
        programmeIds: constraint.programmeIds,
      },
      students: {
        total: studentsTotal,
        byActivationState: studentsByActivationState,
        byStatus: studentsByStatus,
        byFaculty: studentsByFaculty,
      },
      changeRequests: { pending: pendingChangeRequests },
      staff: { total: staffTotal, active: staffActive },
    };
  }

  /**
   * A student's own snapshot: their read-only master-record summary plus a
   * breakdown of their change requests by status. Ownership-bound — refuses any
   * caller without a linked student record.
   */
  async studentOverview(actor: AuthPrincipal) {
    if (!actor.studentRecordId) {
      throw new ForbiddenException('This dashboard is only available to a student account');
    }
    const recordId = actor.studentRecordId;

    const record = await this.prisma.studentRecord.findUnique({
      where: { id: recordId },
      select: {
        studentId: true,
        matriculationNumber: true,
        surname: true,
        firstName: true,
        otherNames: true,
        currentLevel: true,
        activationState: true,
        faculty: { select: { name: true, code: true } },
        department: { select: { name: true, code: true } },
        programme: { select: { name: true, code: true, award: true, durationYears: true } },
        admissionSession: { select: { name: true } },
        studentStatus: { select: { key: true, label: true } },
      },
    });
    if (!record) throw new NotFoundException('Student record not found');

    const crRaw = await this.prisma.profileChangeRequest.groupBy({
      by: ['status'],
      where: { studentRecordId: recordId },
      _count: true,
      orderBy: { status: 'asc' },
    });
    const changeRequests = Object.fromEntries(
      Object.values(ChangeRequestStatus).map((status) => [
        status,
        crRaw.find((r) => r.status === status)?._count ?? 0,
      ]),
    ) as Record<ChangeRequestStatus, number>;

    return { record, changeRequests };
  }
}
