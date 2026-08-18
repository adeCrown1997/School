'use client';

/**
 * Staff result-batch list (docs/03 §10.4). Shows every batch within the
 * caller's scope with its lifecycle position; opens into the review page where
 * approval stages and dual-control publication happen. View requires
 * results.view — the list is the reviewer's entry point.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { AcademicSession, ResultBatchListItem, Semester } from '@/lib/types';
import { PageHeader, AccessNotice, EmptyState } from '@/components/page';
import { Alert, Spinner, StatusBadge } from '@/components/ui';

const STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'SENATE_RATIFIED', 'PUBLISHED', 'REJECTED'] as const;

export default function ResultBatchesPage() {
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.RESULTS_VIEW);

  const [rows, setRows] = useState<ResultBatchListItem[]>([]);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [semesterId, setSemesterId] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!canView) return;
    api.get<AcademicSession[]>('/structure/sessions').then(setSessions).catch(() => setSessions([]));
  }, [canView]);

  useEffect(() => {
    if (!canView || !sessionId) {
      setSemesters([]);
      return;
    }
    api
      .get<Semester[]>(`/structure/semesters?sessionId=${sessionId}`)
      .then(setSemesters)
      .catch(() => setSemesters([]));
  }, [canView, sessionId]);

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (sessionId) params.set('sessionId', sessionId);
    if (semesterId) params.set('semesterId', semesterId);
    if (status) params.set('status', status);
    try {
      const res = await api.get<ResultBatchListItem[]>(`/results/batches?${params.toString()}`);
      setRows(res);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load result batches.');
    } finally {
      setLoading(false);
    }
  }, [canView, sessionId, semesterId, status]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canView) return <AccessNotice />;

  const pending = rows.filter((r) => r.status === 'PENDING_APPROVAL').length;
  const ratified = rows.filter((r) => r.status === 'SENATE_RATIFIED').length;

  return (
    <>
      <PageHeader
        title="Result batches"
        description="One batch per course offering moves through approval to dual-control publication."
        actions={
          can(me?.permissions, PERMISSIONS.RESULTS_WITHHOLD) ? (
            <Link href="/results/withholdings" className="btn-secondary">
              Withholdings
            </Link>
          ) : null
        }
      />

      {error ? (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      <div className="card mb-6 p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label htmlFor="f-session" className="label">
              Session
            </label>
            <select
              id="f-session"
              className="input"
              value={sessionId}
              onChange={(e) => {
                setSessionId(e.target.value);
                setSemesterId('');
              }}
            >
              <option value="">All sessions</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-semester" className="label">
              Semester
            </label>
            <select
              id="f-semester"
              className="input"
              value={semesterId}
              onChange={(e) => setSemesterId(e.target.value)}
              disabled={!sessionId}
            >
              <option value="">All semesters</option>
              {semesters.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-status" className="label">
              Status
            </label>
            <select id="f-status" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading batches…" />
      ) : rows.length === 0 ? (
        <EmptyState title="No result batches found">
          Batches are opened from the score-entry page once an offering&apos;s scores are complete.
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-4 py-3 font-medium">Course</th>
                <th className="px-4 py-3 font-medium">Session · Semester</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Grades</th>
                <th className="px-4 py-3 font-medium">Updated</th>
                <th className="px-4 py-3" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-800">{b.offering.course.code}</span>
                    <span className="block max-w-[16rem] truncate text-xs text-slate-500">
                      {b.offering.course.title}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {b.session.name} · {b.offering.semester.name}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge state={b.status} />
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{b._count.gradeRecords}</td>
                  <td className="px-4 py-3 text-xs tabular-nums text-slate-500">
                    {b.publishedAt
                      ? new Date(b.publishedAt).toLocaleString()
                      : b.submittedAt
                        ? new Date(b.submittedAt).toLocaleString()
                        : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/results/batches/${b.id}`} className="btn-secondary">
                      {b.status === 'PENDING_APPROVAL'
                        ? 'Review'
                        : b.status === 'SENATE_RATIFIED'
                          ? 'Publish'
                          : 'Open'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && rows.length > 0 ? (
        <p className="mt-3 text-xs text-slate-500">
          {rows.length} batch(es) · {pending} awaiting approval · {ratified} ratified, awaiting publication
        </p>
      ) : null}
    </>
  );
}
