'use client';

/**
 * Sign-in page. Posts credentials to `POST /auth/login`; on success the API sets
 * httpOnly cookies and we re-fetch the principal, then route by user type. There
 * is deliberately no "create account" link — staff accounts are provisioned by
 * an administrator and students use the separate activation flow (linked below).
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Field } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/auth/login', { email, password });
      const me = await refresh();
      router.replace(me?.userType === 'STUDENT' ? '/student' : '/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-brand-700">University ePortal</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your account</p>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-6" noValidate>
          {error ? <Alert kind="error">{error}</Alert> : null}

          <Field
            label="Email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="flex items-center justify-between text-sm">
            <Link href="/forgot-password" className="text-brand-600 hover:underline">
              Forgot password?
            </Link>
            <Link href="/activate" className="text-brand-600 hover:underline">
              Activate student account
            </Link>
          </div>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          Staff accounts are created by an administrator. Students activate the account issued by the
          university — no self-registration.
        </p>
      </div>
    </main>
  );
}
