'use client';

/**
 * Landing route. Sends authenticated users to their dashboard and anonymous
 * visitors to the sign-in page. This redirect is a convenience only — the
 * destination pages independently reflect what the API authorizes.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { Spinner } from '@/components/ui';

export default function HomePage() {
  const { me, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(me ? '/dashboard' : '/login');
  }, [me, loading, router]);

  return (
    <main className="grid min-h-screen place-items-center">
      <Spinner label="Loading the portal…" />
    </main>
  );
}
