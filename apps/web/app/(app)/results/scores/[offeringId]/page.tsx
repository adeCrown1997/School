'use client';

/**
 * Staff score entry for one course offering (docs/03 §10.2).
 *
 * The grid mirrors the API's sheet: rows are LOCKED registrations, columns are
 * assessment components. Everything here follows the server's rules — a blank
 * is never a zero (the mark select forces ABSENT/WITHHELD/MEDICAL/MALPRACTICE),
 * saves write DRAFTS (draft ≠ submitted), and an out-of-range score is surfaced
 * as an error, never clamped. Scoresheets can also be uploaded as CSV/XLSX
 * through a preview → apply two-phase flow.
 *
 * Entry requires results.score.manage; defining the components requires
 * results.assess.manage — the two are different hands (INV-11).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type {
  ResultBatchDetail,
  ScoreComponent,
  ScoreGrid,
  ScoreMark,
  ScoreSheetSummary,
} from '@/lib/types';
import { PageHeader, AccessNotice, EmptyState } from '@/components/page';
import { Alert, Spinner, StatusBadge } from '@/components/ui';
import { UploadIcon } from '@/components/icons';

const MARKS: ScoreMark[] = ['SCORED', 'ABSENT', 'WITHHELD', 'MEDICAL', 'MALPRACTICE'];

interface CellDraft {
  /** Raw text as typed; '' means "no score". */
  score: string;
  mark: ScoreMark;
  state: 'DRAFT' | 'SUBMITTED';
  dirty: boolean;
}

function fmtDecimal(v: string | number | null): string {
  if (v === null) return '';
  return String(v);
}

function ck(componentId: string, lineId: string): string {
  return `${componentId}:${lineId}`;
}

/** The batch has moved out of the lecturer's hands — explain, don't pretend. */
function frozenReasonFor(batch: ResultBatchDetail | null): string | null {
  if (!batch) return null;
  if (batch.status === 'SENATE_RATIFIED' || batch.status === 'PUBLISHED') {
    return `This batch is already ${batch.status.toLowerCase().replace(/_/g, ' ')} — scores can only change through a formal amendment.`;
  }
  if (batch.status === 'PENDING_APPROVAL') {
    return 'This batch is awaiting approval — scores are frozen until it is decided (a rejection reopens them).';
  }
  return null;
}

