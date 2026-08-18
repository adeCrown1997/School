'use client';

/**
 * Invoice detail & actions (docs/03 §11.2, §11.3, §11.4).
 *
 *  - DRAFT: may be ISSUED (posts the DEBIT) or cancelled quietly.
 *  - ISSUED/PARTIALLY_PAID: payments are posted here (idempotent by provider
 *    reference) and reversals recorded; waivers may be requested.
 *  - Paid/waived invoices are read-only — money that moved only unwinds through
 *    audited reversals and waiver rejections, never edits.
 * Each action button is permission-gated for UX; the API re-checks every grant.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { InvoiceDetail, PaymentIntentItem } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Labeled, PanelLoader, StatusBadge } from '@/components/ui';
import { formatNaira, nairaToMinor } from '@/lib/money';
import { PlusIcon, XIcon } from '@/components/icons';

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.FINANCE_VIEW);
  const canInvoice = can(me?.permissions, PERMISSIONS.FINANCE_INVOICE_MANAGE);
  const canPayment = can(me?.permissions, PERMISSIONS.FINANCE_PAYMENT_MANAGE);
  const canWaiver = can(me?.permissions, PERMISSIONS.FINANCE_WAIVER_MANAGE);

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [payments, setPayments] = useState<PaymentIntentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [issueDue, setIssueDue] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payRef, setPayRef] = useState('');
  const [payProvider, setPayProvider] = useState('MANUAL');
  const [payAllowPartial, setPayAllowPartial] = useState(false);
  const [reverseFor, setReverseFor] = useState<PaymentIntentItem | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [waiveOpen, setWaiveOpen] = useState(false);
  const [waiveAmount, setWaiveAmount] = useState('');
  const [waiveFeeType, setWaiveFeeType] = useState('');
  const [waiveReason, setWaiveReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const [inv, pays] = await Promise.all([
        api.get<InvoiceDetail>(`/finance/invoices/${id}`),
        api
          .get<PaymentIntentItem[]>(`/finance/payments?invoiceId=${id}`)
          .catch(() => [] as PaymentIntentItem[]),
      ]);
      setInvoice(inv);
      setPayments(pays);
      setPayAmount(formatNairaInput(inv.outstanding));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load the invoice.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

  function apiError(err: unknown, fallback: string) {
    setError(err instanceof ApiError ? err.message : fallback);
  }

  async function issue() {
    if (!invoice) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post(`/finance/invoices/${invoice.id}/issue`, {
        dueAt: issueDue ? new Date(issueDue).toISOString() : undefined,
      });
      setSuccess('Invoice issued — the charge is now posted to the student ledger.');
      await load();
    } catch (err) {
      apiError(err, 'Failed to issue the invoice.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice || cancelReason.trim().length < 10) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/finance/invoices/${invoice.id}/cancel`, { reason: cancelReason.trim() });
      setCancelOpen(false);
      setCancelReason('');
      setSuccess('Invoice cancelled.');
      await load();
    } catch (err) {
      apiError(err, 'Failed to cancel the invoice.');
    } finally {
      setBusy(false);
    }
  }

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice) return;
    const minor = nairaToMinor(payAmount);
    if (minor === null || minor === '0') return setError('Enter a valid positive amount.');
    if (payRef.trim().length < 3) return setError('Enter the provider/bank reference.');
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.post<{ message: string }>('/finance/payments', {
        invoiceId: invoice.id,
        amount: minor,
        providerReference: payRef.trim(),
        provider: payProvider.trim() || 'MANUAL',
        allowPartial: payAllowPartial,
      });
      setPayOpen(false);
      setSuccess(res.message ?? 'Payment posted.');
      await load();
    } catch (err) {
      apiError(err, 'Failed to post the payment.');
    } finally {
      setBusy(false);
    }
  }

  async function reversePayment(e: React.FormEvent) {
    e.preventDefault();
    if (!reverseFor || reverseReason.trim().length < 10) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/finance/payments/reverse', {
        paymentIntentId: reverseFor.id,
        reason: reverseReason.trim(),
      });
      setReverseFor(null);
      setReverseReason('');
      setSuccess('Payment reversed — a compensating ledger entry was written.');
      await load();
    } catch (err) {
      apiError(err, 'Failed to reverse the payment.');
    } finally {
      setBusy(false);
    }
  }

  async function createWaiver(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice) return;
    const minor = nairaToMinor(waiveAmount);
    if (minor === null || minor === '0') return setError('Enter a valid waiver amount.');
    if (waiveReason.trim().length < 10) return setError('Give a reason (min 10 characters).');
    setBusy(true);
    setError(null);
    try {
      await api.post('/finance/waivers', {
        studentRecordId: invoice.student.id,
        invoiceId: invoice.id,
        amount: minor,
        reason: waiveReason.trim(),
        feeType: waiveFeeType.trim() || undefined,
      });
      setWaiveOpen(false);
      setWaiveAmount('');
      setWaiveReason('');
      setSuccess('Waiver requested — it posts to the ledger only after a different officer approves it.');
      await load();
    } catch (err) {
      apiError(err, 'Failed to create the waiver request.');
    } finally {
      setBusy(false);
    }
  }

  if (!canView) return <AccessNotice />;
  if (forbidden) return <AccessNotice />;
  if (notFound) return <AccessNotice message="Invoice not found." />;
  if (loading || !invoice) return <PanelLoader label="Loading invoice…" />;

  const live = invoice.status === 'ISSUED' || invoice.status === 'PARTIALLY_PAID';

  return (
    <>
      <PageHeader
        title={invoice.invoiceNumber}
        description={`${invoice.student.name} · ${invoice.student.matriculationNumber}${
          invoice.session ? ` · ${invoice.session.name}` : ''
        }${invoice.semester ? ` · ${invoice.semester.name}` : ''}`}
        actions={
          <>
            <StatusBadge state={invoice.status} />
            <Link href="/finance/invoices" className="btn-secondary">
              Back
            </Link>
          </>
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

      {/* Money summary */}
      <section className="card mb-6 animate-fade-up p-6" aria-labelledby="inv-totals">
        <h2 id="inv-totals" className="sr-only">
          Amounts
        </h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
          <Labeled label="Total billed">{formatNaira(invoice.totalAmount)}</Labeled>
          <Labeled label="Paid">{formatNaira(invoice.paidAmount)}</Labeled>
          <Labeled label="Waived">{formatNaira(invoice.waivedAmount)}</Labeled>
          <Labeled label="Outstanding">{formatNaira(invoice.outstanding)}</Labeled>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-slate-500 md:grid-cols-4">
          <p>Issued: {invoice.issuedAt ? new Date(invoice.issuedAt).toLocaleString() : '—'}</p>
          <p>Due: {invoice.dueAt ? new Date(invoice.dueAt).toLocaleDateString() : '—'}</p>
          <p>Created: {new Date(invoice.createdAt).toLocaleDateString()}</p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Lines */}
          <section className="card p-6" aria-labelledby="inv-lines">
            <h2 id="inv-lines" className="card-title">
              Invoice lines
            </h2>
            <p className="card-subtitle">Snapshot of the fee schedule at billing time.</p>
            <table className="mt-4 w-full min-w-[26rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2 pr-3">Fee type</th>
                  <th className="py-2 pr-3 text-right">Qty</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 pr-3 text-slate-800">{l.description}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{l.feeType ?? '—'}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">{l.quantity}</td>
                    <td className="py-2.5 text-right font-semibold tabular-nums text-slate-900">
                      {formatNaira(l.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Ledger */}
          <section className="card p-6" aria-labelledby="inv-ledger">
            <h2 id="inv-ledger" className="card-title">
              Ledger entries
            </h2>
            <p className="card-subtitle">Append-only history for this invoice — never edited.</p>
            {invoice.ledger.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                No ledger entries yet. {invoice.status === 'DRAFT' ? 'Issuing this invoice posts the charge.' : ''}
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {invoice.ledger.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-700">{e.description}</p>
                      <p className="text-xs text-slate-400">
                        {e.source} · {new Date(e.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-sm font-bold tabular-nums ${
                        e.direction === 'CREDIT' ? 'text-emerald-600' : 'text-slate-800'
                      }`}
                    >
                      {e.direction === 'CREDIT' ? '−' : '+'}
                      {formatNaira(e.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Payments */}
          <section className="card p-6" aria-labelledby="inv-payments">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="inv-payments" className="card-title">
                  Payment history
                </h2>
                <p className="card-subtitle">Every recorded attempt, idempotent by provider reference.</p>
              </div>
              {canPayment && live ? (
                <button className="btn-primary gap-1.5" onClick={() => setPayOpen((v) => !v)}>
                  <PlusIcon size={15} /> {payOpen ? 'Close' : 'Record payment'}
                </button>
              ) : null}
            </div>

            {payOpen && live ? (
              <form onSubmit={recordPayment} className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                      ₦
                    </span>
                    <input
                      className="input pl-7"
                      placeholder="Amount received"
                      inputMode="decimal"
                      aria-label="Amount received"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      required
                    />
                  </div>
                  <input
                    className="input"
                    placeholder="Bank / gateway reference"
                    aria-label="Provider reference"
                    value={payRef}
                    onChange={(e) => setPayRef(e.target.value)}
                    required
                    minLength={3}
                  />
                  <input
                    className="input"
                    placeholder="Provider (MANUAL, PAYSTACK…)"
                    aria-label="Provider name"
                    value={payProvider}
                    onChange={(e) => setPayProvider(e.target.value.toUpperCase())}
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    checked={payAllowPartial}
                    onChange={(e) => setPayAllowPartial(e.target.checked)}
                  />
                  Partial payment is intentional (instalment)
                </label>
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn-secondary" onClick={() => setPayOpen(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={busy}>
                    {busy ? 'Posting…' : 'Post payment'}
                  </button>
                </div>
              </form>
            ) : null}

            {payments.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No payments recorded against this invoice.</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">
                        {formatNaira(p.amount)}
                        <span className="font-normal text-slate-500"> via {p.provider ?? 'MANUAL'}</span>
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {p.providerReference ?? 'no reference'} ·{' '}
                        {p.postedAt ? new Date(p.postedAt).toLocaleString() : new Date(p.createdAt).toLocaleString()}
                        {p.discrepancyAmount && p.discrepancyAmount !== '0'
                          ? ` · shortfall ${formatNaira(p.discrepancyAmount)}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge state={p.status} />
                      {canPayment && (p.status === 'POSTED_TO_LEDGER' || p.status === 'UNDERPAID') ? (
                        <button
                          className="btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => {
                            setReverseFor(p);
                            setReverseReason('');
                          }}
                        >
                          Reverse
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Actions column */}
        <div className="space-y-6">
          {invoice.status === 'DRAFT' && canInvoice ? (
            <section className="card p-6" aria-labelledby="act-issue">
              <h2 id="act-issue" className="card-title">
                Issue this invoice
              </h2>
              <p className="card-subtitle">Posting the bill to the student ledger.</p>
              <div className="mt-4 space-y-3">
                <div>
                  <label htmlFor="issue-due" className="label">
                    Due date (optional)
                  </label>
                  <input
                    id="issue-due"
                    type="date"
                    className="input"
                    value={issueDue}
                    onChange={(e) => setIssueDue(e.target.value)}
                  />
                </div>
                <button className="btn-primary w-full" disabled={busy} onClick={issue}>
                  {busy ? 'Issuing…' : 'Issue invoice'}
                </button>
              </div>
            </section>
          ) : null}

          {live && canWaiver ? (
            <section className="card p-6" aria-labelledby="act-waive">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="act-waive" className="card-title">
                  Waivers
                </h2>
                <button className="btn-secondary" onClick={() => setWaiveOpen((v) => !v)}>
                  {waiveOpen ? 'Close' : 'Request waiver'}
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Approval requires a different officer (separation of duties).
              </p>
              {waiveOpen ? (
                <form onSubmit={createWaiver} className="mt-3 space-y-3">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                      ₦
                    </span>
                    <input
                      className="input pl-7"
                      placeholder={`Up to ${formatNaira(invoice.outstanding)}`}
                      inputMode="decimal"
                      aria-label="Waiver amount"
                      value={waiveAmount}
                      onChange={(e) => setWaiveAmount(e.target.value)}
                      required
                    />
                  </div>
                  <input
                    className="input"
                    placeholder="Fee type (optional, e.g. HOSTEL)"
                    aria-label="Fee type"
                    value={waiveFeeType}
                    onChange={(e) => setWaiveFeeType(e.target.value.toUpperCase())}
                  />
                  <textarea
                    className="input min-h-[4rem]"
                    placeholder="Reason (min 10 characters)"
                    aria-label="Waiver reason"
                    value={waiveReason}
                    onChange={(e) => setWaiveReason(e.target.value)}
                    required
                    minLength={10}
                  />
                  <button type="submit" className="btn-primary w-full" disabled={busy}>
                    {busy ? 'Requesting…' : 'Request waiver'}
                  </button>
                </form>
              ) : null}
              <ul className="mt-3 space-y-2">
                {invoice.waivers.map((w) => (
                  <li key={w.id} className="rounded-lg border border-slate-100 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold tabular-nums text-slate-900">
                        {formatNaira(w.amount)}
                      </span>
                      <StatusBadge state={w.status} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{w.reason}</p>
                    {w.decisionNote ? <p className="mt-1 text-xs text-slate-400">Note: {w.decisionNote}</p> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {(invoice.status === 'DRAFT' || live) && canInvoice && !cancelOpen ? (
            <button
              className="btn-secondary w-full text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => setCancelOpen(true)}
            >
              Cancel invoice
            </button>
          ) : null}
          {cancelOpen ? (
            <form onSubmit={cancel} className="card space-y-3 p-5">
              <h2 className="text-sm font-semibold text-slate-800">Cancel invoice</h2>
              <p className="text-xs text-slate-500">
                {invoice.status === 'DRAFT'
                  ? 'A draft is deleted outright — nothing was ever posted.'
                  : 'A compensating ledger credit undoes the posted charge.'}{' '}
                Not allowed once a payment or waiver is attached.
              </p>
              <textarea
                className="input min-h-[4rem]"
                placeholder="Reason (min 10 characters) — rides the audit trail"
                aria-label="Cancellation reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                required
                minLength={10}
              />
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setCancelOpen(false)}>
                  Keep invoice
                </button>
                <button type="submit" className="btn-primary bg-red-600 hover:bg-red-700" disabled={busy}>
                  {busy ? 'Cancelling…' : 'Cancel invoice'}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </div>

      {/* Reverse dialog */}
      {reverseFor ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <form onSubmit={reversePayment} className="card w-full max-w-lg space-y-4 p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900">Reverse payment</h2>
              <button type="button" className="btn-icon" aria-label="Close" onClick={() => setReverseFor(null)}>
                <XIcon size={16} />
              </button>
            </div>
            <p className="text-sm text-slate-600">
              {formatNaira(reverseFor.amount)} ({reverseFor.providerReference ?? reverseFor.provider}).
              The original ledger entry stays; a new <span className="font-semibold">REVERSAL debit</span> retires it.
            </p>
            <textarea
              className="input min-h-[5rem]"
              placeholder="Reason (min 10 characters) — refunds are never automatic"
              aria-label="Reversal reason"
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              required
              minLength={10}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setReverseFor(null)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary bg-red-600 hover:bg-red-700" disabled={busy}>
                {busy ? 'Reversing…' : 'Reverse payment'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

/** "12500000" kobo → "125000" naira for prefilling payment inputs. */
function formatNairaInput(minor: string): string {
  try {
    const v = BigInt(minor);
    const naira = v / 100n;
    const rem = v % 100n;
    return rem === 0n ? naira.toString() : `${naira}.${rem.toString().padStart(2, '0')}`;
  } catch {
    return '';
  }
}
