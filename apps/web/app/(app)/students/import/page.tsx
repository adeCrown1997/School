'use client';

/**
 * Bulk student import. Two-phase, matching the API:
 *   1) POST /students/import/preview (multipart) → validate only, per-row report.
 *   2) POST /students/import/commit  (multipart + previewToken) → atomic insert.
 * The same file is re-uploaded on commit (stateless server). Invalid rows are
 * NEVER silently dropped — every row's errors/warnings are shown, and commit is
 * blocked while any row is in error. Soft-duplicate warnings can be accepted
 * explicitly. All authorization + validation is re-done server-side.
 */
import { useRef, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { ImportSummary } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Spinner } from '@/components/ui';

export default function ImportStudentsPage() {
  const { me } = useSession();
  const canImport = can(me?.permissions, PERMISSIONS.STUDENTS_IMPORT);

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [committed, setCommitted] = useState<ImportSummary | null>(null);
  const [acceptWarnings, setAcceptWarnings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canImport) return <AccessNotice />;

  async function runPreview(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPreview(null);
    setCommitted(null);
    if (!file) {
      setError('Choose a .csv or .xlsx file first.');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.upload<ImportSummary>('/students/import/preview', fd);
      setPreview(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Preview failed.');
    } finally {
      setBusy(false);
    }
  }

  async function runCommit() {
    if (!file || !preview) return;
    if (!window.confirm(`Import ${preview.valid + (acceptWarnings ? preview.warnings : 0)} student record(s)?`))
      return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('previewToken', preview.previewToken);
      if (acceptWarnings) fd.append('acceptWarnings', 'true');
      const res = await api.upload<ImportSummary>('/students/import/commit', fd);
      setCommitted(res);
      setPreview(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  const hasErrors = (preview?.errors ?? 0) > 0;
  const canCommit = preview && preview.valid > 0 && (!hasErrors) && (preview.warnings === 0 || acceptWarnings);

  return (
    <>
      <PageHeader
        title="Bulk import students"
        description="Upload a CSV or XLSX file, review the validation report, then confirm the import."
        actions={
          <Link href="/students" className="btn-secondary">
            Back to students
          </Link>
        }
      />

      {error ? (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      {committed ? (
        <Alert kind="success" title="Import complete">
          Imported {committed.imported ?? committed.valid} record(s) from {committed.totalRows} row(s).{' '}
          <Link href="/students" className="underline">
            View students
          </Link>
        </Alert>
      ) : null}

      {!committed ? (
        <form onSubmit={runPreview} className="card mb-6 p-5">
          <label htmlFor="file" className="label">
            Import file
          </label>
          <input
            ref={fileRef}
            id="file"
            type="file"
            accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-md file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-brand-700 hover:file:bg-brand-100"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
            }}
          />
          <p className="mt-2 text-xs text-slate-500">
            Columns: matriculationNumber, surname, firstName, otherNames, dateOfBirth (YYYY-MM-DD),
            gender, facultyCode, departmentCode, programmeCode, admissionSession, entryMode,
            currentLevel. Max 5 MB.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Not sure of the format? Download a starter template:{' '}
            <a href="/templates/student-import-template.csv" className="text-brand-700 underline" download>
              CSV
            </a>{' '}
            or{' '}
            <a href="/templates/student-import-template.xlsx" className="text-brand-700 underline" download>
              XLSX
            </a>
            .
          </p>
          <div className="mt-4">
            <button type="submit" className="btn-primary" disabled={busy || !file}>
              {busy ? 'Validating…' : 'Validate & preview'}
            </button>
          </div>
        </form>
      ) : null}

      {busy && !preview ? <Spinner label="Working…" /> : null}

      {preview ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <SummaryTile label="Total rows" value={preview.totalRows} />
            <SummaryTile label="Valid" value={preview.valid} tone="green" />
            <SummaryTile label="Warnings" value={preview.warnings} tone="amber" />
            <SummaryTile label="Errors" value={preview.errors} tone="red" />
          </div>

          {preview.unknownHeaders?.length ? (
            <Alert kind="warning" title="Unrecognized columns (ignored)">
              {preview.unknownHeaders.join(', ')}
            </Alert>
          ) : null}

          {hasErrors ? (
            <Alert kind="error" title="Fix the errors below, then re-upload">
              Rows in error are not imported. The import is all-or-nothing while any error remains.
            </Alert>
          ) : null}

          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="px-4 py-3 font-medium">Row</th>
                  <th className="px-4 py-3 font-medium">Matric no.</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Messages</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.rowNumber} className="border-b border-slate-100 align-top last:border-0">
                    <td className="px-4 py-3 tabular-nums text-slate-600">{r.rowNumber}</td>
                    <td className="px-4 py-3 text-slate-700">{r.matriculationNumber ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-700">{r.fullName ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`badge ${
                          r.status === 'error'
                            ? 'bg-red-100 text-red-800'
                            : r.status === 'warning'
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-green-100 text-green-800'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {r.errors.length ? (
                        <ul className="list-disc pl-4 text-red-700">
                          {r.errors.map((m, i) => (
                            <li key={i}>{m}</li>
                          ))}
                        </ul>
                      ) : null}
                      {r.warnings.length ? (
                        <ul className="list-disc pl-4 text-amber-700">
                          {r.warnings.map((m, i) => (
                            <li key={i}>{m}</li>
                          ))}
                        </ul>
                      ) : null}
                      {!r.errors.length && !r.warnings.length ? (
                        <span className="text-slate-400">OK</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
            {preview.warnings > 0 && !hasErrors ? (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={acceptWarnings}
                  onChange={(e) => setAcceptWarnings(e.target.checked)}
                />
                Import rows flagged as possible duplicates (warnings)
              </label>
            ) : (
              <span className="text-sm text-slate-500">
                {canCommit ? `${preview.valid} row(s) ready to import.` : 'Nothing to import yet.'}
              </span>
            )}
            <div className="flex gap-2">
              <button
                className="btn-secondary"
                onClick={() => {
                  setPreview(null);
                  setFile(null);
                  if (fileRef.current) fileRef.current.value = '';
                }}
              >
                Discard
              </button>
              <button className="btn-primary" onClick={runCommit} disabled={busy || !canCommit}>
                {busy ? 'Importing…' : 'Confirm import'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'green' | 'amber' | 'red';
}) {
  const color =
    tone === 'green'
      ? 'text-green-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : tone === 'red'
          ? 'text-red-700'
          : 'text-slate-900';
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
