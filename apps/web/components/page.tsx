'use client';

/**
 * Page-level layout helpers: a title/description header and a "no access" notice
 * used when the API refuses a page's data (403). Showing the notice — rather than
 * hiding the route entirely — keeps the frontend honest: the API is the gate, and
 * the UI simply reflects its decision.
 */
import Link from 'next/link';
import { Alert } from './ui';
import { InboxIcon, ShieldCheckIcon } from './icons';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 animate-fade-up">
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </div>
  );
}

export function AccessNotice({ message }: { message?: string }) {
  return (
    <div className="card mx-auto mt-10 max-w-lg animate-fade-up p-8 text-center">
      <div
        aria-hidden
        className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-500"
      >
        <ShieldCheckIcon size={24} />
      </div>
      <h1 className="font-display text-lg font-bold text-slate-900">
        You don&apos;t have access to this area
      </h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        {message ??
          'Your account is not authorized to view this. If you believe this is an error, contact an administrator.'}
      </p>
      <Link href="/dashboard" className="btn-secondary mt-6">
        Return to your dashboard
      </Link>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card animate-fade-up grid place-items-center px-6 py-14 text-center">
      <div
        aria-hidden
        className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"
      >
        <InboxIcon size={24} />
      </div>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {children ? <div className="mt-1 max-w-sm text-sm leading-6 text-slate-500">{children}</div> : null}
    </div>
  );
}
