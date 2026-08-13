'use client';

/**
 * Staff registration calendar windows and policy (§9). Lists windows from
 * GET /registrations/windows; policy from GET /registrations/policy.
 * Window create/edit requires structure.manage; policy edit requires
 * academic.config.manage.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type {
  AcademicSession,
  CalendarWindowListItem,
  RegistrationPolicy,
  RegistrationWindowType,
  Semester,
} from '@/lib/types';
import { PageHeader, AccessNotice, EmptyState } from '@/components/page';
import { Alert, Spinner } from '@/components/ui';

const WINDOW_TYPES: { value: RegistrationWindowType; label: string }[] = [
  { value: 'REGISTRATION', label: 'Registration' },
  { value: 'ADD_DROP', label: 'Add / drop' },
  { value: 'LATE_REGISTRATION', label: 'Late registration' },
];

interface Filters {
  sessionId: string;
  semesterId: string;
  windowType: '' | RegistrationWindowType;
  includeInactive: boolean;
}

function windowTypeLabel(t: RegistrationWindowType): string {
  return WINDOW_TYPES.find((w) => w.value === t)?.label ?? t;
}

function scopeLabel(w: CalendarWindowListItem): string {
  if (w.scopeType === 'GLOBAL') return 'Global';
  if (w.scopeType === 'FACULTY' && w.faculty) return `Faculty: ${w.faculty.name}`;
  if (w.scopeType === 'DEPARTMENT' && w.department) return `Department: ${w.department.name}`;
  if (w.scopeType === 'PROGRAMME' && w.programme) return `Programme: ${w.programme.name}`;
  return w.scopeType;
}

function windowPhase(w: CalendarWindowListItem): { label: string; className: string } {
  if (!w.isActive) return { label: 'Suspended', className: 'bg-amber-100 text-amber-800' };
  const now = Date.now();
  const opens = new Date(w.opensAt).getTime();
  const closes = new Date(w.closesAt).getTime();
  if (now < opens) return { label: 'Not yet open', className: 'bg-slate-100 text-slate-600' };
  if (now > closes) return { label: 'Closed', className: 'bg-slate-200 text-slate-700' };
  return { label: 'Open now', className: 'bg-green-100 text-green-800' };
}

export default function RegistrationWindowsPage() {
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.REGISTRATION_VIEW);
  const canManageWindows = can(me?.permissions, PERMISSIONS.STRUCTURE_MANAGE);
  const canManagePolicy = can(me?.permissions, PERMISSIONS.ACADEMIC_CONFIG_MANAGE);

  const [rows, setRows] = useState<CalendarWindowListItem[]>([]);
  const [policy, setPolicy] = useState<RegistrationPolicy | null>(null);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);

  const [loading, setLoading] = useState(true);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<Filters>({
    sessionId: '',
    semesterId: '',
    windowType: '',
    includeInactive: false,
  });

  useEffect(() => {
    if (!canView) return;
    api.get<AcademicSession[]>('/structure/sessions').then(setSessions).catch(() => setSessions([]));
  }, [canView]);

  useEffect(() => {
    if (!canView || !filters.sessionId) {
      setSemesters([]);
      return;
    }
    api
      .get<Semester[]>(`/structure/semesters?sessionId=${filters.sessionId}`)
      .then(setSemesters)
      .catch(() => setSemesters([]));
  }, [canView, filters.sessionId]);

  const loadWindows = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (filters.sessionId) params.set('sessionId', filters.sessionId);
    if (filters.semesterId) params.set('semesterId', filters.semesterId);
    if (filters.windowType) params.set('windowType', filters.windowType);
    if (filters.includeInactive) params.set('includeInactive', 'true');
    try {
      const data = await api.get<CalendarWindowListItem[]>(
        `/registrations/windows?${params.toString()}`,
      );
      setRows(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load windows.');
    } finally {
      setLoading(false);
    }
  }, [canView, filters]);

  useEffect(() => {
    loadWindows();
  }, [loadWindows]);

  useEffect(() => {
    if (!canView) {
      setPolicyLoading(false);
      return;
    }
    setPolicyLoading(true);
    api
      .get<RegistrationPolicy>('/registrations/policy')
      .then(setPolicy)
      .catch(() => setPolicy(null))
      .finally(() => setPolicyLoading(false));
  }, [canView]);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => new Date(a.opensAt).getTime() - new Date(b.opensAt).getTime()),
    [rows],
  );

  if (!canView) return <AccessNotice />;

  return (
    <>
      <PageHeader
        title="Registration windows"
        description="Configure when students can register, add/drop or register late. Policy rules govern prerequisites, level spread and capacity."
        actions={
          canManageWindows ? (
            <Link href="/registrations/windows/new" className="btn-primary">
              New window
            </Link>
          ) : null
        }
      />

      <RegistrationPolicyPanel
        policy={policy}
        loading={policyLoading}
        canEdit={canManagePolicy}
        onSaved={setPolicy}
      />

      <form
        className="card mb-4 grid grid-cols-1 gap-3 p-4 md:grid-cols-5"
        onSubmit={(e) => e.preventDefault()}
      >
        <div>
          <label htmlFor="session" className="label">
            Session
          </label>
          <select
            id="session"
            className="input"
            value={filters.sessionId}
            onChange={(e) =>
              setFilters((f) => ({ ...f, sessionId: e.target.value, semesterId: '' }))
            }
          >
            <option value="">All sessions</option>
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
            Semester
          </label>
          <select
            id="semester"
            className="input"
            value={filters.semesterId}
            disabled={!filters.sessionId}
            onChange={(e) => setFilters((f) => ({ ...f, semesterId: e.target.value }))}
          >
            <option value="">All semesters</option>
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="windowType" className="label">
            Window type
          </label>
          <select
            id="windowType"
            className="input"
            value={filters.windowType}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                windowType: e.target.value as Filters['windowType'],
              }))
            }
          >
            <option value="">All types</option>
            {WINDOW_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={filters.includeInactive}
              onChange={(e) => setFilters((f) => ({ ...f, includeInactive: e.target.checked }))}
            />
            Include suspended
          </label>
        </div>
      </form>

      {error ? (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      {loading ? (
        <Spinner label="Loading windows…" />
      ) : forbidden ? (
        <AccessNotice />
      ) : sorted.length === 0 ? (
        <EmptyState title="No registration windows found">
          {canManageWindows
            ? 'Create a window to open registration for a session or semester.'
            : 'Try adjusting your filters.'}
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Session</th>
                <th className="px-4 py-3 font-medium">Semester</th>
                <th className="px-4 py-3 font-medium">Scope</th>
                <th className="px-4 py-3 font-medium">Opens</th>
                <th className="px-4 py-3 font-medium">Closes</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((w) => {
                const phase = windowPhase(w);
                return (
                  <tr
                    key={w.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                  >
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {windowTypeLabel(w.windowType)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{w.session.name}</td>
                    <td className="px-4 py-3 text-slate-600">{w.semester?.name ?? 'Whole session'}</td>
                    <td className="px-4 py-3 text-slate-600">{scopeLabel(w)}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">
                      {new Date(w.opensAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">
                      {new Date(w.closesAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${phase.className}`}>{phase.label}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canManageWindows ? (
                        <Link
                          href={`/registrations/windows/${w.id}`}
                          className="text-brand-700 hover:underline"
                        >
                          Edit
                        </Link>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && sorted.length > 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          {sorted.length} window{sorted.length === 1 ? '' : 's'}
        </p>
      ) : null}
    </>
  );
}

function RegistrationPolicyPanel({
  policy,
  loading,
  canEdit,
  onSaved,
}: {
  policy: RegistrationPolicy | null;
  loading: boolean;
  canEdit: boolean;
  onSaved: (p: RegistrationPolicy) => void;
}) {
  const [form, setForm] = useState<RegistrationPolicy | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (policy) setForm(policy);
  }, [policy]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !canEdit) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const saved = await api.post<RegistrationPolicy>('/registrations/policy', {
        prerequisiteEnforcement: form.prerequisiteEnforcement,
        levelSpread: form.levelSpread,
        allowRepeatForUpgrade: form.allowRepeatForUpgrade,
        enforceCapacity: form.enforceCapacity,
        timetableClash: form.timetableClash,
      });
      onSaved(saved);
      setForm(saved);
      setEditing(false);
      setSuccess('Registration policy saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save policy.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card mb-6 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Registration policy</h2>
          <p className="text-sm text-slate-500">
            Rules applied when students build their course list and submit.
            {policy?.isDefault ? ' Using system defaults — not yet configured.' : null}
          </p>
        </div>
        {canEdit && form && !editing ? (
          <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
            Edit policy
          </button>
        ) : null}
      </div>

      {loading ? (
        <Spinner label="Loading policy…" />
      ) : !form ? (
        <p className="text-sm text-slate-500">Policy could not be loaded.</p>
      ) : editing ? (
        <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
          {error ? <Alert kind="error">{error}</Alert> : null}
          <div>
            <label htmlFor="prereq" className="label">
              Prerequisite enforcement
            </label>
            <select
              id="prereq"
              className="input"
              value={form.prerequisiteEnforcement}
              onChange={(e) =>
                setForm((f) =>
                  f ? { ...f, prerequisiteEnforcement: e.target.value as 'BLOCK' | 'WARN' } : f,
                )
              }
            >
              <option value="BLOCK">Block — refuse unmet prerequisites</option>
              <option value="WARN">Warn — allow with warning for approvers</option>
            </select>
          </div>
          <div>
            <label htmlFor="levelSpread" className="label">
              Level spread (levels above own)
            </label>
            <input
              id="levelSpread"
              type="number"
              className="input"
              min={0}
              max={3}
              value={form.levelSpread}
              onChange={(e) =>
                setForm((f) => (f ? { ...f, levelSpread: Number(e.target.value) } : f))
              }
            />
          </div>
          <div>
            <label htmlFor="timetableClash" className="label">
              Timetable clash
            </label>
            <select
              id="timetableClash"
              className="input"
              value={form.timetableClash}
              onChange={(e) =>
                setForm((f) =>
                  f ? { ...f, timetableClash: e.target.value as 'BLOCK' | 'WARN' } : f,
                )
              }
            >
              <option value="BLOCK">Block submission</option>
              <option value="WARN">Warn only</option>
            </select>
          </div>
          <div className="flex flex-col gap-3 md:col-span-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.allowRepeatForUpgrade}
                onChange={(e) =>
                  setForm((f) => (f ? { ...f, allowRepeatForUpgrade: e.target.checked } : f))
                }
              />
              Allow repeat for grade upgrade (passed courses)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.enforceCapacity}
                onChange={(e) =>
                  setForm((f) => (f ? { ...f, enforceCapacity: e.target.checked } : f))
                }
              />
              Enforce offering capacity limits
            </label>
          </div>
          <div className="flex gap-2 md:col-span-2">
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save policy'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={submitting}
              onClick={() => {
                setEditing(false);
                if (policy) setForm(policy);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          {success ? (
            <div className="mb-3">
              <Alert kind="success">{success}</Alert>
            </div>
          ) : null}
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-slate-500">Prerequisites</dt>
              <dd className="font-medium text-slate-800">{form.prerequisiteEnforcement}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Level spread</dt>
              <dd className="font-medium text-slate-800">{form.levelSpread}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Timetable clash</dt>
              <dd className="font-medium text-slate-800">{form.timetableClash}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Repeat for upgrade</dt>
              <dd className="font-medium text-slate-800">
                {form.allowRepeatForUpgrade ? 'Allowed' : 'Not allowed'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Capacity enforcement</dt>
              <dd className="font-medium text-slate-800">
                {form.enforceCapacity ? 'Enforced' : 'Not enforced'}
              </dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
