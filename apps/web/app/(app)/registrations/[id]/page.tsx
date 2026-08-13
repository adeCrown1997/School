'use client';

/**
 * Staff registration detail. Shows the student's selected courses, approval
 * progress and — when the registration is awaiting approval and the caller holds
 * registration.approve — the controls to approve or reject at the current stage.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { StaffRegistrationDetail } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Labeled, Spinner, StatusBadge } from '@/components/ui';

function activeLines(reg: StaffRegistrationDetail) {
  return reg.lines.filter((l) => l.state === 'ACTIVE');
}

export default function RegistrationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.REGISTRATION_VIEW);
  const canApprove = can(me?.permissions, PERMISSIONS.REGISTRATION_APPROVE);
  const canLock = can(me?.permissions, PERMISSIONS.REGISTRATION_LOCK);

  const [reg, setReg] = useState<StaffRegistrationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<StaffRegistrationDetail>(`/registrations/${id}`);
      setReg(res);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load the registration.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

  if (!canView) return <AccessNotice />;
  if (loading) return <Spinner label="Loading registration…" />;
  if (forbidden) return <AccessNotice />;
  if (notFound)
    return (
      <Alert kind="warning" title="Not found">
        No registration matches this id, or it is outside your scope.
      </Alert>
    );
  if (error && !reg) return <Alert kind="error">{error}</Alert>;
  if (!reg) return null;

  const student = reg.studentRecord;
  const name = student
    ? [student.surname, student.firstName, student.otherNames].filter(Boolean).join(' ')
    : 'Student';
  const lines = activeLines(reg);
  const unitBounds =
    reg.minUnits != null && reg.maxUnits != null ? `${reg.minUnits}–${reg.maxUnits} units` : null;

  return (
    <>
      <PageHeader
        title={name}
        description={
          student
            ? `${student.matriculationNumber} · ${reg.session.name} · ${reg.semester.name}`
            : `${reg.session.name} · ${reg.semester.name}`
        }
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge state={reg.status} />
            <Link href="/registrations" className="btn-secondary">
              Back to list
            </Link>
          </div>
        }
      />

      {error ? (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      {student ? (
        <div className="card mb-6 grid grid-cols-2 gap-4 p-5 md:grid-cols-4">
          <Labeled label="Matriculation number">{student.matriculationNumber}</Labeled>
          <Labeled label="Level">{student.currentLevel}</Labeled>
          <Labeled label="Programme">
            {student.programme ? `${student.programme.name} (${student.programme.code})` : '—'}
          </Labeled>
          <Labeled label="Department">{student.department?.name ?? '—'}</Labeled>
        </div>
      ) : null}

      {reg.status === 'REJECTED' && reg.rejectReason ? (
        <div className="mb-4">
          <Alert kind="error" title="Registration rejected">
            {reg.rejectReason}
          </Alert>
        </div>
      ) : null}

      <section className="card mb-6 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Selected courses</h2>
          <span className="text-sm text-slate-500">
            {reg.totalUnits} units{unitBounds ? ` (${unitBounds})` : ''}
          </span>
        </div>
        {lines.length === 0 ? (
          <p className="text-sm text-slate-500">No active course lines.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="pb-2 pr-4 font-medium">Code</th>
                  <th className="pb-2 pr-4 font-medium">Title</th>
                  <th className="pb-2 pr-4 font-medium">Units</th>
                  <th className="pb-2 font-medium">Type</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const c = line.courseOffering.course;
                  return (
                    <tr key={line.id} className="border-b border-slate-50">
                      <td className="py-2 pr-4 font-medium">{c.code}</td>
                      <td className="py-2 pr-4">{c.title}</td>
                      <td className="py-2 pr-4 tabular-nums">{line.creditUnits}</td>
                      <td className="py-2">
                        <span className="badge bg-slate-100 text-slate-600">{line.lineType}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {reg.approvals.length ? (
        <section className="card mb-6 p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Approval progress</h2>
          <ul className="space-y-2 text-sm">
            {reg.approvals.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <StatusBadge state={a.decision} />
                <span className="font-medium">{a.stage.name}</span>
                {a.comment ? <span className="text-slate-500">— {a.comment}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canApprove && reg.status === 'PENDING_APPROVAL' ? (
        <DecisionPanel registrationId={reg.id} onDecided={() => router.push('/registrations')} />
      ) : null}

      {canLock && reg.status === 'APPROVED' ? (
        <LockPanel registrationId={reg.id} onLocked={load} />
      ) : null}
    </>
  );
}

function DecisionPanel({
  registrationId,
  onDecided,
}: {
  registrationId: string;
  onDecided: () => void;
}) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'APPROVED' | 'REJECTED') {
    setError(null);
    if (decision === 'REJECTED' && !comment.trim()) {
      setError('A comment is required when rejecting.');
      return;
    }
    if (
      !window.confirm(
        decision === 'APPROVED'
          ? 'Approve this registration at your stage?'
          : 'Reject this registration? The student will need to revise and resubmit.',
      )
    )
      return;

    setBusy(true);
    try {
      await api.post(`/registrations/${registrationId}/decision`, {
        decision,
        comment: comment.trim() || undefined,
      });
      onDecided();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit the decision.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <h2 className="mb-1 text-sm font-semibold text-slate-700">Your decision</h2>
      <p className="mb-4 text-xs text-slate-500">
        You act at the next unsigned approval stage. A rejection requires a comment so the student
        knows what to fix.
      </p>
      {error ? (
        <div className="mb-3">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}
      <div>
        <label htmlFor="decision-comment" className="label">
          Comment (required to reject)
        </label>
        <textarea
          id="decision-comment"
          className="input min-h-[70px]"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={1000}
        />
      </div>
      <div className="mt-4 flex gap-2">
        <button className="btn-primary" onClick={() => decide('APPROVED')} disabled={busy}>
          {busy ? 'Working…' : 'Approve'}
        </button>
        <button className="btn-secondary" onClick={() => decide('REJECTED')} disabled={busy}>
          Reject
        </button>
      </div>
    </section>
  );
}

function LockPanel({
  registrationId,
  onLocked,
}: {
  registrationId: string;
  onLocked: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lock() {
    if (
      !window.confirm(
        'Lock this registration? The student will no longer be able to change their course list.',
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/registrations/${registrationId}/lock`);
      onLocked();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to lock the registration.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <h2 className="mb-1 text-sm font-semibold text-slate-700">Lock registration</h2>
      <p className="mb-4 text-xs text-slate-500">
        Fully approved registrations can be locked to freeze the course list for the semester.
      </p>
      {error ? (
        <div className="mb-3">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}
      <button className="btn-primary" onClick={lock} disabled={busy}>
        {busy ? 'Locking…' : 'Lock registration'}
      </button>
    </section>
  );
}
