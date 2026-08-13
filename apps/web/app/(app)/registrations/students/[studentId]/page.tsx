'use client';

/**
 * Staff manage a student's course registration on their behalf (§9).
 * Backed by GET /registrations/students/:id/context and the staff mutation
 * routes (draft, lines, submit). Requires registration.view to load;
 * registration.manage to edit. Carryover drops additionally need
 * registration.exception.review unless an approved exception exists.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type {
  AcademicSession,
  RegistrationContext,
  RegistrationDetail,
  Semester,
  StudentRecord,
} from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Spinner, StatusBadge } from '@/components/ui';

const GATE_LABELS: Record<string, string> = {
  ACCOUNT: 'Account active',
  WINDOW: 'Registration window open',
  FEE_CLEARANCE: 'Fee clearance',
  HOLDS: 'No registration holds',
  DURATION: 'Within programme duration',
};

const EDITABLE = new Set(['DRAFT', 'REJECTED']);

function activeLines(reg: RegistrationDetail | null) {
  return reg?.lines.filter((l) => l.state === 'ACTIVE') ?? [];
}

function formatStatus(status: string) {
  return status.replace(/_/g, ' ');
}

export default function StaffStudentRegistrationPage() {
  const params = useParams<{ studentId: string }>();
  const studentId = params.studentId;
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.REGISTRATION_VIEW);
  const canManage = can(me?.permissions, PERMISSIONS.REGISTRATION_MANAGE);
  const canExceptionReview = can(me?.permissions, PERMISSIONS.REGISTRATION_EXCEPTION_REVIEW);

  const [student, setStudent] = useState<StudentRecord | null>(null);
  const [ctx, setCtx] = useState<RegistrationContext | null>(null);
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [period, setPeriod] = useState({ sessionId: '', semesterId: '' });

  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    api.get<AcademicSession[]>('/structure/sessions').then(setSessions).catch(() => setSessions([]));
  }, [canView]);

  useEffect(() => {
    if (!canView || !period.sessionId) {
      setSemesters([]);
      return;
    }
    api
      .get<Semester[]>(`/structure/semesters?sessionId=${period.sessionId}`)
      .then(setSemesters)
      .catch(() => setSemesters([]));
  }, [canView, period.sessionId]);

  const loadContext = useCallback(
    async (sessionId?: string, semesterId?: string) => {
      const params = new URLSearchParams();
      if (sessionId) params.set('sessionId', sessionId);
      if (semesterId) params.set('semesterId', semesterId);
      const qs = params.toString();
      const path = `/registrations/students/${studentId}/context${qs ? `?${qs}` : ''}`;
      const res = await api.get<RegistrationContext>(path);
      setCtx(res);
      setPeriod({ sessionId: res.session.id, semesterId: res.semester.id });
      return res;
    },
    [studentId],
  );

  const load = useCallback(async () => {
    setActionError(null);
    setError(null);
    setLoading(true);
    try {
      await loadContext();
      if (can(me?.permissions, PERMISSIONS.STUDENTS_VIEW)) {
        api
          .get<StudentRecord>(`/students/${studentId}`)
          .then(setStudent)
          .catch(() => setStudent(null));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load registration context.');
    } finally {
      setLoading(false);
    }
  }, [studentId, me?.permissions, loadContext]);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

  async function applyPeriod(sessionId: string, semesterId: string) {
    setPeriod({ sessionId, semesterId });
    setLoading(true);
    setActionError(null);
    setError(null);
    try {
      await loadContext(sessionId || undefined, semesterId || undefined);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load registration context.');
    } finally {
      setLoading(false);
    }
  }

  async function startDraft() {
    if (!ctx || !canManage) return;
    setBusy('draft');
    setActionError(null);
    try {
      const reg = await api.post<RegistrationDetail>(
        `/registrations/students/${studentId}/draft`,
        { sessionId: ctx.session.id, semesterId: ctx.semester.id },
      );

      const preSelected = ctx.courses.items.filter(
        (i) => i.preSelected && i.selectable && !i.alreadyRegistered,
      );
      if (preSelected.length) {
        await api.post(`/registrations/${reg.id}/lines`, {
          offeringIds: preSelected.map((i) => i.offeringId),
        });
      }
      await loadContext(ctx.session.id, ctx.semester.id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not start registration.');
    } finally {
      setBusy(null);
    }
  }

  async function addCourse(offeringId: string) {
    if (!ctx?.registration || !canManage) return;
    setBusy(offeringId);
    setActionError(null);
    try {
      await api.post(`/registrations/${ctx.registration.id}/lines`, {
        offeringIds: [offeringId],
      });
      await loadContext(ctx.session.id, ctx.semester.id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not add the course.');
    } finally {
      setBusy(null);
    }
  }

  async function dropCourse(lineId: string, isCarryover: boolean) {
    if (!ctx?.registration || !canManage) return;
    if (isCarryover && !canExceptionReview) return;

    let reason: string | undefined;
    if (isCarryover || canManage) {
      const input = window.prompt(
        isCarryover
          ? 'Reason for removing this carryover (required, min 3 characters):'
          : 'Reason for removing this course (optional):',
      );
      if (isCarryover && (!input || input.trim().length < 3)) return;
      reason = input?.trim() || undefined;
    }

    setBusy(lineId);
    setActionError(null);
    try {
      await api.del(`/registrations/${ctx.registration.id}/lines/${lineId}`, { reason });
      await loadContext(ctx.session.id, ctx.semester.id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not remove the course.');
    } finally {
      setBusy(null);
    }
  }

  async function submitRegistration() {
    if (!ctx?.registration || !canManage) return;
    if (
      !window.confirm(
        'Submit this registration on behalf of the student? Course seats will be claimed.',
      )
    )
      return;
    setBusy('submit');
    setActionError(null);
    try {
      await api.post(`/registrations/${ctx.registration.id}/submit`, {
        idempotencyKey: crypto.randomUUID(),
      });
      await loadContext(ctx.session.id, ctx.semester.id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not submit registration.');
    } finally {
      setBusy(null);
    }
  }

  if (!canView) return <AccessNotice />;
  if (loading && !ctx) return <Spinner label="Loading registration…" />;
  if (forbidden) return <AccessNotice />;
  if (notFound)
    return (
      <Alert kind="warning" title="Not found">
        No student record matches this id, or it is outside your scope.
      </Alert>
    );
  if (error && !ctx) return <Alert kind="error">{error}</Alert>;
  if (!ctx) return null;

  const reg = ctx.registration;
  const editable = canManage && reg ? EDITABLE.has(reg.status) : false;
  const registeredOfferingIds = new Set(activeLines(reg).map((l) => l.courseOffering.id));
  const available = ctx.courses.items.filter((i) => !registeredOfferingIds.has(i.offeringId));
  const lines = activeLines(reg);
  const unitBounds =
    reg?.minUnits != null && reg?.maxUnits != null
      ? `${reg.minUnits}–${reg.maxUnits} units`
      : null;

  const studentName = student
    ? [student.surname, student.firstName, student.otherNames].filter(Boolean).join(' ')
    : 'Student';
  const matric = student?.matriculationNumber ?? studentId.slice(0, 8);

  return (
    <>
      <PageHeader
        title={`Registration — ${studentName}`}
        description={`${matric} · ${ctx.session.name} · ${ctx.semester.name}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {reg ? <StatusBadge state={reg.status} /> : null}
            {student ? (
              <Link href={`/students/${student.id}`} className="btn-secondary">
                Student record
              </Link>
            ) : null}
            {reg && reg.status !== 'DRAFT' ? (
              <Link href={`/registrations/${reg.id}`} className="btn-secondary">
                Review page
              </Link>
            ) : null}
            <Link href="/registrations" className="btn-secondary">
              Back to list
            </Link>
          </div>
        }
      />

      {!canManage ? (
        <div className="mb-4">
          <Alert kind="info">You have view-only access. Editing requires registration.manage.</Alert>
        </div>
      ) : (
        <div className="mb-4">
          <Alert kind="info">
            You are managing this registration on the student&apos;s behalf. All changes are audited.
          </Alert>
        </div>
      )}

      {actionError ? (
        <div className="mb-4">
          <Alert kind="error">{actionError}</Alert>
        </div>
      ) : null}

      <section className="card mb-6 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Academic period</h2>
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[12rem] flex-1">
            <label htmlFor="period-session" className="label">
              Session
            </label>
            <select
              id="period-session"
              className="input"
              value={period.sessionId}
              onChange={(e) => {
                const sessionId = e.target.value;
                setPeriod({ sessionId, semesterId: '' });
                if (sessionId) applyPeriod(sessionId, '');
              }}
            >
              <option value="">Current session</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.isCurrent ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[12rem] flex-1">
            <label htmlFor="period-semester" className="label">
              Semester
            </label>
            <select
              id="period-semester"
              className="input"
              value={period.semesterId}
              disabled={!period.sessionId}
              onChange={(e) => {
                const semesterId = e.target.value;
                setPeriod((p) => ({ ...p, semesterId }));
                applyPeriod(period.sessionId, semesterId);
              }}
            >
              <option value="">Current semester</option>
              {semesters.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.isCurrent ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="card mb-6 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Eligibility</h2>
        {!ctx.eligibility.eligible ? (
          <Alert kind="warning" title="Student is not eligible to register yet">
            <p>Resolve the items below before submitting the registration.</p>
          </Alert>
        ) : (
          <Alert kind="success">Student meets all eligibility requirements.</Alert>
        )}
        <ul className="mt-4 space-y-2">
          {ctx.eligibility.gates.map((g) => (
            <li key={g.gate} className="flex items-start gap-3 text-sm">
              <span
                aria-hidden
                className={
                  g.passed
                    ? 'text-green-600'
                    : g.notEnforced
                      ? 'text-amber-500'
                      : 'text-red-600'
                }
              >
                {g.passed ? '✓' : g.notEnforced ? '–' : '✗'}
              </span>
              <span className="flex-1">
                <span className="font-medium text-slate-800">{GATE_LABELS[g.gate] ?? g.gate}</span>
                {g.message ? (
                  <span className="mt-0.5 block text-slate-500">{g.message}</span>
                ) : null}
                {g.notEnforced ? (
                  <span className="mt-0.5 block text-xs text-amber-700">Not enforced yet</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {ctx.eligibility.window ? (
          <p className="mt-3 text-xs text-slate-500">
            Registration window:{' '}
            {new Date(ctx.eligibility.window.opensAt).toLocaleString()} –{' '}
            {new Date(ctx.eligibility.window.closesAt).toLocaleString()}
          </p>
        ) : null}
      </section>

      {ctx.courses.curriculumVersion ? (
        <p className="mb-4 text-sm text-slate-500">
          Curriculum: {ctx.courses.curriculumVersion.name} · Level {ctx.courses.level}
          {ctx.courses.warnings.length ? (
            <span className="ml-2 text-amber-700">({ctx.courses.warnings.join('; ')})</span>
          ) : null}
        </p>
      ) : null}

      {!reg && canManage ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-slate-600">
            Open a draft to select courses for {ctx.semester.name} on behalf of the student.
          </p>
          <button className="btn-primary mt-4" disabled={busy === 'draft'} onClick={startDraft}>
            {busy === 'draft' ? 'Starting…' : 'Open registration draft'}
          </button>
          {!ctx.eligibility.eligible ? (
            <p className="mt-3 text-xs text-amber-700">
              A draft can be opened to preview courses, but submission requires eligibility.
            </p>
          ) : null}
        </div>
      ) : null}

      {!reg && !canManage ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-slate-500">No registration exists for this period.</p>
        </div>
      ) : null}

      {reg && !editable ? (
        <section className="card mb-6 p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Registration</h2>
            <span className="text-sm text-slate-500">
              {reg.totalUnits} units{unitBounds ? ` (${unitBounds})` : ''}
            </span>
          </div>
          {reg.status === 'REJECTED' && reg.rejectReason ? (
            <Alert kind="error" title="Registration rejected">
              {reg.rejectReason}
            </Alert>
          ) : null}
          {reg.status === 'PENDING_APPROVAL' ? (
            <Alert kind="info">
              Submitted and awaiting approval. Courses cannot be changed while under review.
            </Alert>
          ) : null}
          {reg.status === 'APPROVED' || reg.status === 'LOCKED' ? (
            <Alert kind="success">
              Registration is {formatStatus(reg.status).toLowerCase()}.
              {reg.lockedAt
                ? ` Locked on ${new Date(reg.lockedAt).toLocaleDateString()}.`
                : null}
            </Alert>
          ) : null}
          <CourseTable lines={lines} editable={false} busy={busy} canDropCarryover={false} onDrop={dropCourse} />
          {reg.approvals.length ? (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Approval progress
              </h3>
              <ul className="space-y-1 text-sm">
                {reg.approvals.map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    <StatusBadge state={a.decision} />
                    <span>{a.stage.name}</span>
                    {a.comment ? <span className="text-slate-500">— {a.comment}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {reg && editable ? (
        <>
          <section className="card mb-6 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-700">Selected courses</h2>
              <span className="text-sm text-slate-500">
                {reg.totalUnits} units{unitBounds ? ` · required ${unitBounds}` : ''}
              </span>
            </div>
            {reg.status === 'REJECTED' && reg.rejectReason ? (
              <div className="mb-4">
                <Alert kind="warning" title="Previous submission rejected">
                  {reg.rejectReason}. Update courses and submit again.
                </Alert>
              </div>
            ) : null}
            {lines.length === 0 ? (
              <p className="text-sm text-slate-500">No courses selected yet. Add courses below.</p>
            ) : (
              <CourseTable
                lines={lines}
                editable
                busy={busy}
                canDropCarryover={canExceptionReview}
                onDrop={dropCourse}
              />
            )}
            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              <button
                className="btn-primary"
                disabled={busy === 'submit' || lines.length === 0}
                onClick={submitRegistration}
              >
                {busy === 'submit' ? 'Submitting…' : 'Submit for approval'}
              </button>
              {!ctx.eligibility.eligible ? (
                <p className="self-center text-xs text-amber-700">
                  Submission is blocked until all eligibility gates pass.
                </p>
              ) : null}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="mb-1 text-sm font-semibold text-slate-700">Available courses</h2>
            <p className="mb-4 text-xs text-slate-500">
              {available.length} course{available.length === 1 ? '' : 's'} available ·{' '}
              {ctx.courses.totals.carryoverCount} carryover
              {ctx.courses.totals.carryoverCount === 1 ? '' : 's'}
            </p>
            {available.length === 0 ? (
              <p className="text-sm text-slate-500">
                All available courses are on the registration.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {available.map((item) => (
                  <li key={item.offeringId} className="flex flex-wrap items-start gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">
                        {item.code}{' '}
                        <span className="font-normal text-slate-600">{item.title}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Level {item.courseLevel} · {item.creditUnits} units · {item.lineType}
                        {item.preSelected ? ' · recommended' : ''}
                      </p>
                      {item.warnings.map((w) => (
                        <p key={w} className="mt-0.5 text-xs text-amber-700">
                          {w}
                        </p>
                      ))}
                      {!item.prerequisites.satisfied ? (
                        <p className="mt-0.5 text-xs text-red-600">
                          Prerequisite:{' '}
                          {item.prerequisites.unmet.map((u) => u.message).join('; ')}
                        </p>
                      ) : null}
                      {item.capacity.isFull ? (
                        <p className="mt-0.5 text-xs text-red-600">No seats available</p>
                      ) : item.capacity.seatsAvailable != null ? (
                        <p className="mt-0.5 text-xs text-slate-400">
                          {item.capacity.seatsAvailable} seat
                          {item.capacity.seatsAvailable === 1 ? '' : 's'} left
                        </p>
                      ) : null}
                    </div>
                    <button
                      className="btn-secondary shrink-0"
                      disabled={!item.selectable || busy === item.offeringId}
                      title={
                        !item.selectable
                          ? item.removable === false
                            ? 'Carryovers cannot be removed without registry approval'
                            : 'This course cannot be selected'
                          : undefined
                      }
                      onClick={() => addCourse(item.offeringId)}
                    >
                      {busy === item.offeringId ? 'Adding…' : 'Add'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {ctx.courses.excluded.length ? (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer text-slate-500">
                  {ctx.courses.excluded.length} course
                  {ctx.courses.excluded.length === 1 ? '' : 's'} not on the list
                </summary>
                <ul className="mt-2 space-y-1 text-xs text-slate-500">
                  {ctx.courses.excluded.map((e) => (
                    <li key={e.courseId}>
                      {e.code} — {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        </>
      ) : null}
    </>
  );
}

function CourseTable({
  lines,
  editable,
  busy,
  canDropCarryover,
  onDrop,
}: {
  lines: RegistrationDetail['lines'];
  editable: boolean;
  busy: string | null;
  canDropCarryover: boolean;
  onDrop: (lineId: string, isCarryover: boolean) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
            <th className="pb-2 pr-4 font-medium">Code</th>
            <th className="pb-2 pr-4 font-medium">Title</th>
            <th className="pb-2 pr-4 font-medium">Units</th>
            <th className="pb-2 pr-4 font-medium">Type</th>
            {editable ? <th className="pb-2 font-medium" /> : null}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const c = line.courseOffering.course;
            const isCarryover = line.lineType === 'CARRYOVER';
            const canDrop = !isCarryover || canDropCarryover;
            return (
              <tr key={line.id} className="border-b border-slate-50">
                <td className="py-2 pr-4 font-medium">{c.code}</td>
                <td className="py-2 pr-4">{c.title}</td>
                <td className="py-2 pr-4 tabular-nums">{line.creditUnits}</td>
                <td className="py-2 pr-4">
                  <span className="badge bg-slate-100 text-slate-600">{line.lineType}</span>
                </td>
                {editable ? (
                  <td className="py-2 text-right">
                    <button
                      className="text-sm text-red-600 hover:underline disabled:opacity-50"
                      disabled={!canDrop || busy === line.id}
                      title={
                        isCarryover && !canDropCarryover
                          ? 'Carryovers require registration.exception.review to remove'
                          : undefined
                      }
                      onClick={() => onDrop(line.id, isCarryover)}
                    >
                      {busy === line.id ? 'Removing…' : 'Remove'}
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
