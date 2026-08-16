'use client';

/**
 * Staff academic configuration hub (§ Phase 2).
 * Categories, grade scales and credit-unit policy. View requires
 * academic.config.view; create/edit requires academic.config.manage.
 * Category list uses GET /academics/categories (also gated by courses.view on the API).
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { CourseCategory, CreditPolicy, GradeScale } from '@/lib/types';
import { PageHeader, AccessNotice, EmptyState } from '@/components/page';
import { Alert, Spinner, StatusBadge } from '@/components/ui';

export default function AcademicConfigPage() {
  const { me } = useSession();
  const canView = can(me?.permissions, PERMISSIONS.ACADEMIC_CONFIG_VIEW);
  const canManage = can(me?.permissions, PERMISSIONS.ACADEMIC_CONFIG_MANAGE);
  const canListCategories = can(me?.permissions, PERMISSIONS.COURSES_VIEW);

  const [policy, setPolicy] = useState<CreditPolicy | null>(null);
  const [categories, setCategories] = useState<CourseCategory[]>([]);
  const [scales, setScales] = useState<GradeScale[]>([]);

  const [policyLoading, setPolicyLoading] = useState(true);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [scalesLoading, setScalesLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeInactiveCategories, setIncludeInactiveCategories] = useState(false);
  const [includeInactiveScales, setIncludeInactiveScales] = useState(false);

  useEffect(() => {
    if (!canView) {
      setPolicyLoading(false);
      return;
    }
    setPolicyLoading(true);
    api
      .get<CreditPolicy>('/academics/credit-policy')
      .then(setPolicy)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        setPolicy(null);
      })
      .finally(() => setPolicyLoading(false));
  }, [canView]);

  const loadCategories = useCallback(async () => {
    if (!canView || !canListCategories) {
      setCategoriesLoading(false);
      setCategories([]);
      return;
    }
    setCategoriesLoading(true);
    try {
      const params = new URLSearchParams();
      if (includeInactiveCategories) params.set('includeInactive', 'true');
      const qs = params.toString();
      const data = await api.get<CourseCategory[]>(
        `/academics/categories${qs ? `?${qs}` : ''}`,
      );
      setCategories(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load categories.');
      setCategories([]);
    } finally {
      setCategoriesLoading(false);
    }
  }, [canView, canListCategories, includeInactiveCategories]);

  const loadScales = useCallback(async () => {
    if (!canView) {
      setScalesLoading(false);
      return;
    }
    setScalesLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (includeInactiveScales) params.set('includeInactive', 'true');
      const qs = params.toString();
      const data = await api.get<GradeScale[]>(`/academics/grade-scales${qs ? `?${qs}` : ''}`);
      setScales(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load grade scales.');
      setScales([]);
    } finally {
      setScalesLoading(false);
    }
  }, [canView, includeInactiveScales]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    loadScales();
  }, [loadScales]);

  if (!canView) return <AccessNotice />;
  if (forbidden) return <AccessNotice />;

  return (
    <>
      <PageHeader
        title="Academic configuration"
        description="Course categories, grading scales and per-semester credit-unit limits used by registration."
        actions={
          canManage ? (
            <Link href="/academics/config/scales/new" className="btn-primary">
              New grade scale
            </Link>
          ) : null
        }
      />

      {error ? (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      <CreditPolicyPanel
        policy={policy}
        loading={policyLoading}
        canEdit={canManage}
        onSaved={setPolicy}
      />

      <CategoriesSection
        categories={categories}
        loading={categoriesLoading}
        canManage={canManage}
        canList={canListCategories}
        includeInactive={includeInactiveCategories}
        onIncludeInactiveChange={setIncludeInactiveCategories}
        onChanged={loadCategories}
      />

      <GradeScalesSection
        scales={scales}
        loading={scalesLoading}
        canManage={canManage}
        includeInactive={includeInactiveScales}
        onIncludeInactiveChange={setIncludeInactiveScales}
      />
    </>
  );
}

function CreditPolicyPanel({
  policy,
  loading,
  canEdit,
  onSaved,
}: {
  policy: CreditPolicy | null;
  loading: boolean;
  canEdit: boolean;
  onSaved: (p: CreditPolicy) => void;
}) {
  const [form, setForm] = useState<{ minUnits: number; maxUnits: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (policy) setForm({ minUnits: policy.minUnits, maxUnits: policy.maxUnits });
  }, [policy]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !canEdit) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const saved = await api.post<CreditPolicy>('/academics/credit-policy', {
        minUnits: Number(form.minUnits),
        maxUnits: Number(form.maxUnits),
      });
      onSaved(saved);
      setForm({ minUnits: saved.minUnits, maxUnits: saved.maxUnits });
      setEditing(false);
      setSuccess('Credit policy saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save credit policy.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card mb-6 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Credit policy</h2>
          <p className="text-sm text-slate-500">
            Min/max credit units a student may register per semester (enforced at commit).
            {policy?.isDefault ? ' Using system defaults — not yet configured.' : null}
          </p>
        </div>
        {canEdit && form && !editing ? (
          <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
            Edit policy
          </button>
        ) : null}
      </div>

      {loading ? (
        <Spinner label="Loading credit policy…" />
      ) : !form ? (
        <p className="text-sm text-slate-500">Credit policy could not be loaded.</p>
      ) : editing ? (
        <form onSubmit={save} className="grid max-w-lg gap-4 sm:grid-cols-2">
          {error ? (
            <div className="sm:col-span-2">
              <Alert kind="error">{error}</Alert>
            </div>
          ) : null}
          <div>
            <label htmlFor="minUnits" className="label">
              Minimum units
            </label>
            <input
              id="minUnits"
              type="number"
              className="input"
              min={0}
              max={60}
              value={form.minUnits}
              onChange={(e) => setForm((f) => (f ? { ...f, minUnits: Number(e.target.value) } : f))}
            />
          </div>
          <div>
            <label htmlFor="maxUnits" className="label">
              Maximum units
            </label>
            <input
              id="maxUnits"
              type="number"
              className="input"
              min={1}
              max={60}
              value={form.maxUnits}
              onChange={(e) => setForm((f) => (f ? { ...f, maxUnits: Number(e.target.value) } : f))}
            />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save policy'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={submitting}
              onClick={() => {
                setEditing(false);
                if (policy) setForm({ minUnits: policy.minUnits, maxUnits: policy.maxUnits });
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          {success ? (
            <div className="mb-3">
              <Alert kind="success">{success}</Alert>
            </div>
          ) : null}
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Minimum units</dt>
              <dd className="font-medium text-slate-800">{form.minUnits}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Maximum units</dt>
              <dd className="font-medium text-slate-800">{form.maxUnits}</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}

function CategoriesSection({
  categories,
  loading,
  canManage,
  canList,
  includeInactive,
  onIncludeInactiveChange,
  onChanged,
}: {
  categories: CourseCategory[];
  loading: boolean;
  canManage: boolean;
  canList: boolean;
  includeInactive: boolean;
  onIncludeInactiveChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    key: '',
    label: '',
    description: '',
    sortOrder: '0',
  });
  const [editForm, setEditForm] = useState({
    label: '',
    description: '',
    sortOrder: '0',
    isActive: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function startEdit(c: CourseCategory) {
    setEditingId(c.id);
    setShowCreate(false);
    setEditForm({
      label: c.label,
      description: c.description ?? '',
      sortOrder: String(c.sortOrder ?? 0),
      isActive: c.isActive !== false,
    });
    setError(null);
    setSuccess(null);
  }

  async function createCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await api.post('/academics/categories', {
        key: createForm.key.trim().toUpperCase(),
        label: createForm.label.trim(),
        description: createForm.description.trim() || undefined,
        sortOrder: Number(createForm.sortOrder) || 0,
      });
      setCreateForm({ key: '', label: '', description: '', sortOrder: '0' });
      setShowCreate(false);
      setSuccess('Category created.');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create category.');
    } finally {
      setSubmitting(false);
    }
  }

  async function saveCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !editingId) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await api.patch(`/academics/categories/${editingId}`, {
        label: editForm.label.trim(),
        description: editForm.description.trim() || null,
        sortOrder: Number(editForm.sortOrder) || 0,
        isActive: editForm.isActive,
      });
      setEditingId(null);
      setSuccess('Category updated.');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update category.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Course categories</h2>
          <p className="text-sm text-slate-500">
            Labels such as Core, Elective or GST. The key is fixed after create; the label is
            editable.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canList ? (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => onIncludeInactiveChange(e.target.checked)}
              />
              Include inactive
            </label>
          ) : null}
          {canManage && canList ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setShowCreate((v) => !v);
                setEditingId(null);
                setError(null);
              }}
            >
              {showCreate ? 'Cancel' : 'New category'}
            </button>
          ) : null}
        </div>
      </div>

      {success ? (
        <div className="mb-3">
          <Alert kind="success">{success}</Alert>
        </div>
      ) : null}
      {error ? (
        <div className="mb-3">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      {!canList ? (
        <Alert kind="info">
          Listing categories also requires courses.view. You can still manage grade scales and
          credit policy with your config permissions.
        </Alert>
      ) : showCreate ? (
        <form onSubmit={createCategory} className="card mb-4 grid gap-3 p-4 md:grid-cols-2">
          <div>
            <label htmlFor="cat-key" className="label">
              Key
            </label>
            <input
              id="cat-key"
              className="input"
              placeholder="CORE"
              required
              pattern="[A-Za-z][A-Za-z0-9_]{1,31}"
              value={createForm.key}
              onChange={(e) => setCreateForm((f) => ({ ...f, key: e.target.value }))}
            />
            <p className="mt-1 text-xs text-slate-500">Uppercase letters, digits, underscores.</p>
          </div>
          <div>
            <label htmlFor="cat-label" className="label">
              Label
            </label>
            <input
              id="cat-label"
              className="input"
              required
              minLength={2}
              value={createForm.label}
              onChange={(e) => setCreateForm((f) => ({ ...f, label: e.target.value }))}
            />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="cat-desc" className="label">
              Description
            </label>
            <input
              id="cat-desc"
              className="input"
              value={createForm.description}
              onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="cat-sort" className="label">
              Sort order
            </label>
            <input
              id="cat-sort"
              type="number"
              className="input"
              min={0}
              max={999}
              value={createForm.sortOrder}
              onChange={(e) => setCreateForm((f) => ({ ...f, sortOrder: e.target.value }))}
            />
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create category'}
            </button>
          </div>
        </form>
      ) : null}

      {canList && editingId ? (
        <form onSubmit={saveCategory} className="card mb-4 grid gap-3 p-4 md:grid-cols-2">
          <div>
            <label htmlFor="edit-label" className="label">
              Label
            </label>
            <input
              id="edit-label"
              className="input"
              required
              minLength={2}
              value={editForm.label}
              onChange={(e) => setEditForm((f) => ({ ...f, label: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="edit-sort" className="label">
              Sort order
            </label>
            <input
              id="edit-sort"
              type="number"
              className="input"
              min={0}
              max={999}
              value={editForm.sortOrder}
              onChange={(e) => setEditForm((f) => ({ ...f, sortOrder: e.target.value }))}
            />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="edit-desc" className="label">
              Description
            </label>
            <input
              id="edit-desc"
              className="input"
              value={editForm.description}
              onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={editForm.isActive}
              onChange={(e) => setEditForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            Active
          </label>
          <div className="flex gap-2 md:col-span-2">
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save category'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={submitting}
              onClick={() => setEditingId(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {canList ? (
        loading ? (
          <Spinner label="Loading categories…" />
        ) : categories.length === 0 ? (
          <EmptyState title="No course categories">
            {canManage ? 'Create a category to classify catalogue courses.' : null}
          </EmptyState>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="px-4 py-3 font-medium">Key</th>
                  <th className="px-4 py-3 font-medium">Label</th>
                  <th className="px-4 py-3 font-medium">Courses</th>
                  <th className="px-4 py-3 font-medium">Sort</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                  >
                    <td className="px-4 py-3 font-mono text-slate-800">{c.key}</td>
                    <td className="px-4 py-3 text-slate-800">
                      <div className="font-medium">{c.label}</div>
                      {c.description ? (
                        <div className="text-xs text-slate-500">{c.description}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">
                      {c._count?.courses ?? '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{c.sortOrder ?? 0}</td>
                    <td className="px-4 py-3">
                      <StatusBadge state={c.isActive === false ? 'INACTIVE' : 'ACTIVE'} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canManage ? (
                        <button
                          type="button"
                          className="text-brand-700 hover:underline"
                          onClick={() => startEdit(c)}
                        >
                          Edit
                        </button>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </section>
  );
}

function GradeScalesSection({
  scales,
  loading,
  canManage,
  includeInactive,
  onIncludeInactiveChange,
}: {
  scales: GradeScale[];
  loading: boolean;
  canManage: boolean;
  includeInactive: boolean;
  onIncludeInactiveChange: (v: boolean) => void;
}) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Grade scales</h2>
          <p className="text-sm text-slate-500">
            Letter bands and grade points used when results are computed. Exactly one scale is the
            default.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => onIncludeInactiveChange(e.target.checked)}
          />
          Include inactive
        </label>
      </div>

      {loading ? (
        <Spinner label="Loading grade scales…" />
      ) : scales.length === 0 ? (
        <EmptyState title="No grade scales">
          {canManage ? 'Create a scale with bands covering 0–100%.' : null}
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-4 py-3 font-medium">Key</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Bands</th>
                <th className="px-4 py-3 font-medium">Records</th>
                <th className="px-4 py-3 font-medium">Flags</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {scales.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                >
                  <td className="px-4 py-3 font-mono text-slate-800">{s.key}</td>
                  <td className="px-4 py-3 text-slate-800">{s.name}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{s.bands?.length ?? 0}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">
                    {s._count?.gradeRecords ?? 0}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {s.isDefault ? (
                        <span className="badge bg-brand-100 text-brand-800">Default</span>
                      ) : null}
                      <StatusBadge state={s.isActive ? 'ACTIVE' : 'INACTIVE'} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/academics/config/scales/${s.id}`}
                      className="text-brand-700 hover:underline"
                    >
                      {canManage ? 'Open' : 'View'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
