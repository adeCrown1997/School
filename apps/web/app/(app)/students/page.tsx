'use client';

/**
 * Admin student register. Server-side search / filter / pagination / sort against
 * GET /students — the frontend never loads the whole table. Column visibility and
 * the "New student" / "Bulk import" actions are gated by permission for UX only;
 * the API independently authorizes every request and scopes the rows to what the
 * caller may see.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, type ApiEnvelope } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { StudentRecord, Faculty, AcademicSession } from '@/lib/types';
import { PageHeader, AccessNotice, EmptyState } from '@/components/page';
import { Alert, Spinner, StatusBadge } from '@/components/ui';
import { Pagination, type PageMeta } from '@/components/pagination';

interface Filters {
  search: string;
  facultyId: string;
  activationState: string;
  page: number;
}

export default function StudentsListPage() {
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.STUDENTS_VIEW);
  const canCreate = can(me?.permissions, PERMISSIONS.STUDENTS_CREATE);
  const canImport = can(me?.permissions, PERMISSIONS.STUDENTS_IMPORT);

  const [rows, setRows] = useState<StudentRecord[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<Filters>({
    search: '',
    facultyId: '',
    activationState: '',
    page: 1,
  });
  // The value bound to the search box, applied on submit (debounce-free).
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    // Faculty filter options — best-effort; ignore if the caller can't read structure.
    if (!canView) return;
    api
      .get<Faculty[]>('/structure/faculties')
      .then(setFaculties)
      .catch(() => setFaculties([]));
  }, [canView]);

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set('page', String(filters.page));
    params.set('pageSize', '20');
    if (filters.search) params.set('search', filters.search);
    if (filters.facultyId) params.set('facultyId', filters.facultyId);
    if (filters.activationState) params.set('activationState', filters.activationState);
    try {
      const env: ApiEnvelope<StudentRecord[]> = await api.getEnvelope<StudentRecord[]>(
        `/students?${params.toString()}`,
      );
      setRows(env.data);
      setMeta((env.meta as unknown as PageMeta) ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load students.');
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
        title="Students"
        description="Official student master records."
        actions={
          <>
            {canImport ? (
              <Link href="/students/import" className="btn-secondary">
                Bulk import
              </Link>
            ) : null}
            {canCreate ? (
              <Link href="/students/new" className="btn-primary">
                New student
              </Link>
            ) : null}
          </>
        }
      />

      <form
        className="card mb-4 grid grid-cols-1 gap-3 p-4 md:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters((f) => ({ ...f, search: searchInput.trim(), page: 1 }));
        }}
      >
        <div className="md:col-span-2">
          <label htmlFor="search" className="label">
            Search
          </label>
          <input
            id="search"
            className="input"
            placeholder="Name or matriculation number"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="faculty" className="label">
            Faculty
          </label>
          <select
            id="faculty"
            className="input"
            value={filters.facultyId}
            onChange={(e) => setFilters((f) => ({ ...f, facultyId: e.target.value, page: 1 }))}
          >
            <option value="">All faculties</option>
            {faculties.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="state" className="label">
            Account state
          </label>
          <select
            id="state"
            className="input"
            value={filters.activationState}
            onChange={(e) =>
              setFilters((f) => ({ ...f, activationState: e.target.value, page: 1 }))
            }
          >
            <option value="">Any state</option>
            <option value="PENDING">Pending</option>
            <option value="ACTIVATED">Activated</option>
            <option value="LOCKED">Locked</option>
          </select>
        </div>
        <div className="md:col-span-4">
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
        <Spinner label="Loading students…" />
      ) : forbidden ? (
        <AccessNotice />
      ) : rows.length === 0 ? (
        <EmptyState title="No students found">Try adjusting your search or filters.</EmptyState>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-4 py-3 font-medium">Matric no.</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Programme</th>
                <th className="px-4 py-3 font-medium">Level</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Account</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{s.matriculationNumber}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {[s.surname, s.firstName, s.otherNames].filter(Boolean).join(' ')}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{s.programme?.name ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{s.currentLevel}</td>
                  <td className="px-4 py-3 text-slate-600">{s.studentStatus?.label ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge state={s.activationState} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/students/${s.id}`} className="text-brand-700 hover:underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination meta={meta} onPage={(page) => setFilters((f) => ({ ...f, page }))} />
    </>
  );
}
