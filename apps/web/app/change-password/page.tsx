'use client';

/**
 * Forced password change — the gate between a student's first sign-in and the
 * dashboard. On activation the account is issued the student's surname as the
 * initial password with `mustChangePassword` set, and the API's global
 * PasswordChangeGuard rejects every other authenticated route until it is
 * rotated. This page is the one place that state can be cleared.
 *
 * It deliberately sits OUTSIDE the (app) route group: the nav shell links to
 * pages the API would 403 right now, so showing it would only offer dead ends.
 * The voluntary equivalent for an unblocked user stays at /account/password.
 *
 * Rules mirror the API (PasswordService.validateStrength) so the student sees
 * them before submitting rather than as a list of server errors — the server
 * re-checks regardless.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Field, Spinner } from '@/components/ui';

export default function ForcedChangePasswordPage() {
  const router = useRouter();
  const { me, loading, clear } = useSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Anonymous visitor → sign in. Already-rotated user → nothing to do here.
  useEffect(() => {
    if (loading || done) return;
    if (!me) router.replace('/login');
    else if (!me.mustChangePassword) {
      router.replace(me.userType === 'STUDENT' ? '/student' : '/dashboard');
    }
  }, [me, loading, done, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDetails([]);
    if (newPassword !== confirm) {
      setError('The new passwords do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('Your new password must be different from your initial password.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      // The API revoked every session and cleared the cookies, so the only way
      // forward is a fresh sign-in with the new — now permanent — password.
      setDone(true);
      clear();
      setTimeout(() => router.replace('/login'), 2000);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? []);
      } else {
        setError('Failed to change your password. Please try again.');
      }
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center">
        <Spinner label="Loading…" />
      </main>
    );
  }

  if (done) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <div className="w-full max-w-md">
          <Alert kind="success" title="Password changed">
            This is now your permanent password. Please sign in again to continue — redirecting you
            to the sign-in page…
          </Alert>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-brand-700">Choose your password</h1>
          <p className="mt-1 text-sm text-slate-500">
            Before you can use the portal, please replace the initial password issued with your
            account.
          </p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6" noValidate>
          <Alert kind="info">
            You signed in with your surname as a temporary password. The password you set now becomes
            your permanent one.
          </Alert>

          {error ? (
            <Alert kind="error">
              <p>{error}</p>
              {details.length ? (
                <ul className="mt-1 list-disc pl-5">
                  {details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              ) : null}
            </Alert>
          ) : null}

          {me?.matriculationNumber ? (
            <Field
              label="Matriculation number"
              value={me.matriculationNumber}
              protectedField
              readOnly
              tabIndex={-1}
            />
          ) : null}

          <Field
            label="Initial password (your surname)"
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
            hint="At least 12 characters, with an uppercase letter, a lowercase letter, a digit and a symbol."
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
            {submitting ? 'Saving…' : 'Set my password'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          Your matriculation number never changes and cannot be edited.
        </p>
      </div>
    </main>
  );
}
