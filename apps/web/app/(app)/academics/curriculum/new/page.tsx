'use client';

/**
 * Create a draft curriculum version for a programme. Requires CURRICULUM_MANAGE.
 * The effective-from session anchors the admission cohort (INV-7).
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { AcademicSession, Programme } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Field } from '@/components/ui';

export default function NewCurriculumPage() {
  const router = useRouter();
  const { me } = useSession();
  const canManage = can(me?.permissions, PERMISSIONS.CURRICULUM_MANAGE);

  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);

  const [form, setForm] = useState({
    programmeId: '',
    name: '',
    effectiveFromSessionId: '',
    notes: '',
  });

  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    api.get<Programme[]>('/structure/programmes').then(setProgrammes).catch(() => {});
    api.get<AcademicSession[]>('/structure/sessions').then(setSessions).catch(() => {});
  }, [canManage]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDetails(null);
    setSubmitting(true);
    try {
      const payload = {
        programmeId: form.programmeId,
        name: form.name.trim(),
        effectiveFromSessionId: form.effectiveFromSessionId,
        notes: form.notes.trim() || undefined,
      };
      const created = await api.post<{ id: string }>('/academics/curriculum', payload);
      router.push(`/academics/curriculum/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? null);
      } else setError('Failed to create the curriculum version.');
      setSubmitting(false);
    }
  }

  if (!canManage) return <AccessNotice />;

  return (
    <>
      <PageHeader
        title="New curriculum version"
        description="Create a draft curriculum for a programme. Add course requirements on the next screen, then publish when ready."
        actions={
          <Link href="/academics/curriculum" className="btn-secondary">
            Cancel
          </Link>
        }
      />

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

        <div>
          <label htmlFor="programme" className="label">
            Programme <span className="text-red-600">*</span>
          </label>
          <select
            id="programme"
            className="input"
            required
            value={form.programmeId}
            onChange={(e) => set('programmeId', e.target.value)}
          >
            <option value="">Select programme</option>
            {programmes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </div>

        <Field
          label="Version name"
          required
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="2024/2025 curriculum"
          hint="A descriptive label for this version"
        />

        <div>
          <label htmlFor="session" className="label">
            Effective from session <span className="text-red-600">*</span>
          </label>
          <select
            id="session"
            className="input"
            required
            value={form.effectiveFromSessionId}
            onChange={(e) => set('effectiveFromSessionId', e.target.value)}
          >
            <option value="">Select admission session</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.isCurrent ? ' (current)' : ''}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Students admitted from this session are assessed against this curriculum.
          </p>
        </div>

        <div>
          <label htmlFor="notes" className="label">
            Notes
          </label>
          <textarea
            id="notes"
            className="input min-h-[5rem]"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Optional notes about this version"
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Link href="/academics/curriculum" className="btn-secondary">
            Cancel
          </Link>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create draft'}
          </button>
        </div>
      </form>
    </>
  );
}
