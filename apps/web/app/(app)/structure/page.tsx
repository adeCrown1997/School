'use client';

/**
 * University structure (§7). Read view renders the persisted hierarchy
 * University → Faculty → Department → Programme plus academic sessions — nothing
 * is hardcoded; it all comes from the DB. Staff with STRUCTURE_MANAGE additionally
 * get create forms and a "set current session" action. Every write is authorized
 * and audited server-side; the forms are convenience only.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { AcademicSession, Faculty, UniversityTree } from '@/lib/types';
import { PageHeader, AccessNotice, EmptyState } from '@/components/page';
import { Alert, Spinner } from '@/components/ui';
import { ManagePanel } from './manage';

export default function StructurePage() {
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.STRUCTURE_VIEW);
  const canManage = can(me?.permissions, PERMISSIONS.STRUCTURE_MANAGE);

  const [tree, setTree] = useState<UniversityTree[]>([]);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, s] = await Promise.all([
        api.get<UniversityTree[]>('/structure/tree'),
        api.get<AcademicSession[]>('/structure/sessions'),
      ]);
      setTree(t);
      setSessions(s);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load structure.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

  if (!canView) return <AccessNotice />;
  if (loading) return <Spinner label="Loading structure…" />;
  if (forbidden) return <AccessNotice />;
  if (error) return <Alert kind="error">{error}</Alert>;

  const university = tree[0] ?? null;

  return (
    <>
      <PageHeader
        title="University structure"
        description="Faculties, departments, programmes and academic sessions — the source of truth for every dropdown."
      />

      {canManage ? (
        <div className="mb-6">
          <ManagePanel
            universityId={university?.id ?? null}
            tree={tree}
            onChanged={load}
          />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-700">Academic hierarchy</h2>
          {tree.length === 0 ? (
            <EmptyState title="No university structure yet.">
              {canManage
                ? 'Create a faculty to get started.'
                : 'An administrator has not set up the structure yet.'}
            </EmptyState>
          ) : (
            tree.map((uni) => (
              <div key={uni.id} className="card p-5">
                <h3 className="text-base font-bold text-slate-900">{uni.name}</h3>
                {uni.faculties.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">No faculties yet.</p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {uni.faculties.map((f) => (
                      <FacultyNode key={f.id} faculty={f} />
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>

        <div>
          <h2 className="mb-4 text-sm font-semibold text-slate-700">Academic sessions</h2>
          <div className="card p-5">
            {sessions.length === 0 ? (
              <p className="text-sm text-slate-500">No sessions yet.</p>
            ) : (
              <ul className="space-y-2">
                {sessions.map((s) => (
                  <li key={s.id} className="flex items-center justify-between">
                    <span className="text-sm text-slate-800">
                      {s.name}
                      {s.isCurrent ? (
                        <span className="ml-2 badge bg-green-100 text-green-800">current</span>
                      ) : null}
                    </span>
                    {canManage && !s.isCurrent ? (
                      <SetCurrentButton sessionId={s.id} onChanged={load} />
                    ) : null}
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

function FacultyNode({ faculty }: { faculty: Faculty }) {
  return (
    <li>
      <p className="text-sm font-semibold text-slate-800">
        {faculty.name} <span className="text-xs font-normal text-slate-400">({faculty.code})</span>
      </p>
      {faculty.departments && faculty.departments.length ? (
        <ul className="ml-4 mt-1 space-y-1 border-l border-slate-100 pl-3">
          {faculty.departments.map((d) => (
            <li key={d.id}>
              <p className="text-sm text-slate-700">
                {d.name} <span className="text-xs text-slate-400">({d.code})</span>
              </p>
              {d.programmes && d.programmes.length ? (
                <ul className="ml-4 mt-0.5 list-disc text-xs text-slate-500">
                  {d.programmes.map((p) => (
                    <li key={p.id}>
                      {p.name} — {p.award} ({p.durationYears}yr)
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ml-4 text-xs text-slate-400">No programmes.</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ml-4 text-xs text-slate-400">No departments.</p>
      )}
    </li>
  );
}

function SetCurrentButton({ sessionId, onChanged }: { sessionId: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!window.confirm('Make this the current academic session?')) return;
    setBusy(true);
    try {
      await api.post(`/structure/sessions/${sessionId}/set-current`);
      onChanged();
    } catch {
      /* surfaced by reload; keep the control simple */
    } finally {
      setBusy(false);
    }
  }
  return (
    <button className="text-xs text-brand-600 hover:underline" onClick={go} disabled={busy}>
      {busy ? '…' : 'Set current'}
    </button>
  );
}
