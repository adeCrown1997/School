'use client';

/**
 * Edit a registration calendar window. Scope is immutable after creation;
 * dates, notes and active flag can be updated. Requires structure.manage.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { CalendarWindowListItem, RegistrationWindowType } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert } from '@/components/ui';

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const WINDOW_LABELS: Record<RegistrationWindowType, string> = {
  REGISTRATION: 'Registration',
  ADD_DROP: 'Add / drop',
  LATE_REGISTRATION: 'Late registration',
};

function scopeSummary(w: CalendarWindowListItem): string {
  if (w.scopeType === 'GLOBAL') return 'Global';
  if (w.scopeType === 'FACULTY' && w.faculty) return w.faculty.name;
  if (w.scopeType === 'DEPARTMENT' && w.department) return w.department.name;
  if (w.scopeType === 'PROGRAMME' && w.programme) return `${w.programme.name}`;
  return w.scopeType;
}

export default function EditRegistrationWindowPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { me } = useSession();
  const canManage = can(me?.permissions, PERMISSIONS.STRUCTURE_MANAGE);

  const [window, setWindow] = useState<CalendarWindowListItem | null>(null);
  const [form, setForm] = useState({ opensAt: '', closesAt: '', notes: '', isActive: true });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canManage || !id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await api.get<CalendarWindowListItem[]>(
        '/registrations/windows?includeInactive=true',
      );
      const found = rows.find((w) => w.id === id);
      if (!found) {
        setError('Calendar window not found.');
        setWindow(null);
        return;
      }
      setWindow(found);
      setForm({
        opensAt: toDatetimeLocal(found.opensAt),
        closesAt: toDatetimeLocal(found.closesAt),
        notes: found.notes ?? '',
        isActive: found.isActive,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load window.');
    } finally {
      setLoading(false);
    }
  }, [canManage, id]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setError(null);
    setDetails(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await api.patch(`/registrations/windows/${id}`, {
        opensAt: new Date(form.opensAt).toISOString(),
        closesAt: new Date(form.closesAt).toISOString(),
        notes: form.notes.trim() || null,
        isActive: form.isActive,
      });
      await load();
      setSuccess('Window updated.');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? null);
      } else setError('Failed to update the window.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!canManage) return <AccessNotice />;

  if (loading) {
    return <p className="text-sm text-slate-500">Loading window…</p>;
  }

  if (!window) {
    return (
      <>
        <PageHeader title="Window not found" />
        {error ? <Alert kind="error">{error}</Alert> : null}
        <Link href="/registrations/windows" className="btn-secondary mt-4 inline-block">
          Back to windows
        </Link>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={WINDOW_LABELS[window.windowType]}
        description={`${window.session.name}${window.semester ? ` · ${window.semester.name}` : ' · whole session'} · ${scopeSummary(window)}`}
        actions={
          <Link href="/registrations/windows" className="btn-secondary">
            Back to list
          </Link>
        }
      />

      <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Scope and audience cannot be changed after creation. To target a different faculty,
        department or programme, suspend this window and create a new one.
      </div>

      <form onSubmit={submit} className="card mx-auto max-w-2xl space-y-6 p-6">
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
        {success ? <Alert kind="success">{success}</Alert> : null}

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
          />
          Window is active (uncheck to suspend without changing published dates)
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="opensAt" className="label">
              Opens at
            </label>
            <input
              id="opensAt"
              type="datetime-local"
              className="input"
              required
              value={form.opensAt}
              onChange={(e) => setForm((f) => ({ ...f, opensAt: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="closesAt" className="label">
              Closes at
            </label>
            <input
              id="closesAt"
              type="datetime-local"
              className="input"
              required
              value={form.closesAt}
              onChange={(e) => setForm((f) => ({ ...f, closesAt: e.target.value }))}
            />
          </div>
        </div>

        <div>
          <label htmlFor="notes" className="label">
            Notes
          </label>
          <textarea
            id="notes"
            className="input min-h-[4rem]"
            maxLength={500}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={submitting}
            onClick={() => router.push('/registrations/windows')}
          >
            Done
          </button>
        </div>
      </form>
    </>
  );
}
