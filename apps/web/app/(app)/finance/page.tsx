'use client';

/**
 * Bursary overview (docs/03 §11.5). Every figure is DERIVED by the API from the
 * append-only ledger and live invoices — nothing here is stored state, and no
 * number is invented in the UI. The session filter simply re-asks the API.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { AcademicSession, FinanceOverview } from '@/lib/types';
import { PageHeader, AccessNotice, EmptyState } from '@/components/page';
import { Alert, BreakdownRow, PanelLoader, StatCard } from '@/components/ui';
import { formatNaira } from '@/lib/money';
import {
  BanknoteIcon,
  ClipboardListIcon,
  FileTextIcon,
  LandmarkIcon,
  LayersIcon,
  RefreshIcon,
  ShieldCheckIcon,
} from '@/components/icons';

const INVOICE_STATUS_ORDER = [
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED',
  'VOID',
] as const;

export default function FinanceOverviewPage() {
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.FINANCE_VIEW);

  const [data, setData] = useState<FinanceOverview | null>(null);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = sessionId ? `?sessionId=${sessionId}` : '';
      setData(await api.get<FinanceOverview>(`/finance/overview${params}`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load the finance overview.');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

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

  return (
    <>
      <PageHeader
        title="Finance"
        description="Live receivables position: billed vs received vs waived, the waiver pipeline and loan clearances. Balances are computed from the append-only ledger on every read."
        actions={
          <>
            <select
              className="input min-w-[11rem]"
              value={sessionId}
              aria-label="Filter by session"
              onChange={(e) => setSessionId(e.target.value)}
            >
              <option value="">All sessions</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.isCurrent ? ' (current)' : ''}
                </option>
              ))}
            </select>
            <button className="btn-secondary gap-1.5" onClick={load} disabled={loading}>
              <RefreshIcon size={15} /> Refresh
            </button>
          </>
        }
      />

      <nav className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Finance areas">
        <AreaLink href="/finance/schedules" icon={<LayersIcon size={18} />} label="Fee schedules" />
        <AreaLink href="/finance/invoices" icon={<FileTextIcon size={18} />} label="Invoices" />
        <AreaLink href="/finance/waivers" icon={<ShieldCheckIcon size={18} />} label="Waivers & loans" />
        <AreaLink href="/finance/payments" icon={<BanknoteIcon size={18} />} label="Payments & reconciliation" />
      </nav>

      {error ? (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      {loading || !data ? (
        <PanelLoader label="Computing ledger positions…" />
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Billed"
              value={formatNaira(data.billed)}
              sub="Issued invoices in scope"
              icon={<FileTextIcon size={20} />}
              tone="brand"
            />
            <StatCard
              label="Received"
              value={formatNaira(data.received)}
              sub="Posted payments"
              icon={<BanknoteIcon size={20} />}
              tone="emerald"
            />
            <StatCard
              label="Waived"
              value={formatNaira(data.waived)}
              sub="Approved waivers on live invoices"
              icon={<ShieldCheckIcon size={20} />}
              tone="violet"
            />
            <StatCard
              label="Outstanding"
              value={formatNaira(data.outstanding)}
              sub="Billed − received − waived"
              icon={<LandmarkIcon size={20} />}
              tone="amber"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card animate-fade-up p-6" aria-labelledby="fin-by-status">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"
                >
                  <ClipboardListIcon size={20} />
                </span>
                <div>
                  <h2 id="fin-by-status" className="card-title">
                    Invoices by status
                  </h2>
                  <p className="card-subtitle">Count and billed total per invoice state.</p>
                </div>
              </div>
              {Object.keys(data.invoices).length === 0 ? (
                <div className="mt-5">
                  <EmptyState title="No invoices yet.">
                    Generate and issue invoices from a fee schedule to see them here.
                  </EmptyState>
                </div>
              ) : (
                <ul className="mt-5 space-y-4">
                  {INVOICE_STATUS_ORDER.filter((s) => data.invoices[s]).map((status) => {
                    const g = data.invoices[status];
                    return (
                      <BreakdownRow
                        key={status}
                        label={status}
                        count={g.count}
                        total={Object.values(data.invoices).reduce((a, b) => a + b.count, 0)}
                        badge={
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-slate-700">
                              {status.replace(/_/g, ' ')}
                            </span>
                            <span className="text-xs text-slate-400">{formatNaira(g.billed)} billed</span>
                          </span>
                        }
                        barClass={
                          status === 'PAID'
                            ? 'bg-emerald-500'
                            : status === 'PARTIALLY_PAID'
                              ? 'bg-amber-500'
                              : status === 'ISSUED'
                                ? 'bg-brand-500'
                                : 'bg-slate-400'
                        }
                      />
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="card animate-fade-up p-6" aria-labelledby="fin-pipeline">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600"
                >
                  <ShieldCheckIcon size={20} />
                </span>
                <div>
                  <h2 id="fin-pipeline" className="card-title">
                    Waivers & loans
                  </h2>
                  <p className="card-subtitle">Awaiting dual approval, and loan-funded students.</p>
                </div>
              </div>
              <dl className="mt-5 space-y-4">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
                  <dt className="text-sm text-slate-600">Pending waivers</dt>
                  <dd className="text-right">
                    <span className="block text-lg font-bold tabular-nums text-slate-900">
                      {data.pendingWaivers.count}
                    </span>
                    <span className="text-xs text-slate-500">
                      {formatNaira(data.pendingWaivers.amount)} requested
                    </span>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-sm text-slate-600">Approved loan clearances</dt>
                  <dd className="text-lg font-bold tabular-nums text-slate-900">
                    {data.approvedLoanClearances}
                  </dd>
                </div>
              </dl>
              <div className="mt-6 flex flex-wrap gap-2">
                <Link href="/finance/waivers" className="btn-secondary">
                  Review pending waivers
                </Link>
              </div>
            </section>
          </div>
        </>
      )}
    </>
  );
}

function AreaLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="card group flex items-center gap-3 p-4 transition-all hover:-translate-y-px hover:border-brand-200 hover:shadow-card-hover"
    >
      <span
        aria-hidden
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"
      >
        {icon}
      </span>
      <span className="text-sm font-semibold text-slate-800">{label}</span>
    </Link>
  );
}
