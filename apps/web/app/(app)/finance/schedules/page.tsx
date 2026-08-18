'use client';

/**
 * Fee schedules list (docs/03 §11.2). A schedule is one programme's fee
 * structure for a session. Once any invoice has been issued from it the items
 * are FROZEN — the list shows invoiceCount so officers can see at a glance
 * which schedules are locked by the ledger's snapshot rule.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { FeeSchedule } from '@/lib/types';
import { PageHeader, AccessNotice, EmptyState } from '@/components/page';
import { Alert, PanelLoader, StatusBadge } from '@/components/ui';
import { formatNaira } from '@/lib/money';
import { ChevronRightIcon, PlusIcon } from '@/components/icons';

export default function FeeSchedulesPage() {
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.FINANCE_VIEW);
  const canManage = can(me?.permissions, PERMISSIONS.FINANCE_SCHEDULE_MANAGE);

  const [rows, setRows] = useState<FeeSchedule[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<FeeSchedule[]>(
        `/finance/schedules?includeInactive=${includeInactive ? 'true' : 'false'}`,
      );
      setRows(res);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load fee schedules.');
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

  if (!canView) return <AccessNotice />;
  if (forbidden) return <AccessNotice />;

  return (
    <>
      <PageHeader
        title="Fee schedules"
        description="Per-programme fee structures. Invoices snapshot these amounts when issued, so a schedule's items freeze once anything has been billed from it."
        actions={
          canManage ? (
            <Link href="/finance/schedules/new" className="btn-primary gap-1.5">
              <PlusIcon size={15} /> New schedule
            </Link>
          ) : undefined
        }
      />

      <label className="mb-4 flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          checked={includeInactive}
          onChange={(e) => setIncludeInactive(e.target.checked)}
        />
        Include inactive schedules
      </label>

      {error ? (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      {loading ? (
        <PanelLoader label="Loading fee schedules…" />
      ) : rows.length === 0 ? (
        <EmptyState title="No fee schedules.">
          Create a schedule for a programme to define its fee structure before invoicing.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {rows.map((s) => (
            <ScheduleRow key={s.id} schedule={s} />
          ))}
        </div>
      )}
    </>
  );
}

function ScheduleRow({ schedule }: { schedule: FeeSchedule }) {
  const total = schedule.items.reduce((acc, i) => {
    try {
      return acc + BigInt(i.amount);
    } catch {
      return acc;
    }
  }, 0n);
  const frozen = schedule.invoiceCount > 0;

  return (
    <Link
      href={`/finance/schedules/${schedule.id}`}
      className="group card flex flex-wrap items-center justify-between gap-3 p-5 transition-all hover:-translate-y-px hover:border-brand-200 hover:shadow-card-hover"
    >
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
          {schedule.name}
          <StatusBadge state={schedule.isActive ? 'ACTIVE' : 'INACTIVE'} />
          {frozen ? (
            <span
              className="badge bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-500/20"
              title="Items are frozen because invoices were issued from this schedule"
            >
              items frozen
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          {schedule.programme.code} {schedule.programme.name}
          {schedule.session ? ` · ${schedule.session.name}` : ' · no session'}
          {schedule.Semester ? ` · ${schedule.Semester.name}` : ''}
          {` · ${schedule.items.length} fee item${schedule.items.length === 1 ? '' : 's'}`}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="text-sm font-bold tabular-nums text-slate-900">{formatNaira(total)}</p>
          <p className="text-xs text-slate-500">
            {schedule.invoiceCount} invoice{schedule.invoiceCount === 1 ? '' : 's'} issued
          </p>
        </div>
        <ChevronRightIcon
          size={16}
          className="text-slate-400 transition-transform group-hover:translate-x-0.5"
        />
      </div>
    </Link>
  );
}
