'use client';

/**
 * Fee schedule detail. Shows the itemised structure and lets officers with
 * finance.schedule.manage edit the name/threshold/active flag. Item edits are
 * only offered while the schedule has NOT been invoiced — the API freezes items
 * after issuing (§11.2), and the UI refuses to offer what the server rejects.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { FeeSchedule } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, PanelLoader, StatusBadge } from '@/components/ui';
import { formatNaira, nairaToMinor } from '@/lib/money';
import { BanknoteIcon, PlusIcon, XIcon } from '@/components/icons';

interface ItemDraft {
  feeType: string;
  label: string;
  amountNaira: string;
  isMandatory: boolean;
}

function toNairaInput(minor: string): string {
  try {
    const v = BigInt(minor);
    const naira = v / 100n;
    const rem = v % 100n;
    return rem === 0n ? naira.toString() : `${naira}.${rem.toString().padStart(2, '0')}`;
  } catch {
    return '';
  }
}

export default function FeeScheduleDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.FINANCE_VIEW);
  const canManage = can(me?.permissions, PERMISSIONS.FINANCE_SCHEDULE_MANAGE);

  const [schedule, setSchedule] = useState<FeeSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [thresholdPct, setThresholdPct] = useState(100);
  const [editingItems, setEditingItems] = useState(false);
  const [items, setItems] = useState<ItemDraft[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const res = await api.get<FeeSchedule>(`/finance/schedules/${id}`);
      setSchedule(res);
      setName(res.name);
      setThresholdPct(res.clearanceThresholdBps / 100);
      setItems(
        res.items.map((it) => ({
          feeType: it.feeType,
          label: it.label,
          amountNaira: toNairaInput(it.amount),
          isMandatory: it.isMandatory,
        })),
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load the schedule.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

  function setItem(i: number, patch: Partial<ItemDraft>) {
    setItems((xs) => xs.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!schedule) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post(`/finance/schedules/${schedule.id}`, {
        name: name.trim(),
        clearanceThresholdBps: Math.round(thresholdPct * 100),
      });
      setSuccess('Schedule settings saved.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    if (!schedule) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post(`/finance/schedules/${schedule.id}`, { isActive: !schedule.isActive });
      setSuccess(schedule.isActive ? 'Schedule deactivated.' : 'Schedule activated.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update the schedule.');
    } finally {
      setBusy(false);
    }
  }

  async function saveItems(e: React.FormEvent) {
    e.preventDefault();
    if (!schedule) return;
    setError(null);
    const payload = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.feeType.trim()) return setError(`Item ${i + 1}: enter a fee type.`);
      if (!it.label.trim()) return setError(`Item ${i + 1}: enter a label.`);
      const minor = nairaToMinor(it.amountNaira);
      if (minor === null || minor === '0')
        return setError(`Item ${i + 1}: enter a positive amount.`);
      payload.push({
        feeType: it.feeType.trim().toUpperCase(),
        label: it.label.trim(),
        amount: minor,
        isMandatory: it.isMandatory,
        sortOrder: i,
      });
    }
    setBusy(true);
    try {
      await api.post(`/finance/schedules/${schedule.id}/items`, { items: payload });
      setEditingItems(false);
      setSuccess('Fee items replaced.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save the fee items.');
    } finally {
      setBusy(false);
    }
  }

  if (!canView) return <AccessNotice />;
  if (forbidden) return <AccessNotice />;
  if (notFound) return <AccessNotice message="Fee schedule not found." />;
  if (loading || !schedule) return <PanelLoader label="Loading schedule…" />;

  const frozen = schedule.invoiceCount > 0;
  const total = schedule.items.reduce((acc, it) => {
    try {
      return acc + BigInt(it.amount);
    } catch {
      return acc;
    }
  }, 0n);

  return (
    <>
      <PageHeader
        title={schedule.name}
        description={`${schedule.programme.code} · ${schedule.programme.name}${
          schedule.session ? ` · ${schedule.session.name}` : ''
        }${schedule.Semester ? ` · ${schedule.Semester.name}` : ''}`}
        actions={
          <>
            <StatusBadge state={schedule.isActive ? 'ACTIVE' : 'INACTIVE'} />
            <Link href="/finance/schedules" className="btn-secondary">
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

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <section className="card p-6 lg:col-span-1" aria-labelledby="sched-settings">
          <h2 id="sched-settings" className="card-title">
            Settings
          </h2>
          <p className="card-subtitle">Name and clearance threshold.</p>
          <form onSubmit={saveSettings} className="mt-4 space-y-4">
            <div>
              <label htmlFor="sched-name" className="label">
                Name
              </label>
              <input
                id="sched-name"
                className="input"
                value={name}
                disabled={!canManage}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="sched-threshold" className="label">
                Clearance threshold
              </label>
              <select
                id="sched-threshold"
                className="input"
                value={thresholdPct}
                disabled={!canManage}
                onChange={(e) => setThresholdPct(Number(e.target.value))}
              >
                <option value={100}>Full payment (100%)</option>
                <option value={75}>Three quarters (75%)</option>
                <option value={50}>Half (50%)</option>
                <option value={25}>Quarter (25%)</option>
              </select>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
              {canManage ? (
                <>
                  <button type="submit" className="btn-primary" disabled={busy}>
                    Save
                  </button>
                  <button type="button" className="btn-secondary" disabled={busy} onClick={toggleActive}>
                    {schedule.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </>
              ) : (
                <p className="text-xs text-slate-500">Read-only view.</p>
              )}
            </div>
          </form>
        </section>

        <section className="card p-6 lg:col-span-2" aria-labelledby="sched-items">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="sched-items" className="card-title">
                Fee items
              </h2>
              <p className="card-subtitle">
                {frozen
                  ? `${schedule.invoiceCount} invoice(s) issued — items are frozen by the ledger snapshot rule.`
                  : 'The amounts invoices are cut from.'}
              </p>
            </div>
            {canManage && !frozen && !editingItems ? (
              <button className="btn-secondary" onClick={() => setEditingItems(true)}>
                Replace items
              </button>
            ) : null}
          </div>

          {!editingItems ? (
            <table className="mt-4 w-full min-w-[30rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Label</th>
                  <th className="py-2 pr-3 text-right">Amount</th>
                  <th className="py-2">Mandatory</th>
                </tr>
              </thead>
              <tbody>
                {schedule.items.map((it) => (
                  <tr key={it.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 pr-3 font-medium text-slate-800">{it.feeType}</td>
                    <td className="py-2.5 pr-3 text-slate-600">{it.label}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold tabular-nums text-slate-900">
                      {formatNaira(it.amount)}
                    </td>
                    <td className="py-2.5 text-slate-600">{it.isMandatory ? 'Yes' : 'Optional'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="py-3 text-sm font-semibold text-slate-700">
                    Total per invoice
                  </td>
                  <td className="py-3 pr-3 text-right text-base font-bold tabular-nums text-slate-900">
                    {formatNaira(total)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          ) : (
            <form onSubmit={saveItems} className="mt-4 space-y-3">
              {items.map((it, i) => (
                <div
                  key={i}
                  className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-[1fr_2fr_1fr_auto_auto]"
                >
                  <input
                    className="input"
                    placeholder="Fee type"
                    aria-label={`Fee type for item ${i + 1}`}
                    value={it.feeType}
                    onChange={(e) => setItem(i, { feeType: e.target.value.toUpperCase() })}
                  />
                  <input
                    className="input"
                    placeholder="Label shown on the invoice"
                    aria-label={`Label for item ${i + 1}`}
                    value={it.label}
                    onChange={(e) => setItem(i, { label: e.target.value })}
                  />
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                      ₦
                    </span>
                    <input
                      className="input pl-7"
                      inputMode="decimal"
                      aria-label={`Amount for item ${i + 1}`}
                      value={it.amountNaira}
                      onChange={(e) => setItem(i, { amountNaira: e.target.value })}
                    />
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      checked={it.isMandatory}
                      onChange={(e) => setItem(i, { isMandatory: e.target.checked })}
                    />
                    mandatory
                  </label>
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label={`Remove item ${i + 1}`}
                    disabled={items.length === 1}
                    onClick={() => setItems((xs) => xs.filter((_, idx) => idx !== i))}
                  >
                    <XIcon size={16} />
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  className="btn-ghost gap-1.5"
                  onClick={() => setItems((xs) => [...xs, { feeType: '', label: '', amountNaira: '', isMandatory: true }])}
                >
                  <PlusIcon size={15} /> Add item
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setEditingItems(false);
                      setItems(
                        schedule.items.map((it) => ({
                          feeType: it.feeType,
                          label: it.label,
                          amountNaira: toNairaInput(it.amount),
                          isMandatory: it.isMandatory,
                        })),
                      );
                    }}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={busy}>
                    {busy ? 'Saving…' : 'Replace items'}
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Replacing items rewrites the whole set. This is refused by the API once any invoice
                exists for the schedule.
              </p>
            </form>
          )}
        </section>
      </div>

      {canManage ? (
        <section className="card flex flex-wrap items-center justify-between gap-3 p-6" aria-labelledby="sched-bill">
          <div>
            <h2 id="sched-bill" className="card-title">
              Invoice students from this schedule
            </h2>
            <p className="card-subtitle">
              Bills every active student on the programme (or a hand-picked list) for the pinned session.
            </p>
          </div>
          <Link href={`/finance/invoices/generate?scheduleId=${schedule.id}`} className="btn-primary gap-1.5">
            <BanknoteIcon size={16} /> Generate invoices
          </Link>
        </section>
      ) : null}
    </>
  );
}
