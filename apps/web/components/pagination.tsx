'use client';

/**
 * Shared pagination control + a tiny hook for reading the API `meta` block.
 * Pagination is server-side (the API never returns more than one page), so this
 * only renders prev/next + page indicator; it never slices a client-side list.
 */
import { ChevronLeftIcon, ChevronRightIcon } from './icons';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function Pagination({
  meta,
  onPage,
}: {
  meta: PageMeta | null;
  onPage: (page: number) => void;
}) {
  if (!meta || meta.totalPages <= 1) return null;
  const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.page * meta.pageSize, meta.total);
  return (
    <nav
      className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600"
      aria-label="Pagination"
    >
      <span className="tabular-nums">
        Showing <span className="font-semibold text-slate-800">{from}–{to}</span> of{' '}
        <span className="font-semibold text-slate-800">{meta.total}</span> · page {meta.page} of{' '}
        {meta.totalPages}
      </span>
      <div className="flex gap-2">
        <button
          className="btn-secondary gap-1.5"
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
        >
          <ChevronLeftIcon size={16} /> Previous
        </button>
        <button
          className="btn-secondary gap-1.5"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPage(meta.page + 1)}
        >
          Next <ChevronRightIcon size={16} />
        </button>
      </div>
    </nav>
  );
}
