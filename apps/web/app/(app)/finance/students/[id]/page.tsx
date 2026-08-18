'use client';

/**
 * One student's money picture (ledger service §11.4 read side): derived sums,
 * invoice history, waivers and the per-session fee-clearance verdict. This is
 * exactly what the registration fee gate queries — the verdict here is the
 * gate's verdict, never a cached flag.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { AcademicSession, ClearanceView, StudentLedgerView } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, PanelLoader, StatusBadge } from '@/components/ui';
import { formatNaira } from '@/lib/money';

export default function StudentLedgerPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.FINANCE_VIEW);

  const [data, setData] = useState<StudentLedgerView | null>(null);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [clearances, setClearances] = useState<ClearanceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ledger = await api.get<StudentLedgerView>(`/finance/students/${id}/ledger`);
      setData(ledger);
      const sessionIds = [
        ...new Set(ledger.invoices.map((i) => i.session?.id).filter((s): s is string => Boolean(s))),
      ];
      const verdicts = await Promise.all(
        sessionIds.map((sid) =>
          api.get<ClearanceView>(`/finance/students/${id}/clearance?sessionId=${sid}`).catch(() => null),
        ),
      );
      setClearances(verdicts.filter((v): v is ClearanceView => v !== null));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load the ledger.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!canView) return;
    api.get<AcademicSession[]>('/structure/sessions').then(setSessions).catch(() => {});
  }, [canView]);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

  if (!canView) return <AccessNotice />;
  if (forbidden) return <AccessNotice />;
  if (notFound) return <AccessNotice message="Student record not found." />;
  if (loading || !data) return <PanelLoader label="Computing ledger…" />;

  const credit = safeBigInt(data.sums.credits);
  const debit = safeBigInt(data.sums.debits);
  const balance = credit - debit;

  return (
    <>
      <PageHeader
        title={data.student.name}
        description={`${data.student.matriculationNumber} · derived from the append-only ledger (balances are sums, never stored)`}
        actions={
          <Link href="/finance" className="btn-secondary">
            Back to finance
          </Link>
        }
      />

      {error ? (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Billed (debits)</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{formatNaira(debit)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Covered (credits)</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{formatNaira(credit)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Balance</p>
          <p
            className={`mt-2 text-2xl font-bold tabular-nums ${
              balance >= 0n ? 'text-emerald-600' : 'text-red-600'
            }`}
          >
            {balance < 0n ? '−' : ''}
            {formatNaira(balance < 0n ? -balance : balance)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {balance >= 0n ? 'Payments and waivers cover the bills.' : 'Shortfall against billing.'}
          </p>
        </div>
      </div>

      {/* Clearance verdicts */}
      {clearances.length > 0 ? (
        <section className="card mb-6 p-6" aria-labelledby="led-clearance">
          <h2 id="led-clearance" className="card-title">
            Fee clearance by session
          </h2>
          <p className="card-subtitle">
            The same derived verdict the registration gate reads — payment + approved waivers + loan cover
            vs the schedule&apos;s threshold.
          </p>
          <ul className="mt-4 space-y-2">
            {clearances.map((c) => (
              <li
                key={c.session.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {c.session.name}
                    {!c.invoiced ? <span className="ml-2 text-xs font-normal text-slate-400">nothing invoiced</span> : null}
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
        <section className="card p-6" aria-labelledby="led-invoices">
          <h2 id="led-invoices" className="card-title">
            Invoices
          </h2>
          {data.invoices.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No invoices — generate from a fee schedule.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {data.invoices.map((inv) => (
                <li key={inv.id}>
                  <Link
                    href={`/finance/invoices/${inv.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5 transition-colors hover:border-brand-200 hover:bg-brand-50/40"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800">{inv.invoiceNumber}</p>
                      <p className="text-xs text-slate-400">
                        {inv.session?.name ?? '—'}
                        {inv.semester ? ` · ${inv.semester.name}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="text-xs tabular-nums text-slate-500">
                        {formatNaira(inv.paidAmount)} / {formatNaira(inv.totalAmount)}
                      </span>
                      <StatusBadge state={inv.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {data.waivers.length > 0 ? (
            <>
              <h3 className="mt-5 text-sm font-semibold text-slate-800">Waivers</h3>
              <ul className="mt-2 space-y-2">
                {data.waivers.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-700">
                        {formatNaira(w.amount)} · {w.invoiceNumber ?? '—'}
                      </p>
                      <p className="truncate text-xs text-slate-400">{w.reason}</p>
                    </div>
                    <StatusBadge state={w.status} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        {/* Ledger entries */}
        <section className="card p-6" aria-labelledby="led-entries">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 id="led-entries" className="card-title">
                Ledger entries
              </h2>
              <p className="card-subtitle">Append-only history, newest first.</p>
            </div>
            {sessions.length > 0 ? (
              <select
                className="input min-w-[10rem]"
                aria-label="Filter entries by session"
                defaultValue=""
                onChange={(e) => {
                  const sid = e.target.value;
                  void api
                    .get<StudentLedgerView>(
                      `/finance/students/${id}/ledger${sid ? `?sessionId=${sid}` : ''}`,
                    )
                    .then(setData)
                    .catch(() => setError('Failed to reload the ledger.'));
                }}
              >
                <option value="">All sessions</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          {data.entries.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No ledger entries yet.</p>
          ) : (
            <ul className="mt-4 max-h-[36rem] space-y-2 overflow-y-auto pr-1">
              {data.entries.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-700">{e.description}</p>
                    <p className="text-xs text-slate-400">
                      {e.source}
                      {e.invoiceNumber ? ` · ${e.invoiceNumber}` : ''} ·{' '}
                      {new Date(e.createdAt).toLocaleString()}
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
      </div>
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
