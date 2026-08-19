'use client';

/**
 * Admin "create student". The registry/admin is the authoritative source of
 * student identity, so this form legitimately captures identity fields — this is
 * NOT a student-facing page (students can never reach it: it requires
 * STUDENTS_CREATE). Faculty/department/programme/session options come from the
 * DB (cascading selects); nothing is hardcoded. The API re-validates the whole
 * hierarchy, matric uniqueness, and the actor's scope — the UI is convenience.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { Faculty, Department, Programme, AcademicSession, EntryMode, Gender } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Field } from '@/components/ui';
import { dobToIso } from '@/lib/dates';

const ENTRY_MODES: EntryMode[] = ['UTME', 'DIRECT_ENTRY', 'TRANSFER', 'INTER_UNIVERSITY', 'JUPEB'];
const GENDERS: Gender[] = ['MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED'];

export default function NewStudentPage() {
  const router = useRouter();
  const { me } = useSession();
  const canCreate = can(me?.permissions, PERMISSIONS.STUDENTS_CREATE);

  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);

  const [form, setForm] = useState({
    matriculationNumber: '',
    jambRegistrationNumber: '',
    surname: '',
    firstName: '',
    otherNames: '',
    dateOfBirth: '',
    gender: 'UNSPECIFIED' as Gender,
    facultyId: '',
    departmentId: '',
    programmeId: '',
    admissionSessionId: '',
    entryMode: 'UTME' as EntryMode,
    currentLevel: 100,
    officialEmail: '',
    officialPhone: '',
  });

  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!canCreate) return;
    api.get<Faculty[]>('/structure/faculties').then(setFaculties).catch(() => {});
    api.get<AcademicSession[]>('/structure/sessions').then(setSessions).catch(() => {});
  }, [canCreate]);

  // Cascade: faculty → departments.
  useEffect(() => {
    if (!form.facultyId) {
      setDepartments([]);
      return;
    }
    api
      .get<Department[]>(`/structure/departments?facultyId=${form.facultyId}`)
      .then(setDepartments)
      .catch(() => setDepartments([]));
  }, [form.facultyId]);

  // Cascade: department → programmes.
  useEffect(() => {
    if (!form.departmentId) {
      setProgrammes([]);
      return;
    }
    api
      .get<Programme[]>(`/structure/programmes?departmentId=${form.departmentId}`)
      .then(setProgrammes)
      .catch(() => setProgrammes([]));
  }, [form.departmentId]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDetails(null);
    const dobIso = dobToIso(form.dateOfBirth);
    if (!dobIso) {
      setError('Date of birth must be a valid date in DD/MM/YYYY format.');
      return;
    }
    if (!window.confirm('Create this official student record?')) return;
    setSubmitting(true);
    try {
      const payload = {
        matriculationNumber: form.matriculationNumber.trim(),
        jambRegistrationNumber: form.jambRegistrationNumber.trim() || undefined,
        surname: form.surname.trim(),
        firstName: form.firstName.trim(),
        otherNames: form.otherNames.trim() || undefined,
        dateOfBirth: dobIso,
        gender: form.gender,
        facultyId: form.facultyId,
        departmentId: form.departmentId,
        programmeId: form.programmeId,
        admissionSessionId: form.admissionSessionId,
        entryMode: form.entryMode,
        currentLevel: Number(form.currentLevel),
        officialEmail: form.officialEmail.trim() || undefined,
        officialPhone: form.officialPhone.trim() || undefined,
      };
      const created = await api.post<{ id: string }>('/students', payload);
      router.push(`/students/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? null);
      } else setError('Failed to create the student record.');
      setSubmitting(false);
    }
  }

  if (!canCreate) return <AccessNotice />;

  return (
    <>
      <PageHeader
        title="New student"
        description="Create an official student master record. No login account is created — the student activates their own account later."
        actions={
          <Link href="/students" className="btn-secondary">
            Cancel
          </Link>
        }
      />

      <form onSubmit={submit} className="card space-y-6 p-6">
        {error ? (
          <Alert kind="error" title={error}>
            {details && details.length ? (
              <ul className="ml-4 list-disc">
                {details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}

        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold text-slate-700">Identity</legend>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              label="Matriculation number"
              value={form.matriculationNumber}
              onChange={(e) => set('matriculationNumber', e.target.value)}
              required
            />
            <Field
              label="JAMB registration number"
              value={form.jambRegistrationNumber}
              onChange={(e) => set('jambRegistrationNumber', e.target.value)}
            />
            <Field
              label="Surname"
              value={form.surname}
              onChange={(e) => set('surname', e.target.value)}
              required
            />
            <Field
              label="First name"
              value={form.firstName}
              onChange={(e) => set('firstName', e.target.value)}
              required
            />
            <Field
              label="Other names"
              value={form.otherNames}
              onChange={(e) => set('otherNames', e.target.value)}
            />
            <Field
              label="Date of birth"
              value={form.dateOfBirth}
              onChange={(e) => set('dateOfBirth', e.target.value)}
              placeholder="DD/MM/YYYY"
              hint="Format: DD/MM/YYYY, for example 14/03/2005."
              inputMode="numeric"
              required
            />
            <div>
              <label htmlFor="gender" className="label">
                Gender
              </label>
              <select
                id="gender"
                className="input"
                value={form.gender}
                onChange={(e) => set('gender', e.target.value as Gender)}
              >
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold text-slate-700">Academic placement</legend>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="faculty" className="label">
                Faculty
              </label>
              <select
                id="faculty"
                className="input"
                value={form.facultyId}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    facultyId: e.target.value,
                    departmentId: '',
                    programmeId: '',
                  }))
                }
                required
              >
                <option value="">Select faculty…</option>
                {faculties.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="department" className="label">
                Department
              </label>
              <select
                id="department"
                className="input"
                value={form.departmentId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, departmentId: e.target.value, programmeId: '' }))
                }
                disabled={!form.facultyId}
                required
              >
                <option value="">Select department…</option>
                {departments.map((d) => (
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
                value={form.programmeId}
                onChange={(e) => set('programmeId', e.target.value)}
                disabled={!form.departmentId}
                required
              >
                <option value="">Select programme…</option>
                {programmes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.award})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="session" className="label">
                Admission session
              </label>
              <select
                id="session"
                className="input"
                value={form.admissionSessionId}
                onChange={(e) => set('admissionSessionId', e.target.value)}
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
              <label htmlFor="entry" className="label">
                Entry mode
              </label>
              <select
                id="entry"
                className="input"
                value={form.entryMode}
                onChange={(e) => set('entryMode', e.target.value as EntryMode)}
              >
                {ENTRY_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <Field
              label="Current level"
              type="number"
              min={100}
              step={100}
              value={form.currentLevel}
              onChange={(e) => set('currentLevel', Number(e.target.value))}
              required
            />
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold text-slate-700">
            Contact of record (used for activation)
          </legend>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              label="Official email"
              type="email"
              value={form.officialEmail}
              onChange={(e) => set('officialEmail', e.target.value)}
              hint="Required for the student to receive an activation OTP."
            />
            <Field
              label="Official phone"
              value={form.officialPhone}
              onChange={(e) => set('officialPhone', e.target.value)}
            />
          </div>
        </fieldset>

        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create student record'}
          </button>
          <Link href="/students" className="btn-secondary">
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
