'use client';

/**
 * Staff course catalogue. Lists courses from GET /academics/courses with
 * server-side filters. Create and edit actions are permission-gated for UX;
 * the API independently authorizes every request.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { CatalogueCourse, CourseCategory, Department } from '@/lib/types';
import { PageHeader, AccessNotice, EmptyState } from '@/components/page';
import { Alert, Spinner, StatusBadge } from '@/components/ui';

interface Filters {
  q: string;
  departmentId: string;
  categoryId: string;
  level: string;
  includeInactive: boolean;
}

export default function CoursesListPage() {
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.COURSES_VIEW);
  const canCreate = can(me?.permissions, PERMISSIONS.COURSES_CREATE);

  const [rows, setRows] = useState<CatalogueCourse[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [categories, setCategories] = useState<CourseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({
    q: '',
    departmentId: '',
    categoryId: '',
    level: '',
    includeInactive: false,
  });

  useEffect(() => {
    if (!canView) return;
    api.get<Department[]>('/structure/departments').then(setDepartments).catch(() => setDepartments([]));
    api.get<CourseCategory[]>('/academics/categories').then(setCategories).catch(() => setCategories([]));
  }, [canView]);

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.departmentId) params.set('departmentId', filters.departmentId);
    if (filters.categoryId) params.set('categoryId', filters.categoryId);
    if (filters.level) params.set('level', filters.level);
    if (filters.includeInactive) params.set('includeInactive', 'true');
    try {
      const data = await api.get<CatalogueCourse[]>(`/academics/courses?${params.toString()}`);
      setRows(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load courses.');
    } finally {
      setLoading(false);
    }
  }, [canView, filters]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canView) return <AccessNotice />;

  return (
    <>
      <PageHeader
        title="Course catalogue"
        description="University-wide course definitions used in curricula and registration."
        actions={
          canCreate ? (
            <Link href="/academics/courses/new" className="btn-primary">
              New course
            </Link>
          ) : null
        }
      />

      <form
        className="card mb-4 grid grid-cols-1 gap-3 p-4 md:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters((f) => ({ ...f, q: searchInput.trim() }));
        }}
      >
        <div className="md:col-span-2">
          <label htmlFor="search" className="label">
            Search
          </label>
          <input
            id="search"
            className="input"
            placeholder="Code or title"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="department" className="label">
            Department
          </label>
          <select
            id="department"
            className="input"
            value={filters.departmentId}
            onChange={(e) => setFilters((f) => ({ ...f, departmentId: e.target.value }))}
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="category" className="label">
            Category
          </label>
          <select
            id="category"
            className="input"
            value={filters.categoryId}
            onChange={(e) => setFilters((f) => ({ ...f, categoryId: e.target.value }))}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="level" className="label">
            Level
          </label>
          <select
            id="level"
            className="input"
            value={filters.level}
            onChange={(e) => setFilters((f) => ({ ...f, level: e.target.value }))}
          >
            <option value="">Any level</option>
            {[100, 200, 300, 400, 500, 600].map((l) => (
              <option key={l} value={String(l)}>
                {l}
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
            Include inactive
          </label>
        </div>
        <div className="md:col-span-6">
          <button type="submit" className="btn-secondary">
            Apply
          </button>
        </div>
      </form>

      {error ? (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      {loading ? (
        <Spinner label="Loading courses…" />
      ) : forbidden ? (
        <AccessNotice />
      ) : rows.length === 0 ? (
        <EmptyState title="No courses found">Try adjusting your search or filters.</EmptyState>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Level</th>
                <th className="px-4 py-3 font-medium">Units</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{c.code}</td>
                  <td className="px-4 py-3 text-slate-700">{c.title}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{c.level}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{c.creditUnits}</td>
                  <td className="px-4 py-3 text-slate-600">{c.category?.label ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{c.department?.name ?? 'University-wide'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge state={c.isActive ? 'ACTIVE' : 'INACTIVE'} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/academics/courses/${c.id}`} className="text-brand-700 hover:underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && rows.length > 0 ? (
        <p className="mt-3 text-sm text-slate-500">{rows.length} course{rows.length === 1 ? '' : 's'}</p>
      ) : null}
    </>
  );
}
