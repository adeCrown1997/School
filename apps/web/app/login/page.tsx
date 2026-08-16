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
import { ChevronRightIcon, GraduationCapIcon, LandmarkIcon, UsersIcon } from '@/components/icons';

const OPTIONS = [
  {
    href: '/login/student',
    icon: GraduationCapIcon,
    title: 'Student sign-in',
    subtitle: 'Sign in with your matriculation number',
  },
  {
    href: '/login/staff',
    icon: UsersIcon,
    title: 'Staff sign-in',
    subtitle: 'Sign in with your work email address',
  },
] as const;

export default function LoginChooserPage() {
  return (
    <main className="auth-bg grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-md animate-fade-up">
        <div className="mb-8 text-center">
          <span
            aria-hidden
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/25"
          >
            <LandmarkIcon size={26} />
          </span>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            University ePortal
          </h1>
          <p className="mt-1 text-sm text-slate-500">Choose how to sign in</p>
        </div>

        <div className="space-y-3">
          {OPTIONS.map((o) => {
            const Icon = o.icon;
            return (
              <Link
                key={o.href}
                href={o.href}
                className="group card flex items-center gap-4 p-5 transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lift"
              >
                <span
                  aria-hidden
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-600 group-hover:text-white"
                >
                  <Icon size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-slate-900">{o.title}</span>
                  <span className="block text-sm text-slate-500">{o.subtitle}</span>
                </span>
                <ChevronRightIcon
                  size={18}
                  className="shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-500"
                />
              </Link>
            );
          })}
        </div>

        <div className="mt-6 flex items-center justify-between text-sm">
          <Link href="/forgot-password" className="font-medium text-brand-600 hover:underline">
            Forgot password?
          </Link>
          <Link href="/activate" className="font-medium text-brand-600 hover:underline">
            Activate student account
          </Link>
        </div>

        <p className="mt-5 text-center text-xs leading-5 text-slate-400">
          Staff accounts are created by an administrator. Students activate the account issued by
          the university — no self-registration.
        </p>
      </div>
    </main>
  );
}
