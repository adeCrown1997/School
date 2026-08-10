'use client';

/**
 * Staff detail & access management (§6). Depending on the actor's own
 * permissions, sections appear to:
 *   • edit name/email (USERS_UPDATE),
 *   • deactivate/reactivate the account (USERS_DEACTIVATE),
 *   • issue a password reset (USERS_RESET) — the token is shown ONCE for
 *     out-of-band handoff; the admin never sets or sees the password,
 *   • assign/revoke SCOPED roles (ROLES_ASSIGN).
 *
 * Role assignment honours grant-authority: only roles the API marks `grantable`
 * (a subset of the actor's own permissions) can be selected. This is a UX mirror
 * — the backend re-checks grant-authority and scope on every assign/revoke.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type {
  StaffUser,
  RoleView,
  RoleAssignmentView,
  Faculty,
  Department,
  Programme,
  ScopeType,
} from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Field, Labeled, Spinner, StatusBadge } from '@/components/ui';

const SCOPE_RANK: Record<ScopeType, number> = {
  GLOBAL: 0,
  FACULTY: 1,
  DEPARTMENT: 2,
  PROGRAMME: 3,
};
const SCOPE_TYPES: ScopeType[] = ['GLOBAL', 'FACULTY', 'DEPARTMENT', 'PROGRAMME'];

export default function StaffDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { me } = useSession();

  const canView = can(me?.permissions, PERMISSIONS.USERS_VIEW);
  const canUpdate = can(me?.permissions, PERMISSIONS.USERS_UPDATE);
  const canDeactivate = can(me?.permissions, PERMISSIONS.USERS_DEACTIVATE);
  const canReset = can(me?.permissions, PERMISSIONS.USERS_RESET);
  const canAssign = can(me?.permissions, PERMISSIONS.ROLES_ASSIGN);

  const [user, setUser] = useState<StaffUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<StaffUser>(`/users/${id}`);
      setUser(res);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load the account.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

  if (!canView) return <AccessNotice />;
  if (loading) return <Spinner label="Loading account…" />;
  if (forbidden) return <AccessNotice />;
  if (notFound)
    return (
      <Alert kind="warning" title="Not found">
        No staff account matches this id.
      </Alert>
    );
  if (error && !user) return <Alert kind="error">{error}</Alert>;
  if (!user) return null;

  const isSelf = me?.userId === user.id;

  return (
    <>
      <PageHeader
        title={user.fullName}
        description={user.email}
        actions={
          <Link href="/users" className="btn-secondary">
            Back to staff
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <ProfileCard user={user} canUpdate={canUpdate} onSaved={load} />
          <RolesCard
            user={user}
            canAssign={canAssign}
            onChanged={load}
          />
        </div>

        <div className="space-y-6">
          <div className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Account</h2>
            <div className="space-y-3">
              <Labeled label="Status">
                <StatusBadge state={user.isActive ? 'ACTIVE' : 'LOCKED'} />
              </Labeled>
              <Labeled label="Must change password">
                {user.mustChangePassword ? 'Yes' : 'No'}
              </Labeled>
              <Labeled label="Last login">
                {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—'}
              </Labeled>
              <Labeled label="Created">
                {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}
              </Labeled>
            </div>
          </div>

          {canDeactivate || canReset ? (
            <SecurityCard
              user={user}
              isSelf={isSelf}
              canDeactivate={canDeactivate}
              canReset={canReset}
              onChanged={load}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}

function ProfileCard({
  user,
  canUpdate,
  onSaved,
}: {
  user: StaffUser;
  canUpdate: boolean;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(user.fullName);
  const [email, setEmail] = useState(user.email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const dirty = fullName.trim() !== user.fullName || email.trim() !== user.email;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    setBusy(true);
    try {
      const payload: Record<string, string> = {};
      if (fullName.trim() !== user.fullName) payload.fullName = fullName.trim();
      if (email.trim() !== user.email) payload.email = email.trim();
      await api.patch(`/users/${user.id}`, payload);
      setOk(true);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save.');
    } finally {
      setBusy(false);
    }
  }

  if (!canUpdate) {
    return (
      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Profile</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Labeled label="Full name">{user.fullName}</Labeled>
          <Labeled label="Email">{user.email}</Labeled>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Profile</h2>
      {error ? (
        <div className="mb-3">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}
      {ok ? (
        <div className="mb-3">
          <Alert kind="success">Saved.</Alert>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="mt-4">
        <button type="submit" className="btn-primary" disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

function SecurityCard({
  user,
  isSelf,
  canDeactivate,
  canReset,
  onChanged,
}: {
  user: StaffUser;
  isSelf: boolean;
  canDeactivate: boolean;
  canReset: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);

  async function setActive(isActive: boolean) {
    setError(null);
    if (
      !window.confirm(
        isActive
          ? 'Reactivate this account?'
          : 'Deactivate this account? Active sessions will be revoked.',
      )
    )
      return;
    setBusy(true);
    try {
      await api.post(`/users/${user.id}/set-active`, { isActive });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change status.');
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    setError(null);
    setResetToken(null);
    if (
      !window.confirm(
        'Issue a password reset? The user must set a new password and active sessions are revoked.',
      )
    )
      return;
    setBusy(true);
    try {
      const res = await api.post<{ resetToken: string; expiresInSec: number }>(
        `/users/${user.id}/reset-password`,
      );
      setResetToken(res.resetToken);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reset.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Security actions</h2>
      {error ? (
        <div className="mb-3">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}
      {resetToken ? (
        <div className="mb-3">
          <Alert kind="success" title="Reset token issued — copy it now">
            <code className="mt-1 block break-all rounded bg-white/60 px-2 py-1 text-xs">
              {resetToken}
            </code>
            <p className="mt-1 text-xs">
              Share this with the user out-of-band. It is shown only once and expires.
            </p>
          </Alert>
        </div>
      ) : null}
      <div className="space-y-2">
        {canDeactivate ? (
          user.isActive ? (
            <button
              className="btn-secondary w-full"
              onClick={() => setActive(false)}
              disabled={busy || isSelf}
              title={isSelf ? 'You cannot deactivate your own account' : undefined}
            >
              Deactivate account
            </button>
          ) : (
            <button
              className="btn-primary w-full"
              onClick={() => setActive(true)}
              disabled={busy}
            >
              Reactivate account
            </button>
          )
        ) : null}
        {canReset ? (
          <button className="btn-secondary w-full" onClick={resetPassword} disabled={busy}>
            Issue password reset
          </button>
        ) : null}
        {isSelf && canDeactivate ? (
          <p className="text-xs text-slate-500">You cannot deactivate your own account.</p>
        ) : null}
      </div>
    </div>
  );
}

function RolesCard({
  user,
  canAssign,
  onChanged,
}: {
  user: StaffUser;
  canAssign: boolean;
  onChanged: () => void;
}) {
  const { me } = useSession();
  const canViewRoles = can(me?.permissions, PERMISSIONS.ROLES_VIEW);
  const canViewStructure = can(me?.permissions, PERMISSIONS.STRUCTURE_VIEW);

  const [roles, setRoles] = useState<RoleView[]>([]);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [programmes, setProgrammes] = useState<Programme[]>([]);

  const [roleId, setRoleId] = useState('');
  const [scopeType, setScopeType] = useState<ScopeType>('GLOBAL');
  const [facultyId, setFacultyId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [programmeId, setProgrammeId] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canAssign || !canViewRoles) return;
    api.get<RoleView[]>('/roles').then(setRoles).catch(() => setRoles([]));
  }, [canAssign, canViewRoles]);

  useEffect(() => {
    if (!canAssign || !canViewStructure) return;
    api.get<Faculty[]>('/structure/faculties').then(setFaculties).catch(() => setFaculties([]));
  }, [canAssign, canViewStructure]);

  useEffect(() => {
    if (!facultyId) {
      setDepartments([]);
      return;
    }
    api
      .get<Department[]>(`/structure/departments?facultyId=${facultyId}`)
      .then(setDepartments)
      .catch(() => setDepartments([]));
  }, [facultyId]);

  useEffect(() => {
    if (!departmentId) {
      setProgrammes([]);
      return;
    }
    api
      .get<Programme[]>(`/structure/programmes?departmentId=${departmentId}`)
      .then(setProgrammes)
      .catch(() => setProgrammes([]));
  }, [departmentId]);

  const selectedRole = useMemo(() => roles.find((r) => r.id === roleId), [roles, roleId]);

  // A role may be assigned at its own scopeKind or NARROWER only.
  const allowedScopes = useMemo(() => {
    if (!selectedRole) return SCOPE_TYPES;
    return SCOPE_TYPES.filter((s) => SCOPE_RANK[s] >= SCOPE_RANK[selectedRole.scopeKind]);
  }, [selectedRole]);

  // Keep the chosen scope valid when the role changes.
  useEffect(() => {
    if (selectedRole && !allowedScopes.includes(scopeType)) {
      setScopeType(selectedRole.scopeKind);
    }
  }, [selectedRole, allowedScopes, scopeType]);

  // Name lookups so existing assignments read as names, not raw ids (best-effort).
  const facultyName = (fid: string | null) => faculties.find((f) => f.id === fid)?.name ?? null;
  const departmentName = (did: string | null) =>
    departments.find((d) => d.id === did)?.name ?? null;
  const programmeName = (pid: string | null) => programmes.find((p) => p.id === pid)?.name ?? null;

  function scopeLabel(a: RoleAssignmentView) {
    switch (a.scopeType) {
      case 'GLOBAL':
        return 'Global';
      case 'FACULTY':
        return `Faculty${facultyName(a.facultyId) ? ` · ${facultyName(a.facultyId)}` : ''}`;
      case 'DEPARTMENT':
        return `Department${departmentName(a.departmentId) ? ` · ${departmentName(a.departmentId)}` : ''}`;
      case 'PROGRAMME':
        return `Programme${programmeName(a.programmeId) ? ` · ${programmeName(a.programmeId)}` : ''}`;
    }
  }

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!roleId) {
      setError('Choose a role.');
      return;
    }
    const payload: Record<string, string> = { roleId, scopeType };
    if (scopeType === 'FACULTY') {
      if (!facultyId) return setError('Select a faculty for FACULTY scope.');
      payload.facultyId = facultyId;
    } else if (scopeType === 'DEPARTMENT') {
      if (!departmentId) return setError('Select a department for DEPARTMENT scope.');
      payload.departmentId = departmentId;
    } else if (scopeType === 'PROGRAMME') {
      if (!programmeId) return setError('Select a programme for PROGRAMME scope.');
      payload.programmeId = programmeId;
    }
    setBusy(true);
    try {
      await api.post(`/users/${user.id}/roles`, payload);
      setRoleId('');
      setScopeType('GLOBAL');
      setFacultyId('');
      setDepartmentId('');
      setProgrammeId('');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to assign the role.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(assignmentId: string) {
    if (!window.confirm('Revoke this role assignment?')) return;
    setError(null);
    setBusy(true);
    try {
      await api.del(`/users/${user.id}/roles/${assignmentId}`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revoke.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Roles</h2>
      {error ? (
        <div className="mb-3">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      {user.roles.length ? (
        <ul className="mb-4 divide-y divide-slate-100">
          {user.roles.map((a) => (
            <li key={a.assignmentId} className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium text-slate-800">{a.roleName}</p>
                <p className="text-xs text-slate-500">{scopeLabel(a)}</p>
              </div>
              {canAssign ? (
                <button
                  className="text-sm text-red-600 hover:underline disabled:opacity-50"
                  onClick={() => revoke(a.assignmentId)}
                  disabled={busy}
                >
                  Revoke
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-slate-500">No roles assigned.</p>
      )}

      {canAssign ? (
        canViewRoles ? (
          <form onSubmit={assign} className="space-y-3 border-t border-slate-100 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Assign a role
            </p>
            <div>
              <label htmlFor="assign-role" className="label">
                Role
              </label>
              <select
                id="assign-role"
                className="input"
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
              >
                <option value="">Select a role…</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id} disabled={!r.grantable}>
                    {r.name}
                    {r.grantable ? '' : ' — not grantable by you'}
                  </option>
                ))}
              </select>
              {selectedRole ? (
                <p className="mt-1 text-xs text-slate-500">
                  Default scope: {selectedRole.scopeKind}. {selectedRole.description}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="assign-scope" className="label">
                Scope
              </label>
              <select
                id="assign-scope"
                className="input"
                value={scopeType}
                onChange={(e) => {
                  setScopeType(e.target.value as ScopeType);
                  setFacultyId('');
                  setDepartmentId('');
                  setProgrammeId('');
                }}
              >
                {allowedScopes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {!canViewStructure && scopeType !== 'GLOBAL' ? (
              <Alert kind="info">
                Selecting a specific faculty/department/programme needs the “University structure”
                permission. You can still assign at GLOBAL scope.
              </Alert>
            ) : null}

            {scopeType === 'FACULTY' || scopeType === 'DEPARTMENT' || scopeType === 'PROGRAMME' ? (
              <div>
                <label htmlFor="assign-faculty" className="label">
                  Faculty
                </label>
                <select
                  id="assign-faculty"
                  className="input"
                  value={facultyId}
                  onChange={(e) => {
                    setFacultyId(e.target.value);
                    setDepartmentId('');
                    setProgrammeId('');
                  }}
                >
                  <option value="">Select faculty…</option>
                  {faculties.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {scopeType === 'DEPARTMENT' || scopeType === 'PROGRAMME' ? (
              <div>
                <label htmlFor="assign-department" className="label">
                  Department
                </label>
                <select
                  id="assign-department"
                  className="input"
                  value={departmentId}
                  onChange={(e) => {
                    setDepartmentId(e.target.value);
                    setProgrammeId('');
                  }}
                  disabled={!facultyId}
                >
                  <option value="">Select department…</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {scopeType === 'PROGRAMME' ? (
              <div>
                <label htmlFor="assign-programme" className="label">
                  Programme
                </label>
                <select
                  id="assign-programme"
                  className="input"
                  value={programmeId}
                  onChange={(e) => setProgrammeId(e.target.value)}
                  disabled={!departmentId}
                >
                  <option value="">Select programme…</option>
                  {programmes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <button type="submit" className="btn-primary" disabled={busy || !roleId}>
              {busy ? 'Assigning…' : 'Assign role'}
            </button>
          </form>
        ) : (
          <p className="border-t border-slate-100 pt-4 text-sm text-slate-500">
            You can revoke roles but need the “Roles: view” permission to see the assignable role
            catalog.
          </p>
        )
      ) : null}
    </div>
  );
}
