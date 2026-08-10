'use client';

/**
 * STRUCTURE_MANAGE-only create forms, split out of the page for readability. Each
 * form posts to the corresponding /structure endpoint and, on success, calls
 * `onChanged` so the parent re-reads the tree. All validation (code format,
 * hierarchy, date ordering, single-current-session) is re-enforced server-side.
 */
import { useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { UniversityTree } from '@/lib/types';
import { Alert, Field } from '@/components/ui';

type Tab = 'faculty' | 'department' | 'programme' | 'session';

export function ManagePanel({
  universityId,
  tree,
  onChanged,
}: {
  universityId: string | null;
  tree: UniversityTree[];
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>('faculty');

  const faculties = useMemo(() => tree.flatMap((u) => u.faculties), [tree]);

  return (
    <div className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Manage structure</h2>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Structure entity">
        {(['faculty', 'department', 'programme', 'session'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`badge capitalize ${
              tab === t ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
            }`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'faculty' ? (
        <FacultyForm universityId={universityId} onChanged={onChanged} />
      ) : tab === 'department' ? (
        <DepartmentForm faculties={faculties} onChanged={onChanged} />
      ) : tab === 'programme' ? (
        <ProgrammeForm tree={tree} onChanged={onChanged} />
      ) : (
        <SessionForm onChanged={onChanged} />
      )}
    </div>
  );
}

function useSubmit(onChanged: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setOk(false);
    setBusy(true);
    try {
      await fn();
      setOk(true);
      onChanged();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Request failed.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, ok, run };
}

function Feedback({ error, ok }: { error: string | null; ok: boolean }) {
  return (
    <>
      {error ? (
        <div className="mb-3">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}
      {ok ? (
        <div className="mb-3">
          <Alert kind="success">Created.</Alert>
        </div>
      ) : null}
    </>
  );
}

function FacultyForm({
  universityId,
  onChanged,
}: {
  universityId: string | null;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const { busy, error, ok, run } = useSubmit(onChanged);

  if (!universityId) {
    return (
      <Alert kind="warning">
        No university record exists yet. Seed the base university before adding faculties.
      </Alert>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const done = await run(() =>
      api.post('/structure/faculties', {
        universityId,
        name: name.trim(),
        code: code.trim().toUpperCase(),
      }),
    );
    if (done) {
      setName('');
      setCode('');
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <Feedback error={error} ok={ok} />
      </div>
      <Field label="Faculty name" value={name} onChange={(e) => setName(e.target.value)} required />
      <Field
        label="Code"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        required
        hint="2–16 uppercase letters/digits, e.g. SCI"
      />
      <div className="md:col-span-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Add faculty'}
        </button>
      </div>
    </form>
  );
}

function DepartmentForm({
  faculties,
  onChanged,
}: {
  faculties: UniversityTree['faculties'];
  onChanged: () => void;
}) {
  const [facultyId, setFacultyId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const { busy, error, ok, run } = useSubmit(onChanged);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const done = await run(() =>
      api.post('/structure/departments', {
        facultyId,
        name: name.trim(),
        code: code.trim().toUpperCase(),
      }),
    );
    if (done) {
      setName('');
      setCode('');
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <Feedback error={error} ok={ok} />
      </div>
      <div className="md:col-span-2">
        <label htmlFor="dept-faculty" className="label">
          Faculty
        </label>
        <select
          id="dept-faculty"
          className="input"
          value={facultyId}
          onChange={(e) => setFacultyId(e.target.value)}
          required
        >
          <option value="">Select faculty…</option>
          {faculties.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      <Field
        label="Department name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <Field
        label="Code"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        required
        hint="e.g. CSC"
      />
      <div className="md:col-span-2">
        <button type="submit" className="btn-primary" disabled={busy || !facultyId}>
          {busy ? 'Creating…' : 'Add department'}
        </button>
      </div>
    </form>
  );
}

function ProgrammeForm({ tree, onChanged }: { tree: UniversityTree[]; onChanged: () => void }) {
  const [facultyId, setFacultyId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [award, setAward] = useState('');
  const [durationYears, setDurationYears] = useState(4);
  const [studyMode, setStudyMode] = useState<'FULL_TIME' | 'PART_TIME' | 'SANDWICH'>('FULL_TIME');
  const { busy, error, ok, run } = useSubmit(onChanged);

  const faculties = useMemo(() => tree.flatMap((u) => u.faculties), [tree]);
  const departments = useMemo(
    () => faculties.find((f) => f.id === facultyId)?.departments ?? [],
    [faculties, facultyId],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const done = await run(() =>
      api.post('/structure/programmes', {
        departmentId,
        name: name.trim(),
        code: code.trim().toUpperCase(),
        award: award.trim(),
        durationYears: Number(durationYears),
        studyMode,
      }),
    );
    if (done) {
      setName('');
      setCode('');
      setAward('');
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <Feedback error={error} ok={ok} />
      </div>
      <div>
        <label htmlFor="prog-faculty" className="label">
          Faculty
        </label>
        <select
          id="prog-faculty"
          className="input"
          value={facultyId}
          onChange={(e) => {
            setFacultyId(e.target.value);
            setDepartmentId('');
          }}
          required
        >
          <option value="">Select faculty…</option>
          {faculties.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="prog-department" className="label">
          Department
        </label>
        <select
          id="prog-department"
          className="input"
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          disabled={!facultyId}
          required
        >
          <option value="">Select department…</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <Field
        label="Programme name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <Field
        label="Code"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        required
      />
      <Field
        label="Award"
        value={award}
        onChange={(e) => setAward(e.target.value)}
        required
        hint="e.g. B.Sc, B.Eng"
      />
      <Field
        label="Duration (years)"
        type="number"
        min={1}
        max={10}
        value={durationYears}
        onChange={(e) => setDurationYears(Number(e.target.value))}
        required
      />
      <div>
        <label htmlFor="prog-mode" className="label">
          Study mode
        </label>
        <select
          id="prog-mode"
          className="input"
          value={studyMode}
          onChange={(e) =>
            setStudyMode(e.target.value as 'FULL_TIME' | 'PART_TIME' | 'SANDWICH')
          }
        >
          <option value="FULL_TIME">Full time</option>
          <option value="PART_TIME">Part time</option>
          <option value="SANDWICH">Sandwich</option>
        </select>
      </div>
      <div className="md:col-span-2">
        <button type="submit" className="btn-primary" disabled={busy || !departmentId}>
          {busy ? 'Creating…' : 'Add programme'}
        </button>
      </div>
    </form>
  );
}

function SessionForm({ onChanged }: { onChanged: () => void }) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isCurrent, setIsCurrent] = useState(false);
  const { busy, error, ok, run } = useSubmit(onChanged);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const done = await run(() =>
      api.post('/structure/sessions', {
        name: name.trim(),
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        isCurrent,
      }),
    );
    if (done) {
      setName('');
      setStartDate('');
      setEndDate('');
      setIsCurrent(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <Feedback error={error} ok={ok} />
      </div>
      <Field
        label="Session name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        hint="Format 2024/2025"
      />
      <div className="flex items-end gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={isCurrent}
            onChange={(e) => setIsCurrent(e.target.checked)}
          />
          Set as current session
        </label>
      </div>
      <Field
        label="Start date"
        type="date"
        value={startDate}
        onChange={(e) => setStartDate(e.target.value)}
        required
      />
      <Field
        label="End date"
        type="date"
        value={endDate}
        onChange={(e) => setEndDate(e.target.value)}
        required
      />
      <div className="md:col-span-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Add session'}
        </button>
      </div>
    </form>
  );
}
