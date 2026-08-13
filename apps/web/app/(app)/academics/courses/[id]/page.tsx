'use client';

/**
 * Course detail and edit. View requires COURSES_VIEW; edit and deactivate
 * require their respective permissions. The course code is read-only — it is
 * referenced by transcripts and prerequisite chains.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { CourseCategory, CourseDetail, Department } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Field, Labeled, Spinner, StatusBadge } from '@/components/ui';

export default function CourseDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.COURSES_VIEW);
  const canUpdate = can(me?.permissions, PERMISSIONS.COURSES_UPDATE);
  const canDeactivate = can(me?.permissions, PERMISSIONS.COURSES_DEACTIVATE);

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [categories, setCategories] = useState<CourseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    creditUnits: 0,
    level: 0,
    categoryId: '',
    departmentId: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [details, setDetails] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<CourseDetail>(`/academics/courses/${id}`);
      setCourse(res);
      setForm({
        title: res.title,
        description: res.description ?? '',
        creditUnits: res.creditUnits,
        level: res.level,
        categoryId: res.category?.id ?? '',
        departmentId: res.department?.id ?? '',
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load the course.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

  useEffect(() => {
    if (!canView) return;
    api.get<Department[]>('/structure/departments').then(setDepartments).catch(() => {});
    api.get<CourseCategory[]>('/academics/categories').then(setCategories).catch(() => {});
  }, [canView]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDetails(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await api.patch(`/academics/courses/${id}`, {
        title: form.title.trim(),
        description: form.description.trim() || null,
        creditUnits: Number(form.creditUnits),
        level: Number(form.level),
        categoryId: form.categoryId || null,
        departmentId: form.departmentId || null,
      });
      setSuccess('Course updated.');
      setEditing(false);
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? null);
      } else setError('Failed to update the course.');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive() {
    if (!course) return;
    const action = course.isActive ? 'deactivate' : 'reactivate';
    if (!window.confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} this course?`)) return;
    setError(null);
    setSuccess(null);
    try {
      await api.post(`/academics/courses/${id}/active`, { isActive: !course.isActive });
      setSuccess(course.isActive ? 'Course deactivated.' : 'Course reactivated.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to ${action} the course.`);
    }
  }

  if (!canView) return <AccessNotice />;
  if (loading) return <Spinner label="Loading course…" />;
  if (forbidden) return <AccessNotice />;
  if (notFound)
    return (
      <Alert kind="warning" title="Not found">
        No course matches this id.
      </Alert>
    );
  if (!course) return null;

  return (
    <>
      <PageHeader
        title={`${course.code} — ${course.title}`}
        description={`Level ${course.level} · ${course.creditUnits} credit unit${course.creditUnits === 1 ? '' : 's'}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/academics/courses" className="btn-secondary">
              Back to list
            </Link>
            {canUpdate && !editing ? (
              <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
                Edit
              </button>
            ) : null}
            {canDeactivate ? (
              <button type="button" className="btn-secondary" onClick={toggleActive}>
                {course.isActive ? 'Deactivate' : 'Reactivate'}
              </button>
            ) : null}
          </div>
        }
      />

      {error ? (
        <div className="mb-4">
          <Alert kind="error" title={error}>
            {details?.length ? (
              <ul className="ml-4 list-disc">
                {details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : null}
          </Alert>
        </div>
      ) : null}
      {success ? (
        <div className="mb-4">
          <Alert kind="success">{success}</Alert>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Course details</h2>
            <StatusBadge state={course.isActive ? 'ACTIVE' : 'INACTIVE'} />
          </div>

          {editing ? (
            <form onSubmit={save} className="space-y-4">
              <Field label="Course code" value={course.code} protectedField readOnly />
              <Field
                label="Title"
                required
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
              />
              <div>
                <label htmlFor="description" className="label">
                  Description
                </label>
                <textarea
                  id="description"
                  className="input min-h-[5rem]"
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Credit units"
                  type="number"
                  required
                  min={0}
                  max={60}
                  value={form.creditUnits}
                  onChange={(e) => set('creditUnits', Number(e.target.value))}
                />
                <Field
                  label="Level"
                  type="number"
                  required
                  min={0}
                  max={1200}
                  value={form.level}
                  onChange={(e) => set('level', Number(e.target.value))}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="category" className="label">
                    Category
                  </label>
                  <select
                    id="category"
                    className="input"
                    value={form.categoryId}
                    onChange={(e) => set('categoryId', e.target.value)}
                  >
                    <option value="">None</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="department" className="label">
                    Owning department
                  </label>
                  <select
                    id="department"
                    className="input"
                    value={form.departmentId}
                    onChange={(e) => set('departmentId', e.target.value)}
                  >
                    <option value="">University-wide</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setEditing(false);
                    setForm({
                      title: course.title,
                      description: course.description ?? '',
                      creditUnits: course.creditUnits,
                      level: course.level,
                      categoryId: course.category?.id ?? '',
                      departmentId: course.department?.id ?? '',
                    });
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <Labeled label="Code" protectedField>
                {course.code}
              </Labeled>
              <Labeled label="Level">{course.level}</Labeled>
              <Labeled label="Credit units">{course.creditUnits}</Labeled>
              <Labeled label="Category">{course.category?.label ?? '—'}</Labeled>
              <Labeled label="Department">{course.department?.name ?? 'University-wide'}</Labeled>
              <div className="col-span-2 md:col-span-3">
                <Labeled label="Description">{course.description ?? '—'}</Labeled>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Prerequisites</h2>
            {course.prerequisites.length === 0 ? (
              <p className="text-sm text-slate-500">None defined.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {course.prerequisites.map((p) => (
                  <li key={p.id} className="text-slate-700">
                    <span className="font-medium">{p.prerequisiteCourse.code}</span>
                    {' — '}
                    {p.prerequisiteCourse.title}
                    {p.minGrade ? (
                      <span className="text-slate-500"> (min grade: {p.minGrade})</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Relationships</h2>
            {course.relationshipsFrom.length === 0 ? (
              <p className="text-sm text-slate-500">None defined.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {course.relationshipsFrom.map((r) => (
                  <li key={r.id} className="text-slate-700">
                    <span className="badge bg-slate-100 text-slate-700">{r.type}</span>{' '}
                    <span className="font-medium">{r.relatedCourse.code}</span>
                    {' — '}
                    {r.relatedCourse.title}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
