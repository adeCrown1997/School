'use client';

/**
 * Shared sign-in form for the two segmented entry points (/login/student and
 * /login/staff). Both audiences authenticate through the SAME endpoint —
 * `POST /auth/login` with a single `identifier` — because the API tells students
 * and staff apart by the SHAPE of the identifier, not by which page was used
 * (see apps/api/src/auth/auth.service.ts). So this component owns all the shared
 * mechanics (submit, re-fetch principal, redirect, error handling) and the two
 * pages only supply the copy and input attributes that differ by role.
 *
 * The post-login redirect is keyed to the RETURNED principal's userType, never
 * to the page the person happened to open. A student who lands on the staff page
 * and types their matriculation number still authenticates and is still sent to
 * /student — the segmentation is a wayfinding aid, not an authorization boundary
 * (the API is the only gate).
 *
 * As with the old combined page, the identifier input is deliberately not forced
 * to type="email": a matriculation number is not an email and the browser would
 * reject it before it ever reached the API.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Field } from '@/components/ui';
import type { LoginResult } from '@/lib/types';

export interface SignInFormProps {
  /** Label above the identifier field, e.g. "Matriculation number". */
  identifierLabel: string;
  /** Small helper text under the identifier field. */
  identifierHint?: string;
  identifierPlaceholder?: string;
  identifierType?: 'text' | 'email';
  identifierInputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  identifierAutoCapitalize?: string;
  /** Rendered under the submit button (cross-links, forgot password, etc.). */
  footer?: React.ReactNode;
}

export function SignInForm({
  identifierLabel,
  identifierHint,
  identifierPlaceholder,
  identifierType = 'text',
  identifierInputMode,
  identifierAutoCapitalize,
  footer,
}: SignInFormProps) {
  const router = useRouter();
  const { refresh } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.post<LoginResult>('/auth/login', {
        identifier,
        password,
      });
      const me = await refresh();
      if (result?.mustChangePassword ?? me?.mustChangePassword) {
        router.replace('/change-password');
        return;
      }
      // Route by who they ARE, not which page they used.
      router.replace(me?.userType === 'STUDENT' ? '/student' : '/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-6" noValidate>
      {error ? <Alert kind="error">{error}</Alert> : null}

      <Field
        label={identifierLabel}
        type={identifierType}
        inputMode={identifierInputMode}
        autoComplete="username"
        autoCapitalize={identifierAutoCapitalize}
        placeholder={identifierPlaceholder}
        hint={identifierHint}
        required
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
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

      {footer ? <div className="text-sm">{footer}</div> : null}
    </form>
  );
}
