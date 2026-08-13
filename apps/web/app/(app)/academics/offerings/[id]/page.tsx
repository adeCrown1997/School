'use client';

/**
 * Course offering detail and edit. View requires OFFERINGS_VIEW; edit and delete
 * require OFFERINGS_MANAGE. Status transitions follow API rules (no return to DRAFT).
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { Department, OfferingListItem, OfferingStatus } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Field, Labeled, Spinner, StatusBadge } from '@/components/ui';

export default function OfferingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.OFFERINGS_VIEW);
  const canManage = can(me?.permissions, PERMISSIONS.OFFERINGS_MANAGE);

  const [offering, setOffering] = useState<OfferingListItem | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [details, setDetails] = useState<string[] | null>(null);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    departmentId: '',
    status: 'DRAFT' as OfferingStatus,
    uncapped: true,
    capacity: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<OfferingListItem>(`/academics/offerings/${id}`);
      setOffering(res);
      setForm({
        departmentId: res.department?.id ?? '',
        status: res.status,
        uncapped: res.capacity === null,
        capacity: res.capacity !== null ? String(res.capacity) : '',
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load the offering.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

  useEffect(() => {
    if (!canManage) return;
    api.get<Department[]>('/structure/departments').then(setDepartments).catch(() => {});
  }, [canManage]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDetails(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {};
      if (form.departmentId) payload.departmentId = form.departmentId;
      if (form.status !== offering?.status) payload.status = form.status;
      if (form.uncapped) {
        if (offering?.capacity !== null) payload.capacity = null;
      } else if (form.capacity.trim() !== '') {
        payload.capacity = Number(form.capacity);
      }
      await api.patch(`/academics/offerings/${id}`, payload);
      setSuccess('Offering updated.');
      setEditing(false);
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? null);
      } else setError('Failed to update the offering.');
    } finally {
      setSubmitting(false);
    }
  }

  async function removeOffering() {
    if (!window.confirm('Delete this draft offering? This cannot be undone.')) return;
    setError(null);
    setSuccess(null);
    try {
      await api.del(`/academics/offerings/${id}`);
      router.push('/academics/offerings');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete the offering.');
    }
  }

  if (!canView) return <AccessNotice />;

  if (loading) return <Spinner label="Loading offering…" />;

  if (forbidden) return <AccessNotice />;

  if (notFound) {
    return (
      <>
        <PageHeader title="Offering not found" />
        <Link href="/academics/offerings" className="text-brand-700 hover:underline">
          Back to offerings
        </Link>
      </>
    );
  }

  if (!offering) return null;

  const isDraft = offering.status === 'DRAFT';

  return (
    <>
      <PageHeader
        title={`${offering.course.code} — ${offering.session.name}`}
        description={`${offering.course.title} · ${offering.semester.name}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/academics/offerings" className="btn-secondary">
              Back
            </Link>
            {canManage && !editing ? (
              <button type="button" className="btn-primary" onClick={() => setEditing(true)}>
                Edit
              </button>
            ) : null}
            {canManage && isDraft ? (
              <button type="button" className="btn-secondary text-red-700" onClick={removeOffering}>
                Delete
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

      {editing && canManage ? (
        <form onSubmit={save} className="card mx-auto max-w-2xl space-y-6 p-6">
          <div>
            <label htmlFor="department" className="label">
              Teaching department
            </label>
            <select
              id="department"
              className="input"
              value={form.departmentId}
              onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
            >
              <option value="">None</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
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
              value={form.status}
              onChange={(e) =>
                setForm((f) => ({ ...f, status: e.target.value as OfferingStatus }))
              }
            >
              {isDraft ? <option value="DRAFT">Draft</option> : null}
              <option value="OPEN">Open</option>
              <option value="CLOSED">Closed</option>
            </select>
            {!isDraft ? (
              <p className="mt-1 text-xs text-slate-500">
                An offering cannot return to draft once published. Close it instead.
              </p>
            ) : null}
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.uncapped}
                onChange={(e) => setForm((f) => ({ ...f, uncapped: e.target.checked }))}
              />
              Uncapped capacity
            </label>
            {!form.uncapped ? (
              <Field
                label="Capacity"
                type="number"
                min={0}
                max={100000}
                className="mt-2"
                value={form.capacity}
                onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
                hint="Set capacity before opening if status is Open."
              />
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setEditing(false);
                setForm({
                  departmentId: offering.department?.id ?? '',
                  status: offering.status,
                  uncapped: offering.capacity === null,
                  capacity: offering.capacity !== null ? String(offering.capacity) : '',
                });
              }}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      ) : (
        <div className="card mx-auto max-w-2xl divide-y divide-slate-100 p-6">
          <div className="grid gap-4 pb-4 sm:grid-cols-2">
            <Labeled label="Course">
              <Link href={`/academics/courses/${offering.course.id}`} className="text-brand-700 hover:underline">
                {offering.course.code} — {offering.course.title}
              </Link>
              <span className="block text-xs text-slate-500">
                Level {offering.course.level} · {offering.course.creditUnits} units
              </span>
            </Labeled>
            <Labeled label="Status">
              <StatusBadge state={offering.status} />
            </Labeled>
            <Labeled label="Session">{offering.session.name}</Labeled>
            <Labeled label="Semester">{offering.semester.name}</Labeled>
            <Labeled label="Teaching department">{offering.department?.name ?? '—'}</Labeled>
            <Labeled label="Capacity">
              {offering.capacity === null ? 'Uncapped' : offering.capacity}
            </Labeled>
            <Labeled label="Seats taken">{offering.seatsTaken}</Labeled>
            <Labeled label="Seats available">
              {offering.seatsAvailable === null ? 'Uncapped' : offering.seatsAvailable}
              {offering.isFull ? (
                <span className="ml-2 badge bg-red-100 text-red-800">Full</span>
              ) : null}
            </Labeled>
          </div>
        </div>
      )}
    </>
  );
}
