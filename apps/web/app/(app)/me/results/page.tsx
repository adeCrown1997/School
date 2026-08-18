'use client';

/**
 * Student "My results" self-service (GET /me/results — ownership-gated; the
 * student sees ONLY their own PUBLISHED grades). The API returns the whole
 * screen in one call: grade rows per semester, the derived GPA/CGPA table, and
 * any ACTIVE withholdings WITH their reasons (§10.7: the student is told,
 * never left staring at a silent gap).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import type { OwnResults } from '@/lib/types';
import { PageHeader, AccessNotice, EmptyState } from '@/components/page';
import { Alert, PanelLoader } from '@/components/ui';
import { FileTextIcon, GraduationCapIcon, ShieldCheckIcon } from '@/components/icons';

const MARK_LABEL: Record<string, string> = {
  SCORED: '', // a normal grade renders its letter
  ABSENT: 'Absent',
  WITHHELD: 'Withheld',
  MEDICAL: 'Medical',
  MALPRACTICE: 'Malpractice',
};

function fmt(d: string | number | null, digits = 2): string {
  if (d === null) return '—';
  const n = Number(d);
  return Number.isInteger(n) && digits === 0 ? String(n) : n.toFixed(digits);
}

export default function MyResultsPage() {
  const [data, setData] = useState<OwnResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<OwnResults>('/me/results');
        if (!cancelled) setData(res);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof ApiError ? err.message : 'Failed to load your results.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <PanelLoader label="Loading your results…" />;
  if (forbidden)
    return <AccessNotice message="This page is only available to an activated student account." />;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return null;

  const latestGpa = data.gpas[data.gpas.length - 1] ?? null;

  // Group grades by session+semester, preserving the API's chronological order.
  const terms: Array<{ key: string; label: string; rows: OwnResults['grades'] }> = [];
  for (const g of data.grades) {
    const key = `${g.sessionId}:${g.semester}`;
    const term = terms.find((t) => t.key === key);
    if (term) term.rows.push(g);
    else terms.push({ key, label: `${g.session} · ${g.semester}`, rows: [g] });
  }

  return (
    <>
      <PageHeader
        title="My results"
        description="Your published grades and the standing they produce — computed by the university, never editable."
      />

      {data.withholdings.length > 0 ? (
        <div className="mb-6">
          <Alert kind="warning" title="Some of your results are withheld">
            The university has placed a withholding on your results. The reason is shown below;
            a withheld grade is hidden while the withholding is active.{' '}
            {data.withheldCourseCodes.length > 0
              ? `Affected course(s): ${data.withheldCourseCodes.join(', ')}.`
              : ''}
          </Alert>
        </div>
      ) : null}

      {/* Standing summary */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Latest GPA</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
            {latestGpa ? fmt(latestGpa.gpa) : '—'}
          </p>
          {latestGpa ? (
            <p className="mt-1 text-xs text-slate-500">
              {latestGpa.session} · {latestGpa.semester}
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">No published results yet</p>
          )}
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">CGPA</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
            {latestGpa ? fmt(latestGpa.cgpa) : '—'}
          </p>
          {latestGpa ? (
            <p className="mt-1 text-xs text-slate-500">{latestGpa.cumulativeUnits} units over all levels</p>
          ) : null}
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Courses graded</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{data.grades.length}</p>
          <p className="mt-1 text-xs text-slate-500">Published across {terms.length} term(s)</p>
        </div>
      </div>

      {terms.length === 0 ? (
        <EmptyState title="No published results yet">
          Results appear here once the course&apos;s result batch is approved and published by the
          university.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {terms.map((term) => (
            <section key={term.key} className="card p-0" aria-label={term.label}>
              <h2 className="border-b border-slate-100 px-5 py-4 text-sm font-semibold text-slate-700">
                {term.label}
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                      <th className="px-5 py-2.5 font-medium">Code</th>
                      <th className="px-3 py-2.5 font-medium">Title</th>
                      <th className="px-3 py-2.5 font-medium">Units</th>
                      <th className="px-3 py-2.5 font-medium">Score</th>
                      <th className="px-3 py-2.5 font-medium">Grade</th>
                      <th className="px-3 py-2.5 font-medium">Points</th>
                      <th className="px-3 py-2.5 font-medium">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {term.rows.map((g) => {
                      const label = MARK_LABEL[g.mark] ?? '';
                      const pass = g.gradePoint !== null && Number(g.gradePoint) > 0;
                      return (
                        <tr key={g.id} className="border-b border-slate-50 last:border-0">
                          <td className="whitespace-nowrap px-5 py-2.5 font-medium text-slate-800">
                            {g.code}
                            {g.isCarryover ? (
                              <span className="ml-1.5 badge bg-slate-100 text-slate-600">carryover</span>
                            ) : null}
                          </td>
                          <td className="max-w-[16rem] truncate px-3 py-2.5 text-slate-600">{g.title}</td>
                          <td className="px-3 py-2.5 tabular-nums text-slate-600">{g.creditUnits}</td>
                          <td className="px-3 py-2.5 tabular-nums text-slate-600">
                            {g.totalScore !== null ? Number(g.totalScore).toFixed(2) : '—'}
                          </td>
                          <td className="px-3 py-2.5">
                            {g.grade ? (
                              <span className={`badge ${pass ? 'bg-emerald-50 text-emerald-700' : 'bg-red-100 text-red-800'}`}>
                                {g.grade}
                              </span>
                            ) : (
                              <span className="badge bg-slate-100 text-slate-600">{label}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-slate-600">
                            {g.gradePoint !== null ? Number(g.gradePoint).toFixed(2) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-500">{label}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* GPA table */}
      {data.gpas.length > 0 ? (
        <section className="card mt-6 p-0" aria-label="GPA history">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
            <span
              aria-hidden
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600"
            >
              <GraduationCapIcon size={18} />
            </span>
            <div>
              <h2 className="card-title">Academic standing</h2>
              <p className="card-subtitle">Semester GPAs and the running CGPA — derived on every publication.</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="px-5 py-2.5 font-medium">Session</th>
                  <th className="px-3 py-2.5 font-medium">Semester</th>
                  <th className="px-3 py-2.5 font-medium">Level</th>
                  <th className="px-3 py-2.5 font-medium">Units registered</th>
                  <th className="px-3 py-2.5 font-medium">Units passed</th>
                  <th className="px-3 py-2.5 font-medium">GPA</th>
                  <th className="px-3 py-2.5 font-medium">CGPA</th>
                </tr>
              </thead>
              <tbody>
                {data.gpas.map((g) => (
                  <tr key={g.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-2.5 text-slate-700">{g.session}</td>
                    <td className="px-3 py-2.5 text-slate-600">{g.semester}</td>
                    <td className="px-3 py-2.5 tabular-nums">{g.level}</td>
                    <td className="px-3 py-2.5 tabular-nums">{g.unitsRegistered}</td>
                    <td className="px-3 py-2.5 tabular-nums">{g.unitsPassed}</td>
                    <td className="px-3 py-2.5 font-semibold tabular-nums">{fmt(g.gpa)}</td>
                    <td className="px-3 py-2.5 font-semibold tabular-nums">{fmt(g.cgpa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Withholdings detail */}
      {data.withholdings.length > 0 ? (
        <section className="card mt-6 p-5" aria-label="Withholdings">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600"
            >
              <ShieldCheckIcon size={18} />
            </span>
            <div>
              <h2 className="card-title">Active withholdings</h2>
              <p className="card-subtitle">Contact the registry if you believe a withholding is in error.</p>
            </div>
          </div>
          <ul className="mt-4 space-y-2">
            {data.withholdings.map((w) => (
              <li key={w.id} className="rounded-lg border border-amber-100 bg-amber-50/40 px-3 py-2.5 text-sm">
                <p className="font-medium text-slate-800">
                  {w.course ? `Course ${w.course}` : w.session ? `${w.session} (whole session)` : 'All results'}
                </p>
                <p className="mt-0.5 text-slate-600">{w.reason}</p>
                <p className="mt-0.5 text-xs text-slate-400">Placed {new Date(w.placedAt).toLocaleDateString()}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-6 flex items-center gap-2 text-xs text-slate-400">
        <FileTextIcon size={14} aria-hidden /> Grades are final once published; a correction is a new
        approved version, never an edit.{' '}
        <Link href="/student" className="text-brand-700 underline">
          Back to dashboard
        </Link>
      </p>
    </>
  );
}
