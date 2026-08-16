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
import type { StudentOverview } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Labeled, Spinner, StatusBadge } from '@/components/ui';
import {
  ClipboardListIcon,
  FileTextIcon,
  GraduationCapIcon,
  UserIcon,
} from '@/components/icons';

export default function StudentDashboardPage() {
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
  const initials = [r.firstName, r.surname].filter(Boolean).map((w) => w[0]?.toUpperCase()).join('');

  return (
    <>
      <PageHeader
        title={`Hello, ${r.firstName}`}
        description="Your official record, as held by the university."
      />

      {/* Identity summary card */}
      <section
        className="card mb-6 animate-fade-up overflow-hidden"
        aria-labelledby="student-id-card"
      >
        <div className="bg-gradient-to-r from-brand-700 to-brand-600 px-6 py-5">
          <div className="flex flex-wrap items-center gap-4">
            <span
              aria-hidden
              className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 text-lg font-bold text-white ring-1 ring-white/20"
            >
              {initials || '•'}
            </span>
            <div className="min-w-0">
              <h2 id="student-id-card" className="font-display text-lg font-bold text-white">
                {fullName}
              </h2>
              <p className="truncate text-sm text-brand-100">
                {r.matriculationNumber}
                {r.programme ? ` · ${r.programme.award}` : ''}
              </p>
            </div>
            <div className="ml-auto">
              <StatusBadge state={r.activationState} />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 px-6 py-6 md:grid-cols-3">
          <Labeled label="Student ID" protectedField>
            {r.studentId}
          </Labeled>
          <Labeled label="Matriculation number" protectedField>
            {r.matriculationNumber}
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
        <p className="border-t border-slate-100 px-6 py-4 text-xs leading-5 text-slate-500">
          These details are managed by the university. To request a correction to a personal detail
          (e.g. a misspelt name), open a change request.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Change requests */}
        <section className="card animate-fade-up p-6" aria-labelledby="dash-cr">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600"
            >
              <ClipboardListIcon size={20} />
            </span>
            <div>
              <h2 id="dash-cr" className="card-title">
                My change requests
              </h2>
              <p className="card-subtitle">Corrections you have asked the registry to make.</p>
            </div>
          </div>
          <ul className="mt-5 space-y-3">
            {Object.entries(data.changeRequests).map(([status, count]) => (
              <li key={status} className="flex items-center justify-between text-sm">
                <StatusBadge state={status} />
                <span className="font-semibold tabular-nums text-slate-900">{count}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Quick actions */}
        <section className="card animate-fade-up p-6" aria-labelledby="dash-actions">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"
            >
              <GraduationCapIcon size={20} />
            </span>
            <div>
              <h2 id="dash-actions" className="card-title">
                Quick actions
              </h2>
              <p className="card-subtitle">The things you do most often, one tap away.</p>
            </div>
          </div>
          <div className="mt-5 space-y-2.5">
            <Link href="/student/registration" className="btn-primary w-full justify-between">
              <span className="flex items-center gap-2">
                <GraduationCapIcon size={16} /> Course registration
              </span>
            </Link>
            <Link href="/me/profile" className="btn-secondary w-full justify-between">
              <span className="flex items-center gap-2">
                <UserIcon size={16} /> View my profile
              </span>
            </Link>
            <Link href="/me/change-requests" className="btn-secondary w-full justify-between">
              <span className="flex items-center gap-2">
                <FileTextIcon size={16} /> Request a correction
              </span>
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
