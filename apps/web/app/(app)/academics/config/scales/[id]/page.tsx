'use client';

/**
 * Grade scale detail. View requires academic.config.view; replace bands and
 * set-default require academic.config.manage. Bands cannot be edited once any
 * grade record references the scale — create a new scale instead.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { GradeScale } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Labeled, Spinner, StatusBadge } from '@/components/ui';
import {
  GradeBandsEditor,
  parseBandsPayload,
  type BandDraft,
} from '@/components/academics/grade-bands-editor';

function bandToDraft(b: GradeScale['bands'][number]): BandDraft {
  return {
    grade: b.grade,
    minScore: String(b.minScore),
    maxScore: String(b.maxScore),
    gradePoint: String(b.gradePoint),
  };
}

export default function GradeScaleDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.ACADEMIC_CONFIG_VIEW);
  const canManage = can(me?.permissions, PERMISSIONS.ACADEMIC_CONFIG_MANAGE);

  const [scale, setScale] = useState<GradeScale | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [editingBands, setEditingBands] = useState(false);
  const [bands, setBands] = useState<BandDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [details, setDetails] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<GradeScale>(`/academics/grade-scales/${id}`);
      setScale(res);
      setBands(res.bands.map(bandToDraft));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load the grade scale.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

  const lockedByRecords = (scale?._count?.gradeRecords ?? 0) > 0;

  async function saveBands(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !scale || lockedByRecords) return;
    setError(null);
    setDetails(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const updated = await api.post<GradeScale>(`/academics/grade-scales/${id}/bands`, {
        bands: parseBandsPayload(bands),
      });
      setScale(updated);
      setBands(updated.bands.map(bandToDraft));
      setEditingBands(false);
      setSuccess('Bands updated.');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? null);
      } else setError('Failed to update bands.');
    } finally {
      setSubmitting(false);
    }
  }

  async function setDefault() {
    if (!canManage || !scale) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const updated = await api.post<GradeScale>(`/academics/grade-scales/${id}/set-default`);
      setScale(updated);
      setSuccess(`${updated.key} is now the default scale.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to set default scale.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!canView) return <AccessNotice />;
  if (forbidden) return <AccessNotice />;
  if (loading) return <Spinner label="Loading grade scale…" />;
  if (notFound || !scale) {
    return (
      <Alert kind="error" title="Grade scale not found">
        <Link href="/academics/config" className="text-brand-700 underline">
          Back to academic config
        </Link>
      </Alert>
    );
  }

  const sortedBands = [...scale.bands].sort((a, b) => Number(b.minScore) - Number(a.minScore));

  return (
    <>
      <PageHeader
        title={scale.name}
        description={`${scale.key}${scale.description ? ` — ${scale.description}` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/academics/config" className="btn-secondary">
              Back to config
            </Link>
            {canManage && !scale.isDefault && scale.isActive ? (
              <button
                type="button"
                className="btn-primary"
                disabled={submitting || scale.bands.length === 0}
                onClick={setDefault}
              >
                Set as default
              </button>
            ) : null}
          </div>
        }
      />

      {error ? (
        <div className="mb-4">
          <Alert kind="error" title={error}>
            {details?.length ? (
              <ul className="mt-1 list-disc pl-5">
                {details.map((d) => (
                  <li key={d}>{d}</li>
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

      <section className="card mb-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Labeled label="Key">{scale.key}</Labeled>
        <Labeled label="Status">
          <StatusBadge state={scale.isActive ? 'ACTIVE' : 'INACTIVE'} />
        </Labeled>
        <Labeled label="Default">{scale.isDefault ? 'Yes' : 'No'}</Labeled>
        <Labeled label="Grade records">{scale._count?.gradeRecords ?? 0}</Labeled>
      </section>

      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Bands</h2>
            <p className="text-sm text-slate-500">
              {lockedByRecords
                ? 'This scale has graded results — bands are locked. Create a new scale to revise.'
                : 'Scores map inclusively; consecutive bands must meet with no gap.'}
            </p>
          </div>
          {canManage && !lockedByRecords && !editingBands ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setBands(scale.bands.map(bandToDraft));
                setEditingBands(true);
                setError(null);
                setSuccess(null);
              }}
            >
              Edit bands
            </button>
          ) : null}
        </div>

        {editingBands ? (
          <form onSubmit={saveBands} className="space-y-4">
            <GradeBandsEditor bands={bands} onChange={setBands} disabled={submitting} />
            <div className="flex gap-2">
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? 'Saving…' : 'Save bands'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={submitting}
                onClick={() => {
                  setEditingBands(false);
                  setBands(scale.bands.map(bandToDraft));
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="px-3 py-2 font-medium">Grade</th>
                  <th className="px-3 py-2 font-medium">Score range</th>
                  <th className="px-3 py-2 font-medium">Points</th>
                </tr>
              </thead>
              <tbody>
                {sortedBands.map((b) => (
                  <tr key={b.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 font-medium text-slate-800">{b.grade}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">
                      {b.minScore} – {b.maxScore}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">{b.gradePoint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
