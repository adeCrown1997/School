'use client';

/**
 * Layout for all authenticated pages. Redirects anonymous visitors to /login
 * once the session has loaded, and anyone still holding the initial password
 * issued at activation to /change-password. Both gates are a UX convenience —
 * they prevent a flash of chrome the user cannot use — but neither is the
 * security boundary: the API authorizes every request independently (and its
 * PasswordChangeGuard rejects this whole group while a change is pending), so
 * the app never trusts these checks to protect data.
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
    if (loading) return;
    if (!me) router.replace('/login');
    else if (me.mustChangePassword) router.replace('/change-password');
  }, [me, loading, router]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Loading…" />
      </div>
    );
  }
  if (!me || me.mustChangePassword) return null; // redirecting

  return <AppShell>{children}</AppShell>;
}
