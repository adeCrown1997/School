'use client';

/**
 * Payments ledger & daily settlement reconciliation (§11.3 rule 7, §11.5).
 * Reversals live on the invoice detail page next to the payment being unwound;
 * this page is the day-by-day view: what providers settled vs what the ledger
 * shows, with discrepancies kept PENDING until resolved with a documented note.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { PaymentIntentItem, ReconciliationItem } from '@/lib/types';
import { PageHeader, AccessNotice, EmptyState } from '@/components/page';
import { Alert, PanelLoader, StatusBadge } from '@/components/ui';
import { formatNaira, nairaToMinor } from '@/lib/money';
import { RefreshIcon, XIcon } from '@/components/icons';

export default function PaymentsPage() {
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.FINANCE_VIEW);
  const canReconcile = can(me?.permissions, PERMISSIONS.FINANCE_RECONCILE);

  const [payments, setPayments] = useState<PaymentIntentItem[]>([]);
  const [recons, setRecons] = useState<ReconciliationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [provider, setProvider] = useState('');
  const [settlementDate, setSettlementDate] = useState('');
  const [providerTotal, setProviderTotal] = useState('');
  const [reconNotes, setReconNotes] = useState('');
  const [resolveFor, setResolveFor] = useState<ReconciliationItem | null>(null);
  const [resolveNotes, setResolveNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pays, rs] = await Promise.all([
        api.get<PaymentIntentItem[]>('/finance/payments'),
        api.get<ReconciliationItem[]>('/finance/reconciliations'),
      ]);
      setPayments(pays);
      setRecons(rs);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load payment data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

  async function recordReconciliation(e: React.FormEvent) {
    e.preventDefault();
    const minor = nairaToMinor(providerTotal);
    if (!provider.trim()) return setError('Enter the provider name.');
    if (!settlementDate) return setError('Choose the settlement date.');
    if (minor === null) return setError('Enter the provider total as a naira amount.');
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post('/finance/reconciliations', {
        provider: provider.trim(),
        settlementDate,
        providerTotal: minor,
        notes: reconNotes.trim() || undefined,
      });
      setSuccess('Reconciliation recorded — provider and ledger totals match.');
      setProviderTotal('');
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Discrepancy surfaced honestly (§11.5): the row IS saved as PENDING.
        setSuccess(null);
        setError(err.message);
        await load();
      } else setError(err instanceof ApiError ? err.message : 'Failed to record the reconciliation.');
    } finally {
      setBusy(false);
    }
  }

  async function resolve(e: React.FormEvent) {
    e.preventDefault();
    if (!resolveFor || resolveNotes.trim().length < 10) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/finance/reconciliations/${resolveFor.id}/resolve`, { notes: resolveNotes.trim() });
      setResolveFor(null);
      setResolveNotes('');
      setSuccess('Discrepancy resolved — the explanation is stored on the record.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to resolve the discrepancy.');
    } finally {
      setBusy(false);
    }
  }

  if (!canView) return <AccessNotice />;
  if (forbidden) return <AccessNotice />;

  const postedTotal = payments
    .filter((p) => p.status === 'POSTED_TO_LEDGER' || p.status === 'UNDERPAID')
    .reduce((acc, p) => {
      try {
        return acc + BigInt(p.amount);
      } catch {
        return acc;
      }
    }, 0n);

  return (
    <>
      <PageHeader
        title="Payments & reconciliation"
        description="Every recorded payment (idempotent by provider reference) and the daily provider-vs-ledger settlement check. Posting and reversing money happens on the invoice."
        actions={
          <button className="btn-secondary gap-1.5" onClick={load} disabled={loading}>
            <RefreshIcon size={15} /> Refresh
          </button>
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

      {loading ? (
        <PanelLoader label="Loading payments…" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Recent payments */}
          <section className="card p-6 lg:col-span-2" aria-labelledby="pay-list">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 id="pay-list" className="card-title">
                  Recorded payments
                </h2>
                <p className="card-subtitle">Latest {payments.length} · posted {formatNaira(postedTotal)}</p>
              </div>
            </div>
            {payments.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                No payments yet. Record a payment from an issued invoice&apos;s detail page.
              </p>
            ) : (
              <ul className="mt-4 max-h-[34rem] space-y-2 overflow-y-auto pr-1">
                {payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800">
                        {formatNaira(p.amount)}
                        <span className="font-normal text-slate-500">
                          {' '}via {p.provider ?? 'MANUAL'}
                          {p.invoiceNumber ? ` · ${p.invoiceNumber}` : ''}
                        </span>
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {p.providerReference ?? 'no reference'} ·{' '}
                        {new Date(p.postedAt ?? p.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <StatusBadge state={p.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Reconciliation */}
          <section className="card space-y-5 p-6" aria-labelledby="recon">
            <div>
              <h2 id="recon" className="card-title">
                Settlement reconciliation
              </h2>
              <p className="card-subtitle">
                The ledger side is computed by the API — you only supply the provider&apos;s own total.
              </p>
            </div>

            {canReconcile ? (
              <form onSubmit={recordReconciliation} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="grid grid-cols-2 gap-3">
                  <input
                    className="input"
                    placeholder="Provider (PAYSTACK…)"
                    aria-label="Provider"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value.toUpperCase())}
                    required
                  />
                  <input
                    type="date"
                    className="input"
                    aria-label="Settlement date"
                    value={settlementDate}
                    onChange={(e) => setSettlementDate(e.target.value)}
                    required
                  />
                </div>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                    ₦
                  </span>
                  <input
                    className="input pl-7"
                    placeholder="Provider settlement total"
                    inputMode="decimal"
                    aria-label="Provider total"
                    value={providerTotal}
                    onChange={(e) => setProviderTotal(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="btn-primary w-full" disabled={busy}>
                  {busy ? 'Checking…' : 'Reconcile this day'}
                </button>
              </form>
            ) : (
              <p className="text-xs text-slate-500">You do not hold finance.reconcile — entries are read-only.</p>
            )}

            {recons.length === 0 ? (
              <p className="text-sm text-slate-500">No reconciliation records yet.</p>
            ) : (
              <ul className="space-y-2">
                {recons.map((r) => {
                  const discrepancy = safeBigInt(r.discrepancy);
                  return (
                    <li key={r.id} className="rounded-lg border border-slate-100 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-800">
                          {r.provider} · {new Date(r.settlementDate).toLocaleDateString()}
                        </p>
                        <StatusBadge state={r.status === 'APPROVED' ? 'CLEARED' : 'NOT_CLEARED'} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Provider {formatNaira(r.providerTotal)} · ledger {formatNaira(r.ledgerTotal)} ·{' '}
                        {r.matchedCount} matched
                      </p>
                      {discrepancy !== 0n ? (
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-red-600">
                            Discrepancy {discrepancy > 0n ? '+' : '−'}
                            {formatNaira(discrepancy < 0n ? -discrepancy : discrepancy)}
                          </p>
                          {canReconcile && r.status === 'PENDING' ? (
                            <button
                              className="btn-secondary px-2.5 py-1 text-xs"
                              onClick={() => {
                                setResolveFor(r);
                                setResolveNotes('');
                              }}
                            >
                              Resolve
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {r.notes ? <p className="mt-1 text-xs text-slate-400">{r.notes}</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* Resolve dialog */}
      {resolveFor ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <form onSubmit={resolve} className="card w-full max-w-lg space-y-4 p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900">
                Resolve discrepancy — {resolveFor.provider}
              </h2>
              <button type="button" className="btn-icon" aria-label="Close" onClick={() => setResolveFor(null)}>
                <XIcon size={16} />
              </button>
            </div>
            <p className="text-sm text-slate-600">
              {new Date(resolveFor.settlementDate).toLocaleDateString()}: provider{' '}
              {formatNaira(resolveFor.providerTotal)} vs ledger {formatNaira(resolveFor.ledgerTotal)} —
              a difference of {formatNaira(resolveFor.discrepancy)}. Explain the review, not just the fix.
            </p>
            <textarea
              className="input min-h-[5rem]"
              placeholder="Resolution notes (min 10 characters)"
              aria-label="Resolution notes"
              value={resolveNotes}
              onChange={(e) => setResolveNotes(e.target.value)}
              required
              minLength={10}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setResolveFor(null)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? 'Resolving…' : 'Mark resolved'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

function safeBigInt(value: string): bigint {
  try {
    return BigInt(value.replace(/[^0-9-]/g, '') || '0');
  } catch {
    return 0n;
  }
}
