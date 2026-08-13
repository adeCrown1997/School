'use client';

/**
 * Staff curriculum versions list. Lists versions from GET /academics/curriculum
 * with programme and status filters. Archived versions are hidden by default.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { CurriculumListItem, CurriculumStatus, Programme } from '@/lib/types';
import { PageHeader, AccessNotice, EmptyState } from '@/components/page';
import { Alert, Spinner, StatusBadge } from '@/components/ui';

interface Filters {
  programmeId: string;
  status: '' | CurriculumStatus;
  includeArchived: boolean;
}

export default function CurriculumListPage() {
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.CURRICULUM_VIEW);
  const canManage = can(me?.permissions, PERMISSIONS.CURRICULUM_MANAGE);

  const [rows, setRows] = useState<CurriculumListItem[]>([]);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<Filters>({
    programmeId: '',
    status: '',
    includeArchived: false,
  });

  useEffect(() => {
    if (!canView) return;
    api.get<Programme[]>('/structure/programmes').then(setProgrammes).catch(() => setProgrammes([]));
  }, [canView]);

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (filters.programmeId) params.set('programmeId', filters.programmeId);
    if (filters.status) params.set('status', filters.status);
    try {
      const data = await api.get<CurriculumListItem[]>(`/academics/curriculum?${params.toString()}`);
      setRows(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load curriculum versions.');
    } finally {
      setLoading(false);
    }
  }, [canView, filters.programmeId, filters.status]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    if (filters.includeArchived || filters.status === 'ARCHIVED') return rows;
    return rows.filter((r) => r.status !== 'ARCHIVED');
  }, [rows, filters.includeArchived, filters.status]);

  if (!canView) return <AccessNotice />;

  return (
    <>
      <PageHeader
        title="Curriculum versions"
        description="Programme curricula — course requirements per level and semester. Published versions are frozen."
        actions={
          canManage ? (
            <Link href="/academics/curriculum/new" className="btn-primary">
              New version
            </Link>
          ) : null
        }
      />

      <form
        className="card mb-4 grid grid-cols-1 gap-3 p-4 md:grid-cols-4"
        onSubmit={(e) => e.preventDefault()}
      >
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
            <option value="PUBLISHED">Published</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={filters.includeArchived}
              onChange={(e) => setFilters((f) => ({ ...f, includeArchived: e.target.checked }))}
            />
            Include archived
          </label>
        </div>
      </form>

      {error ? (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      {loading ? (
        <Spinner label="Loading curriculum versions…" />
      ) : forbidden ? (
        <AccessNotice />
      ) : visible.length === 0 ? (
        <EmptyState title="No curriculum versions found">
          Try adjusting your filters or create a new draft version.
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Programme</th>
                <th className="px-4 py-3 font-medium">Effective from</th>
                <th className="px-4 py-3 font-medium">Requirements</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {visible.map((v) => (
                <tr key={v.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{v.name}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {v.programme.code} — {v.programme.name}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{v.effectiveFromSession.name}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{v._count.requirements}</td>
                  <td className="px-4 py-3">
                    <StatusBadge state={v.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/academics/curriculum/${v.id}`} className="text-brand-700 hover:underline">
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
          {visible.length} version{visible.length === 1 ? '' : 's'}
        </p>
      ) : null}
    </>
  );
}
