'use client';

/**
 * Staff registration review queue (§9). Lists student registrations within the
 * reviewer's scope, filterable by status. Approve/reject decisions happen on the
 * detail page — the API enforces stage authority and separation of duties.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type {
  AcademicSession,
  PaginatedRegistrations,
  RegistrationListItem,
  RegistrationStatus,
  Semester,
} from '@/lib/types';
import { PageHeader, AccessNotice, EmptyState } from '@/components/page';
import { Alert, Spinner, StatusBadge } from '@/components/ui';
import { Pagination, type PageMeta } from '@/components/pagination';

const STATUSES: RegistrationStatus[] = [
  'PENDING_APPROVAL',
  'DRAFT',
  'APPROVED',
  'LOCKED',
  'REJECTED',
  'CANCELLED',
];

export default function RegistrationsPage() {
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.REGISTRATION_VIEW);

  const [rows, setRows] = useState<RegistrationListItem[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [semesterId, setSemesterId] = useState('');
  const [status, setStatus] = useState<RegistrationStatus>('PENDING_APPROVAL');
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    api.get<AcademicSession[]>('/structure/sessions').then(setSessions).catch(() => setSessions([]));
  }, [canView]);

  useEffect(() => {
    if (!canView || !sessionId) {
      setSemesters([]);
      return;
    }
    api
      .get<Semester[]>(`/structure/semesters?sessionId=${sessionId}`)
      .then(setSemesters)
      .catch(() => setSemesters([]));
  }, [canView, sessionId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        status,
        page: String(page),
        pageSize: '20',
      });
      if (search) params.set('search', search);
      if (sessionId) params.set('sessionId', sessionId);
      if (semesterId) params.set('semesterId', semesterId);
      const res = await api.get<PaginatedRegistrations>(`/registrations?${params.toString()}`);
      setRows(res.items);
      setMeta({
        page: res.page,
        pageSize: res.pageSize,
        total: res.total,
        totalPages: Math.max(1, Math.ceil(res.total / res.pageSize)),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load registrations.');
    } finally {
      setLoading(false);
    }
  }, [status, page, search, sessionId, semesterId]);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

  if (!canView) return <AccessNotice />;
  if (forbidden) return <AccessNotice />;

  return (
    <>
      <PageHeader
        title="Registrations"
        description="Review student course registrations within your scope. Open a registration to approve or reject it."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <select
          className="input min-w-[10rem]"
          value={sessionId}
          aria-label="Filter by session"
          onChange={(e) => {
            setSessionId(e.target.value);
            setSemesterId('');
            setPage(1);
          }}
        >
          <option value="">All sessions</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.isCurrent ? ' (current)' : ''}
            </option>
          ))}
        </select>
        <select
          className="input min-w-[10rem]"
          value={semesterId}
          aria-label="Filter by semester"
          disabled={!sessionId}
          onChange={(e) => {
            setSemesterId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All semesters</option>
          {semesters.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.isCurrent ? ' (current)' : ''}
            </option>
          ))}
        </select>
      </div>

      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(searchInput.trim());
          setPage(1);
        }}
      >
        <input
          className="input max-w-xs flex-1"
          placeholder="Search matric no. or name…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <button type="submit" className="btn-secondary">
          Search
        </button>
        {search ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setSearchInput('');
              setSearch('');
              setPage(1);
            }}
          >
            Clear
          </button>
        ) : null}
      </form>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
        {STATUSES.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={status === s}
            className={`badge ${status === s ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}
            onClick={() => {
              setStatus(s);
              setPage(1);
            }}
          >
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {error ? (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      {loading ? (
        <Spinner label="Loading registrations…" />
      ) : rows.length === 0 ? (
        <EmptyState title={`No ${status.replace(/_/g, ' ').toLowerCase()} registrations.`} />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <RegistrationRow key={r.id} item={r} />
          ))}
        </div>
      )}

      <Pagination meta={meta} onPage={setPage} />
    </>
  );
}

function RegistrationRow({ item }: { item: RegistrationListItem }) {
  const student = item.studentRecord;
  const name = student ? `${student.surname} ${student.firstName}` : 'Unknown student';

  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-800">
          {name}
          {student ? ` · ${student.matriculationNumber}` : null}
        </p>
        <p className="text-xs text-slate-500">
          Level {item.level} · {item.semester.name} · {item.totalUnits} units ·{' '}
          {item._count.lines} course{item._count.lines === 1 ? '' : 's'}
          {item.submittedAt
            ? ` · submitted ${new Date(item.submittedAt).toLocaleString()}`
            : null}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <StatusBadge state={item.status} />
        <Link href={`/registrations/${item.id}`} className="btn-primary">
          {item.status === 'PENDING_APPROVAL' ? 'Review' : 'View'}
        </Link>
      </div>
    </div>
  );
}
