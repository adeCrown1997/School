'use client';

/**
 * Shared pagination control + a tiny hook for reading the API `meta` block.
 * Pagination is server-side (the API never returns more than one page), so this
 * only renders prev/next + page indicator; it never slices a client-side list.
 */
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
  return (
    <nav
      className="mt-4 flex items-center justify-between text-sm text-slate-600"
      aria-label="Pagination"
    >
      <span>
        Page {meta.page} of {meta.totalPages} · {meta.total} total
      </span>
      <div className="flex gap-2">
        <button
          className="btn-secondary"
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
        >
          Previous
        </button>
        <button
          className="btn-secondary"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPage(meta.page + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
