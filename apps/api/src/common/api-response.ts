/**
 * Canonical API response envelope. Every endpoint returns this shape so the
 * frontend has one contract. Success and error are mutually exclusive.
 *
 *   success: { ok: true,  data, meta? }
 *   error:   { ok: false, error: { code, message, details? } }
 */
export interface ApiMeta {
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  [k: string]: unknown;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: ApiMeta;
}

export interface ApiErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
    // Field-level validation errors etc. Never contains secrets or stack traces.
    details?: unknown;
    requestId?: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorBody;

export function ok<T>(data: T, meta?: ApiMeta): ApiSuccess<T> {
  return meta ? { ok: true, data, meta } : { ok: true, data };
}
