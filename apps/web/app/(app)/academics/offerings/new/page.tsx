'use client';

/**
 * Create a single course offering. Requires OFFERINGS_MANAGE.
 * Semesters load for the selected session; teaching department defaults to the course owner.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { AcademicSession, CatalogueCourse, Department, Semester } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Field } from '@/components/ui';

export default function NewOfferingPage() {
  const router = useRouter();
  const { me } = useSession();
  const canManage = can(me?.permissions, PERMISSIONS.OFFERINGS_MANAGE);

  const [courses, setCourses] = useState<CatalogueCourse[]>([]);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  const [form, setForm] = useState({
    courseId: '',
    sessionId: '',
    semesterId: '',
    departmentId: '',
    capacity: '',
    uncapped: true,
  });

  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    api.get<CatalogueCourse[]>('/academics/courses').then(setCourses).catch(() => {});
    api.get<AcademicSession[]>('/structure/sessions').then(setSessions).catch(() => {});
    api.get<Department[]>('/structure/departments').then(setDepartments).catch(() => {});
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

  useEffect(() => {
    const course = courses.find((c) => c.id === form.courseId);
    if (course?.department?.id && !form.departmentId) {
      setForm((f) => ({ ...f, departmentId: course.department!.id }));
    }
  }, [form.courseId, courses, form.departmentId]);

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
        courseId: form.courseId,
        sessionId: form.sessionId,
        semesterId: form.semesterId,
      };
      if (form.departmentId) payload.departmentId = form.departmentId;
      if (!form.uncapped && form.capacity.trim() !== '') {
        payload.capacity = Number(form.capacity);
      }
      const created = await api.post<{ id: string }>('/academics/offerings', payload);
      router.push(`/academics/offerings/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? null);
      } else setError('Failed to create the offering.');
      setSubmitting(false);
    }
  }

  if (!canManage) return <AccessNotice />;

  return (
    <>
      <PageHeader
        title="New offering"
        description="Schedule a course for a session and semester. New offerings start as draft."
        actions={
          <Link href="/academics/offerings" className="btn-secondary">
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
          <label htmlFor="course" className="label">
            Course <span className="text-red-600">*</span>
          </label>
          <select
            id="course"
            className="input"
            required
            value={form.courseId}
            onChange={(e) => set('courseId', e.target.value)}
          >
            <option value="">Select a course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.title} ({c.creditUnits} units)
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
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="department" className="label">
            Teaching department
          </label>
          <select
            id="department"
            className="input"
            value={form.departmentId}
            onChange={(e) => set('departmentId', e.target.value)}
          >
            <option value="">Course owner (default)</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            For service courses taught by a department other than the course owner.
          </p>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.uncapped}
              onChange={(e) => set('uncapped', e.target.checked)}
            />
            Uncapped capacity
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
              hint="Zero means closed to registration without deleting the offering."
            />
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Link href="/academics/offerings" className="btn-secondary">
            Cancel
          </Link>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create offering'}
          </button>
        </div>
      </form>
    </>
  );
}
