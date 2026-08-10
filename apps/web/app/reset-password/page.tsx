'use client';

/**
 * Reset-password completion. Reads the opaque token from the URL (?token=…) and
 * posts it with a new password to `POST /auth/reset-password`. Password strength
 * is enforced server-side by PasswordService; we mirror the minimum length hint
 * here for UX but never treat client checks as authoritative.
 */
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Alert, Field } from '@/components/ui';

function ResetForm() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDetails([]);
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: password });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? []);
      } else {
        setError('Unable to reset the password. Please request a new link.');
      }
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <Alert kind="error" title="Invalid link">
        This reset link is missing its token. Please request a new one.
      </Alert>
    );
  }

  if (done) {
    return (
      <div className="space-y-4">
        <Alert kind="success" title="Password updated">
          Your password has been reset. You can now sign in with your new password.
        </Alert>
        <Link href="/login" className="btn-primary w-full">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
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
      <Field
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 12 characters, mixing upper/lower case, a number and a symbol."
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Field
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      <button type="submit" className="btn-primary w-full" disabled={submitting}>
        {submitting ? 'Updating…' : 'Update password'}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md">
        <h1 className="mb-6 text-center text-2xl font-bold text-brand-700">Choose a new password</h1>
        <div className="card p-6">
          <Suspense fallback={null}>
            <ResetForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
