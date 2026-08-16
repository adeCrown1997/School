'use client';

/**
 * Forgot-password request. Posts an email to `POST /auth/forgot-password`, which
 * ALWAYS returns the same generic acknowledgement — the API never reveals
 * whether an account exists (anti-enumeration), so this page shows one neutral
 * confirmation regardless.
 */
import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Alert, Field } from '@/components/ui';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    // Even on error we show the same neutral message (never leak existence).
    try {
      await api.post('/auth/forgot-password', { email });
    } catch {
      /* swallow — response is intentionally uniform */
    }
    setDone(true);
    setSubmitting(false);
  }

  return (
    <main className="auth-bg grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md animate-fade-up">
        <h1 className="mb-6 text-center font-display text-2xl font-bold tracking-tight text-slate-900">
          Reset your password
        </h1>

        {done ? (
          <div className="card space-y-4 p-6">
            <Alert kind="info" title="Check your email">
              If an account exists for that address, a password reset link has been sent. The link
              expires shortly for your security.
            </Alert>
            <Link href="/login" className="btn-secondary w-full">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="card space-y-4 p-6" noValidate>
            <p className="text-sm text-slate-600">
              Enter the email associated with your account and we&apos;ll send a reset link.
            </p>
            <Field
              label="Email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
            <Link href="/login" className="block text-center text-sm text-brand-600 hover:underline">
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </main>
  );
}
