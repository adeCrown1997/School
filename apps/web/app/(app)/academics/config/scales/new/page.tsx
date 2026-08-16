'use client';

/**
 * Create a grade scale with bands in one step. Requires academic.config.manage.
 * A scale with no bands cannot grade anything, so bands are required at create.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Field } from '@/components/ui';
import {
  FIVE_POINT_TEMPLATE,
  GradeBandsEditor,
  parseBandsPayload,
  type BandDraft,
} from '@/components/academics/grade-bands-editor';

export default function NewGradeScalePage() {
  const router = useRouter();
  const { me } = useSession();
  const canManage = can(me?.permissions, PERMISSIONS.ACADEMIC_CONFIG_MANAGE);

  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [bands, setBands] = useState<BandDraft[]>(FIVE_POINT_TEMPLATE.map((b) => ({ ...b })));

  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setError(null);
    setDetails(null);
    setSubmitting(true);
    try {
      const created = await api.post<{ id: string }>('/academics/grade-scales', {
        key: key.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim() || undefined,
        bands: parseBandsPayload(bands),
      });
      router.push(`/academics/config/scales/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? null);
      } else setError('Failed to create the grade scale.');
      setSubmitting(false);
    }
  }

  if (!canManage) return <AccessNotice />;

  return (
    <>
      <PageHeader
        title="New grade scale"
        description="Define letter grades, score ranges and grade points. The first scale on a fresh install becomes the default."
        actions={
          <Link href="/academics/config" className="btn-secondary">
            Back to config
          </Link>
        }
      />

      <form onSubmit={submit} className="card space-y-5 p-5">
        {error ? (
          <Alert kind="error" title={error}>
            {details?.length ? (
              <ul className="mt-1 list-disc pl-5">
                {details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Key"
            required
            pattern="[A-Za-z][A-Za-z0-9_]{1,31}"
            placeholder="NUC_5PT"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            hint="Uppercase letters, digits, underscores. Not editable later."
          />
          <Field
            label="Name"
            required
            minLength={2}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="md:col-span-2">
            <label htmlFor="scale-desc" className="label">
              Description
            </label>
            <input
              id="scale-desc"
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Bands</h2>
          <GradeBandsEditor bands={bands} onChange={setBands} disabled={submitting} />
        </div>

        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create scale'}
          </button>
          <Link href="/academics/config" className="btn-secondary">
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
