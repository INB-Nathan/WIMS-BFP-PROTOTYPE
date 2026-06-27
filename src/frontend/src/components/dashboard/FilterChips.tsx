'use client';

import { X } from 'lucide-react';

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

interface FilterChipsProps {
  chips: FilterChip[];
  onClearAll?: () => void;
}

export function FilterChips({ chips, onClearAll }: FilterChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-full border border-[#1A3263]/30 bg-red-50 px-2.5 py-1 text-xs font-medium text-[#1A3263]"
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.onRemove}
            className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-red-100 transition-colors"
            aria-label={`Remove filter: ${chip.label}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {onClearAll && chips.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

