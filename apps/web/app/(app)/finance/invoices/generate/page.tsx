'use client';

/**
 * Generate DRAFT invoices from a fee schedule (docs/03 §11.2). Billing a cohort
 * is a consequential act: the form previews what will happen, and the API refuses
 * to double-bill (409) unless skipExisting is set. Generated invoices are DRAFT —
 * nothing hits the ledger until each is explicitly issued.
 */
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError, type ApiEnvelope } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { AcademicSession, FeeSchedule, Semester, StudentRecord } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Field } from '@/components/ui';
import { formatNaira } from '@/lib/money';
import { SearchIcon } from '@/components/icons';

interface GenerateResult {
  sessionId: string;
  semesterId: string | null;
  created: number;
  skippedExisting: number;
  totalPerInvoice: string;
  invoiceIds: string[];
}

export default function GenerateInvoicesPage() {
  const router = useRouter();
  const search = useSearchParams();
  const { me } = useSession();
  const canManage = can(me?.permissions, PERMISSIONS.FINANCE_INVOICE_MANAGE);

  const [schedules, setSchedules] = useState<FeeSchedule[]>([]);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [scheduleId, setScheduleId] = useState(search.get('scheduleId') ?? '');
  const [sessionId, setSessionId] = useState('');
  const [semesterId, setSemesterId] = useState('');
  const [skipExisting, setSkipExisting] = useState(false);

  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[] | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);

  useEffect(() => {
    if (!canManage) return;
    api
      .get<FeeSchedule[]>('/finance/schedules')
      .then((rows) => setSchedules(rows.filter((s) => s.isActive && s.items.length > 0)))
      .catch(() => {});
    api.get<AcademicSession[]>('/structure/sessions').then(setSessions).catch(() => {});
  }, [canManage]);

  useEffect(() => {
    if (!canManage || !sessionId) {
      setSemesters([]);
      return;
    }
    api.get<Semester[]>(`/structure/semesters?sessionId=${sessionId}`).then(setSemesters).catch(() => {});
  }, [canManage, sessionId]);

  const schedule = schedules.find((s) => s.id === scheduleId) ?? null;

  async function findStudents() {
    setSearching(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams({ pageSize: '20' });
      if (searchInput.trim()) params.set('search', searchInput.trim());
      const env = await api.getEnvelope<StudentRecord[]>(`/students?${params.toString()}`);
      setStudents(env.data);
    } catch (err) {
      setSearchError(err instanceof ApiError ? err.message : 'Student search failed.');
    } finally {
      setSearching(false);
    }
  }

  function toggleStudent(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDetails(null);
    setResult(null);
    if (!scheduleId) return setError('Choose a fee schedule.');
    setSubmitting(true);
    try {
      const res = await api.post<GenerateResult>('/finance/invoices/generate', {
        scheduleId,
        sessionId: sessionId || undefined,
        semesterId: semesterId || undefined,
        studentRecordIds: selected.size ? [...selected] : undefined,
        skipExisting,
      });
      setResult(res);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? null);
      } else setError('Failed to generate invoices.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!canManage) return <AccessNotice />;

  return (
    <>
      <PageHeader
        title="Generate invoices"
        description="Cut DRAFT invoices from a fee schedule. Drafts never touch the ledger — each invoice must be issued separately, which posts the charge."
        actions={
          <Link href="/finance/invoices" className="btn-secondary">
            Back to invoices
          </Link>
        }
      />

      {result ? (
        <div className="card mx-auto max-w-2xl p-6">
          <Alert kind="success" title={`${result.created} draft invoice(s) created`}>
            <p>
              {formatNaira(result.totalPerInvoice)} per invoice
              {result.skippedExisting > 0 ? ` · ${result.skippedExisting} already billed and skipped` : ''}.
            </p>
            <p className="mt-1">
              The invoices are <span className="font-semibold">DRAFT</span> — issue each one to post
              the charge to the student&apos;s ledger.
            </p>
          </Alert>
          <div className="mt-5 flex justify-end gap-2">
            <Link href="/finance/invoices" className="btn-primary">
              Review & issue invoices
            </Link>
          </div>
        </div>
      ) : (
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

          <div>
            <label htmlFor="schedule" className="label">
              Fee schedule
            </label>
            <select
              id="schedule"
              className="input"
              value={scheduleId}
              onChange={(e) => setScheduleId(e.target.value)}
              required
            >
              <option value="">Select schedule…</option>
              {schedules.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.programme.code} ({formatNaira(scheduleTotal(s))})
                </option>
              ))}
            </select>
            {schedule ? (
              <p className="mt-1 text-xs text-slate-500">
                Pinned to {schedule.session?.name ?? 'no session'}
                {schedule.Semester ? ` · ${schedule.Semester.name}` : ''} ·{' '}
                {schedule.items.length} fee item{schedule.items.length === 1 ? '' : 's'}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="g-session" className="label">
                Session override
              </label>
              <select
                id="g-session"
                className="input"
                value={sessionId}
                onChange={(e) => {
                  setSessionId(e.target.value);
                  setSemesterId('');
                }}
              >
                <option value="">Use the schedule&apos;s session</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.isCurrent ? ' (current)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="g-semester" className="label">
                Semester override
              </label>
              <select
                id="g-semester"
                className="input"
                value={semesterId}
                disabled={!sessionId}
                onChange={(e) => setSemesterId(e.target.value)}
              >
                <option value="">Use the schedule&apos;s semester</option>
                {semesters.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={skipExisting}
              onChange={(e) => setSkipExisting(e.target.checked)}
            />
            <span>
              Skip students who already have a bill for this period
              <span className="block text-xs text-slate-400">
                Without this, the request fails if anyone in the scope is already invoiced — the
                safe default against double billing.
              </span>
            </span>
          </label>

          <div className="border-t border-slate-100 pt-4">
            <p className="text-sm font-semibold text-slate-800">Optional: bill specific students only</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Leave empty to bill every active student on the schedule&apos;s programme.
            </p>

            <div
              className="mt-3 flex gap-2"
              role="search"
              onSubmitCapture={(e) => {
                // Enter in the search box must search, not submit the whole form.
                e.preventDefault();
                void findStudents();
              }}
            >
              <div className="relative max-w-xs flex-1">
                <SearchIcon
                  size={16}
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  className="input pl-9"
                  placeholder="Search matric no. or name…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void findStudents();
                    }
                  }}
                />
              </div>
              <button type="button" className="btn-secondary" disabled={searching} onClick={() => void findStudents()}>
                {searching ? 'Searching…' : 'Search'}
              </button>
            </div>
            {searchError ? <p className="mt-2 text-xs text-red-600">{searchError}</p> : null}

            {students.length > 0 ? (
              <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
                {students.map((st) => (
                  <li key={st.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        checked={selected.has(st.id)}
                        onChange={() => toggleStudent(st.id)}
                      />
                      <span className="min-w-0 truncate">
                        {st.surname} {st.firstName}
                        <span className="text-slate-400"> · {st.matriculationNumber}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            {selected.size > 0 ? (
              <p className="mt-2 text-xs text-slate-600">
                {selected.size} student{selected.size === 1 ? '' : 's'} selected — only they will be billed.
              </p>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Link href="/finance/invoices" className="btn-secondary">
              Cancel
            </Link>
            <button type="submit" className="btn-primary" disabled={submitting || !scheduleId}>
              {submitting ? 'Generating…' : 'Generate draft invoices'}
            </button>
          </div>
        </form>
      )}
    </>
  );
}

function scheduleTotal(s: FeeSchedule): bigint {
  return s.items.reduce((acc, it) => {
    try {
      return acc + BigInt(it.amount);
    } catch {
      return acc;
    }
  }, 0n);
}
