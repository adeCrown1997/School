'use client';

/**
 * STUDENT sign-in. Students authenticate with their MATRICULATION NUMBER
 * (AGE/2021/001) and the password they set after activation — initially their
 * surname, issued with the admission letter. The identifier field is plain text,
 * not type="email", so a matric is never rejected by the browser before it
 * reaches the API. The shared <SignInForm> owns submit/redirect; this page only
 * supplies the student-facing copy and the cross-links.
 */
import Link from 'next/link';
import { SignInForm } from '@/components/sign-in-form';

export default function StudentLoginPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-brand-700">Student sign-in</h1>
          <p className="mt-1 text-sm text-slate-500">Use your matriculation number</p>
        </div>

        <SignInForm
          identifierLabel="Matriculation number"
          identifierPlaceholder="AGE/2021/001"
          identifierAutoCapitalize="characters"
          identifierHint="The initial password issued with your admission letter is your surname."
          footer={
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Link href="/forgot-password" className="text-brand-600 hover:underline">
                  Forgot password?
                </Link>
                <Link href="/activate" className="text-brand-600 hover:underline">
                  Activate student account
                </Link>
              </div>
              <p className="text-center text-slate-500">
                Staff member?{' '}
                <Link href="/login/staff" className="text-brand-600 hover:underline">
                  Sign in here
                </Link>
              </p>
            </div>
          }
        />

        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="text-slate-500 hover:underline">
            ← All sign-in options
          </Link>
        </p>
      </div>
    </main>
  );
}
