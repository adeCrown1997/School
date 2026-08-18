'use client';

/**
 * Result withholdings (docs/03 §10.7). A withholding is an explicit, reversible,
 * REASONED block on a student's results — never a silent deletion. Placing and
 * releasing require results.withhold. Releasing one's OWN withholding requires a
 * note (the API insists) so the audit trail explains the reversal.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { StudentRecord, WithholdingItem } from '@/lib/types';
import { PageHeader, AccessNotice, EmptyState } from '@/components/page';
import { Alert, Spinner, StatusBadge } from '@/components/ui';

export default function WithholdingsPage() {
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.RESULTS_VIEW);
  const canWithhold = can(me?.permissions, PERMISSIONS.RESULTS_WITHHOLD);

  const [rows, setRows] = useState<WithholdingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [includeReleased, setIncludeReleased] = useState(false);

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const q = includeReleased ? '?includeReleased=true' : '';
      setRows(await api.get<WithholdingItem[]>(`/results/withholdings${q}`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load withholdings.');
    } finally {
      setLoading(false);
    }
  }, [canView, includeReleased]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canView) return <AccessNotice />;

  return (
    <>
      <PageHeader
        title="Result withholdings"
        description="Explicit, reasoned blocks on a student's results. The student is told the reason — a result is never just missing."
        actions={
          <Link href="/results/batches" className="btn-secondary">
            Back to batches
          </Link>
        }
      />

      {error ? (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}
      {success ? (
        <div className="mb-4">
          <Alert kind="success">{success}</Alert>
        </div>
      ) : null}

      {canWithhold ? (
        <PlaceWithholding
          onPlaced={async (msg) => {
            setSuccess(msg);
            setError(null);
            await load();
          }}
        />
      ) : null}

      <label className="mb-3 mt-4 flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={includeReleased}
          onChange={(e) => setIncludeReleased(e.target.checked)}
        />
        Include released withholdings
      </label>

      {loading ? (
        <Spinner label="Loading withholdings…" />
      ) : rows.length === 0 ? (
        <EmptyState title="No withholdings">
          {includeReleased ? 'Nothing — active or released.' : 'No active withholdings right now.'}
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-4 py-3 font-medium">Student</th>
                <th className="px-4 py-3 font-medium">Scope</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Placed</th>
                {canWithhold ? <th className="px-4 py-3" aria-label="Actions" /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id} className="border-b border-slate-100 align-top last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-800">
                      {w.studentRecord.surname} {w.studentRecord.firstName}
                    </span>
                    <span className="block text-xs text-slate-500">{w.studentRecord.matriculationNumber}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {w.offering
                      ? `${w.offering.course.code} (course)`
                      : w.session
                        ? `${w.session.name} (session)`
                        : 'All results'}
                  </td>
                  <td className="max-w-[18rem] px-4 py-3 text-slate-600">{w.reason}</td>
                  <td className="px-4 py-3">
                    <StatusBadge state={w.status} />
                  </td>
                  <td className="px-4 py-3 text-xs tabular-nums text-slate-500">
                    {new Date(w.placedAt).toLocaleString()}
                  </td>
                  {canWithhold ? (
                    <td className="px-4 py-3">
                      {w.status === 'ACTIVE' ? (
                        <ReleaseButton
                          withholding={w}
                          onReleased={async () => {
                            setSuccess('Withholding released.');
                            setError(null);
                            await load();
                          }}
                        />
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function PlaceWithholding({ onPlaced }: { onPlaced: (msg: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [matric, setMatric] = useState('');
  const [matches, setMatches] = useState<StudentRecord[]>([]);
  const [student, setStudent] = useState<StudentRecord | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMatches([]);
    setStudent(null);
    if (!matric.trim()) return;
    setBusy(true);
    try {
      const res = await api.get<StudentRecord[]>(
        `/students?search=${encodeURIComponent(matric.trim())}&pageSize=5`,
      );
      setMatches(res);
      if (res.length === 1) setStudent(res[0] ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Student search failed.');
    } finally {
      setBusy(false);
    }
  }

  async function place(e: React.FormEvent) {
    e.preventDefault();
    if (!student) return;
    if (reason.trim().length < 10) {
      setError('The reason must be at least 10 characters — the student will see it.');
      return;
    }
    if (!window.confirm(`Place a withholding on ${student.matriculationNumber}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/results/withholdings', {
        studentRecordId: student.id,
        reason: reason.trim(),
      });
      setOpen(false);
      setMatric('');
      setMatches([]);
      setStudent(null);
      setReason('');
      await onPlaced('Withholding placed.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to place the withholding.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div>
        <button className="btn-primary" onClick={() => setOpen(true)}>
          Place a withholding
        </button>
      </div>
    );
  }

  return (
    <section className="card mb-6 p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="card-title">Place a withholding</h2>
          <p className="card-subtitle">
            Applies to ALL of the student&apos;s published results. The student sees the reason.
          </p>
        </div>
        <button className="btn-secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>

      {error ? (
        <div className="mb-3 mt-3">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      <form onSubmit={search} className="mt-4 flex gap-2">
        <input
          className="input flex-1"
          aria-label="Find student (matric or name)"
          placeholder="Search matric no. or name…"
          value={matric}
          onChange={(e) => setMatric(e.target.value)}
        />
        <button type="submit" className="btn-secondary" disabled={busy}>
          Find
        </button>
      </form>

      {matches.length > 0 && !student ? (
        <ul className="mt-3 space-y-1">
          {matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="w-full rounded-lg border border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => setStudent(m)}
              >
                <span className="font-medium">{m.matriculationNumber}</span> — {m.surname} {m.firstName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {student ? (
        <form onSubmit={place} className="mt-4 space-y-3">
          <p className="text-sm text-slate-700">
            Withholding <span className="font-semibold">{student.matriculationNumber}</span> —{' '}
            {student.surname} {student.firstName}
          </p>
          <div>
            <label htmlFor="wh-reason" className="label">
              Reason (shown to the student, min 10 characters)
            </label>
            <textarea
              id="wh-reason"
              className="input min-h-[70px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Placing…' : 'Place withholding'}
          </button>
        </form>
      ) : null}
    </section>
  );
}

function ReleaseButton({
  withholding,
  onReleased,
}: {
  withholding: WithholdingItem;
  onReleased: () => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!asking) {
    return (
      <button className="btn-secondary" onClick={() => setAsking(true)}>
        Release
      </button>
    );
  }

  async function release() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/results/withholdings/${withholding.id}/release`, {
        note: note.trim() || undefined,
      });
      await onReleased();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to release.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[14rem]">
      {error ? <p className="mb-1 text-xs text-red-600">{error}</p> : null}
      <input
        className="input px-2 py-1.5 text-xs"
        placeholder="Release note (own withholding: required)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        aria-label="Release note"
      />
      <div className="mt-1 flex gap-1.5">
        <button className="btn-secondary px-2 py-1 text-xs" onClick={release} disabled={busy}>
          {busy ? '…' : 'Confirm'}
        </button>
        <button className="btn-secondary px-2 py-1 text-xs" onClick={() => setAsking(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
