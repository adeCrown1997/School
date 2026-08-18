'use client';

/**
 * Student "My finance" self-service (GET /me/finance — ownership-gated, the
 * student sees ONLY their own money). Shows the current standing per invoiced
 * session (the same derived clearance verdict the registration gate reads),
 * the invoice list with paid/total per bill, waivers and loan clearances.
 * No payment initiation here in v1 — bills are settled at the bank/gateway and
 * posted by the bursary; what matters to the student is the honest standing.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import type { OwnFinanceView } from '@/lib/types';
import { PageHeader, AccessNotice, EmptyState } from '@/components/page';
import { Alert, PanelLoader, StatusBadge } from '@/components/ui';
import { formatNaira } from '@/lib/money';
import { BanknoteIcon, FileTextIcon, ShieldCheckIcon } from '@/components/icons';

export default function MyFinancePage() {
  const [data, setData] = useState<OwnFinanceView | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<OwnFinanceView>('/me/finance');
        if (!cancelled) setData(res);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof ApiError ? err.message : 'Failed to load your finance record.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <PanelLoader label="Loading your finance record…" />;
  if (forbidden)
    return <AccessNotice message="This page is only available to an activated student account." />;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return null;

  const credit = safeBigInt(data.sums.credits);
  const debit = safeBigInt(data.sums.debits);

  return (
    <>
      <PageHeader
        title="My finance"
        description="Your billed charges, payments, waivers and loan clearances — and whether each session is cleared for registration."
      />

      {/* Standing */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Billed to you</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{formatNaira(debit)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Paid / waived / covered</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{formatNaira(credit)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Standing</p>
          {credit - debit >= 0n ? (
            <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-600">In credit</p>
          ) : (
            <>
              <p className="mt-2 text-2xl font-bold tabular-nums text-red-600">
                −{formatNaira(debit - credit)}
              </p>
              <p className="mt-1 text-xs text-slate-500">Outstanding against your bills.</p>
            </>
          )}
        </div>
      </div>

      {/* Session clearance */}
      {data.clearances.length > 0 ? (
        <section className="card mb-6 p-6" aria-labelledby="mf-clearance">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"
            >
              <ShieldCheckIcon size={20} />
            </span>
            <div>
              <h2 id="mf-clearance" className="card-title">
                Session clearance
              </h2>
              <p className="card-subtitle">
                Cleared here means you can register for the session without a fee block.
              </p>
            </div>
          </div>
          <ul className="mt-4 space-y-2">
            {data.clearances.map((c) => (
              <li
                key={c.sessionId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {c.sessionName ?? 'Session'}
                    {!c.invoiced ? (
                      <span className="ml-2 text-xs font-normal text-slate-400">no bill issued yet</span>
                    ) : null}
                  </p>
                  {c.invoiced ? (
                    <p className="text-xs text-slate-500">
                      Billed {formatNaira(c.billed)} · covered {formatNaira(c.covered)}
                      {!c.cleared ? ` · shortfall ${formatNaira(c.shortfall)}` : ''}
                    </p>
                  ) : null}
                </div>
                <StatusBadge state={c.cleared ? 'CLEARED' : c.invoiced ? 'NOT_CLEARED' : 'VOID'} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Invoices */}
        <section className="card p-6" aria-labelledby="mf-invoices">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"
            >
              <FileTextIcon size={20} />
            </span>
            <div>
              <h2 id="mf-invoices" className="card-title">
                My invoices
              </h2>
              <p className="card-subtitle">Bills issued for each session.</p>
            </div>
          </div>
          {data.invoices.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="No invoices yet.">
                Your bills will appear here once the bursary issues them for the session.
              </EmptyState>
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {data.invoices.map((inv) => (
                <li
                  key={inv.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{inv.invoiceNumber}</p>
                    <p className="text-xs text-slate-400">
                      {inv.session?.name ?? '—'}
                      {inv.semester ? ` · ${inv.semester.name}` : ''}
                      {inv.dueAt ? ` · due ${new Date(inv.dueAt).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs tabular-nums text-slate-500">
                      {formatNaira(inv.paidAmount)} / {formatNaira(inv.totalAmount)}
                    </span>
                    <StatusBadge state={inv.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Waivers & loans */}
        <section className="card p-6" aria-labelledby="mf-waivers">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600"
            >
              <BanknoteIcon size={20} />
            </span>
            <div>
              <h2 id="mf-waivers" className="card-title">
                Waivers & loans
              </h2>
              <p className="card-subtitle">Reductions and loan coverages applied to your bills.</p>
            </div>
          </div>
          {data.waivers.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              No waivers recorded. If a waiver or loan clearance applies to you, the bursary processes
              it and it will show here once approved.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {data.waivers.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-700">
                      {formatNaira(w.amount)} · {w.feeType ?? 'Waiver'}
                    </p>
                    <p className="text-xs text-slate-400">{new Date(w.createdAt).toLocaleDateString()}</p>
                  </div>
                  <StatusBadge state={w.status} />
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-800">Loan clearances</h3>
            <LoanList />
          </div>
        </section>
      </div>

      <p className="mt-6 text-xs leading-5 text-slate-500">
        Disputing a charge? Visit the bursary with the invoice number shown above. Payments and
        clearances are posted by the university after your bank transfer is verified — this page
        reflects the official ledger, not gateway callbacks.{' '}
        <Link href="/student" className="font-medium text-brand-600 hover:text-brand-700">
          Back to your dashboard
        </Link>
      </p>
    </>
  );
}

function LoanList() {
  const [loans, setLoans] = useState<
    Array<{
      id: string;
      loanProvider: string;
      reference: string;
      amountCovered: string;
      status: string;
      session: { name: string };
    }>
  >([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .get<never[]>('/me/finance/loans')
      .then((rows) => {
        setLoans(
          (rows as unknown as Array<{
            id: string;
            loanProvider: string;
            reference: string;
            amountCovered: string;
            status: string;
            session?: { name: string };
          }>).map((r) => ({
            id: r.id,
            loanProvider: r.loanProvider,
            reference: r.reference,
            amountCovered: r.amountCovered,
            status: r.status,
            session: r.session ?? { name: '' },
          })),
        );
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return <p className="mt-2 text-xs text-slate-400">Loading…</p>;
  if (loans.length === 0) {
    return <p className="mt-2 text-sm text-slate-500">No loan clearances on your account.</p>;
  }
  return (
    <ul className="mt-2 space-y-2">
      {loans.map((l) => (
        <li
          key={l.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5"
        >
          <div className="min-w-0">
            <p className="text-sm text-slate-700">
              {l.loanProvider} · {formatNaira(l.amountCovered)}
            </p>
            <p className="truncate text-xs text-slate-400">
              Ref {l.reference}
              {l.session.name ? ` · ${l.session.name}` : ''}
            </p>
          </div>
          <StatusBadge state={l.status} />
        </li>
      ))}
    </ul>
  );
}

function safeBigInt(value: string): bigint {
  try {
    return BigInt(value.replace(/[^0-9-]/g, '') || '0');
  } catch {
    return 0n;
  }
}
