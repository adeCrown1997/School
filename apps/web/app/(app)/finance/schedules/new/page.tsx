'use client';

/**
 * Create a fee schedule (docs/03 §11.2). Amounts are entered in NAIRA and sent
 * to the API as integer minor units (kobo) digit strings (§11.5). The clearance
 * threshold controls how much of the bill must be covered (payment + approved
 * waiver + loan) before registration clears.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { AcademicSession, Semester } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Field } from '@/components/ui';
import { PlusIcon, XIcon } from '@/components/icons';
import { nairaToMinor, formatNaira } from '@/lib/money';

interface ItemDraft {
  feeType: string;
  label: string;
  amountNaira: string;
  isMandatory: boolean;
}

const EMPTY_ITEM: ItemDraft = { feeType: '', label: '', amountNaira: '', isMandatory: true };

/** GET /structure/tree returns an ARRAY of universities, each with nested
 *  faculties → departments → programmes. Only the shape we read is typed. */
interface TreeUniversity {
  id: string;
  name: string;
  faculties?: Array<{ id: string; name: string; departments?: Array<{
    id: string;
    name: string;
    programmes?: Array<{ id: string; name: string; award?: string }>;
  }> }>;
}

const departmentsOf = (universities: TreeUniversity[]) =>
  universities.flatMap((u) => u.faculties ?? []).flatMap((f) => f.departments ?? []);

const programmesOf = (universities: TreeUniversity[], departmentId: string) =>
  departmentsOf(universities)
    .find((d) => d.id === departmentId)
    ?.programmes ?? [];

export default function NewFeeSchedulePage() {
  const router = useRouter();
  const { me } = useSession();
  const canManage = can(me?.permissions, PERMISSIONS.FINANCE_SCHEDULE_MANAGE);

  const [universities, setUniversities] = useState<TreeUniversity[]>([]);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [departmentId, setDepartmentId] = useState('');

  const [name, setName] = useState('');
  const [programmeId, setProgrammeId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [semesterId, setSemesterId] = useState('');
  const [threshold, setThreshold] = useState(100); // percent
  const [items, setItems] = useState<ItemDraft[]>([{ ...EMPTY_ITEM }]);

  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    api
      .get<TreeUniversity[]>('/structure/tree')
      .then((rows) => setUniversities(Array.isArray(rows) ? rows : []))
      .catch(() => {});
    api.get<AcademicSession[]>('/structure/sessions').then(setSessions).catch(() => {});
  }, [canManage]);

  // Programmes are embedded in the tree response — derive them from the
  // selected department instead of a second request.
  const programmes = programmesOf(universities, departmentId);

  useEffect(() => {
    if (!canManage || !sessionId) {
      setSemesters([]);
      setSemesterId('');
      return;
    }
    api.get<Semester[]>(`/structure/semesters?sessionId=${sessionId}`).then(setSemesters).catch(() => setSemesters([]));
  }, [canManage, sessionId]);

  function setItem(i: number, patch: Partial<ItemDraft>) {
    setItems((xs) => xs.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDetails(null);

    if (!name.trim()) return setError('Give the schedule a name.');
    if (!programmeId) return setError('Choose a programme.');
    if (!sessionId) return setError('Pin the schedule to a session so it can be invoiced.');
    if (items.length === 0) return setError('Add at least one fee item.');

    const payloadItems = [];
    for (const [i, it] of items.entries()) {
      if (!it.feeType.trim()) return setError(`Fee item ${i + 1}: enter a fee type.`);
      if (!it.label.trim()) return setError(`Fee item ${i + 1}: enter a label.`);
      const minor = nairaToMinor(it.amountNaira);
      if (minor === null || minor === '0')
        return setError(`Fee item ${i + 1}: enter a positive amount (e.g. 250000 or 250,000.00).`);
      payloadItems.push({
        feeType: it.feeType.trim().toUpperCase(),
        label: it.label.trim(),
        amount: minor,
        isMandatory: it.isMandatory,
        sortOrder: i,
      });
    }

    setSubmitting(true);
    try {
      const created = await api.post<{ id: string }>('/finance/schedules', {
        programmeId,
        name: name.trim(),
        sessionId,
        semesterId: semesterId || undefined,
        clearanceThresholdBps: Math.round(threshold * 100),
        items: payloadItems,
      });
      router.push(`/finance/schedules/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? null);
      } else setError('Failed to create the fee schedule.');
      setSubmitting(false);
    }
  }

  if (!canManage) return <AccessNotice />;

  return (
    <>
      <PageHeader
        title="New fee schedule"
        description="Define the fee items one programme pays for a session. Invoices snapshot these amounts, so changes after issuing require a new schedule."
        actions={
          <Link href="/finance/schedules" className="btn-secondary">
            Cancel
          </Link>
        }
      />

      <form onSubmit={submit} className="card mx-auto max-w-3xl space-y-6 p-6">
        {error ? (
          <Alert kind="error" title={error}>
            {details?.length ? (
              <ul className="ml-4 list-disc">
                {details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}

        <Field
          label="Schedule name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="2025/2026 — Computer Science (B.Sc)"
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="department" className="label">
              Department
            </label>
            <select
              id="department"
              className="input"
              value={departmentId}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                setProgrammeId('');
              }}
            >
              <option value="">Select department…</option>
              {departmentsOf(universities).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="programme" className="label">
              Programme
            </label>
            <select
              id="programme"
              className="input"
              value={programmeId}
              disabled={!departmentId}
              onChange={(e) => setProgrammeId(e.target.value)}
            >
              <option value="">{departmentId ? 'Select programme…' : 'Choose a department first'}</option>
              {programmes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.award})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="session" className="label">
              Session (required)
            </label>
            <select
              id="session"
              className="input"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              required
            >
              <option value="">Select session…</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.isCurrent ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="semester" className="label">
              Semester (optional)
            </label>
            <select
              id="semester"
              className="input"
              value={semesterId}
              disabled={!sessionId}
              onChange={(e) => setSemesterId(e.target.value)}
            >
              <option value="">Whole session</option>
              {semesters.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="threshold" className="label">
              Clearance threshold
            </label>
            <select
              id="threshold"
              className="input"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            >
              <option value={100}>Full payment (100%)</option>
              <option value={75}>Three quarters (75%)</option>
              <option value={50}>Half (50%)</option>
              <option value={25}>Quarter (25%)</option>
            </select>
            <p className="mt-1 text-xs text-slate-500">Minimum covered fraction for fee clearance.</p>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="label mb-0">Fee items</p>
            <button
              type="button"
              className="btn-ghost gap-1.5"
              onClick={() => setItems((xs) => [...xs, { ...EMPTY_ITEM }])}
            >
              <PlusIcon size={15} /> Add item
            </button>
          </div>
          <div className="space-y-3">
            {items.map((it, i) => (
              <div key={i} className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-[1fr_2fr_1fr_auto_auto]">
                <input
                  className="input"
                  placeholder="Fee type (TUITION)"
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
                    placeholder="0.00"
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
          </div>
          <p className="mt-2 text-right text-sm tabular-nums text-slate-600">
            Total:{' '}
            <span className="font-semibold text-slate-900">
              {formatNaira(
                items.reduce((acc, it) => {
                  const minor = nairaToMinor(it.amountNaira);
                  return acc + (minor ? BigInt(minor) : 0n);
                }, 0n),
              )}
            </span>
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Link href="/finance/schedules" className="btn-secondary">
            Cancel
          </Link>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create schedule'}
          </button>
        </div>
      </form>
    </>
  );
}
