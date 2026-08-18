import { Prisma } from '@prisma/client';
import { AuthPrincipal } from '../common/auth-principal';
import { PermissionKey } from '../rbac/permissions.catalog';
import { scopeConstraintFor, ScopeConstraint, studentScopeWhere } from '../rbac/scope.util';

/**
 * Shared scoping plumbing for the role dashboards. Every dashboard figure that
 * touches student-located data (students, registrations, offerings, invoices,
 * exam cards, …) is constrained to the records inside the actor's scope for
 * the underlying MODULE permission — the same authority set the module's own
 * endpoints enforce — so a department-scoped dashboard shows exactly what its
 * holder may see in the module, and nothing more.
 *
 * Fail-closed posture: holding the permission at no usable scope yields a
 * match-nothing filter (see studentScopeWhere), never an empty filter.
 */

/** A UUID guaranteed to exist nowhere; used to build match-nothing filters. */
export const NO_MATCHING_ID = '00000000-0000-0000-0000-000000000000';

/**
 * A structural id filter usable on any uuid-keyed model (`offeringId: x`). It is
 * a subset of Prisma's generated `UuidFilter<Model>` / `StringFilter<Model>`,
 * so it assigns into any model's `where` clause without model-specific typing.
 */
export type IdFilter = { in: string[] } | string;

/** An `id` filter that selects a known list, or matches nothing if it is empty. */
export function idFilterOrNone(ids: string[]): IdFilter {
  return ids.length ? { in: ids } : NO_MATCHING_ID;
}
export interface DashboardScope {
  constraint: ScopeConstraint;
  /** Prisma `where` fragment for StudentRecord, scoped to the actor. */
  studentWhere: Prisma.StudentRecordWhereInput;
  /** True when the actor sees the whole institution (GLOBAL grant). */
  unrestricted: boolean;
  /** The scope summary echoed to the client for display. */
  summary: {
    unrestricted: boolean;
    facultyIds: string[];
    departmentIds: string[];
    programmeIds: string[];
  };
}

/** Resolve the actor's dashboard scope from a module permission. */
export function dashboardScopeFor(
  actor: AuthPrincipal,
  permission: PermissionKey,
): DashboardScope {
  const constraint = scopeConstraintFor(actor, permission);
  const scopeWhere = studentScopeWhere(constraint) as Prisma.StudentRecordWhereInput | undefined;
  return {
    constraint,
    studentWhere: scopeWhere ?? {},
    unrestricted: constraint.unrestricted,
    summary: {
      unrestricted: constraint.unrestricted,
      facultyIds: constraint.facultyIds,
      departmentIds: constraint.departmentIds,
      programmeIds: constraint.programmeIds,
    },
  };
}

/**
 * A `where` fragment for models that reach a student through a relation
 * (Registration, Invoice, PaymentIntent, ExamCard, GraduationCandidate, …).
 * When the actor is unrestricted the fragment stays empty.
 */
export function viaStudentWhere(
  scope: DashboardScope,
): Prisma.StudentRecordWhereInput {
  return scope.studentWhere;
}

/** A match-nothing offering filter, used when a scope carries no usable ids. */
const NO_MATCHING_OFFERING: Prisma.CourseOfferingWhereInput = {
  id: NO_MATCHING_ID,
};

/**
 * A `where` fragment for CourseOffering located through its teaching department.
 * University-wide offerings (departmentId null, e.g. General Studies) belong to
 * no faculty or department, so a scoped actor never sees them — only a GLOBAL
 * holder does (fail closed, mirroring assertDepartmentWithinScope).
 */
export function offeringDepartmentWhere(
  scope: DashboardScope,
): Prisma.CourseOfferingWhereInput {
  if (scope.unrestricted) return {};

  const or: Prisma.CourseOfferingWhereInput[] = [];
  if (scope.constraint.facultyIds.length) {
    or.push({ department: { facultyId: { in: scope.constraint.facultyIds } } });
  }
  if (scope.constraint.departmentIds.length) {
    or.push({ departmentId: { in: scope.constraint.departmentIds } });
  }
  if (scope.constraint.programmeIds.length) {
    // Programme scope reaches an offering through its owning department's
    // programme set.
    or.push({
      department: { programmes: { some: { id: { in: scope.constraint.programmeIds } } } },
    });
  }
  if (or.length === 0) return NO_MATCHING_OFFERING;
  return { OR: or };
}
