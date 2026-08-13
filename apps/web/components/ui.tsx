'use client';

/**
 * Small, dependency-free UI primitives shared across pages. Kept intentionally
 * minimal — just enough consistency (spacing, focus, colour) without a component
 * framework. All are accessible (labels tied to inputs, aria attributes on
 * status regions, semantic elements).
 */
import { forwardRef } from 'react';

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-2 text-slate-500">
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"
      />
      <span className="text-sm">{label}</span>
    </span>
  );
}

export function Alert({
  kind = 'error',
  title,
  children,
}: {
  kind?: 'error' | 'success' | 'info' | 'warning';
  title?: string;
  children?: React.ReactNode;
}) {
  const styles: Record<string, string> = {
    error: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-green-200 bg-green-50 text-green-800',
    info: 'border-brand-200 bg-brand-50 text-brand-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
  };
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={`rounded-md border px-4 py-3 text-sm ${styles[kind]}`}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? 'mt-1' : ''}>{children}</div> : null}
    </div>
  );
}

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  /** Marks the field as a protected, read-only identity attribute (styling +
   *  aria). The server enforces immutability regardless of this flag. */
  protectedField?: boolean;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, protectedField, id, className, ...rest },
  ref,
) {
  const inputId = id ?? `f-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div>
      <label htmlFor={inputId} className="label">
        {label}
        {protectedField ? (
          <span className="ml-2 badge bg-slate-200 text-slate-600" title="Managed by the university">
            🔒 read-only
          </span>
        ) : null}
      </label>
      <input
        ref={ref}
        id={inputId}
        readOnly={protectedField || rest.readOnly}
        aria-readonly={protectedField || undefined}
        aria-invalid={error ? true : undefined}
        className={`input ${protectedField ? 'protected-field' : ''} ${className ?? ''}`}
        {...rest}
      />
      {hint && !error ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
});

export function Labeled({
  label,
  children,
  protectedField,
}: {
  label: string;
  children: React.ReactNode;
  protectedField?: boolean;
}) {
  return (
    <div>
      <p className="label mb-0.5">
        {label}
        {protectedField ? (
          <span className="ml-2 badge bg-slate-200 text-slate-600">🔒 read-only</span>
        ) : null}
      </p>
      <p className="text-sm text-slate-900">{children}</p>
    </div>
  );
}

export function StatusBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    ACTIVATED: 'bg-green-100 text-green-800',
    PENDING: 'bg-amber-100 text-amber-900',
    PENDING_APPROVAL: 'bg-amber-100 text-amber-900',
    DRAFT: 'bg-slate-100 text-slate-700',
    LOCKED: 'bg-red-100 text-red-800',
    APPROVED: 'bg-green-100 text-green-800',
    REJECTED: 'bg-red-100 text-red-800',
    CANCELLED: 'bg-slate-100 text-slate-600',
    ACTIVE: 'bg-green-100 text-green-800',
    INACTIVE: 'bg-slate-200 text-slate-600',
    PUBLISHED: 'bg-green-100 text-green-800',
    ARCHIVED: 'bg-slate-200 text-slate-600',
    OPEN: 'bg-green-100 text-green-800',
    CLOSED: 'bg-red-100 text-red-800',
  };
  return <span className={`badge ${map[state] ?? 'bg-slate-100 text-slate-700'}`}>{state}</span>;
}
