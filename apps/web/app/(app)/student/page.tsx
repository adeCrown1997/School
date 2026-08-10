'use client';

/**
 * Student self-dashboard. Fetched from `GET /dashboards/me` — a read-only summary
 * of the caller's OWN official record plus a breakdown of their change requests.
 * Everything shown here is owned by the university; nothing on this page is
 * editable (identity corrections go through "My change requests").
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { StudentOverview } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Labeled, Spinner, StatusBadge } from '@/components/ui';

export default function StudentDashboardPage() {
  const { me } = useSession();
  const [data, setData] = useState<StudentOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<StudentOverview>('/dashboards/me');
        if (!cancelled) setData(res);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof ApiError ? err.message : 'Failed to load your dashboard.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Spinner label="Loading your dashboard…" />;
  if (forbidden)
    return <AccessNotice message="This dashboard is only available to a student account." />;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return null;

  const r = data.record;
  const fullName = [r.surname, r.firstName, r.otherNames].filter(Boolean).join(' ');

  return (
    <>
      <PageHeader
        title={`Hello, ${r.firstName}`}
        description="Your official record, as held by the university."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Student record</h2>
            <StatusBadge state={r.activationState} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Labeled label="Full name" protectedField>
              {fullName}
            </Labeled>
            <Labeled label="Matriculation number" protectedField>
              {r.matriculationNumber}
            </Labeled>
            <Labeled label="Student ID" protectedField>
              {r.studentId}
            </Labeled>
            <Labeled label="Level" protectedField>
              {r.currentLevel}
            </Labeled>
            <Labeled label="Faculty" protectedField>
              {r.faculty?.name ?? '—'}
            </Labeled>
            <Labeled label="Department" protectedField>
              {r.department?.name ?? '—'}
            </Labeled>
            <Labeled label="Programme" protectedField>
              {r.programme ? `${r.programme.name} (${r.programme.award})` : '—'}
            </Labeled>
            <Labeled label="Admission session" protectedField>
              {r.admissionSession?.name ?? '—'}
            </Labeled>
            <Labeled label="Academic status" protectedField>
              {r.studentStatus?.label ?? '—'}
            </Labeled>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            These details are managed by the university. To request a correction to a personal detail
            (e.g. a misspelt name), open a change request.
          </p>
        </div>

        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">My change requests</h2>
          <ul className="space-y-2">
            {Object.entries(data.changeRequests).map(([status, count]) => (
              <li key={status} className="flex items-center justify-between text-sm">
                <StatusBadge state={status} />
                <span className="font-semibold tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 space-y-2">
            <Link href="/me/profile" className="btn-secondary w-full">
              View my profile
            </Link>
            <Link href="/me/change-requests" className="btn-primary w-full">
              Request a correction
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
