'use client';

/**
 * Sign-in CHOOSER. Staff and students authenticate through the same endpoint but
 * with different identifiers (email vs. matriculation number), so rather than one
 * combined field that has to explain itself, this page routes each audience to a
 * dedicated form. There is deliberately no "create account" path — staff accounts
 * are provisioned by an administrator and students activate a pre-existing record
 * (linked below).
 *
 * This is wayfinding only: both destinations post to the same API, which remains
 * the sole authority on who is who. A student who picks "Staff" still signs in
 * correctly; the choice just puts the right field and guidance in front of them.
 */
import Link from 'next/link';

const OPTIONS = [
  {
    href: '/login/student',
    icon: '🎓',
    title: 'Student sign-in',
    subtitle: 'Sign in with your matriculation number',
  },
  {
    href: '/login/staff',
    icon: '🏛️',
    title: 'Staff sign-in',
    subtitle: 'Sign in with your work email address',
  },
] as const;

export default function LoginChooserPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-brand-700">University ePortal</h1>
          <p className="mt-1 text-sm text-slate-500">Choose how to sign in</p>
        </div>

        <div className="space-y-3">
          {OPTIONS.map((o) => (
            <Link
              key={o.href}
              href={o.href}
              className="card flex items-center gap-4 p-5 transition hover:border-brand-300 hover:shadow-md"
            >
              <span aria-hidden className="text-2xl">
                {o.icon}
              </span>
              <span className="flex-1">
                <span className="block font-semibold text-slate-900">{o.title}</span>
                <span className="block text-sm text-slate-500">{o.subtitle}</span>
              </span>
              <span aria-hidden className="text-xl text-slate-300">
                ›
              </span>
            </Link>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between text-sm">
          <Link href="/forgot-password" className="text-brand-600 hover:underline">
            Forgot password?
          </Link>
          <Link href="/activate" className="text-brand-600 hover:underline">
            Activate student account
          </Link>
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          Staff accounts are created by an administrator. Students activate the account issued by
          the university — no self-registration.
        </p>
      </div>
    </main>
  );
}
