'use client';

/**
 * Landing page. Authenticated users are sent to their dashboard (a convenience
 * only — the destination pages independently reflect what the API authorizes);
 * anonymous visitors see the animated school gate and choose their sign-in.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { Spinner } from '@/components/ui';
import { SchoolGate } from '@/components/school-gate';

export default function HomePage() {
  const { me, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (me) router.replace('/dashboard');
  }, [me, loading, router]);

  if (loading || me) {
    return (
      <main className="grid min-h-screen place-items-center">
        <Spinner label="Loading the portal…" />
      </main>
    );
  }

  return (
    <main className="auth-bg grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-2xl text-center animate-fade-up">
        <div className="gate-scene">
          <SchoolGate className="mx-auto w-full max-w-xl drop-shadow-sm" />
        </div>

        <h1 className="mt-8 text-3xl font-bold text-brand-700">University ePortal</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
          Registration, results and records — the campus front gate, now online. Walk in with your
          university credentials.
        </p>

        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/login/student" className="btn-primary w-full sm:w-auto">
            Student sign-in
          </Link>
          <Link href="/login/staff" className="btn-secondary w-full sm:w-auto">
            Staff sign-in
          </Link>
        </div>

        <div className="mt-5 flex items-center justify-center gap-4 text-sm">
          <Link href="/activate" className="text-brand-600 hover:underline">
            Activate student account
          </Link>
          <span aria-hidden className="text-slate-300">
            |
          </span>
          <Link href="/forgot-password" className="text-brand-600 hover:underline">
            Forgot password?
          </Link>
        </div>
      </div>
    </main>
  );
}
