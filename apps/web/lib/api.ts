/**
 * Typed API client for the ePortal backend.
 *
 * Security posture (matches the API):
 *   • The browser talks to the NestJS API directly with `credentials: 'include'`
 *     so the httpOnly auth cookies ride along. Tokens are NEVER stored in JS —
 *     they are unreadable httpOnly cookies, mitigating XSS token theft.
 *   • On a 401 the client transparently attempts ONE refresh, then retries. This
 *     mirrors the short-lived access token + DB-backed refresh token design.
 *   • This client is a convenience layer for UX only. It is NOT a security
 *     boundary — every protected endpoint is independently authorized server-side.
 */

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';

/** Standard success envelope returned by the API: `{ ok: true, data, meta? }`. */
export interface ApiEnvelope<T> {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
}

/** A normalized error thrown by the client so callers get a consistent shape. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Field-level or list messages from the API validation layer, if any. */
    readonly details?: string[],
    /** Machine-readable code from the API envelope, e.g. PASSWORD_CHANGE_REQUIRED. */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Multipart body (file upload); when set, `body` is ignored. */
  form?: FormData;
  /** Set false to skip the automatic refresh-and-retry (used by refresh itself). */
  retryOnUnauthorized?: boolean;
  signal?: AbortSignal;
}

/** Extract a human message + optional detail list from an API error payload. */
function parseError(status: number, payload: unknown): ApiError {
  // The API's exception filter emits `{ ok:false, error:{ code, message, details? } }`
  // (Nest's default is `{ message, ... }`). Handle both defensively.
  const p = payload as
    | { error?: { code?: unknown; message?: string; details?: unknown }; message?: unknown }
    | undefined;
  const rawMessage = p?.error?.message ?? p?.message;
  const message =
    typeof rawMessage === 'string'
      ? rawMessage
      : Array.isArray(rawMessage)
        ? String(rawMessage[0])
        : `Request failed (${status})`;
  const rawDetails = p?.error?.details ?? (Array.isArray(p?.message) ? p?.message : undefined);
  const details = Array.isArray(rawDetails) ? rawDetails.map(String) : undefined;
  const code = typeof p?.error?.code === 'string' ? p.error.code : undefined;
  return new ApiError(status, message, details, code);
}

/**
 * The API blocks every route while a password change is pending. If that reaches
 * the client mid-session (a stale tab, a direct URL), send the user to the one
 * page that can clear the state rather than showing an "access denied" dead end.
 * A hard navigation, not a router push, because this can fire from anywhere —
 * including outside a React render tree.
 */
function redirectIfPasswordChangeRequired(err: ApiError): void {
  if (err.code !== 'PASSWORD_CHANGE_REQUIRED') return;
  if (typeof window === 'undefined') return;
  if (window.location.pathname === '/change-password') return;
  window.location.assign('/change-password');
}

async function raw<T>(path: string, opts: RequestOptions = {}): Promise<ApiEnvelope<T>> {
  const { method = 'GET', body, form, retryOnUnauthorized = true, signal } = opts;

  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (form) {
    payload = form; // browser sets multipart boundary
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: payload,
    credentials: 'include',
    signal,
  });

  if (res.status === 401 && retryOnUnauthorized && path !== '/auth/refresh') {
    // One silent refresh attempt, then retry the original request once.
    const refreshed = await tryRefresh();
    if (refreshed) return raw<T>(path, { ...opts, retryOnUnauthorized: false });
  }

  let json: unknown = undefined;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }

  if (!res.ok) {
    const err = parseError(res.status, json);
    redirectIfPasswordChangeRequired(err);
    throw err;
  }
  return (json as ApiEnvelope<T>) ?? ({ ok: true, data: undefined as T });
}

/** Attempt a token refresh. Returns true on success. Never throws. */
async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Thin verb helpers returning the unwrapped `data`. */
export const api = {
  async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    return (await raw<T>(path, { method: 'GET', signal })).data;
  },
  async post<T>(path: string, body?: unknown): Promise<T> {
    return (await raw<T>(path, { method: 'POST', body })).data;
  },
  async patch<T>(path: string, body?: unknown): Promise<T> {
    return (await raw<T>(path, { method: 'PATCH', body })).data;
  },
  async del<T>(path: string): Promise<T> {
    return (await raw<T>(path, { method: 'DELETE' })).data;
  },
  async upload<T>(path: string, form: FormData): Promise<T> {
    return (await raw<T>(path, { method: 'POST', form })).data;
  },
  /** Full envelope (for endpoints whose `meta` pagination the caller needs). */
  async getEnvelope<T>(path: string, signal?: AbortSignal): Promise<ApiEnvelope<T>> {
    return raw<T>(path, { method: 'GET', signal });
  },
};
