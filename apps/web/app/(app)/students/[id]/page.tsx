'use client';

/**
 * Admin student detail. Renders the full master record with PROTECTED identity
 * fields visibly read-only (🔒). Authorized staff can:
 *   • change academic status (STUDENTS_STATUS) — applied as an audited amendment,
 *     never a direct write; the DB trigger enforces this regardless of the UI;
 *   • update the profile photo key (STUDENTS_UPDATE) — a non-protected field.
 * The API scopes and authorizes every action; a 403 shows an access notice.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { StudentRecord, StudentStatusRef } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Labeled, Spinner, StatusBadge } from '@/components/ui';

export default function StudentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { me } = useSession();
  const canStatus = can(me?.permissions, PERMISSIONS.STUDENTS_STATUS);
  const canRegView = can(me?.permissions, PERMISSIONS.REGISTRATION_VIEW);
  const canRegManage = can(me?.permissions, PERMISSIONS.REGISTRATION_MANAGE);
  const canFinanceView = can(me?.permissions, PERMISSIONS.FINANCE_VIEW);

  const [record, setRecord] = useState<StudentRecord | null>(null);
  const [statuses, setStatuses] = useState<StudentStatusRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<StudentRecord>(`/students/${id}`);
      setRecord(res);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load the record.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!canStatus) return;
    api
      .get<StudentStatusRef[]>('/students/statuses')
      .then(setStatuses)
      .catch(() => setStatuses([]));
  }, [canStatus]);

  if (loading) return <Spinner label="Loading record…" />;
  if (forbidden) return <AccessNotice />;
  if (notFound)
    return (
      <Alert kind="warning" title="Not found">
        No student record matches this id, or it is outside your scope.
      </Alert>
    );
  if (error && !record) return <Alert kind="error">{error}</Alert>;
  if (!record) return null;

  const fullName = [record.surname, record.firstName, record.otherNames].filter(Boolean).join(' ');

  return (
    <>
      <PageHeader
        title={fullName}
        description={record.matriculationNumber}
        actions={
          <div className="flex flex-wrap gap-2">
            {canRegView ? (
              <Link href={`/registrations/students/${record.id}`} className="btn-primary">
                {canRegManage ? 'Manage registration' : 'View registration'}
              </Link>
            ) : null}
            {canFinanceView ? (
              <Link href={`/finance/students/${record.id}`} className="btn-secondary">
                View ledger
              </Link>
            ) : null}
            <Link href="/students" className="btn-secondary">
              Back to list
            </Link>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Official record</h2>
            <StatusBadge state={record.activationState} />
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Labeled label="Student ID" protectedField>
              {record.studentId}
            </Labeled>
            <Labeled label="Matriculation number" protectedField>
              {record.matriculationNumber}
            </Labeled>
            <Labeled label="JAMB reg. number" protectedField>
              {record.jambRegistrationNumber ?? '—'}
            </Labeled>
            <Labeled label="Surname" protectedField>
              {record.surname}
            </Labeled>
            <Labeled label="First name" protectedField>
              {record.firstName}
            </Labeled>
            <Labeled label="Other names" protectedField>
              {record.otherNames ?? '—'}
            </Labeled>
            <Labeled label="Date of birth" protectedField>
              {record.dateOfBirth?.slice(0, 10)}
            </Labeled>
            <Labeled label="Gender" protectedField>
              {record.gender}
            </Labeled>
            <Labeled label="Entry mode" protectedField>
              {record.entryMode}
            </Labeled>
            <Labeled label="Faculty" protectedField>
              {record.faculty?.name ?? '—'}
            </Labeled>
            <Labeled label="Department" protectedField>
              {record.department?.name ?? '—'}
            </Labeled>
            <Labeled label="Programme" protectedField>
              {record.programme?.name ?? '—'}
            </Labeled>
            <Labeled label="Level" protectedField>
              {record.currentLevel}
            </Labeled>
            <Labeled label="Admission session" protectedField>
              {record.admissionSession?.name ?? '—'}
            </Labeled>
            <Labeled label="Academic status" protectedField>
              {record.studentStatus?.label ?? '—'}
            </Labeled>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            🔒 Protected identity fields are managed by the university and cannot be edited directly.
            Academic status changes are recorded as audited amendments.
          </p>
        </div>

        <div className="space-y-6">
          <div className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Account</h2>
            <div className="space-y-3">
              <Labeled label="Activation state">
                <StatusBadge state={record.activationState} />
              </Labeled>
              <Labeled label="Login email">{record.userAccount?.email ?? '— not activated'}</Labeled>
              <Labeled label="Official email">{record.officialEmail ?? '—'}</Labeled>
              <Labeled label="Official phone">{record.officialPhone ?? '—'}</Labeled>
              <Labeled label="Last login">
                {record.userAccount?.lastLoginAt
                  ? new Date(record.userAccount.lastLoginAt).toLocaleString()
                  : '—'}
              </Labeled>
            </div>
          </div>

          {canStatus ? (
            <StatusChangeCard
              statuses={statuses}
              currentStatusId={record.studentStatus?.id}
              onChanged={load}
              studentId={record.id}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}

function StatusChangeCard({
  statuses,
  currentStatusId,
  studentId,
  onChanged,
}: {
  statuses: StudentStatusRef[];
  currentStatusId?: string;
  studentId: string;
  onChanged: () => void;
}) {
  const [statusId, setStatusId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    if (!statusId) {
      setError('Choose a new status.');
      return;
    }
    if (!window.confirm('Change this student’s academic status? This is recorded in the audit log.'))
      return;
    setBusy(true);
    try {
      await api.post(`/students/${studentId}/status`, { studentStatusId: statusId, reason: reason.trim() });
      setOk(true);
      setReason('');
      setStatusId('');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change status.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Change academic status</h2>
      {error ? (
        <div className="mb-3">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}
      {ok ? (
        <div className="mb-3">
          <Alert kind="success">Status updated.</Alert>
        </div>
      ) : null}
      <div className="space-y-3">
        <div>
          <label htmlFor="new-status" className="label">
            New status
          </label>
          <select
            id="new-status"
            className="input"
            value={statusId}
            onChange={(e) => setStatusId(e.target.value)}
          >
            <option value="">Select…</option>
            {statuses
              .filter((s) => s.id !== currentStatusId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label htmlFor="reason" className="label">
            Reason
          </label>
          <textarea
            id="reason"
            className="input min-h-[80px]"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={3}
            maxLength={500}
            required
          />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Applying…' : 'Apply status change'}
        </button>
      </div>
    </form>
  );
}
