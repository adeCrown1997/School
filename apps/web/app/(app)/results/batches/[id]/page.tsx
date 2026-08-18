'use client';

/**
 * Result-batch review (docs/03 §10.4–§10.6). The same number every reviewer
 * signs: the compute preview grades every locked registration against the
 * batch's PINNED scale, so approval and publication act on exactly what is
 * shown. Approval requires results.approve; publication requires
 * results.publish AND a second, distinct person (dual control) — the page
 * surfaces who has already signed so the second signer knows their role.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { BatchComputePreview, ResultBatchDetail } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Spinner, StatusBadge } from '@/components/ui';

export default function ResultBatchDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.RESULTS_VIEW);
  const canApprove = can(me?.permissions, PERMISSIONS.RESULTS_APPROVE);
  const canPublish = can(me?.permissions, PERMISSIONS.RESULTS_PUBLISH);

  const [batch, setBatch] = useState<ResultBatchDetail | null>(null);
  const [preview, setPreview] = useState<BatchComputePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get<ResultBatchDetail>(`/results/batches/${id}`);
      setBatch(res);
      // The preview is what every decision is made against. It computes from
      // SUBMITTED entries, so it is only meaningful once scores are submitted —
      // fetch it defensively (the API reports the reason on failure).
      try {
        setPreview(await api.get<BatchComputePreview>(`/results/batches/${id}/compute`));
      } catch {
        setPreview(null);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load the batch.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

  if (!canView) return <AccessNotice />;
  if (loading) return <Spinner label="Loading batch…" />;
  if (forbidden) return <AccessNotice />;
  if (notFound)
    return (
      <Alert kind="warning" title="Not found">
        No batch matches this id, or it is outside your scope.
      </Alert>
    );
  if (error && !batch) return <Alert kind="error">{error}</Alert>;
  if (!batch) return null;

  return (
    <>
      <PageHeader
        title={`${batch.offering.course.code} — ${batch.session.name}`}
        description={`${batch.offering.course.title} · ${batch.offering.semester.name} · graded on scale "${batch.gradeScale.name}"`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge state={batch.status} />
            <Link href="/results/batches" className="btn-secondary">
              Back to batches
            </Link>
          </div>
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

      {batch.status === 'DRAFT' ? (
        <div className="mb-4">
          <Alert kind="info" title="Still a draft">
            The lecturer has not submitted this batch yet — approval begins once it is submitted
            from the score-entry page.
          </Alert>
        </div>
      ) : null}
      {batch.status === 'REJECTED' && batch.rejectReason ? (
        <div className="mb-4">
          <Alert kind="error" title="Rejected — returned to the lecturer">
            {batch.rejectReason}
          </Alert>
        </div>
      ) : null}

      {/* Approval chain */}
      <section className="card mb-6 p-5">
        <h2 className="card-title">Approval chain</h2>
        <p className="card-subtitle">
          Stages act in order; nobody signs two stages on the same batch (§5.4).
        </p>
        {batch.approvals.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No stage has decided this batch yet{batch.status === 'PENDING_APPROVAL' ? ' — it awaits the first stage.' : '.'}
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {batch.approvals.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <StatusBadge state={a.decision} />
                <span className="font-medium">{a.stage.name}</span>
                {a.comment ? <span className="text-slate-500">— {a.comment}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Compute preview */}
      <section className="card mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="card-title">Computed results</h2>
            <p className="card-subtitle">
              Exactly what approval and publication will record — graded against the pinned scale.
            </p>
          </div>
          {preview ? (
            <span className="text-sm text-slate-500 tabular-nums">
              {preview.graded} graded · {preview.marked} marked · {preview.incomplete} incomplete
            </span>
          ) : null}
        </div>

        {preview ? (
          preview.incomplete > 0 ? (
            <div className="mb-3 mt-3">
              <Alert kind="warning" title={`${preview.incomplete} student(s) are missing submitted entries`}>
                Submission will be refused until every student has every component.
              </Alert>
            </div>
          ) : null
        ) : (
          <p className="mt-3 text-sm text-slate-500">
            The preview could not be produced — the offering likely has no assessment structure or
            submitted entries yet.
          </p>
        )}

        {preview && preview.rows.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="px-2 py-2 font-medium">Matric no.</th>
                  <th className="px-2 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Level</th>
                  <th className="px-2 py-2 font-medium">Total</th>
                  <th className="px-2 py-2 font-medium">Grade</th>
                  <th className="px-2 py-2 font-medium">Points</th>
                  <th className="px-2 py-2 font-medium">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.registrationLineId} className="border-b border-slate-50 last:border-0">
                    <td className="px-2 py-2 font-medium tabular-nums text-slate-700">
                      {r.matriculationNumber}
                    </td>
                    <td className="px-2 py-2">{r.fullName}</td>
                    <td className="px-2 py-2 tabular-nums">{r.level}</td>
                    <td className="px-2 py-2 tabular-nums">
                      {r.totalScore !== null ? Number(r.totalScore).toFixed(2) : '—'}
                    </td>
                    <td className="px-2 py-2">
                      {r.grade ? (
                        <span
                          className={`badge ${
                            r.passed === false ? 'bg-red-100 text-red-800' : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {r.grade}
                        </span>
                      ) : (
                        <span className="badge bg-slate-100 text-slate-500">
                          {r.status === 'INCOMPLETE' ? 'Missing' : (r.mark ?? '—')}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 tabular-nums">
                      {r.gradePoint !== null ? Number(r.gradePoint).toFixed(2) : '—'}
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-500">{r.reason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {/* Actions */}
      {canApprove && batch.status === 'PENDING_APPROVAL' ? (
        <DecisionPanel
          batchId={batch.id}
          onDecided={async (msg) => {
            setSuccess(msg);
            setError(null);
            await load();
          }}
        />
      ) : null}

      {canPublish && batch.status === 'SENATE_RATIFIED' ? (
        <PublishPanel
          batch={batch}
          onPublished={async (msg) => {
            setSuccess(msg);
            setError(null);
            await load();
          }}
        />
      ) : null}

      {/* Published grade records */}
      {batch.status === 'PUBLISHED' && batch.gradeRecords.length > 0 ? (
        <section className="card p-5">
          <h2 className="card-title">Published grades</h2>
          <p className="card-subtitle">
            Immutable (INV-12) — corrections create a new version, never an edit.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="px-2 py-2 font-medium">Grade</th>
                  <th className="px-2 py-2 font-medium">Points</th>
                  <th className="px-2 py-2 font-medium">Units</th>
                  <th className="px-2 py-2 font-medium">Mark</th>
                  <th className="px-2 py-2 font-medium">Version</th>
                  <th className="px-2 py-2 font-medium">Published</th>
                </tr>
              </thead>
              <tbody>
                {batch.gradeRecords.map((g) => (
                  <tr key={g.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-2 py-2 font-semibold">{g.grade ?? g.mark}</td>
                    <td className="px-2 py-2 tabular-nums">
                      {g.gradePoint !== null ? Number(g.gradePoint).toFixed(2) : '—'}
                    </td>
                    <td className="px-2 py-2 tabular-nums">{g.creditUnits}</td>
                    <td className="px-2 py-2">{g.mark}</td>
                    <td className="px-2 py-2 tabular-nums">{g.version}</td>
                    <td className="px-2 py-2 text-xs text-slate-500">
                      {g.publishedAt ? new Date(g.publishedAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}

function DecisionPanel({
  batchId,
  onDecided,
}: {
  batchId: string;
  onDecided: (msg: string) => Promise<void>;
}) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'APPROVED' | 'REJECTED') {
    setError(null);
    if (decision === 'REJECTED' && !comment.trim()) {
      setError('A rejection must say why — the lecturer needs it to correct the batch.');
      return;
    }
    if (!window.confirm(decision === 'APPROVED' ? 'Approve at your stage?' : 'Reject this batch?')) return;
    setBusy(true);
    try {
      const res = await api.post<ResultBatchDetail>(`/results/batches/${batchId}/decision`, {
        decision,
        comment: comment.trim() || undefined,
      });
      await onDecided(
        decision === 'APPROVED'
          ? res.status === 'SENATE_RATIFIED'
            ? 'Final stage approved — the batch is now ratified and awaiting publication.'
            : 'Approved at your stage; the next stage acts next.'
          : 'Rejected — the batch returned to the lecturer with your reason.',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record the decision.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card mb-6 p-5">
      <h2 className="card-title">Your decision</h2>
      <p className="card-subtitle">
        You act at the next unsigned stage. Approving the final stage ratifies the batch;
        rejecting returns it to the lecturer.
      </p>
      {error ? (
        <div className="mb-3 mt-3">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}
      <div className="mt-3">
        <label htmlFor="batch-comment" className="label">
          Comment (required to reject)
        </label>
        <textarea
          id="batch-comment"
          className="input min-h-[70px]"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={500}
        />
      </div>
      <div className="mt-4 flex gap-2">
        <button className="btn-primary" onClick={() => decide('APPROVED')} disabled={busy}>
          {busy ? 'Working…' : 'Approve'}
        </button>
        <button className="btn-secondary text-red-700" onClick={() => decide('REJECTED')} disabled={busy}>
          Reject
        </button>
      </div>
    </section>
  );
}

function PublishPanel({
  batch,
  onPublished,
}: {
  batch: ResultBatchDetail;
  onPublished: (msg: string) => Promise<void>;
}) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstSigned = batch.publishedById !== null;
  const { me } = useSession();
  const iAmFirstSigner = batch.publishedById !== null && batch.publishedById === me?.userId;

  async function publish() {
    setError(null);
    if (iAmFirstSigner && !batch.publishCosignerId) {
      setError(
        'You recorded the first publish signature — dual control requires a SECOND person to confirm. Ask a colleague with results.publish.',
      );
      return;
    }
    if (!window.confirm(firstSigned ? 'Confirm publication? This writes the grades and makes them immutable.' : 'Record the FIRST publish signature? A second signer must confirm afterwards.')) return;
    setBusy(true);
    try {
      const res = await api.post<ResultBatchDetail | null>(`/results/batches/${batch.id}/publish`, {
        comment: comment.trim() || undefined,
      });
      if (res && res.status === 'PUBLISHED') {
        await onPublished('Published — the results are now official, immutable and student-visible.');
      } else {
        await onPublished(
          'First publish signature recorded — a second person with results.publish must now confirm.',
        );
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to publish.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card mb-6 p-5">
      <h2 className="card-title">Publish (dual control)</h2>
      <p className="card-subtitle">
        Two DISTINCT people must sign before these results become official. On the second
        signature the grades are written and GPA/CGPA recomputed from scratch (INV-13).
      </p>
      {error ? (
        <div className="mb-3 mt-3">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}
      {firstSigned ? (
        <div className="mb-3 mt-3">
          <Alert kind="info">First signature recorded — awaiting the co-signature.</Alert>
        </div>
      ) : null}
      <div className="mt-3">
        <label htmlFor="publish-comment" className="label">
          Comment (optional)
        </label>
        <textarea
          id="publish-comment"
          className="input min-h-[60px]"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={500}
        />
      </div>
      <button className="btn-primary mt-4" onClick={publish} disabled={busy}>
        {busy ? 'Publishing…' : firstSigned ? 'Publish — confirm as second signer' : 'Record first publish signature'}
      </button>
    </section>
  );
}
