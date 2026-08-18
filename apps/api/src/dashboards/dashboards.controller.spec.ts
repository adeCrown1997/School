import 'reflect-metadata';
import { PermissionsGuard } from '../auth/permissions.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import { DashboardsController } from './dashboards.controller';

/**
 * Route-authorization matrix for the dashboard endpoints. The controller is the
 * backend authorization boundary: every role endpoint must carry its own
 * @RequirePermissions guard key, the class must run JwtAuthGuard +
 * PermissionsGuard, and the open `/me` endpoint must carry none. Reading the
 * emitted metadata directly verifies what the PermissionsGuard will enforce at
 * request time for EVERY dashboard route.
 */
function requiredFor(method: string): readonly string[] | undefined {
  return Reflect.getMetadata('requiredPermissions', (DashboardsController as never)[method]);
}

function routePath(method: string): string {
  return Reflect.getMetadata('path', (DashboardsController as never)[method]);
}

describe('DashboardsController authorization', () => {
  const classGuards: unknown[] = Reflect.getMetadata('__guards__', DashboardsController) ?? [];

  it('serves everything under the /dashboards controller prefix', () => {
    expect(Reflect.getMetadata('path', DashboardsController)).toBe('dashboards');
  });

  it('runs the JWT and permissions guards on every route', () => {
    expect(classGuards).toContain(JwtAuthGuard);
    expect(classGuards).toContain(PermissionsGuard);
  });

  it.each([
    ['admin', 'admin', PERMISSIONS.DASHBOARD_ADMIN_VIEW],
    ['lecturer', 'lecturer', PERMISSIONS.DASHBOARD_LECTURER_VIEW],
    ['adviser', 'adviser', PERMISSIONS.DASHBOARD_ADVISER_VIEW],
    ['department', 'department', PERMISSIONS.DASHBOARD_HOD_VIEW],
    ['faculty', 'faculty', PERMISSIONS.DASHBOARD_FACULTY_VIEW],
    ['bursar', 'bursar', PERMISSIONS.DASHBOARD_BURSAR_VIEW],
    ['registry', 'registry', PERMISSIONS.DASHBOARD_REGISTRY_VIEW],
    ['admissions', 'admissions', PERMISSIONS.DASHBOARD_ADMISSIONS_VIEW],
    ['exams', 'exams', PERMISSIONS.DASHBOARD_EXAMS_VIEW],
    ['library', 'library', PERMISSIONS.DASHBOARD_LIBRARY_VIEW],
    ['studentAffairs', 'student-affairs', PERMISSIONS.DASHBOARD_AFFAIRS_VIEW],
    ['hostel', 'hostel', PERMISSIONS.DASHBOARD_HOSTEL_VIEW],
    ['project', 'project', PERMISSIONS.DASHBOARD_PROJECT_VIEW],
    ['registrar', 'registrar', PERMISSIONS.DASHBOARD_REGISTRAR_VIEW],
    ['viceChancellor', 'vice-chancellor', PERMISSIONS.DASHBOARD_VC_VIEW],
  ])('%s requires exactly %s', (method, path, permission) => {
    expect(routePath(method)).toBe(path);
    expect(requiredFor(method)).toEqual([permission]);
  });

  it('keeps the student self-overview authenticated-only (ownership-bound)', () => {
    expect(requiredFor('me')).toBeUndefined();
  });

  it('every dashboard permission in the catalog keys a guarded role route', () => {
    const guarded = new Set(
      [
        'admin',
        'lecturer',
        'adviser',
        'department',
        'faculty',
        'bursar',
        'registry',
        'admissions',
        'exams',
        'library',
        'studentAffairs',
        'hostel',
        'project',
        'registrar',
        'viceChancellor',
      ].map((m) => requiredFor(m)?.[0]),
    );
    const dashboardKeys = Object.values(PERMISSIONS).filter((k) => k.startsWith('dashboard.'));
    for (const key of dashboardKeys) {
      expect(guarded.has(key)).toBe(true);
    }
  });
});
