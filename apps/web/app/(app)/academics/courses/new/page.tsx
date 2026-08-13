'use client';

/**
 * Create a course in the university catalogue. Requires COURSES_CREATE.
 * Department and category options come from the API — nothing is hardcoded.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { CourseCategory, Department } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Field } from '@/components/ui';

export default function NewCoursePage() {
  const router = useRouter();
  const { me } = useSession();
  const canCreate = can(me?.permissions, PERMISSIONS.COURSES_CREATE);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [categories, setCategories] = useState<CourseCategory[]>([]);

  const [form, setForm] = useState({
    code: '',
    title: '',
    description: '',
    creditUnits: 3,
    level: 100,
    categoryId: '',
    departmentId: '',
  });

  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!canCreate) return;
    api.get<Department[]>('/structure/departments').then(setDepartments).catch(() => {});
    api.get<CourseCategory[]>('/academics/categories').then(setCategories).catch(() => {});
  }, [canCreate]);

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
        code: form.code.trim().toUpperCase(),
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        creditUnits: Number(form.creditUnits),
        level: Number(form.level),
        categoryId: form.categoryId || undefined,
        departmentId: form.departmentId || undefined,
      };
      const created = await api.post<{ id: string }>('/academics/courses', payload);
      router.push(`/academics/courses/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? null);
      } else setError('Failed to create the course.');
      setSubmitting(false);
    }
  }

  if (!canCreate) return <AccessNotice />;

  return (
    <>
      <PageHeader
        title="New course"
        description="Add a course to the university catalogue. The code cannot be changed later."
        actions={
          <Link href="/academics/courses" className="btn-secondary">
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

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Course code"
            required
            value={form.code}
            onChange={(e) => set('code', e.target.value.toUpperCase())}
            placeholder="CSC101"
            hint="3–16 uppercase letters, digits or dashes"
          />
          <Field
            label="Level"
            type="number"
            required
            min={0}
            max={1200}
            step={100}
            value={form.level}
            onChange={(e) => set('level', Number(e.target.value))}
          />
        </div>

        <Field
          label="Title"
          required
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Introduction to Computer Science"
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
            placeholder="Optional course description"
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
            <option value="">University-wide (no department)</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Leave blank for university-wide courses such as GST modules.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Link href="/academics/courses" className="btn-secondary">
            Cancel
          </Link>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create course'}
          </button>
        </div>
      </form>
    </>
  );
}
