'use client';

/**
 * Layout for all authenticated pages. Redirects anonymous visitors to /login
 * once the session has loaded. This gate is a UX convenience — it prevents a
 * flash of empty admin chrome — but it is NOT the security boundary: the API
 * authorizes every request independently, so the app never trusts this check to
 * protect data.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { AppShell } from '@/components/app-shell';
import { Spinner } from '@/components/ui';

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const { me, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !me) router.replace('/login');
  }, [me, loading, router]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Loading…" />
      </div>
    );
  }
  if (!me) return null; // redirecting

  return <AppShell>{children}</AppShell>;
}
