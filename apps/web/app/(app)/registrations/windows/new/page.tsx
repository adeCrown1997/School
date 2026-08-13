'use client';

/**
 * Create a registration calendar window. Requires structure.manage.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type {
  AcademicSession,
  Department,
  Faculty,
  Programme,
  RegistrationWindowType,
  ScopeType,
  Semester,
} from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert } from '@/components/ui';

const WINDOW_TYPES: { value: RegistrationWindowType; label: string }[] = [
  { value: 'REGISTRATION', label: 'Registration' },
  { value: 'ADD_DROP', label: 'Add / drop' },
  { value: 'LATE_REGISTRATION', label: 'Late registration' },
];

export default function NewRegistrationWindowPage() {
  const router = useRouter();
  const { me } = useSession();
  const canManage = can(me?.permissions, PERMISSIONS.STRUCTURE_MANAGE);

  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [programmes, setProgrammes] = useState<Programme[]>([]);

  const [form, setForm] = useState({
    windowType: 'REGISTRATION' as RegistrationWindowType,
    sessionId: '',
    semesterId: '',
    wholeSession: true,
    scopeType: 'GLOBAL' as ScopeType,
    facultyId: '',
    departmentId: '',
    programmeId: '',
    opensAt: '',
    closesAt: '',
    notes: '',
  });

  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    api.get<AcademicSession[]>('/structure/sessions').then(setSessions).catch(() => {});
    api.get<Faculty[]>('/structure/faculties').then(setFaculties).catch(() => {});
    api.get<Department[]>('/structure/departments').then(setDepartments).catch(() => {});
    api.get<Programme[]>('/structure/programmes').then(setProgrammes).catch(() => {});
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

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDetails(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        windowType: form.windowType,
        sessionId: form.sessionId,
        scopeType: form.scopeType,
        opensAt: new Date(form.opensAt).toISOString(),
        closesAt: new Date(form.closesAt).toISOString(),
      };
      if (!form.wholeSession && form.semesterId) payload.semesterId = form.semesterId;
      if (form.scopeType === 'FACULTY' && form.facultyId) payload.facultyId = form.facultyId;
      if (form.scopeType === 'DEPARTMENT' && form.departmentId) {
        payload.departmentId = form.departmentId;
      }
      if (form.scopeType === 'PROGRAMME' && form.programmeId) payload.programmeId = form.programmeId;
      if (form.notes.trim()) payload.notes = form.notes.trim();

      const created = await api.post<{ id: string }>('/registrations/windows', payload);
      router.push(`/registrations/windows/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? null);
      } else setError('Failed to create the window.');
      setSubmitting(false);
    }
  }

  if (!canManage) return <AccessNotice />;

  return (
    <>
      <PageHeader
        title="New registration window"
        description="Open or close registration for a session, semester or scoped audience."
        actions={
          <Link href="/registrations/windows" className="btn-secondary">
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
          <label htmlFor="windowType" className="label">
            Window type <span className="text-red-600">*</span>
          </label>
          <select
            id="windowType"
            className="input"
            required
            value={form.windowType}
            onChange={(e) => set('windowType', e.target.value as RegistrationWindowType)}
          >
            {WINDOW_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
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
              onChange={(e) => set('sessionId', e.target.value)}
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
              Semester
            </label>
            <select
              id="semester"
              className="input"
              value={form.semesterId}
              disabled={form.wholeSession || !form.sessionId}
              onChange={(e) => set('semesterId', e.target.value)}
            >
              <option value="">Select semester</option>
              {semesters.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.wholeSession}
                onChange={(e) => set('wholeSession', e.target.checked)}
              />
              Whole session (no specific semester)
            </label>
          </div>
        </div>

        <div>
          <label htmlFor="scopeType" className="label">
            Audience scope
          </label>
          <select
            id="scopeType"
            className="input"
            value={form.scopeType}
            onChange={(e) => set('scopeType', e.target.value as ScopeType)}
          >
            <option value="GLOBAL">Global — all students</option>
            <option value="FACULTY">Faculty</option>
            <option value="DEPARTMENT">Department</option>
            <option value="PROGRAMME">Programme</option>
          </select>
        </div>

        {form.scopeType === 'FACULTY' ? (
          <div>
            <label htmlFor="faculty" className="label">
              Faculty <span className="text-red-600">*</span>
            </label>
            <select
              id="faculty"
              className="input"
              required
              value={form.facultyId}
              onChange={(e) => set('facultyId', e.target.value)}
            >
              <option value="">Select faculty</option>
              {faculties.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {form.scopeType === 'DEPARTMENT' ? (
          <div>
            <label htmlFor="department" className="label">
              Department <span className="text-red-600">*</span>
            </label>
            <select
              id="department"
              className="input"
              required
              value={form.departmentId}
              onChange={(e) => set('departmentId', e.target.value)}
            >
              <option value="">Select department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {form.scopeType === 'PROGRAMME' ? (
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
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="opensAt" className="label">
              Opens at <span className="text-red-600">*</span>
            </label>
            <input
              id="opensAt"
              type="datetime-local"
              className="input"
              required
              value={form.opensAt}
              onChange={(e) => set('opensAt', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="closesAt" className="label">
              Closes at <span className="text-red-600">*</span>
            </label>
            <input
              id="closesAt"
              type="datetime-local"
              className="input"
              required
              value={form.closesAt}
              onChange={(e) => set('closesAt', e.target.value)}
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
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Optional internal note shown to staff"
          />
        </div>

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create window'}
        </button>
      </form>
    </>
  );
}
