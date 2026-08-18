'use client';

/**
 * Small, dependency-free UI primitives shared across pages. Kept intentionally
 * minimal — just enough consistency (spacing, focus, colour) without a component
 * framework. All are accessible (labels tied to inputs, aria attributes on
 * status regions, semantic elements).
 */
import { forwardRef } from 'react';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  InfoIcon,
  LockIcon,
  XCircleIcon,
} from './icons';

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-2.5 text-slate-500"
    >
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"
      />
      <span className="text-sm font-medium">{label}</span>
    </span>
  );
}

/** Full-panel loading state: keeps the page shape (header space, card) so the
 *  layout does not jump when data lands. */
export function PanelLoader({ label = 'Loading…', rows = 5 }: { label?: string; rows?: number }) {
  return (
    <div className="card p-6" role="status" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600"
        />
        <span className="text-sm font-medium text-slate-500">{label}</span>
      </div>
      <div className="mt-6 space-y-3" aria-hidden>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skeleton h-4" style={{ width: `${100 - i * 9}%` }} />
        ))}
      </div>
    </div>
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
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    info: 'border-brand-200 bg-brand-50 text-brand-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
  };
  const iconStyles: Record<string, string> = {
    error: 'text-red-500',
    success: 'text-emerald-500',
    info: 'text-brand-500',
    warning: 'text-amber-500',
  };
  const icons: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
    error: XCircleIcon,
    success: CheckCircleIcon,
    info: InfoIcon,
    warning: AlertTriangleIcon,
  };
  const Icon = icons[kind] ?? InfoIcon;
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={`animate-fade-in flex gap-3 rounded-xl border px-4 py-3.5 text-sm shadow-sm ${styles[kind]}`}
    >
      <Icon size={18} className={`mt-0.5 shrink-0 ${iconStyles[kind]}`} />
      <div className="min-w-0">
        {title ? <p className="font-semibold leading-5">{title}</p> : null}
        {children ? <div className={`${title ? 'mt-1' : ''} leading-6`}>{children}</div> : null}
      </div>
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
          <span className="ml-2 badge bg-slate-100 text-slate-500" title="Managed by the university">
            <LockIcon size={11} /> read-only
          </span>
        ) : null}
      </label>
      <input
        ref={ref}
        id={inputId}
        readOnly={protectedField || rest.readOnly}
        aria-readonly={protectedField || undefined}
        aria-invalid={error ? true : undefined}
        className={`input ${protectedField ? 'protected-field' : ''} ${
          error && !protectedField ? 'border-red-400 focus:border-red-500 focus:ring-red-500/25' : ''
        } ${className ?? ''}`}
        {...rest}
      />
      {hint && !error ? <p className="mt-1.5 text-xs leading-5 text-slate-500">{hint}</p> : null}
      {error ? (
        <p className="mt-1.5 text-xs font-medium leading-5 text-red-600" role="alert">
          {error}
        </p>
      ) : null}
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
    <div className="min-w-0">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
        {label}
        {protectedField ? (
          <span className="ml-1.5 inline-flex -translate-y-px items-center" title="Managed by the university">
            <LockIcon size={11} className="text-slate-300" />
          </span>
        ) : null}
      </p>
      <p className="truncate text-sm font-medium text-slate-900">{children}</p>
    </div>
  );
}

/** One visual language for every status chip: coloured dot + label. The colour
 *  families encode meaning (green = live/success, amber = waiting, red =
 *  blocked/negative, slate = neutral), consistent with the alert tones. */
