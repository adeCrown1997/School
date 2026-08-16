'use client';

/**
 * STAFF sign-in. Staff authenticate with their work EMAIL and password. The
 * field is type="email" here because staff identifiers really are emails (unlike
 * the student page, where a matriculation number must not be email-validated).
 * The shared <SignInForm> owns submit/redirect; this page supplies the staff copy
 * and the cross-links. There is no self-registration — staff accounts are created
 * by an administrator.
 */
import Link from 'next/link';
import { SignInForm } from '@/components/sign-in-form';

export default function StaffLoginPage() {
  return (
    <main className="auth-bg grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md animate-fade-up">
        <div className="mb-6 text-center">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Staff sign-in
          </h1>
          <p className="mt-1 text-sm text-slate-500">Use your work email address</p>
        </div>

        <SignInForm
          identifierLabel="Work email address"
          identifierType="email"
          identifierInputMode="email"
          identifierPlaceholder="name@university.edu"
          footer={
            <div className="space-y-3">
              <Link href="/forgot-password" className="text-brand-600 hover:underline">
                Forgot password?
              </Link>
              <p className="text-center text-slate-500">
                Student?{' '}
                <Link href="/login/student" className="text-brand-600 hover:underline">
                  Sign in here
                </Link>
              </p>
            </div>
          }
        />

        <p className="mt-4 text-center text-xs text-slate-400">
          Staff accounts are created by an administrator — there is no self-registration.
        </p>
        <p className="mt-2 text-center text-sm">
          <Link href="/login" className="text-slate-500 hover:underline">
            ← All sign-in options
          </Link>
        </p>
      </div>
    </main>
  );
}
