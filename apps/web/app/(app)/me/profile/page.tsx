'use client';

/**
 * Student "My profile". Two clearly-separated regions:
 *  1. Official record — PROTECTED identity fields, rendered read-only (🔒). These
 *     are managed by the university; the only way to influence them is a change
 *     request. The API refuses any student write to these regardless of the UI.
 *  2. Contact details (StudentProfile) — Class S, freely student-editable. Saved
 *     via PATCH /me/profile.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import type { OwnProfile, StudentProfileContact } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Field, Labeled, Spinner, StatusBadge } from '@/components/ui';
import { formatDob } from '@/lib/dates';

const CONTACT_FIELDS: { key: keyof StudentProfileContact; label: string; type?: string }[] = [
  { key: 'phone', label: 'Phone' },
  { key: 'personalEmail', label: 'Personal email', type: 'email' },
  { key: 'addressLine', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'country', label: 'Country' },
  { key: 'emergencyContactName', label: 'Emergency contact name' },
  { key: 'emergencyContactPhone', label: 'Emergency contact phone' },
  { key: 'emergencyContactRelation', label: 'Emergency contact relation' },
];

export default function MyProfilePage() {
  const [data, setData] = useState<OwnProfile | null>(null);
  const [contact, setContact] = useState<StudentProfileContact>({});
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<OwnProfile>('/me/profile');
        if (cancelled) return;
        setData(res);
        setContact({ ...(res.profile ?? {}) });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setError(err instanceof ApiError ? err.message : 'Failed to load your profile.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    // Send only non-empty values (all fields optional; server trims + upserts).
    const payload: Record<string, string> = {};
    for (const { key } of CONTACT_FIELDS) {
      const v = (contact[key] ?? '').toString().trim();
      if (v) payload[key] = v;
    }
    try {
      await api.patch('/me/profile', payload);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner label="Loading your profile…" />;
  if (forbidden)
    return <AccessNotice message="This page is only available to a student account." />;
  if (error && !data) return <Alert kind="error">{error}</Alert>;
  if (!data) return null;

  const fullName = [data.surname, data.firstName, data.otherNames].filter(Boolean).join(' ');

  return (
    <>
      <PageHeader
        title="My profile"
        description="Your official record is read-only. You can keep your contact details up to date below."
      />

      <div className="card mb-6 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Official record</h2>
          <StatusBadge state={data.activationState} />
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Labeled label="Full name" protectedField>
            {fullName}
          </Labeled>
          <Labeled label="Matriculation number" protectedField>
            {data.matriculationNumber}
          </Labeled>
          <Labeled label="Student ID" protectedField>
            {data.studentId}
          </Labeled>
          <Labeled label="Date of birth" protectedField>
            {formatDob(data.dateOfBirth ?? null)}
          </Labeled>
          <Labeled label="Gender" protectedField>
            {data.gender}
          </Labeled>
          <Labeled label="JAMB reg. number" protectedField>
            {data.jambRegistrationNumber ?? '—'}
          </Labeled>
          <Labeled label="Faculty" protectedField>
            {data.faculty?.name ?? '—'}
          </Labeled>
          <Labeled label="Department" protectedField>
            {data.department?.name ?? '—'}
          </Labeled>
          <Labeled label="Programme" protectedField>
            {data.programme?.name ?? '—'}
          </Labeled>
          <Labeled label="Level" protectedField>
            {data.currentLevel}
          </Labeled>
          <Labeled label="Admission session" protectedField>
            {data.admissionSession?.name ?? '—'}
          </Labeled>
          <Labeled label="Academic status" protectedField>
            {data.studentStatus?.label ?? '—'}
          </Labeled>
        </div>
        <p className="mt-4 text-xs text-slate-500">
          Spotted a mistake in a personal detail (name, date of birth, gender, JAMB number)?{' '}
          <Link href="/me/change-requests" className="text-brand-700 underline">
            Request a correction
          </Link>
          . Academic placement is changed by the Registry, not by request.
        </p>
      </div>

      <form onSubmit={save} className="card p-5">
        <h2 className="mb-4 text-sm font-semibold text-slate-700">Contact details</h2>
        {error ? (
          <div className="mb-4">
            <Alert kind="error">{error}</Alert>
          </div>
        ) : null}
        {saved ? (
          <div className="mb-4">
            <Alert kind="success">Your contact details were saved.</Alert>
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {CONTACT_FIELDS.map(({ key, label, type }) => (
            <Field
              key={key}
              label={label}
              type={type ?? 'text'}
              value={contact[key] ?? ''}
              onChange={(e) => setContact((c) => ({ ...c, [key]: e.target.value }))}
            />
          ))}
        </div>
        <div className="mt-5">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save contact details'}
          </button>
        </div>
      </form>
    </>
  );
}
