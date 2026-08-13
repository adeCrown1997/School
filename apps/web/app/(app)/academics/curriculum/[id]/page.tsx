'use client';

/**
 * Curriculum version detail. View/edit metadata and requirements (DRAFT only).
 * Publish and archive require CURRICULUM_PUBLISH.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { CatalogueCourse, CurriculumDetail, RequirementType } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Field, Labeled, Spinner, StatusBadge } from '@/components/ui';

interface RequirementDraft {
  key: string;
  courseId: string;
  level: number;
  semesterSequence: number;
  requirementType: RequirementType;
  creditUnits: string;
  electiveGroup: string;
}

function toDraft(r: CurriculumDetail['requirements'][number]): RequirementDraft {
  return {
    key: r.id,
    courseId: r.course.id,
    level: r.level,
    semesterSequence: r.semesterSequence,
    requirementType: r.requirementType,
    creditUnits: r.creditUnits != null ? String(r.creditUnits) : '',
    electiveGroup: r.electiveGroup ?? '',
  };
}

function newDraftRow(): RequirementDraft {
  return {
    key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    courseId: '',
    level: 100,
    semesterSequence: 1,
    requirementType: 'COMPULSORY',
    creditUnits: '',
    electiveGroup: '',
  };
}

export default function CurriculumDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.CURRICULUM_VIEW);
  const canManage = can(me?.permissions, PERMISSIONS.CURRICULUM_MANAGE);
  const canPublish = can(me?.permissions, PERMISSIONS.CURRICULUM_PUBLISH);

  const [version, setVersion] = useState<CurriculumDetail | null>(null);
  const [courses, setCourses] = useState<CatalogueCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [editingMeta, setEditingMeta] = useState(false);
  const [metaForm, setMetaForm] = useState({ name: '', notes: '' });
  const [submittingMeta, setSubmittingMeta] = useState(false);
  const [details, setDetails] = useState<string[] | null>(null);

  const [editingReqs, setEditingReqs] = useState(false);
  const [reqDrafts, setReqDrafts] = useState<RequirementDraft[]>([]);
  const [submittingReqs, setSubmittingReqs] = useState(false);

  const isDraft = version?.status === 'DRAFT';
  const isPublished = version?.status === 'PUBLISHED';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<CurriculumDetail>(`/academics/curriculum/${id}`);
      setVersion(res);
      setMetaForm({ name: res.name, notes: res.notes ?? '' });
      setReqDrafts(res.requirements.map(toDraft));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load the curriculum version.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

  useEffect(() => {
    if (!canView || !isDraft) return;
    api
      .get<CatalogueCourse[]>('/academics/courses')
      .then(setCourses)
      .catch(() => setCourses([]));
  }, [canView, isDraft]);

  const groupedRequirements = useMemo(() => {
    if (!version) return [];
    const groups = new Map<string, CurriculumDetail['requirements']>();
    for (const r of version.requirements) {
      const key = `${r.level}-${r.semesterSequence}`;
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => {
        const [al = 0, as = 0] = a.split('-').map(Number);
        const [bl = 0, bs = 0] = b.split('-').map(Number);
        return al - bl || as - bs;
      })
      .map(([key, reqs]) => {
        const [level, semesterSequence] = key.split('-').map(Number);
        return { level, semesterSequence, reqs };
      });
  }, [version]);

  async function saveMeta(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDetails(null);
    setSuccess(null);
    setSubmittingMeta(true);
    try {
      await api.patch(`/academics/curriculum/${id}`, {
        name: metaForm.name.trim(),
        notes: metaForm.notes.trim() || null,
      });
      setSuccess('Version updated.');
      setEditingMeta(false);
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? null);
      } else setError('Failed to update the version.');
    } finally {
      setSubmittingMeta(false);
    }
  }

  async function saveRequirements(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDetails(null);
    setSuccess(null);

    const missingCourse = reqDrafts.find((r) => !r.courseId);
    if (missingCourse) {
      setError('Every requirement must have a course selected.');
      return;
    }

    setSubmittingReqs(true);
    try {
      const payload = {
        requirements: reqDrafts.map((r) => ({
          courseId: r.courseId,
          level: Number(r.level),
          semesterSequence: Number(r.semesterSequence),
          requirementType: r.requirementType,
          creditUnits: r.creditUnits.trim() ? Number(r.creditUnits) : undefined,
          electiveGroup:
            r.requirementType === 'ELECTIVE' && r.electiveGroup.trim()
              ? r.electiveGroup.trim()
              : undefined,
        })),
      };
      await api.post(`/academics/curriculum/${id}/requirements`, payload);
      setSuccess('Requirements saved.');
      setEditingReqs(false);
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? null);
      } else setError('Failed to save requirements.');
    } finally {
      setSubmittingReqs(false);
    }
  }

  async function publish() {
    if (!window.confirm('Publish this curriculum? Published versions cannot be edited.')) return;
    setError(null);
    setSuccess(null);
    try {
      await api.post(`/academics/curriculum/${id}/publish`);
      setSuccess('Curriculum published.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to publish.');
    }
  }

  async function archive() {
    if (
      !window.confirm(
        'Archive this curriculum version? It will remain readable but cannot be used for new cohorts.',
      )
    )
      return;
    setError(null);
    setSuccess(null);
    try {
      await api.post(`/academics/curriculum/${id}/archive`);
      setSuccess('Curriculum archived.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to archive.');
    }
  }

  function updateDraft(key: string, patch: Partial<RequirementDraft>) {
    setReqDrafts((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeDraft(key: string) {
    setReqDrafts((rows) => rows.filter((r) => r.key !== key));
  }

  if (!canView) return <AccessNotice />;
  if (loading) return <Spinner label="Loading curriculum version…" />;
  if (forbidden) return <AccessNotice />;
  if (notFound)
    return (
      <Alert kind="warning" title="Not found">
        No curriculum version matches this id.
      </Alert>
    );
  if (!version) return null;

  return (
    <>
      <PageHeader
        title={version.name}
        description={`${version.programme.code} — ${version.programme.name} · effective from ${version.effectiveFromSession.name}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/academics/curriculum" className="btn-secondary">
              Back to list
            </Link>
            {canManage && isDraft && !editingMeta ? (
              <button type="button" className="btn-secondary" onClick={() => setEditingMeta(true)}>
                Edit details
              </button>
            ) : null}
            {canPublish && isDraft ? (
              <button type="button" className="btn-primary" onClick={publish}>
                Publish
              </button>
            ) : null}
            {canPublish && isPublished ? (
              <button type="button" className="btn-secondary" onClick={archive}>
                Archive
              </button>
            ) : null}
          </div>
        }
      />

      {error ? (
        <div className="mb-4">
          <Alert kind="error" title={error}>
            {details?.length ? (
              <ul className="ml-4 list-disc">
                {details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : null}
          </Alert>
        </div>
      ) : null}
      {success ? (
        <div className="mb-4">
          <Alert kind="success">{success}</Alert>
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs font-medium uppercase text-slate-500">Status</p>
          <div className="mt-1">
            <StatusBadge state={version.status} />
          </div>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase text-slate-500">Requirements</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-800">
            {version.summary.requirementCount}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase text-slate-500">Total units</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-800">
            {version.summary.totalUnits}
          </p>
        </div>
        {version.publishedAt ? (
          <div className="card p-4">
            <p className="text-xs font-medium uppercase text-slate-500">Published</p>
            <p className="mt-1 text-sm text-slate-800">
              {new Date(version.publishedAt).toLocaleDateString()}
            </p>
          </div>
        ) : null}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-1">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">Version details</h2>
          {editingMeta ? (
            <form onSubmit={saveMeta} className="space-y-4">
              <Field
                label="Name"
                required
                value={metaForm.name}
                onChange={(e) => setMetaForm((f) => ({ ...f, name: e.target.value }))}
              />
              <div>
                <label htmlFor="notes" className="label">
                  Notes
                </label>
                <textarea
                  id="notes"
                  className="input min-h-[4rem]"
                  value={metaForm.notes}
                  onChange={(e) => setMetaForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setEditingMeta(false);
                    setMetaForm({ name: version.name, notes: version.notes ?? '' });
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={submittingMeta}>
                  {submittingMeta ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <Labeled label="Programme">
                {version.programme.code} — {version.programme.name}
              </Labeled>
              <Labeled label="Effective from">{version.effectiveFromSession.name}</Labeled>
              <Labeled label="Notes">{version.notes ?? '—'}</Labeled>
            </div>
          )}
        </div>

        <div className="card p-5 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Units by level</h2>
          {version.summary.byLevel.length === 0 ? (
            <p className="text-sm text-slate-500">No requirements yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-2 pr-4 font-medium">Level</th>
                    <th className="py-2 pr-4 font-medium">Compulsory</th>
                    <th className="py-2 pr-4 font-medium">Elective</th>
                    <th className="py-2 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {version.summary.byLevel.map((row) => (
                    <tr key={row.level} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-4 tabular-nums">{row.level}</td>
                      <td className="py-2 pr-4 tabular-nums">{row.compulsory}</td>
                      <td className="py-2 pr-4 tabular-nums">{row.elective}</td>
                      <td className="py-2 tabular-nums font-medium">{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Course requirements</h2>
          {canManage && isDraft && !editingReqs ? (
            <button type="button" className="btn-secondary" onClick={() => setEditingReqs(true)}>
              Edit requirements
            </button>
          ) : null}
        </div>

        {isDraft && !isPublished && (
          <p className="mb-4 text-xs text-slate-500">
            Each course may appear once. Elective groups need at least two courses sharing the same
            group name.
          </p>
        )}

        {editingReqs && isDraft ? (
          <form onSubmit={saveRequirements} className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="px-2 py-2 font-medium">Course</th>
                    <th className="px-2 py-2 font-medium">Level</th>
                    <th className="px-2 py-2 font-medium">Semester</th>
                    <th className="px-2 py-2 font-medium">Type</th>
                    <th className="px-2 py-2 font-medium">Units override</th>
                    <th className="px-2 py-2 font-medium">Elective group</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {reqDrafts.map((row) => (
                    <tr key={row.key} className="border-b border-slate-100">
                      <td className="px-2 py-2">
                        <select
                          className="input min-w-[12rem]"
                          required
                          value={row.courseId}
                          onChange={(e) => updateDraft(row.key, { courseId: e.target.value })}
                        >
                          <option value="">Select course</option>
                          {courses.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.code} — {c.title}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="input w-20"
                          type="number"
                          min={0}
                          max={1200}
                          step={100}
                          required
                          value={row.level}
                          onChange={(e) => updateDraft(row.key, { level: Number(e.target.value) })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          className="input w-24"
                          value={row.semesterSequence}
                          onChange={(e) =>
                            updateDraft(row.key, { semesterSequence: Number(e.target.value) })
                          }
                        >
                          <option value={1}>1</option>
                          <option value={2}>2</option>
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <select
                          className="input w-32"
                          value={row.requirementType}
                          onChange={(e) =>
                            updateDraft(row.key, {
                              requirementType: e.target.value as RequirementType,
                            })
                          }
                        >
                          <option value="COMPULSORY">Compulsory</option>
                          <option value="ELECTIVE">Elective</option>
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="input w-20"
                          type="number"
                          min={0}
                          max={60}
                          placeholder="—"
                          value={row.creditUnits}
                          onChange={(e) => updateDraft(row.key, { creditUnits: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="input w-28"
                          placeholder="e.g. elect-a"
                          disabled={row.requirementType !== 'ELECTIVE'}
                          value={row.electiveGroup}
                          onChange={(e) => updateDraft(row.key, { electiveGroup: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          className="text-sm text-red-600 hover:underline"
                          onClick={() => removeDraft(row.key)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setReqDrafts((rows) => [...rows, newDraftRow()])}
              >
                Add course
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setEditingReqs(false);
                    setReqDrafts(version.requirements.map(toDraft));
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={submittingReqs}>
                  {submittingReqs ? 'Saving…' : 'Save requirements'}
                </button>
              </div>
            </div>
          </form>
        ) : groupedRequirements.length === 0 ? (
          <p className="text-sm text-slate-500">No course requirements defined yet.</p>
        ) : (
          <div className="space-y-6">
            {groupedRequirements.map(({ level, semesterSequence, reqs }) => (
              <div key={`${level}-${semesterSequence}`}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Level {level} · Semester {semesterSequence}
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-500">
                        <th className="py-2 pr-4 font-medium">Code</th>
                        <th className="py-2 pr-4 font-medium">Title</th>
                        <th className="py-2 pr-4 font-medium">Type</th>
                        <th className="py-2 pr-4 font-medium">Units</th>
                        <th className="py-2 font-medium">Group</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reqs.map((r) => (
                        <tr key={r.id} className="border-b border-slate-100 last:border-0">
                          <td className="py-2 pr-4 font-medium text-slate-800">{r.course.code}</td>
                          <td className="py-2 pr-4 text-slate-700">{r.course.title}</td>
                          <td className="py-2 pr-4">
                            <span className="badge bg-slate-100 text-slate-700">
                              {r.requirementType}
                            </span>
                          </td>
                          <td className="py-2 pr-4 tabular-nums">
                            {r.creditUnits ?? r.course.creditUnits}
                          </td>
                          <td className="py-2 text-slate-600">{r.electiveGroup ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