export default function ScoreEntryPage() {
  const params = useParams<{ offeringId: string }>();
  const offeringId = params.offeringId;
  const { me } = useSession();
  const canScore = can(me?.permissions, PERMISSIONS.RESULTS_SCORE_MANAGE);
  const canAssess = can(me?.permissions, PERMISSIONS.RESULTS_ASSESS_MANAGE);
  const canViewBatches = can(me?.permissions, PERMISSIONS.RESULTS_VIEW);

  const [grid, setGrid] = useState<ScoreGrid | null>(null);
  const [batch, setBatch] = useState<ResultBatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [cells, setCells] = useState<Map<string, CellDraft>>(new Map());

  const loadGrid = useCallback(async () => {
    const res = await api.get<ScoreGrid>(`/results/offerings/${offeringId}/scores`);
    const next = new Map<string, CellDraft>();
    for (const row of res.rows) {
      for (const cell of row.cells) {
        next.set(ck(cell.componentId, cell.registrationLineId), {
          score: fmtDecimal(cell.score),
          mark: cell.mark,
          state: cell.state,
          dirty: false,
        });
      }
    }
    setGrid(res);
    setCells(next);
  }, [offeringId]);

  const loadBatch = useCallback(async () => {
    try {
      const res = await api.get<ResultBatchDetail>(`/results/offerings/${offeringId}/batch`);
      setBatch(res);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setBatch(null);
      else throw err;
    }
  }, [offeringId]);

  const refresh = useCallback(async () => {
    setSuccess(null);
    await Promise.all([loadGrid(), loadBatch()]);
  }, [loadGrid, loadBatch]);

  useEffect(() => {
    if (!canScore) return;
    (async () => {
      try {
        await Promise.all([loadGrid(), loadBatch()]);
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof ApiError ? err.message : 'Failed to load the score sheet.');
      } finally {
        setLoading(false);
      }
    })();
  }, [canScore, loadGrid, loadBatch]);

  if (!canScore) return <AccessNotice />;
  if (loading) return <Spinner label="Loading score sheet…" />;
  if (forbidden) return <AccessNotice />;
  if (!grid) return error ? <Alert kind="error">{error}</Alert> : null;

  const frozen = frozenReasonFor(batch);
  const editable = !frozen;
  const dirtyEntries = [...cells.entries()].filter(([, c]) => c.dirty);

  async function saveDrafts() {
    setError(null);
    setSuccess(null);

    const entries: Array<{
      componentId: string;
      registrationLineId: string;
      score: number | null;
      mark: ScoreMark;
    }> = [];
    const problems: string[] = [];
    for (const [key, cell] of dirtyEntries) {
      const [componentId, registrationLineId] = key.split(':');
      if (!componentId || !registrationLineId) continue;
      if (cell.mark === 'SCORED') {
        const n = Number(cell.score);
        if (cell.score.trim() === '' || !Number.isFinite(n)) {
          problems.push(`A SCORED entry needs a numeric score (or choose a different mark)`);
          continue;
        }
        if (n < 0) {
          problems.push('Scores cannot be negative');
          continue;
        }
        entries.push({ componentId, registrationLineId, score: n, mark: 'SCORED' });
      } else {
        entries.push({ componentId, registrationLineId, score: null, mark: cell.mark });
      }
    }
    if (problems.length > 0) {
      setError(problems[0] ?? 'Some cells are invalid.');
      return;
    }

    setSaving(true);
    try {
      await api.post(`/results/offerings/${offeringId}/scores`, { entries });
      setSuccess(`Saved ${entries.length} cell(s) as drafts — the sheet is not submitted yet.`);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save scores.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title={`${grid.offering.course.code} — Score entry`}
        description={`${grid.offering.course.title} · ${grid.offering.session.name} · ${grid.offering.semester.name}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {batch ? <StatusBadge state={batch.status} /> : null}
            <Link href={`/academics/offerings/${offeringId}`} className="btn-secondary">
              Offering
            </Link>
            {canViewBatches && batch ? (
              <Link href={`/results/batches/${batch.id}`} className="btn-secondary">
                Review batch
              </Link>
            ) : null}
          </div>
        }
      />

      {error ? (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}
      {success ? (
        <div className="mb-4">
          <Alert kind="success">{success}</Alert>
        </div>
      ) : null}
      {grid.components.length === 0 ? (
        <div className="mb-4">
          <Alert kind="warning" title="No assessment structure yet">
            Scores cannot be entered until the components are defined (weights must sum to 100).
            {canAssess
              ? ' Add them below.'
              : ' The structure is owned by the department (results.assess.manage).'}
          </Alert>
        </div>
      ) : null}
      {frozen ? (
        <div className="mb-4">
          <Alert kind="warning" title="Editing is locked">
            {frozen}
          </Alert>
        </div>
      ) : null}

      <ComponentEditor
        offeringId={offeringId}
        components={grid.components}
        canAssess={canAssess}
        hasSubmittedEntries={grid.rows.some((r) => r.cells.some((c) => c.state === 'SUBMITTED'))}
        onSaved={async () => {
          setSuccess('Assessment components updated.');
          await loadGrid();
        }}
      />

      {grid.components.length > 0 && grid.rows.length > 0 ? (
        <UploadPanel
          offeringId={offeringId}
          editable={editable}
          components={grid.components}
          courseCode={grid.offering.course.code}
          onApplied={async (summary) => {
            setSuccess(
              `Imported ${summary.imported ?? summary.entriesPlanned} cell(s) as drafts — the sheet is still not submitted.`,
            );
            await refresh();
          }}
        />
      ) : null}

      {grid.rows.length === 0 ? (
        <EmptyState title="No students to score">
          Only students with a LOCKED registration appear here. Once registrations are locked,
          they will show in this sheet.
        </EmptyState>
      ) : (
        <section className="card mt-6 p-0" aria-label="Score grid">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="card-title">Score sheet</h2>
              <p className="card-subtitle">
                {grid.rows.length} student(s) · {grid.components.length} component(s). Drafts save
                instantly; submitting a component is final.
              </p>
            </div>
            <button className="btn-primary" onClick={saveDrafts} disabled={!editable || saving || dirtyEntries.length === 0}>
              {saving ? 'Saving…' : dirtyEntries.length > 0 ? `Save ${dirtyEntries.length} change(s)` : 'No pending changes'}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="sticky left-0 bg-white px-4 py-3 font-medium">Matric no.</th>
                  <th className="px-3 py-3 font-medium">Name</th>
                  {grid.components.map((c) => {
                    const columnSubmitted = grid.rows.every(
                      (r) => r.cells.find((cc) => cc.componentId === c.id)?.state === 'SUBMITTED',
                    );
                    return (
                      <th key={c.id} className="px-3 py-3 font-medium">
                        <div className="min-w-[7.5rem]">
                          <span className="font-semibold text-slate-700">{c.key}</span>
                          <span className="block text-[11px] font-normal text-slate-400">
                            {fmtDecimal(c.weight)}% · out of {fmtDecimal(c.maxScore)}
                          </span>
                          {editable && !columnSubmitted ? (
                            <button
                              type="button"
                              className="mt-1 text-[11px] font-semibold text-brand-700 hover:underline"
                              onClick={() => submitComponent(c, offeringId, refresh, setError)}
                            >
                              Submit {c.key}
                            </button>
                          ) : null}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => {
                  return (
                    <tr key={row.registrationLineId} className="border-b border-slate-100 last:border-0">
                      <td className="whitespace-nowrap px-4 py-2 font-medium tabular-nums text-slate-700">
                        {row.matriculationNumber}
                        {row.lineType !== 'NEW' ? (
                          <span className="ml-1.5 badge bg-slate-100 text-slate-600">{row.lineType}</span>
                        ) : null}
                      </td>
                      <td className="max-w-[14rem] truncate px-3 py-2">
                        {row.fullName}
                        <span className="block text-[11px] text-slate-400">Level {row.level}</span>
                      </td>
                      {grid.components.map((c) => {
                        const key = ck(c.id, row.registrationLineId);
                        const cell = cells.get(key);
                        const submitted = cell?.state === 'SUBMITTED';
                        return (
                          <td key={key} className="px-3 py-2 align-top">
                            <CellInput
                              value={cell?.score ?? ''}
                              mark={cell?.mark ?? 'SCORED'}
                              disabled={!editable || submitted}
                              maxScore={Number(c.maxScore)}
                              submitted={submitted}
                              dirty={cell?.dirty ?? false}
                              onScore={(v) =>
                                setCells((prev) => {
                                  const next = new Map(prev);
                                  next.set(key, { score: v, mark: cell?.mark ?? 'SCORED', state: cell?.state ?? 'DRAFT', dirty: true });
                                  return next;
                                })
                              }
                              onMark={(m) =>
                                setCells((prev) => {
                                  const next = new Map(prev);
                                  next.set(key, { score: '', mark: m, state: cell?.state ?? 'DRAFT', dirty: true });
                                  return next;
                                })
                              }
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <PipelinePanel
        offeringId={offeringId}
        batch={batch}
        studentCount={grid.rows.length}
        hasComponents={grid.components.length > 0}
        onChanged={refresh}
      />
    </>
  );
}

async function submitComponent(
  c: ScoreComponent,
  offeringId: string,
  refresh: () => Promise<void>,
  setError: (msg: string | null) => void,
) {
  if (
    !window.confirm(
      `Submit every entry for ${c.key}? A submitted component is final — corrections afterwards go through a re-approval.`,
    )
  )
    return;
  setError(null);
  try {
    await api.post(`/results/offerings/${offeringId}/scores/submit`, { componentIds: [c.id] });
    await refresh();
  } catch (err) {
    setError(err instanceof ApiError ? err.message : `Failed to submit ${c.key}.`);
  }
}

// --- one editable cell -------------------------------------------------------

function CellInput({
  value,
  mark,
  disabled,
  submitted,
  dirty,
  maxScore,
  onScore,
  onMark,
}: {
  value: string;
  mark: ScoreMark;
  disabled: boolean;
  submitted: boolean;
  dirty: boolean;
  maxScore: number;
  onScore: (v: string) => void;
  onMark: (m: ScoreMark) => void;
}) {
  const outOfRange =
    mark === 'SCORED' && value.trim() !== '' && Number.isFinite(Number(value)) && (Number(value) < 0 || Number(value) > maxScore);

  if (submitted) {
    return (
      <span className="badge bg-slate-100 text-slate-600">
        {mark === 'SCORED' ? (value === '' ? '—' : value) : mark}
      </span>
    );
  }
  if (disabled) {
    return (
      <span className="tabular-nums text-slate-400">
        {mark === 'SCORED' ? (value === '' ? '—' : value) : mark}
      </span>
    );
  }

  return (
    <div className="min-w-[7.5rem]">
      <input
        type="text"
        inputMode={mark === 'SCORED' ? 'decimal' : undefined}
        aria-label={mark === 'SCORED' ? 'Score' : 'Mark'}
        className={`input w-full px-2 py-1 text-sm tabular-nums ${
          outOfRange ? 'border-red-400' : dirty ? 'border-amber-300' : ''
        }`}
        value={mark === 'SCORED' ? value : ''}
        placeholder={mark === 'SCORED' ? '' : '—'}
        onChange={(e) => onScore(e.target.value)}
      />
      {outOfRange ? <p className="mt-0.5 text-[11px] text-red-600">Max {maxScore}</p> : null}
      <select
        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-500"
        value={mark}
        onChange={(e) => onMark(e.target.value as ScoreMark)}
        aria-label="Entry kind"
      >
        {MARKS.map((m) => (
          <option key={m} value={m}>
            {m === 'SCORED' ? 'Scored' : m.charAt(0) + m.slice(1).toLowerCase()}
          </option>
        ))}
      </select>
      {mark !== 'SCORED' ? (
        <p className="mt-0.5 text-[11px] text-slate-400">recorded as {mark}</p>
      ) : null}
    </div>
  );
}

// --- assessment structure (HOD-owned) -----------------------------------------

function ComponentEditor({
  offeringId,
  components,
  canAssess,
  hasSubmittedEntries,
  onSaved,
}: {
  offeringId: string;
  components: ScoreComponent[];
  canAssess: boolean;
  hasSubmittedEntries: boolean;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Array<{ key: string; label: string; weight: string; maxScore: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open && rows.length === 0) {
      setRows(
        components.map((c) => ({
          key: c.key,
          label: c.label,
          weight: fmtDecimal(c.weight),
          maxScore: fmtDecimal(c.maxScore),
        })),
      );
    }
  }, [open, components, rows.length]);

  if (!canAssess) {
    return components.length > 0 ? (
      <section className="card mt-6 p-5">
        <h2 className="card-title">Assessment components</h2>
        <p className="card-subtitle">
          Defined by the department (INV-11); read-only here because your role cannot manage them.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2 text-sm">
          {components.map((c) => (
            <li key={c.id} className="badge bg-slate-100 text-slate-700">
              {c.key} — {fmtDecimal(c.weight)}% (out of {fmtDecimal(c.maxScore)})
            </li>
          ))}
        </ul>
      </section>
    ) : null;
  }

  const total = rows.reduce((sum, r) => sum + (Number(r.weight) || 0), 0);
  const totalOk = Math.abs(total - 100) < 1e-9;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!rows.length) {
      setError('Define at least one component — or cancel to keep the current structure.');
      return;
    }
    for (const r of rows) {
      if (!/^[A-Z][A-Z0-9_]{0,11}$/.test(r.key.trim().toUpperCase())) {
        setError(`"${r.key}" is not a valid component key (uppercase letters, digits, underscore).`);
        return;
      }
      if (r.label.trim().length < 2) {
        setError(`Component ${r.key || '?'} needs a label of at least 2 characters.`);
        return;
      }
    }
    setBusy(true);
    try {
      await api.post(`/results/offerings/${offeringId}/components`, {
        components: rows.map((r) => ({
          key: r.key.trim().toUpperCase(),
          label: r.label.trim(),
          weight: Number(r.weight),
          maxScore: Number(r.maxScore),
        })),
      });
      setOpen(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save the components.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <section className="card mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="card-title">Assessment components</h2>
            <p className="card-subtitle">
              Weights are owned by the department and locked once any score has been submitted.
            </p>
          </div>
          <button
            className="btn-secondary"
            onClick={() => setOpen(true)}
            disabled={components.length > 0 && hasSubmittedEntries}
            title={hasSubmittedEntries ? 'Locked — scores have been submitted against this offering' : undefined}
          >
            {components.length === 0 ? 'Define components' : 'Edit components'}
          </button>
        </div>
        {components.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2 text-sm">
            {components.map((c) => (
              <li key={c.id} className="badge bg-slate-100 text-slate-700">
                {c.key} — {c.label} · {fmtDecimal(c.weight)}% (out of {fmtDecimal(c.maxScore)})
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    );
  }

  return (
    <form onSubmit={save} className="card mt-6 p-5">
      <h2 className="card-title">Define the assessment structure</h2>
      <p className="card-subtitle">
        Replaces the WHOLE set — weights must sum to exactly 100. Changing components deletes any
        draft scores already entered.
      </p>

      {error ? (
        <div className="mb-3 mt-3">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[7rem_1fr_6rem_6rem_auto]">
            <input
              className="input px-2 py-1.5 text-sm uppercase"
              aria-label="Component key"
              placeholder="CA"
              value={r.key}
              onChange={(e) =>
                setRows((prev) => prev.map((row, j) => (j === i ? { ...row, key: e.target.value } : row)))
              }
            />
            <input
              className="input px-2 py-1.5 text-sm"
              aria-label="Component label"
              placeholder="Continuous assessment"
              value={r.label}
              onChange={(e) =>
                setRows((prev) => prev.map((row, j) => (j === i ? { ...row, label: e.target.value } : row)))
              }
            />
            <input
              className="input px-2 py-1.5 text-sm"
              aria-label="Weight percent"
              placeholder="Weight %"
              value={r.weight}
              onChange={(e) =>
                setRows((prev) => prev.map((row, j) => (j === i ? { ...row, weight: e.target.value } : row)))
              }
            />
            <input
              className="input px-2 py-1.5 text-sm"
              aria-label="Maximum raw score"
              placeholder="Max score"
              value={r.maxScore}
              onChange={(e) =>
                setRows((prev) => prev.map((row, j) => (j === i ? { ...row, maxScore: e.target.value } : row)))
              }
            />
            <button
              type="button"
              className="btn-secondary px-2"
              onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
              aria-label="Remove component"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setRows((prev) => [...prev, { key: '', label: '', weight: '', maxScore: '100' }])}
        >
          Add component
        </button>
        <span className={`text-sm font-medium tabular-nums ${totalOk ? 'text-emerald-600' : 'text-red-600'}`}>
          Total weight: {total} / 100
        </span>
        <span className="ml-auto flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Replace structure'}
          </button>
        </span>
      </div>
    </form>
  );
}

// --- CSV/XLSX upload (preview → apply) -----------------------------------------

function UploadPanel({
  offeringId,
  editable,
  components,
  courseCode,
  onApplied,
}: {
  offeringId: string;
  editable: boolean;
  components: ScoreComponent[];
  courseCode: string;
  onApplied: (summary: ScoreSheetSummary) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ScoreSheetSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const componentKeys = components.map((c) => c.key);

  function downloadTemplate() {
    const header = ['MatriculationNumber', ...componentKeys].join(',');
    const line = ['AGE/2024/001', ...componentKeys.map(() => '0')].join(',');
    const blob = new Blob([`${header}\n${line}\n`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${courseCode}-scores-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function runPreview(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPreview(null);
    if (!file) {
      setError('Choose a .csv or .xlsx file first.');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.upload<ScoreSheetSummary>(
        `/results/offerings/${offeringId}/scores/import/preview`,
        fd,
      );
      setPreview(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Preview failed.');
    } finally {
      setBusy(false);
    }
  }

  async function runApply() {
    if (!file || !preview) return;
    if (!window.confirm(`Import ${preview.entriesPlanned} cell(s) as DRAFT entries?`)) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.upload<ScoreSheetSummary>(
        `/results/offerings/${offeringId}/scores/import/apply`,
        fd,
      );
      setPreview(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await onApplied(res);
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        // The 422 carries a per-row summary in details — not renderable as strings;
        // re-preview to show it.
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Import failed.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <section className="card mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="card-title">Upload a score sheet</h2>
            <p className="card-subtitle">
              CSV or XLSX — one column per component ({componentKeys.join(', ') || 'define components first'})
              plus a Matric column. Cells land as DRAFTS after a preview.
            </p>
          </div>
          <button className="btn-secondary gap-1.5" onClick={() => setOpen(true)} disabled={!editable}>
            <UploadIcon size={16} /> Upload sheet
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card mt-6 p-5" aria-label="Upload score sheet">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="card-title">Upload a score sheet</h2>
          <p className="card-subtitle">
            Two phases: validate &amp; preview, then apply. Invalid cells are NEVER imported silently.
          </p>
        </div>
        <button className="btn-secondary" onClick={() => { setOpen(false); setPreview(null); setFile(null); }}>
          Close
        </button>
      </div>

      {error ? (
        <div className="mb-3 mt-3">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      <form onSubmit={runPreview} className="mt-4">
        <label htmlFor="sheet" className="label">
          Sheet file
        </label>
        <input
          ref={fileRef}
          id="sheet"
          type="file"
          accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-md file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-brand-700 hover:file:bg-brand-100"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPreview(null);
          }}
        />
        <p className="mt-2 text-xs text-slate-500">
          Columns: MatriculationNumber plus one column per component —{' '}
          <span className="font-medium">{componentKeys.join(', ') || 'none defined yet'}</span>.
          Cell values are numbers or ABSENT / WITHHELD / MEDICAL / MALPRACTICE. Missing cells are
          left for manual entry.{' '}
          <button type="button" className="text-brand-700 underline" onClick={downloadTemplate}>
            Download a template
          </button>
          .
        </p>
        <div className="mt-3">
          <button type="submit" className="btn-primary" disabled={busy || !file}>
            {busy && !preview ? 'Validating…' : 'Validate & preview'}
          </button>
        </div>
      </form>

      {preview ? (
        <div className="mt-4 space-y-3">
          {preview.ignoredColumns.length > 0 ? (
            <Alert kind="warning" title="Columns ignored (not components of this offering)">
              {preview.ignoredColumns.join(', ')}
            </Alert>
          ) : null}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Rows in file" value={preview.totalRows} />
            <Tile label="Clean rows" value={preview.valid} tone="text-emerald-600" />
            <Tile label="Rows with gaps" value={preview.warnings} tone="text-amber-600" />
            <Tile label="Rows with errors" value={preview.errors} tone="text-red-600" />
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Matric no.</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Cells</th>
                  <th className="px-3 py-2 font-medium">Messages</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.rowNumber} className="border-b border-slate-50 align-top last:border-0">
                    <td className="px-3 py-2 tabular-nums text-slate-500">{r.rowNumber}</td>
                    <td className="px-3 py-2 font-medium text-slate-700">{r.matriculationNumber ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-700">{r.fullName ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{r.cells}</td>
                    <td className="px-3 py-2">
                      {r.errors.length > 0 ? (
                        <ul className="list-disc pl-4 text-red-700">{r.errors.map((m, i) => <li key={i}>{m}</li>)}</ul>
                      ) : r.warnings.length > 0 ? (
                        <ul className="list-disc pl-4 text-amber-700">{r.warnings.map((m, i) => <li key={i}>{m}</li>)}</ul>
                      ) : (
                        <span className="text-emerald-600">ok</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn-primary"
              onClick={runApply}
              disabled={busy || preview.errors > 0 || preview.entriesPlanned === 0}
            >
              {busy ? 'Applying…' : `Apply ${preview.entriesPlanned} draft cell(s)`}
            </button>
            {preview.errors > 0 ? (
              <span className="text-sm text-red-600">Fix the file and re-upload — nothing imports while errors remain.</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Tile({ label, value, tone = 'text-slate-900' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="card p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

// --- pipeline (open / submit batch) ----------------------------------------------

function PipelinePanel({
  offeringId,
  batch,
  studentCount,
  hasComponents,
  onChanged,
}: {
  offeringId: string;
  batch: ResultBatchDetail | null;
  studentCount: number;
  hasComponents: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readyToOpen = studentCount > 0;

  async function open() {
    setError(null);
    setBusy(true);
    try {
      await api.post(`/results/offerings/${offeringId}/batch`);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to open the batch.');
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!window.confirm('Submit this batch for approval? Every student must have every component entered.')) return;
    setError(null);
    setBusy(true);
    try {
      await api.post(`/results/batches/${batch!.id}/submit`);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit the batch.');
    } finally {
      setBusy(false);
    }
  }

  if (!hasComponents) return null;

  return (
    <section className="card mt-6 p-5">
      <h2 className="card-title">Result batch</h2>
      {error ? (
        <div className="mb-3 mt-2">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      {!batch ? (
        <div className="mt-3">
          <p className="text-sm text-slate-600">
            When every component of every student is entered and submitted, open the batch to move
            the course&apos;s results into the approval chain. Opening pins the default grade scale.
          </p>
          <button className="btn-primary mt-3" onClick={open} disabled={busy || !readyToOpen}>
            {busy ? 'Opening…' : 'Open the result batch'}
          </button>
          {!readyToOpen ? (
            <p className="mt-2 text-xs text-slate-400">Needs at least one locked registration.</p>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <StatusBadge state={batch.status} />
            <span>
              {batch.offering.course.code} · {batch.session.name} · {batch.offering.semester.name} ·
              scale {batch.gradeScale.name}
            </span>
          </div>

          {batch.status === 'REJECTED' && batch.rejectReason ? (
            <Alert kind="error" title="Rejected">
              {batch.rejectReason}
            </Alert>
          ) : null}

          {(batch.status === 'DRAFT' || batch.status === 'REJECTED') ? (
            <button className="btn-primary" onClick={submit} disabled={busy}>
              {busy ? 'Submitting…' : 'Submit for approval'}
            </button>
          ) : batch.status === 'PENDING_APPROVAL' ? (
            <p className="text-sm text-slate-500">
              Awaiting the approval chain — the next approver acts on the batch review page.
            </p>
          ) : batch.status === 'SENATE_RATIFIED' ? (
            <p className="text-sm text-slate-500">
              Ratified. Publication is dual-control and happens on the batch review page.
            </p>
          ) : (
            <p className="text-sm text-emerald-600">Published — these results are now official and immutable.</p>
          )}
        </div>
      )}
    </section>
  );
}
