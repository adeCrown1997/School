'use client';

/**
 * Waivers & loan clearances (docs/03 §11.4, Q-39). Two tabs:
 *  - Waivers: dual control — the requester and approver MUST differ (service
 *    pre-flight + the chk_waiver_sod DB constraint). Approve posts a WAIVER
 *    credit to the ledger; reject is final and audited.
 *  - Loans: third-party education-loan coverages (NELFUND). Recorded PENDING and
 *    approved by a different officer; once approved they count toward the
 *    registration fee-clearance gate.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { LoanClearanceItem, WaiverListItem, WaiverStatus } from '@/lib/types';
import { PageHeader, AccessNotice, EmptyState } from '@/components/page';
import { Alert, PanelLoader, StatusBadge } from '@/components/ui';
import { formatNaira } from '@/lib/money';
import { CheckIcon, XIcon } from '@/components/icons';

type Tab = 'waivers' | 'loans';

const WAIVER_STATUSES: Array<WaiverStatus | ''> = ['', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

export default function WaiversPage() {
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.FINANCE_VIEW);
  const canWaiver = can(me?.permissions, PERMISSIONS.FINANCE_WAIVER_MANAGE);

  const [tab, setTab] = useState<Tab>('waivers');

  const [waivers, setWaivers] = useState<WaiverListItem[]>([]);
  const [status, setStatus] = useState<WaiverStatus | ''>('');
  const [showDecided, setShowDecided] = useState(false);
  const [loans, setLoans] = useState<LoanClearanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decideFor, setDecideFor] = useState<WaiverListItem | null>(null);
  const [decideNote, setDecideNote] = useState('');
  const [cancelFor, setCancelFor] = useState<WaiverListItem | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'waivers') {
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        if (showDecided) params.set('includeDecided', 'true');
        setWaivers(await api.get<WaiverListItem[]>(`/finance/waivers?${params.toString()}`));
      } else {
        setLoans(await api.get<LoanClearanceItem[]>('/finance/loans'));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load data.');
    } finally {
      setLoading(false);
    }
  }, [tab, status, showDecided]);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

  async function decide(waiver: WaiverListItem, decision: 'APPROVED' | 'REJECTED') {
    setBusyId(waiver.id);
    setError(null);
    setSuccess(null);
    try {
      await api.post(`/finance/waivers/${waiver.id}/decide`, {
        decision,
        decisionNote: decideNote.trim() || undefined,
      });
      setDecideFor(null);
      setDecideNote('');
      setSuccess(
        decision === 'APPROVED'
          ? 'Waiver approved — the credit is posted to the student ledger.'
          : 'Waiver rejected. The decision is audited.',
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record the decision.');
    } finally {
      setBusyId(null);
    }
  }

  async function cancelWaiver(waiver: WaiverListItem, e: React.FormEvent) {
    e.preventDefault();
    if (cancelReason.trim().length < 10) return;    setBusyId(waiver.id);
    setError(null);
    try {
      await api.post(`/finance/waivers/${waiver.id}/cancel`, { reason: cancelReason.trim() });
      setCancelFor(null);
      setCancelReason('');
      setSuccess('Waiver request withdrawn.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to cancel the waiver.');
    } finally {
      setBusyId(null);
    }
  }

  async function approveLoan(loan: LoanClearanceItem) {
    setBusyId(loan.id);
    setError(null);
    setSuccess(null);
    try {
      await api.post(`/finance/loans/${loan.id}/approve`);
      setSuccess('Loan clearance approved — it now counts toward fee clearance for that session.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to approve the loan clearance.');
    } finally {
      setBusyId(null);
    }
  }

  if (!canView) return <AccessNotice />;
  if (forbidden) return <AccessNotice />;

  const pendingCount = waivers.filter((w) => w.status === 'PENDING').length;

  return (
    <>
      <PageHeader
        title="Waivers & loans"
        description="Fee reductions and loan-funded clearances. Approvals always need a second signature: the approver must differ from the requester."
      />

      <div className="mb-5 flex gap-1 rounded-xl bg-slate-200/60 p-1" role="tablist" aria-label="Finance reductions">
        <button
          role="tab"
          aria-selected={tab === 'waivers'}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
            tab === 'waivers' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
          onClick={() => setTab('waivers')}
        >
          Waivers
          {pendingCount > 0 ? (
            <span className="ml-2 badge bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20">
              {pendingCount} pending
            </span>
          ) : null}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'loans'}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
            tab === 'loans' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
          onClick={() => setTab('loans')}
        >
          Loan clearances
        </button>
      </div>

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

      {tab === 'waivers' ? (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            {WAIVER_STATUSES.map((s) => {
              const selected = status === s;
              return (
                <button
                  key={s || 'ALL'}
                  role="tab"
                  aria-selected={selected}
                  className={`badge cursor-pointer rounded-full px-3 py-1.5 text-xs transition-all ${
                    selected
                      ? 'bg-brand-600 text-white shadow-sm ring-1 ring-inset ring-brand-600'
                      : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 hover:text-slate-900 hover:ring-slate-300'
                  }`}
                  onClick={() => setStatus(s)}
                >
                  {s ? s.replace(/_/g, ' ') : 'All'}
                </button>
              );
            })}
            <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={showDecided}
                onChange={(e) => setShowDecided(e.target.checked)}
              />
              Include cancelled
            </label>
          </div>

          {loading ? (
            <PanelLoader label="Loading waivers…" />
          ) : waivers.length === 0 ? (
            <EmptyState title="No waivers match this filter.">
              Request a waiver from the invoice detail page to start the dual-approval flow.
            </EmptyState>
          ) : (
            <div className="space-y-3">
              {waivers.map((w) => (
                <div key={w.id} className="card flex flex-wrap items-start justify-between gap-3 p-5">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                      {formatNaira(w.amount)}
                      {w.feeType ? <span className="badge bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/20">{w.feeType}</span> : null}
                      <StatusBadge state={w.status} />
                    </p>
                    <p className="mt-0.5 text-sm text-slate-600">
                      {w.student.name} <span className="text-slate-400">· {w.student.matriculationNumber}</span>
                      {w.invoiceNumber ? <span className="text-slate-400"> · {w.invoiceNumber}</span> : null}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{w.reason}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Requested by {w.requestedByName ?? '—'}
                      {w.approvedByName ? ` · decided by ${w.approvedByName}` : ''}
                      {w.decidedAt ? ` · ${new Date(w.decidedAt).toLocaleString()}` : ` · ${new Date(w.createdAt).toLocaleString()}`}
                    </p>
                    {w.decisionNote ? <p className="mt-1 text-xs text-slate-400">Note: {w.decisionNote}</p> : null}
                  </div>
                  {canWaiver && w.status === 'PENDING' ? (
                    <div className="flex shrink-0 gap-2">
                      <button
                        className="btn-primary gap-1.5"
                        onClick={() => {
                          setDecideFor(w);
                          setDecideNote('');
                        }}
                      >
                        Decide
                      </button>
                      <button
                        className="btn-secondary"
                        onClick={() => {
                          setCancelFor(w);
                          setCancelReason('');
                        }}
                      >
                        Withdraw
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {loading ? (
            <PanelLoader label="Loading loan clearances…" />
          ) : loans.length === 0 ? (
            <EmptyState title="No loan clearances recorded.">
              Record NELFUND or other education-loan clearances via the API — they count toward fee
              clearance for the session once approved by a second officer.
            </EmptyState>
          ) : (
            <div className="space-y-3">
              {loans.map((l) => (
                <div key={l.id} className="card flex flex-wrap items-start justify-between gap-3 p-5">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                      {formatNaira(l.amountCovered)}
                      <span className="badge bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/20">
                        {l.loanProvider}
                      </span>
                      <StatusBadge state={l.status} />
                    </p>
                    <p className="mt-0.5 text-sm text-slate-600">
                      {l.student.name} <span className="text-slate-400">· {l.student.matriculationNumber}</span>
                      <span className="text-slate-400"> · {l.session.name}</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Reference: <span className="font-medium text-slate-700">{l.reference}</span>
                      {l.validFrom || l.validTo
                        ? ` · valid ${l.validFrom ? new Date(l.validFrom).toLocaleDateString() : '…'} – ${
                            l.validTo ? new Date(l.validTo).toLocaleDateString() : '…'
                          }`
                        : ''}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Recorded by {l.recordedByName ?? '—'} · {new Date(l.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {canWaiver && l.status === 'PENDING' ? (
                    <button
                      className="btn-primary shrink-0 gap-1.5"
                      disabled={busyId === l.id}
                      onClick={() => approveLoan(l)}
                    >
                      <CheckIcon size={15} /> {busyId === l.id ? 'Approving…' : 'Approve'}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Decide dialog */}
      {decideFor ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void decide(decideFor, 'APPROVED');
            }}
            className="card w-full max-w-lg space-y-4 p-6"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900">Decide waiver</h2>
              <button type="button" className="btn-icon" aria-label="Close" onClick={() => setDecideFor(null)}>
                <XIcon size={16} />
              </button>
            </div>
            <p className="text-sm text-slate-600">
              {formatNaira(decideFor.amount)} for {decideFor.student.name} ({decideFor.student.matriculationNumber}).
              You requested this waiver? A different officer must decide it — that rule is enforced by
              the database, not just this screen.
            </p>
            <textarea
              className="input min-h-[4rem]"
              placeholder="Decision note (optional)"
              aria-label="Decision note"
              value={decideNote}
              onChange={(e) => setDecideNote(e.target.value)}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="btn-secondary text-red-600 hover:bg-red-50 hover:text-red-700"
                disabled={busyId === decideFor.id}
                onClick={() => void decide(decideFor, 'REJECTED')}
              >
                <XIcon size={15} /> Reject
              </button>
              <button type="submit" className="btn-primary gap-1.5" disabled={busyId === decideFor.id}>
                <CheckIcon size={15} /> {busyId === decideFor.id ? 'Saving…' : 'Approve'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Withdraw dialog */}
      {cancelFor ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <form onSubmit={(e) => cancelWaiver(cancelFor, e)} className="card w-full max-w-lg space-y-4 p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900">Withdraw waiver request</h2>
              <button type="button" className="btn-icon" aria-label="Close" onClick={() => setCancelFor(null)}>
                <XIcon size={16} />
              </button>
            </div>
            <p className="text-sm text-slate-600">
              Only the requesting officer can withdraw a pending waiver before it is decided.
            </p>
            <textarea
              className="input min-h-[4rem]"
              placeholder="Reason (min 10 characters)"
              aria-label="Cancellation reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              required
              minLength={10}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setCancelFor(null)}>
                Keep
              </button>
              <button
                type="submit"
                className="btn-primary bg-red-600 hover:bg-red-700"
                disabled={busyId === cancelFor.id}
              >
                {busyId === cancelFor.id ? 'Withdrawing…' : 'Withdraw'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
