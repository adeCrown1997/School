'use client';

/**
 * Page-level layout helpers: a title/description header and a "no access" notice
 * used when the API refuses a page's data (403). Showing the notice — rather than
 * hiding the route entirely — keeps the frontend honest: the API is the gate, and
 * the UI simply reflects its decision.
 */
import Link from 'next/link';
import { Alert } from './ui';

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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function AccessNotice({ message }: { message?: string }) {
  return (
    <Alert kind="warning" title="You don’t have access to this area">
      <p>
        {message ??
          'Your account is not authorized to view this. If you believe this is an error, contact an administrator.'}
      </p>
      <p className="mt-2">
        <Link href="/dashboard" className="text-brand-700 underline">
          Return to your dashboard
        </Link>
      </p>
    </Alert>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card grid place-items-center px-6 py-12 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {children ? <div className="mt-1 text-sm text-slate-500">{children}</div> : null}
    </div>
  );
}
