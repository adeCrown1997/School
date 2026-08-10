'use client';

/**
 * Administrative dashboard. All figures are fetched live from
 * `GET /dashboards/admin` — nothing here is hardcoded or fabricated. The values
 * are already scope-limited by the API to the records this admin may see, and
 * the `scope` block tells the user whether they are viewing the whole
 * institution or a restricted slice.
 *
 * A student who lands here is redirected to their own dashboard; a staff member
 * lacking DASHBOARD_ADMIN_VIEW sees an access notice (the API would 403 anyway).
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { AdminOverview } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Spinner, StatusBadge } from '@/components/ui';

export default function DashboardPage() {
  const { me } = useSession();
  const router = useRouter();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = can(me?.permissions, PERMISSIONS.DASHBOARD_ADMIN_VIEW);

  useEffect(() => {
    // Students have their own dashboard.
    if (me && me.userType === 'STUDENT' && !isAdmin) {
      router.replace('/student');
      return;
    }
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<AdminOverview>('/dashboards/admin');
        if (!cancelled) setData(res);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof ApiError ? err.message : 'Failed to load the dashboard.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [me, isAdmin, router]);

  if (loading) return <Spinner label="Loading dashboard…" />;
  if (!isAdmin || forbidden) return <AccessNotice />;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return null;

  const { students, staff, changeRequests, scope } = data;

  return (
    <>
      <PageHeader
        title={`Welcome, ${me?.fullName?.split(' ')[0] ?? ''}`}
        description="Live figures from the student master database."
      />

      {!scope.unrestricted ? (
        <div className="mb-4">
          <Alert kind="info">
            You are viewing a scoped subset of records based on your role assignments. Institution-wide
            totals may be larger.
          </Alert>
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Students" value={students.total} />
        <Stat label="Pending change requests" value={changeRequests.pending} />
        <Stat label="Staff accounts" value={staff.total} />
        <Stat label="Active staff" value={staff.active} />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Students by activation state</h2>
          <ul className="space-y-2">
            {Object.entries(students.byActivationState).map(([state, count]) => (
              <li key={state} className="flex items-center justify-between text-sm">
                <StatusBadge state={state} />
                <span className="font-semibold tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Students by status</h2>
          {students.byStatus.length ? (
            <ul className="space-y-2">
              {students.byStatus.map((s) => (
                <li key={s.key} className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">{s.label}</span>
                  <span className="font-semibold tabular-nums">{s.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">No records yet.</p>
          )}
        </div>

        <div className="card p-5 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Students by faculty</h2>
          {students.byFaculty.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="pb-2 font-medium">Faculty</th>
                    <th className="pb-2 font-medium">Code</th>
                    <th className="pb-2 text-right font-medium">Students</th>
                  </tr>
                </thead>
                <tbody>
                  {students.byFaculty.map((f) => (
                    <tr key={f.facultyId} className="border-t border-slate-100">
                      <td className="py-2 text-slate-700">{f.name}</td>
                      <td className="py-2 text-slate-500">{f.code}</td>
                      <td className="py-2 text-right font-semibold tabular-nums">{f.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-400">No records yet.</p>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}
