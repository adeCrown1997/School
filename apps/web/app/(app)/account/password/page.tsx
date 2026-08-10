'use client';

/**
 * Change password (self-service, authenticated). Posts to /auth/change-password,
 * which revokes all sessions and clears cookies on success — so we clear the
 * client session and send the user back to /login to re-authenticate. The new
 * password minimum (12) mirrors the API's ChangePasswordDto.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { PageHeader } from '@/components/page';
import { Alert, Field } from '@/components/ui';

export default function ChangePasswordPage() {
  const router = useRouter();
  const { clear } = useSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError('The new passwords do not match.');
      return;
    }
    if (newPassword.length < 12) {
      setError('Your new password must be at least 12 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      // Server revoked sessions + cleared cookies. Drop local session and re-login.
      setDone(true);
      clear();
      setTimeout(() => router.replace('/login'), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change password.');
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md">
        <Alert kind="success" title="Password changed">
          For your security you have been signed out on all devices. Redirecting you to sign in…
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="Change password" description="You will be signed out after changing it." />
      <form onSubmit={submit} className="card space-y-4 p-5">
        {error ? <Alert kind="error">{error}</Alert> : null}
        <Field
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          hint="At least 12 characters."
          required
        />
        <Field
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? 'Changing…' : 'Change password'}
        </button>
      </form>
    </div>
  );
}
