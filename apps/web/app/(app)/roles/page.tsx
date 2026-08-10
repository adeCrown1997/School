'use client';

/**
 * Roles & permissions catalog (§5). Read-only view of every role, the permissions
 * each carries, and whether THIS actor may grant it (the API's grant-authority
 * hint). Optionally the full permission catalog (grouped by category) for anyone
 * with permissions.view. Custom-role creation is intentionally omitted from Phase
 * 1's UI — the API supports it (POST /roles) but the approved Phase-1 surface is
 * the seeded system roles; this keeps the least-privilege story simple.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { RoleView, PermissionView } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Spinner } from '@/components/ui';

export default function RolesPage() {
  const { me } = useSession();
  const canViewRoles = can(me?.permissions, PERMISSIONS.ROLES_VIEW);
  const canViewPerms = can(me?.permissions, PERMISSIONS.PERMISSIONS_VIEW);

  const [roles, setRoles] = useState<RoleView[]>([]);
  const [perms, setPerms] = useState<PermissionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canViewRoles) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const r = await api.get<RoleView[]>('/roles');
        setRoles(r);
        if (canViewPerms) {
          const p = await api.get<PermissionView[]>('/permissions');
          setPerms(p);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof ApiError ? err.message : 'Failed to load roles.');
      } finally {
        setLoading(false);
      }
    })();
  }, [canViewRoles, canViewPerms]);

  if (!canViewRoles) return <AccessNotice />;
  if (loading) return <Spinner label="Loading roles…" />;
  if (forbidden) return <AccessNotice />;
  if (error) return <Alert kind="error">{error}</Alert>;

  const permsByCategory = perms.reduce<Record<string, PermissionView[]>>((acc, p) => {
    (acc[p.category] ??= []).push(p);
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="The role catalog and the permissions each role carries. Grantability reflects your own authority."
        actions={
          <Link href="/users" className="btn-secondary">
            Back to staff
          </Link>
        }
      />

      <div className="space-y-4">
        {roles.map((r) => (
          <div key={r.id} className="card p-5">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-800">{r.name}</h2>
              <span className="badge bg-slate-100 text-slate-600">{r.key}</span>
              <span className="badge bg-brand-50 text-brand-700">Scope: {r.scopeKind}</span>
              {r.isSystem ? (
                <span className="badge bg-slate-100 text-slate-500">System</span>
              ) : null}
              {r.grantable ? (
                <span className="badge bg-green-100 text-green-800">You can grant</span>
              ) : (
                <span className="badge bg-amber-100 text-amber-900">Not grantable by you</span>
              )}
            </div>
            {r.description ? (
              <p className="mb-3 text-sm text-slate-500">{r.description}</p>
            ) : null}
            <div className="flex flex-wrap gap-1">
              {r.permissions.length ? (
                r.permissions.map((p) => (
                  <span key={p} className="badge bg-slate-100 font-mono text-xs text-slate-700">
                    {p}
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-400">
                  No permissions (e.g. the STUDENT role — self-service is authorized by ownership,
                  not permissions).
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {canViewPerms && perms.length ? (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Permission catalog</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(permsByCategory).map(([category, list]) => (
              <div key={category} className="card p-5">
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {category}
                </h3>
                <ul className="space-y-2">
                  {list.map((p) => (
                    <li key={p.key} className="text-sm">
                      <span className="font-mono text-xs text-brand-700">{p.key}</span>
                      <span className="block text-slate-600">{p.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
