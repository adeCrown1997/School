'use client';

/**
 * Student course registration for the current semester. One screen backed by
 * GET /me/registration — eligibility gates, the §9.2 course list and the
 * student's registration if one exists. Draft edits and submission go through
 * the /me/registration/* endpoints; the API is the sole authority on what may
 * be added, dropped or submitted.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { RegistrationContext, RegistrationDetail } from '@/lib/types';
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

export default function StudentRegistrationPage() {
  const { me } = useSession();
  const [ctx, setCtx] = useState<RegistrationContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setActionError(null);
    try {
      const res = await api.get<RegistrationContext>('/me/registration');
      setCtx(res);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load registration.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function startDraft() {
    if (!ctx) return;
    setBusy('draft');
    setActionError(null);
    try {
      const reg = await api.post<RegistrationDetail>('/me/registration/draft', {
        sessionId: ctx.session.id,
        semesterId: ctx.semester.id,
      });

      const preSelected = ctx.courses.items.filter(
        (i) => i.preSelected && i.selectable && !i.alreadyRegistered,
      );
      if (preSelected.length) {
        await api.post(`/me/registration/${reg.id}/courses`, {
          offeringIds: preSelected.map((i) => i.offeringId),
        });
      }
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not start registration.');
    } finally {
      setBusy(null);
    }
  }

  async function addCourse(offeringId: string) {
    if (!ctx?.registration) return;
    setBusy(offeringId);
    setActionError(null);
    try {
      await api.post(`/me/registration/${ctx.registration.id}/courses`, { offeringIds: [offeringId] });
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not add the course.');
    } finally {
      setBusy(null);
    }
  }

  async function dropCourse(lineId: string) {
    if (!ctx?.registration) return;
    setBusy(lineId);
    setActionError(null);
    try {
      await api.del(`/me/registration/${ctx.registration.id}/courses/${lineId}`);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not remove the course.');
    } finally {
      setBusy(null);
    }
  }

  async function submitRegistration() {
    if (!ctx?.registration) return;
    setBusy('submit');
    setActionError(null);
    try {
      await api.post(`/me/registration/${ctx.registration.id}/submit`, {
        idempotencyKey: crypto.randomUUID(),
      });
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not submit registration.');
    } finally {
      setBusy(null);
    }
  }

  if (me?.userType !== 'STUDENT' && !loading) {
    return (
      <AccessNotice message="Course registration is only available to student accounts." />
    );
  }
  if (loading) return <Spinner label="Loading registration…" />;
  if (forbidden)
    return (
      <AccessNotice message="Course registration is only available to student accounts." />
    );
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!ctx) return null;

  const reg = ctx.registration;
  const editable = reg ? EDITABLE.has(reg.status) : false;
  const registeredOfferingIds = new Set(
    activeLines(reg).map((l) => l.courseOffering.id),
  );
  const available = ctx.courses.items.filter((i) => !registeredOfferingIds.has(i.offeringId));
  const lines = activeLines(reg);
  const unitBounds =
    reg?.minUnits != null && reg?.maxUnits != null
      ? `${reg.minUnits}–${reg.maxUnits} units`
      : null;

  return (
    <>
      <PageHeader
        title="Course registration"
        description={`${ctx.session.name} · ${ctx.semester.name}`}
        actions={
          reg ? (
            <StatusBadge state={reg.status} />
          ) : (
            <span className="text-sm text-slate-500">No registration yet</span>
          )
        }
      />

      {actionError ? (
        <div className="mb-4">
          <Alert kind="error">{actionError}</Alert>
        </div>
      ) : null}

      {/* Eligibility gates */}
      <section className="card mb-6 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Eligibility</h2>
        {!ctx.eligibility.eligible ? (
          <Alert kind="warning" title="You are not eligible to register yet">
            <p>Resolve the items below before submitting your registration.</p>
          </Alert>
        ) : (
          <Alert kind="success">You meet all eligibility requirements.</Alert>
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

      {/* Curriculum context */}
      {ctx.courses.curriculumVersion ? (
        <p className="mb-4 text-sm text-slate-500">
          Curriculum: {ctx.courses.curriculumVersion.name} · Level {ctx.courses.level}
          {ctx.courses.warnings.length ? (
            <span className="ml-2 text-amber-700">({ctx.courses.warnings.join('; ')})</span>
          ) : null}
        </p>
      ) : null}

      {/* No draft yet */}
      {!reg ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-slate-600">
            Start a draft to select courses for {ctx.semester.name}. You can review your choices
            before submitting for approval.
          </p>
          <button
            className="btn-primary mt-4"
            disabled={busy === 'draft'}
            onClick={startDraft}
          >
            {busy === 'draft' ? 'Starting…' : 'Start registration'}
          </button>
          {!ctx.eligibility.eligible ? (
            <p className="mt-3 text-xs text-amber-700">
              You can open a draft to preview courses, but submission requires eligibility.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Submitted / locked states */}
      {reg && !editable ? (
        <section className="card mb-6 p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Your registration</h2>
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
              Your registration has been submitted and is awaiting approval. You cannot change
              courses while it is under review.
            </Alert>
          ) : null}
          {reg.status === 'APPROVED' || reg.status === 'LOCKED' ? (
            <Alert kind="success">
              Your registration is {formatStatus(reg.status).toLowerCase()}.
              {reg.lockedAt
                ? ` Locked on ${new Date(reg.lockedAt).toLocaleDateString()}.`
                : null}
            </Alert>
          ) : null}
          <CourseTable
            lines={lines}
            editable={false}
            busy={busy}
            onDrop={dropCourse}
          />
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

      {/* Editable draft */}
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
                  {reg.rejectReason}. Update your courses and submit again.
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
              <p className="text-sm text-slate-500">All available courses are on your registration.</p>
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
                            ? 'Carryovers cannot be removed without adviser approval'
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
                  {ctx.courses.excluded.length === 1 ? '' : 's'} not on your list
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

      <p className="mt-6 text-center text-sm">
        <Link href="/student" className="text-brand-600 hover:underline">
          ← Back to my dashboard
        </Link>
      </p>
    </>
  );
}

function CourseTable({
  lines,
  editable,
  busy,
  onDrop,
}: {
  lines: RegistrationDetail['lines'];
  editable: boolean;
  busy: string | null;
  onDrop: (lineId: string) => void;
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
                      disabled={isCarryover || busy === line.id}
                      title={
                        isCarryover
                          ? 'Carryovers require adviser approval to remove'
                          : undefined
                      }
                      onClick={() => onDrop(line.id)}
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