export function StatusBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    ACTIVATED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    PENDING: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    PENDING_APPROVAL: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    DRAFT: 'bg-slate-100 text-slate-600 ring-slate-500/20',
    LOCKED: 'bg-red-50 text-red-700 ring-red-600/20',
    APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    REJECTED: 'bg-red-50 text-red-700 ring-red-600/20',
    CANCELLED: 'bg-slate-100 text-slate-500 ring-slate-500/20',
    ACTIVE: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    INACTIVE: 'bg-slate-100 text-slate-500 ring-slate-500/20',
    PUBLISHED: 'bg-brand-50 text-brand-700 ring-brand-600/20',
    ARCHIVED: 'bg-slate-100 text-slate-500 ring-slate-500/20',
    OPEN: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    CLOSED: 'bg-slate-100 text-slate-600 ring-slate-500/20',
    // Result pipeline + finance states (later-phase surfaces).
    SENATE_RATIFIED: 'bg-violet-50 text-violet-700 ring-violet-600/20',
    ISSUED: 'bg-brand-50 text-brand-700 ring-brand-600/20',
    PARTIALLY_PAID: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    PAID: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    VOID: 'bg-slate-100 text-slate-500 ring-slate-500/20',
    RELEASED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    // Payment intents (ledger posting states).
    CREATED: 'bg-slate-100 text-slate-600 ring-slate-500/20',
    POSTED_TO_LEDGER: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    UNDERPAID: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    OVERPAID: 'bg-violet-50 text-violet-700 ring-violet-600/20',
    REVERSED: 'bg-red-50 text-red-700 ring-red-600/20',
    FAILED: 'bg-red-50 text-red-700 ring-red-600/20',
    ABANDONED: 'bg-slate-100 text-slate-500 ring-slate-500/20',
    // Derived fee-clearance verdicts.
    CLEARED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    NOT_CLEARED: 'bg-red-50 text-red-700 ring-red-600/20',
  };
  const dot: Record<string, string> = {
    ACTIVATED: 'bg-emerald-500',
    PENDING: 'bg-amber-500',
    PENDING_APPROVAL: 'bg-amber-500',
    DRAFT: 'bg-slate-400',
    LOCKED: 'bg-red-500',
    APPROVED: 'bg-emerald-500',
    REJECTED: 'bg-red-500',
    CANCELLED: 'bg-slate-400',
    ACTIVE: 'bg-emerald-500',
    INACTIVE: 'bg-slate-400',
    PUBLISHED: 'bg-brand-500',
    ARCHIVED: 'bg-slate-400',
    OPEN: 'bg-emerald-500',
    CLOSED: 'bg-slate-400',
    SENATE_RATIFIED: 'bg-violet-500',
    ISSUED: 'bg-brand-500',
    PARTIALLY_PAID: 'bg-amber-500',
    PAID: 'bg-emerald-500',
    VOID: 'bg-slate-400',
    RELEASED: 'bg-emerald-500',
    CREATED: 'bg-slate-400',
    POSTED_TO_LEDGER: 'bg-emerald-500',
    UNDERPAID: 'bg-amber-500',
    OVERPAID: 'bg-violet-500',
    REVERSED: 'bg-red-500',
    FAILED: 'bg-red-500',
    ABANDONED: 'bg-slate-400',
    CLEARED: 'bg-emerald-500',
    NOT_CLEARED: 'bg-red-500',
  };
  const tone = map[state] ?? 'bg-slate-100 text-slate-600 ring-slate-500/20';
  const dotColor = dot[state] ?? 'bg-slate-400';
  return (
    <span className={`badge ring-1 ring-inset ${tone}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
      {state.replace(/_/g, ' ')}
    </span>
  );
}

/** Dashboard/stat metric card. Value is whatever the API returned — never a
 *  fabricated number. */
export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = 'brand',
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'brand' | 'emerald' | 'amber' | 'violet' | 'slate';
}) {
  const tones: Record<string, string> = {
    brand: 'bg-brand-50 text-brand-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    violet: 'bg-violet-50 text-violet-600',
    slate: 'bg-slate-100 text-slate-500',
  };
  return (
    <div className="card group relative overflow-hidden p-5 transition-shadow hover:shadow-card-hover">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-wider text-slate-500">
            {label}
          </p>
          <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-slate-900">
            {value}
          </p>
          {sub ? <p className="mt-1 text-xs leading-5 text-slate-500">{sub}</p> : null}
        </div>
        {icon ? (
          <div
            aria-hidden
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}
          >
            {icon}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Horizontal bar breakdown for small categorical distributions (the admin and
 *  student dashboards use it for activation states / statuses). Pure CSS — no
 *  chart library — and each row stays a labelled figure, never a colour blob. */
export function BreakdownRow({
  label,
  count,
  total,
  barClass = 'bg-brand-500',
  badge,
}: {
  label: string;
  count: number;
  total: number;
  barClass?: string;
  badge?: React.ReactNode;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <li className="text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-slate-600">{badge ?? label}</span>
        <span className="shrink-0 font-semibold tabular-nums text-slate-900">
          {count}
          <span className="ml-1.5 text-xs font-normal text-slate-400">{pct}%</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <div
          className={`h-full rounded-full ${barClass} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </li>
  );
}
