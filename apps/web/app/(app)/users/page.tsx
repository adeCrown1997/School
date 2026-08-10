'use client';

/**
 * Staff directory (admin user management, §6). Search + role/active filters +
 * server-side pagination. Every row links to the detail page where roles are
 * assigned/revoked. The "New staff" action is shown only with USERS_CREATE, but
 * that is UX only — the API independently authorizes create and every mutation.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { StaffUser, RoleView } from '@/lib/types';
import { PageHeader, AccessNotice, EmptyState } from '@/components/page';
import { Alert, Spinner, StatusBadge } from '@/components/ui';
import { Pagination, type PageMeta } from '@/components/pagination';

export default function UsersPage() {
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.USERS_VIEW);
  const canCreate = can(me?.permissions, PERMISSIONS.USERS_CREATE);

  const [rows, setRows] = useState<StaffUser[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleKey, setRoleKey] = useState('');
  const [active, setActive] = useState<'' | 'true' | 'false'>('');
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (search.trim()) params.set('search', search.trim());
      if (roleKey) params.set('roleKey', roleKey);
      if (active) params.set('isActive', active);
      const env = await api.getEnvelope<StaffUser[]>(`/users?${params.toString()}`);
      setRows(env.data);
      setMeta((env.meta as unknown as PageMeta) ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, [page, search, roleKey, active]);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

  // Role filter options come from the DB (never hardcoded), if the actor may read them.
  useEffect(() => {
    if (!canView || !can(me?.permissions, PERMISSIONS.ROLES_VIEW)) return;
    api.get<RoleView[]>('/roles').then(setRoles).catch(() => setRoles([]));
  }, [canView, me?.permissions]);

  if (!canView) return <AccessNotice />;

  return (
    <>
      <PageHeader
        title="Staff & roles"
        description="Provision staff accounts, assign scoped roles, and manage access."
        actions={
          canCreate ? (
            <Link href="/users/new" className="btn-primary">
              New staff account
            </Link>
          ) : null
        }
      />

      <form
        className="card mb-4 flex flex-wrap items-end gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          load();
        }}
      >
        <div className="flex-1 min-w-[12rem]">
          <label htmlFor="search" className="label">
            Search
          </label>
          <input
            id="search"
            className="input"
            placeholder="Name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {roles.length ? (
          <div>
            <label htmlFor="role" className="label">
              Role
            </label>
            <select
              id="role"
              className="input"
              value={roleKey}
              onChange={(e) => {
                setRoleKey(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All roles</option>
              {roles.map((r) => (
                <option key={r.id} value={r.key}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div>
          <label htmlFor="active" className="label">
            Status
          </label>
          <select
            id="active"
            className="input"
            value={active}
            onChange={(e) => {
              setActive(e.target.value as '' | 'true' | 'false');
              setPage(1);
            }}
          >
            <option value="">All</option>
            <option value="true">Active</option>
            <option value="false">Deactivated</option>
          </select>
        </div>
        <button type="submit" className="btn-secondary">
          Apply
        </button>
      </form>

      {error ? (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      {loading ? (
        <Spinner label="Loading staff…" />
      ) : rows.length === 0 ? (
        <EmptyState title="No staff accounts match your filters." />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Roles</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last login</th>
                <th className="px-4 py-3 font-medium sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{u.fullName}</td>
                  <td className="px-4 py-3 text-slate-600">{u.email}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {u.roles.length ? (
                      <span className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <span key={r.assignmentId} className="badge bg-slate-100 text-slate-700">
                            {r.roleName}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-slate-400">No roles</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge state={u.isActive ? 'ACTIVE' : 'LOCKED'} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/users/${u.id}`} className="text-brand-600 hover:underline">
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination meta={meta} onPage={setPage} />
    </>
  );
}
