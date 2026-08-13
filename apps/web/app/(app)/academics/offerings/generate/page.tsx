'use client';

/**
 * Bulk-generate offerings from a published curriculum version.
 * POST /academics/offerings/generate — idempotent; existing rows are skipped.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type {
  AcademicSession,
  CurriculumListItem,
  GenerateOfferingsResult,
  Semester,
} from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Field } from '@/components/ui';

export default function GenerateOfferingsPage() {
  const { me } = useSession();
  const canManage = can(me?.permissions, PERMISSIONS.OFFERINGS_MANAGE);

  const [curricula, setCurricula] = useState<CurriculumListItem[]>([]);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);

  const [form, setForm] = useState({
    curriculumVersionId: '',
    sessionId: '',
    semesterId: '',
    capacity: '',
    uncapped: true,
  });

  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<GenerateOfferingsResult | null>(null);

  useEffect(() => {
    if (!canManage) return;
    api
      .get<CurriculumListItem[]>('/academics/curriculum?status=PUBLISHED')
      .then(setCurricula)
      .catch(() => setCurricula([]));
    api.get<AcademicSession[]>('/structure/sessions').then(setSessions).catch(() => setSessions([]));
  }, [canManage]);

  useEffect(() => {
    if (!canManage || !form.sessionId) {
      setSemesters([]);
      return;
    }
    api
      .get<Semester[]>(`/structure/semesters?sessionId=${form.sessionId}`)
      .then(setSemesters)
      .catch(() => setSemesters([]));
  }, [canManage, form.sessionId]);

  const selectedCurriculum = useMemo(
    () => curricula.find((c) => c.id === form.curriculumVersionId),
    [curricula, form.curriculumVersionId],
  );

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDetails(null);
    setResult(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        curriculumVersionId: form.curriculumVersionId,
        sessionId: form.sessionId,
        semesterId: form.semesterId,
      };
      if (!form.uncapped && form.capacity.trim() !== '') {
        payload.capacity = Number(form.capacity);
      }
      const res = await api.post<GenerateOfferingsResult>('/academics/offerings/generate', payload);
      setResult(res);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? null);
      } else setError('Failed to generate offerings.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!canManage) return <AccessNotice />;

  return (
    <>
      <PageHeader
        title="Generate offerings"
        description="Create draft offerings for every active course in a published curriculum semester. Safe to re-run — existing offerings are not overwritten."
        actions={
          <Link href="/academics/offerings" className="btn-secondary">
            Back to list
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

        {result ? (
          <Alert kind="success" title="Generation complete">
            <ul className="ml-4 list-disc text-sm">
              <li>{result.created} new offering{result.created === 1 ? '' : 's'} created</li>
              <li>{result.alreadyPresent} already present</li>
              {result.skippedInactive.length > 0 ? (
                <li>Skipped inactive: {result.skippedInactive.join(', ')}</li>
              ) : null}
              <li>
                Semester: {result.semester.name} (sequence {result.semester.sequence})
              </li>
            </ul>
            <Link href="/academics/offerings" className="btn-primary mt-4 inline-block">
              View offerings
            </Link>
          </Alert>
        ) : null}

        <div>
          <label htmlFor="curriculum" className="label">
            Published curriculum <span className="text-red-600">*</span>
          </label>
          <select
            id="curriculum"
            className="input"
            required
            value={form.curriculumVersionId}
            onChange={(e) => set('curriculumVersionId', e.target.value)}
          >
            <option value="">Select curriculum version</option>
            {curricula.map((c) => (
              <option key={c.id} value={c.id}>
                {c.programme.code} — {c.name} ({c._count.requirements} requirements)
              </option>
            ))}
          </select>
          {selectedCurriculum ? (
            <p className="mt-1 text-xs text-slate-500">
              Programme: {selectedCurriculum.programme.name}. Only courses for the selected
              semester sequence are generated.
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="session" className="label">
              Session <span className="text-red-600">*</span>
            </label>
            <select
              id="session"
              className="input"
              required
              value={form.sessionId}
              onChange={(e) => {
                set('sessionId', e.target.value);
                set('semesterId', '');
              }}
            >
              <option value="">Select session</option>
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
              Semester <span className="text-red-600">*</span>
            </label>
            <select
              id="semester"
              className="input"
              required
              disabled={!form.sessionId}
              value={form.semesterId}
              onChange={(e) => set('semesterId', e.target.value)}
            >
              <option value="">Select semester</option>
              {semesters.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} (sequence {s.sequence})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.uncapped}
              onChange={(e) => set('uncapped', e.target.checked)}
            />
            Uncapped capacity for all generated offerings
          </label>
          {!form.uncapped ? (
            <Field
              label="Capacity"
              type="number"
              min={0}
              max={100000}
              className="mt-2"
              value={form.capacity}
              onChange={(e) => set('capacity', e.target.value)}
            />
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Link href="/academics/offerings" className="btn-secondary">
            Cancel
          </Link>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Generating…' : 'Generate offerings'}
          </button>
        </div>
      </form>
    </>
  );
}
