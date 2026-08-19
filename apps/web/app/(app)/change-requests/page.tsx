'use client';

/**
 * Registry change-request review (§16). Lists protected-field correction requests
 * within the reviewer's scope and lets them APPROVE (routes the correction through
 * the audited amendment function) or REJECT with a note. Separation of duties is
 * enforced server-side — a reviewer cannot decide a request they filed — and the
 * UI reflects that by disabling the controls on one's own requests.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { ChangeRequest, ChangeRequestStatus } from '@/lib/types';
import { PageHeader, AccessNotice, EmptyState } from '@/components/page';
import { Alert, Spinner, StatusBadge } from '@/components/ui';
import { Pagination, type PageMeta } from '@/components/pagination';
import { formatDob } from '@/lib/dates';

const STATUSES: ChangeRequestStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

export default function ChangeRequestsPage() {
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.CHANGE_REQUESTS_VIEW);
  const canReview = can(me?.permissions, PERMISSIONS.CHANGE_REQUESTS_REVIEW);

  const [rows, setRows] = useState<ChangeRequest[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [status, setStatus] = useState<ChangeRequestStatus>('PENDING');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status, page: String(page), pageSize: '20' });
      const env = await api.getEnvelope<ChangeRequest[]>(`/change-requests?${params.toString()}`);
      setRows(env.data);
      setMeta((env.meta as unknown as PageMeta) ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load change requests.');
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

  if (!canView) return <AccessNotice />;
  if (forbidden) return <AccessNotice />;

  return (
    <>
      <PageHeader
        title="Change requests"
        description="Review student requests to correct protected identity fields. Approvals are applied as audited amendments."
      />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
        {STATUSES.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={status === s}
            className={`badge ${status === s ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}
            onClick={() => {
              setStatus(s);
              setPage(1);
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {error ? (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      {loading ? (
        <Spinner label="Loading requests…" />
      ) : rows.length === 0 ? (
        <EmptyState title={`No ${status.toLowerCase()} change requests.`} />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              canReview={canReview}
              isOwn={r.requestedById === me?.userId}
              onReviewed={load}
            />
          ))}
        </div>
      )}

      <Pagination meta={meta} onPage={setPage} />
    </>
  );
}

function RequestCard({
  request,
  canReview,
  isOwn,
  onReviewed,
}: {
  request: ChangeRequest;
  canReview: boolean;
  isOwn: boolean;
  onReviewed: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const student = request.studentRecord;
  const isPending = request.status === 'PENDING';
  const isDob = request.fieldKey === 'dateOfBirth';
  const displayValue = (v: string | null | undefined) =>
    isDob ? formatDob(v ?? null) : (v ?? '—');

  async function decide(decision: 'APPROVE' | 'REJECT') {
    setError(null);
    if (decision === 'REJECT' && !note.trim()) {
      setError('A note is required when rejecting.');
      return;
    }
    if (
      !window.confirm(
        decision === 'APPROVE'
          ? 'Approve this correction? It will be applied to the master record and audited.'
          : 'Reject this change request?',
      )
    )
      return;
    setBusy(true);
    try {
      await api.post(`/change-requests/${request.id}/review`, {
        decision,
        reviewNote: note.trim() || undefined,
      });
      onReviewed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit the decision.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            {student
              ? `${student.surname} ${student.firstName} · ${student.matriculationNumber}`
              : request.studentRecordId}
          </p>
          <p className="text-xs text-slate-500">
            Requested {new Date(request.createdAt).toLocaleString()}
          </p>
        </div>
        <StatusBadge state={request.status} />
      </div>

      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
        <div>
          <p className="label mb-0.5">Field</p>
          <p className="font-mono text-xs text-brand-700">{request.fieldKey}</p>
        </div>
        <div>
          <p className="label mb-0.5">Current value</p>
          <p className="text-slate-700">{displayValue(request.currentValue)}</p>
        </div>
        <div>
          <p className="label mb-0.5">Requested value</p>
          <p className="font-medium text-slate-900">{displayValue(request.requestedValue)}</p>
        </div>
      </div>

      <div className="mt-3">
        <p className="label mb-0.5">Reason</p>
        <p className="text-sm text-slate-700">{request.reason}</p>
      </div>

      {request.status !== 'PENDING' && request.reviewNote ? (
        <div className="mt-3">
          <p className="label mb-0.5">Review note</p>
          <p className="text-sm text-slate-700">{request.reviewNote}</p>
        </div>
      ) : null}

      {canReview && isPending ? (
        isOwn ? (
          <div className="mt-4">
            <Alert kind="info">
              You filed this request, so you cannot decide it (separation of duties). Another officer
              must review it.
            </Alert>
          </div>
        ) : (
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
            {error ? <Alert kind="error">{error}</Alert> : null}
            <div>
              <label htmlFor={`note-${request.id}`} className="label">
                Review note (required to reject)
              </label>
              <textarea
                id={`note-${request.id}`}
                className="input min-h-[70px]"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
              />
            </div>
            <div className="flex gap-2">
              <button
                className="btn-primary"
                onClick={() => decide('APPROVE')}
                disabled={busy}
              >
                {busy ? 'Working…' : 'Approve & apply'}
              </button>
              <button
                className="btn-secondary"
                onClick={() => decide('REJECT')}
                disabled={busy}
              >
                Reject
              </button>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
