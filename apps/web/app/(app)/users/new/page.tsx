'use client';

/**
 * Create a STAFF account (§6). Staff only — there is deliberately no path here to
 * create a STUDENT login (students obtain a login solely through the activation
 * ceremony against a pre-existing master record). The temporary password must be
 * changed on first login; strength is re-validated server-side. On success the
 * admin is taken to the detail page to assign scoped roles.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS } from '@/lib/permissions';
import type { StaffUser } from '@/lib/types';
import { PageHeader, AccessNotice } from '@/components/page';
import { Alert, Field } from '@/components/ui';

export default function NewStaffPage() {
  const router = useRouter();
  const { me } = useSession();
  const canCreate = can(me?.permissions, PERMISSIONS.USERS_CREATE);

  const [form, setForm] = useState({ fullName: '', email: '', temporaryPassword: '' });
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!canCreate) return <AccessNotice />;

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDetails(null);
    if (form.temporaryPassword.length < 8) {
      setError('The temporary password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.post<StaffUser>('/users', {
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        temporaryPassword: form.temporaryPassword,
      });
      router.push(`/users/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? null);
      } else setError('Failed to create the account.');
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New staff account"
        description="Provision a staff login. The user must change this temporary password on first sign-in."
        actions={
          <Link href="/users" className="btn-secondary">
            Cancel
          </Link>
        }
      />

      <form onSubmit={submit} className="card max-w-xl space-y-5 p-6">
        {error ? (
          <Alert kind="error" title={error}>
            {details && details.length ? (
              <ul className="ml-4 list-disc">
                {details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}

        <Field
          label="Full name"
          value={form.fullName}
          onChange={(e) => set('fullName', e.target.value)}
          required
          minLength={2}
          maxLength={160}
        />
        <Field
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          required
        />
        <Field
          label="Temporary password"
          type="password"
          value={form.temporaryPassword}
          onChange={(e) => set('temporaryPassword', e.target.value)}
          required
          minLength={8}
          maxLength={128}
          hint="Share this out-of-band. The user is forced to change it on first login."
        />

        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create account'}
          </button>
          <Link href="/users" className="btn-secondary">
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
