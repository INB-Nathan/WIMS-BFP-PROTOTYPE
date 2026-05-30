'use client';

interface PaginationControlsProps {
  page: number;
  total: number;
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
  className?: string;
}

export function PaginationControls({
  page,
  total,
  pageSize,
  onPrev,
  onNext,
  className = '',
}: PaginationControlsProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className={`flex items-center justify-between gap-4 ${className}`}>
      <button
        onClick={onPrev}
        disabled={page === 0}
        className="rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-40 hover:bg-gray-50 transition-colors"
      >
        Previous
      </button>
      <span className="text-sm text-gray-600">
        Page {page + 1} of {totalPages}
      </span>
      <button
        onClick={onNext}
        disabled={page >= totalPages - 1}
        className="rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-40 hover:bg-gray-50 transition-colors"
      >
        Next
      </button>
    </div>
  );
}
