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
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { AdminOverview } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, BreakdownRow, Spinner, StatCard, StatusBadge } from '@/components/ui';
import { FileTextIcon, GraduationCapIcon, ShieldCheckIcon, UsersIcon } from '@/components/icons';

const ACTIVATION_TONES: Record<string, string> = {
  ACTIVATED: 'bg-emerald-500',
  PENDING: 'bg-amber-500',
  LOCKED: 'bg-red-500',
};

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
  const activationEntries = Object.entries(students.byActivationState);
  const activationTotal = activationEntries.reduce((s, [, n]) => s + n, 0);
  const statusTotal = students.byStatus.reduce((s, x) => s + x.count, 0);
  const facultyMax = students.byFaculty.reduce((m, f) => Math.max(m, f.count), 0);

  return (
    <>
      <PageHeader
        title={`Welcome, ${me?.fullName?.split(' ')[0] ?? ''}`}
        description="Live figures from the student master database."
      />

      {!scope.unrestricted ? (
        <div className="mb-6">
          <Alert kind="info">
            You are viewing a scoped subset of records based on your role assignments.
            Institution-wide totals may be larger.
          </Alert>
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Students"
          value={students.total}
          icon={<GraduationCapIcon size={20} />}
          tone="brand"
        />
        <StatCard
          label="Pending change requests"
          value={changeRequests.pending}
          icon={<FileTextIcon size={20} />}
          tone="amber"
        />
        <StatCard label="Staff accounts" value={staff.total} icon={<UsersIcon size={20} />} tone="violet" />
        <StatCard
          label="Active staff"
          value={staff.active}
          icon={<ShieldCheckIcon size={20} />}
          tone="emerald"
        />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card animate-fade-up p-6" aria-labelledby="dash-activation">
          <h2 id="dash-activation" className="card-title">
            Students by activation state
          </h2>
          <p className="card-subtitle">Whether the student account has been activated.</p>
          <ul className="mt-5 space-y-4">
            {activationEntries.map(([state, count]) => (
              <BreakdownRow
                key={state}
                label={state}
                count={count}
                total={activationTotal}
                barClass={ACTIVATION_TONES[state] ?? 'bg-slate-400'}
                badge={<StatusBadge state={state} />}
              />
            ))}
          </ul>
        </section>

        <section className="card animate-fade-up p-6" aria-labelledby="dash-status">
          <h2 id="dash-status" className="card-title">
            Students by status
          </h2>
          <p className="card-subtitle">The academic lifecycle status of each record.</p>
          {students.byStatus.length ? (
            <ul className="mt-5 space-y-4">
              {students.byStatus.map((s, i) => (
                <BreakdownRow
                  key={s.key}
                  label={s.label}
                  count={s.count}
                  total={statusTotal}
                  barClass={['bg-brand-500', 'bg-brand-300', 'bg-slate-300'][i % 3]}
                />
              ))}
            </ul>
          ) : (
            <p className="mt-5 text-sm text-slate-400">No records yet.</p>
          )}
        </section>

        <section className="card animate-fade-up p-6 lg:col-span-2" aria-labelledby="dash-faculty">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 id="dash-faculty" className="card-title">
                Students by faculty
              </h2>
              <p className="card-subtitle">Distribution across the university&apos;s faculties.</p>
            </div>
          </div>
          {students.byFaculty.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                    <th className="pb-2.5 font-semibold">Faculty</th>
                    <th className="pb-2.5 font-semibold">Code</th>
                    <th className="w-1/3 pb-2.5 font-semibold">Distribution</th>
                    <th className="pb-2.5 text-right font-semibold">Students</th>
                  </tr>
                </thead>
                <tbody>
                  {students.byFaculty.map((f) => (
                    <tr key={f.facultyId} className="border-t border-slate-100">
                      <td className="py-3 pr-4 font-medium text-slate-800">{f.name}</td>
                      <td className="py-3 pr-4 text-slate-500">{f.code}</td>
                      <td className="py-3 pr-4">
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                          <div
                            className="h-full rounded-full bg-brand-500 transition-all duration-500"
                            style={{ width: facultyMax ? `${(f.count / facultyMax) * 100}%` : '0%' }}
                          />
                        </div>
                      </td>
                      <td className="py-3 text-right font-semibold tabular-nums text-slate-900">
                        {f.count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-5 text-sm text-slate-400">No records yet.</p>
          )}
        </section>
      </div>

      {can(me?.permissions, PERMISSIONS.STUDENTS_VIEW) ? (
        <div className="mt-6 card flex flex-wrap items-center justify-between gap-3 p-5 animate-fade-up">
          <p className="text-sm text-slate-600">
            Need to find or add a student? The register has search, filters and bulk import.
          </p>
          <div className="flex gap-2">
            {can(me?.permissions, PERMISSIONS.STUDENTS_CREATE) ? (
              <Link href="/students/new" className="btn-secondary">
                New student
              </Link>
            ) : null}
            <Link href="/students" className="btn-primary">
              Open student register
            </Link>
          </div>
        </div>
      ) : null}
    </>
  );
}
