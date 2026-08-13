'use client';

/**
 * Staff course offerings list. Lists offerings from GET /academics/offerings with
 * session, semester, department and status filters. Programme filter is applied
 * client-side against published curriculum course sets.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type {
  AcademicSession,
  CurriculumDetail,
  CurriculumListItem,
  Department,
  OfferingListItem,
  OfferingStatus,
  Programme,
  Semester,
} from '@/lib/types';
import { PageHeader, AccessNotice, EmptyState } from '@/components/page';
import { Alert, Spinner, StatusBadge } from '@/components/ui';

interface Filters {
  sessionId: string;
  semesterId: string;
  departmentId: string;
  programmeId: string;
  status: '' | OfferingStatus;
  q: string;
}

export default function OfferingsListPage() {
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.OFFERINGS_VIEW);
  const canManage = can(me?.permissions, PERMISSIONS.OFFERINGS_MANAGE);

  const [rows, setRows] = useState<OfferingListItem[]>([]);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [programmeCourseIds, setProgrammeCourseIds] = useState<Set<string> | null>(null);

  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({
    sessionId: '',
    semesterId: '',
    departmentId: '',
    programmeId: '',
    status: '',
    q: '',
  });

  useEffect(() => {
    if (!canView) return;
    api.get<AcademicSession[]>('/structure/sessions').then(setSessions).catch(() => setSessions([]));
    api.get<Department[]>('/structure/departments').then(setDepartments).catch(() => setDepartments([]));
    api.get<Programme[]>('/structure/programmes').then(setProgrammes).catch(() => setProgrammes([]));
  }, [canView]);

  useEffect(() => {
    if (!canView || !filters.sessionId) {
      setSemesters([]);
      return;
    }
    api
      .get<Semester[]>(`/structure/semesters?sessionId=${filters.sessionId}`)
      .then(setSemesters)
      .catch(() => setSemesters([]));
  }, [canView, filters.sessionId]);

  useEffect(() => {
    if (!canView || !filters.programmeId) {
      setProgrammeCourseIds(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const versions = await api.get<CurriculumListItem[]>(
          `/academics/curriculum?programmeId=${filters.programmeId}&status=PUBLISHED`,
        );
        if (cancelled || versions.length === 0) {
          if (!cancelled) setProgrammeCourseIds(new Set());
          return;
        }
        const first = versions[0]!;
        const detail = await api.get<CurriculumDetail>(`/academics/curriculum/${first.id}`);
        if (!cancelled) {
          setProgrammeCourseIds(new Set(detail.requirements.map((r) => r.course.id)));
        }
      } catch {
        if (!cancelled) setProgrammeCourseIds(new Set());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canView, filters.programmeId]);

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (filters.sessionId) params.set('sessionId', filters.sessionId);
    if (filters.semesterId) params.set('semesterId', filters.semesterId);
    if (filters.departmentId) params.set('departmentId', filters.departmentId);
    if (filters.status) params.set('status', filters.status);
    if (filters.q) params.set('q', filters.q);
    try {
      const data = await api.get<OfferingListItem[]>(`/academics/offerings?${params.toString()}`);
      setRows(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load offerings.');
    } finally {
      setLoading(false);
    }
  }, [canView, filters]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    if (!filters.programmeId || programmeCourseIds === null) return rows;
    return rows.filter((r) => programmeCourseIds.has(r.course.id));
  }, [rows, filters.programmeId, programmeCourseIds]);

  if (!canView) return <AccessNotice />;

  return (
    <>
      <PageHeader
        title="Course offerings"
        description="Courses scheduled for a session and semester — capacity, status and seat availability."
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <Link href="/academics/offerings/generate" className="btn-secondary">
                Generate from curriculum
              </Link>
              <Link href="/academics/offerings/new" className="btn-primary">
                New offering
              </Link>
            </div>
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
        <div>
          <label htmlFor="session" className="label">
            Session
          </label>
          <select
            id="session"
            className="input"
            value={filters.sessionId}
            onChange={(e) =>
              setFilters((f) => ({ ...f, sessionId: e.target.value, semesterId: '' }))
            }
          >
            <option value="">All sessions</option>
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
            value={filters.semesterId}
            disabled={!filters.sessionId}
            onChange={(e) => setFilters((f) => ({ ...f, semesterId: e.target.value }))}
          >
            <option value="">All semesters</option>
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
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
          <label htmlFor="programme" className="label">
            Programme
          </label>
          <select
            id="programme"
            className="input"
            value={filters.programmeId}
            onChange={(e) => setFilters((f) => ({ ...f, programmeId: e.target.value }))}
          >
            <option value="">All programmes</option>
            {programmes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="status" className="label">
            Status
          </label>
          <select
            id="status"
            className="input"
            value={filters.status}
            onChange={(e) =>
              setFilters((f) => ({ ...f, status: e.target.value as Filters['status'] }))
            }
          >
            <option value="">Any status</option>
            <option value="DRAFT">Draft</option>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
        <div>
          <label htmlFor="search" className="label">
            Search
          </label>
          <input
            id="search"
            className="input"
            placeholder="Course code or title"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div className="md:col-span-6">
          <button type="submit" className="btn-secondary">
            Apply
          </button>
        </div>
      </form>

      {filters.programmeId && programmeCourseIds !== null ? (
        <p className="mb-3 text-sm text-slate-500">
          Programme filter shows offerings whose courses appear in the programme&apos;s published
          curriculum ({programmeCourseIds.size} course{programmeCourseIds.size === 1 ? '' : 's'}).
        </p>
      ) : null}

      {error ? (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      {loading ? (
        <Spinner label="Loading offerings…" />
      ) : forbidden ? (
        <AccessNotice />
      ) : visible.length === 0 ? (
        <EmptyState title="No offerings found">
          Try adjusting your filters or create a new offering.
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-4 py-3 font-medium">Course</th>
                <th className="px-4 py-3 font-medium">Session</th>
                <th className="px-4 py-3 font-medium">Semester</th>
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium">Capacity</th>
                <th className="px-4 py-3 font-medium">Seats</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => (
                <tr key={o.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-800">{o.course.code}</span>
                    <span className="block text-slate-600">{o.course.title}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{o.session.name}</td>
                  <td className="px-4 py-3 text-slate-600">{o.semester.name}</td>
                  <td className="px-4 py-3 text-slate-600">{o.department?.name ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">
                    {o.capacity === null ? 'Uncapped' : o.capacity}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">
                    {o.seatsTaken}
                    {o.capacity !== null ? ` / ${o.capacity}` : ''}
                    {o.isFull ? (
                      <span className="ml-1 badge bg-red-100 text-red-800">Full</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge state={o.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/academics/offerings/${o.id}`} className="text-brand-700 hover:underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && visible.length > 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          {visible.length} offering{visible.length === 1 ? '' : 's'}
        </p>
      ) : null}
    </>
  );
}
