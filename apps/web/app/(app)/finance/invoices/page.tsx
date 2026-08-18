'use client';

/**
 * Invoice register (docs/03 §11.2). Scope-filtered by the API to the caller's
 * finance.view scope. Actions (issue, cancel) live on the detail page; this
 * list is the bursary's working queue.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { AcademicSession, InvoiceListItem, InvoiceStatus } from '@/lib/types';
import { PageHeader, AccessNotice, EmptyState } from '@/components/page';
import { Alert, Spinner, StatusBadge } from '@/components/ui';
import { Pagination, type PageMeta } from '@/components/pagination';
import { formatNaira } from '@/lib/money';
import { ChevronRightIcon, PlusIcon } from '@/components/icons';

const STATUSES: Array<InvoiceStatus | ''> = [
  '',
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED',
  'VOID',
];

export default function InvoicesPage() {
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.FINANCE_VIEW);
  const canManage = can(me?.permissions, PERMISSIONS.FINANCE_INVOICE_MANAGE);

  const [rows, setRows] = useState<InvoiceListItem[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [status, setStatus] = useState<InvoiceStatus | ''>('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    api.get<AcademicSession[]>('/structure/sessions').then(setSessions).catch(() => {});
  }, [canView]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (sessionId) params.set('sessionId', sessionId);
      if (status) params.set('status', status);
      const env = await api.getEnvelope<InvoiceListItem[]>(`/finance/invoices?${params.toString()}`);
      setRows(env.data);
      const m = (env.meta ?? {}) as Partial<PageMeta>;
      setMeta(
        m.total !== undefined
          ? {
              page: (m.page ?? page) as number,
              pageSize: (m.pageSize ?? 20) as number,
              total: m.total as number,
              totalPages: (m.totalPages ?? 1) as number,
            }
          : null,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load invoices.');
    } finally {
      setLoading(false);
    }
  }, [page, sessionId, status]);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

  if (!canView) return <AccessNotice />;
  if (forbidden) return <AccessNotice />;

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Student billing within your scope. Drafts post to the ledger only when issued; cancellations of issued bills write compensating entries."
        actions={
          canManage ? (
            <Link href="/finance/invoices/generate" className="btn-primary gap-1.5">
              <PlusIcon size={15} /> Generate invoices
            </Link>
          ) : undefined
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        <select
          className="input min-w-[11rem]"
          value={sessionId}
          aria-label="Filter by session"
          onChange={(e) => {
            setSessionId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All sessions</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.isCurrent ? ' (current)' : ''}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
          {STATUSES.map((s) => {
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
                onClick={() => {
                  setStatus(s);
                  setPage(1);
                }}
              >
                {s ? s.replace(/_/g, ' ') : 'All'}
              </button>
            );
          })}
        </div>
      </div>

      {error ? (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      {loading ? (
        <Spinner label="Loading invoices…" />
      ) : rows.length === 0 ? (
        <EmptyState title="No invoices match these filters.">
          Generate invoices from a fee schedule to bill students for a session.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {rows.map((inv) => (
            <InvoiceRow key={inv.id} invoice={inv} />
          ))}
        </div>
      )}

      <Pagination meta={meta} onPage={setPage} />
    </>
  );
}

function InvoiceRow({ invoice }: { invoice: InvoiceListItem }) {
  const initials = invoice.student.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

  return (
    <Link
      href={`/finance/invoices/${invoice.id}`}
      className="group card flex flex-wrap items-center justify-between gap-3 p-5 transition-all hover:-translate-y-px hover:border-brand-200 hover:shadow-card-hover"
    >
      <div className="flex min-w-0 items-center gap-3.5">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700"
        >
          {initials || '–'}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">
            {invoice.student.name}
            <span className="font-normal text-slate-500"> · {invoice.student.matriculationNumber}</span>
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {invoice.invoiceNumber}
            {invoice.session ? ` · ${invoice.session.name}` : ''}
            {invoice.dueAt ? ` · due ${new Date(invoice.dueAt).toLocaleDateString()}` : ''}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="text-sm font-bold tabular-nums text-slate-900">
            {formatNaira(invoice.paidAmount)}
            <span className="font-normal text-slate-400"> / {formatNaira(invoice.totalAmount)}</span>
          </p>
        </div>
        <StatusBadge state={invoice.status} />
        <ChevronRightIcon
          size={16}
          className="text-slate-400 transition-transform group-hover:translate-x-0.5"
        />
      </div>
    </Link>
  );
}
