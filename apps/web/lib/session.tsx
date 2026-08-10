'use client';

/**
 * Session context. On mount it asks the API `GET /auth/me` (cookies ride along)
 * and exposes the current principal to the tree. `me === null` means "not
 * authenticated"; `loading` covers the initial fetch.
 *
 * This drives UX only — showing the right nav, redirecting an anonymous visitor
 * to the login page. It is NOT an authorization gate: every protected API call
 * is checked server-side, so a user who forces their way to a page simply gets
 * empty data and 403s from the API, never privileged access.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type { Me } from './types';

interface SessionValue {
  me: Me | null;
  loading: boolean;
  /** Re-fetch /auth/me (after login, role change, etc.). */
  refresh: () => Promise<Me | null>;
  /** Optimistically clear the session (after logout). */
  clear: () => void;
}

const SessionContext = createContext<SessionValue | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<Me>('/auth/me');
      setMe(data);
      return data;
    } catch (err) {
      // 401 → simply not signed in. Anything else is also treated as signed-out
      // for rendering; the API stays the real gate.
      if (!(err instanceof ApiError)) {
        // network error — surface nothing, stay signed-out
      }
      setMe(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => setMe(null), []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <SessionContext.Provider value={{ me, loading, refresh, clear }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within <SessionProvider>');
  return ctx;
}
