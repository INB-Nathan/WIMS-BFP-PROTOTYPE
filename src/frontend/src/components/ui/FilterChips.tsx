'use client';

interface FilterChipOption {
  label: string;
  value: string;
}

interface FilterChipsProps {
  options: FilterChipOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function FilterChips({ options, value, onChange, className = '' }: FilterChipsProps) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              active
                ? 'text-white'
                : 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
            }`}
            style={active ? { backgroundColor: '#1A3263' } : undefined}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
