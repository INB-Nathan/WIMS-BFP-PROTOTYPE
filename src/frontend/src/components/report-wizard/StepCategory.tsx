'use client';

import { Flame, Cloud, Bomb, Wind, Building2, Users, Zap, Beaker, HelpCircle } from 'lucide-react';

export const OBSERVABLES: { value: string; label: string; labelFil: string; icon: React.ReactNode }[] = [
  { value: 'LARGE_FLAMES', label: 'Large flames', labelFil: 'Malalaking apoy', icon: <Flame className="w-5 h-5" /> },
  { value: 'HEAVY_SMOKE', label: 'Heavy smoke', labelFil: 'Makapal na usok', icon: <Cloud className="w-5 h-5" /> },
  { value: 'EXPLOSIONS', label: 'Explosions', labelFil: 'Pagsabog', icon: <Bomb className="w-5 h-5" /> },
  { value: 'SPREADING_FAST', label: 'Spreading fast', labelFil: 'Mabilis kumalat', icon: <Wind className="w-5 h-5" /> },
  { value: 'STRUCTURES_THREATENED', label: 'Structures threatened', labelFil: 'Nanganganib na gusali', icon: <Building2 className="w-5 h-5" /> },
  { value: 'PEOPLE_TRAPPED', label: 'People trapped', labelFil: 'May naipit na tao', icon: <Users className="w-5 h-5" /> },
  { value: 'ELECTRICAL_FIRE', label: 'Electrical fire', labelFil: 'Sunog sa kuryente', icon: <Zap className="w-5 h-5" /> },
  { value: 'CHEMICAL_HAZARD', label: 'Chemical / hazardous smell', labelFil: 'Amoy ng kemikal / mapanganib', icon: <Beaker className="w-5 h-5" /> },
  { value: 'OTHER', label: 'Other', labelFil: 'Iba pa', icon: <HelpCircle className="w-5 h-5" /> },
];

// Civilian report category is still required by the backend payload; the
// wizard collapses the 4 backend categories into a single observable-driven
// type. We map the observable set to the closest backend category for the
// submit payload (kept server-side authoritative for validation).
export const CATEGORY_BY_OBSERVABLE: Record<string, string> = {
  ELECTRICAL_FIRE: 'NON_STRUCTURAL',
  CHEMICAL_HAZARD: 'NON_STRUCTURAL',
  STRUCTURES_THREATENED: 'STRUCTURAL',
  OTHER: 'UNSURE',
};

export function deriveCategory(observables: string[]): string {
  if (observables.length === 0) return 'UNSURE';
  // Prefer the first mapped category; backend allows a single category.
  for (const o of observables) {
    if (CATEGORY_BY_OBSERVABLE[o]) return CATEGORY_BY_OBSERVABLE[o];
  }
  return 'NON_STRUCTURAL';
}

export interface StepCategoryProps {
  observables: string[];
  onChange: (observables: string[]) => void;
}

/**
 * Step 3 — Category. Observable checkboxes (NOT severity) per Issue #613.
 * A civilian reports what they SEE, not assessed severity.
 */
export function StepCategory({ observables, onChange }: StepCategoryProps) {
  function toggle(value: string) {
    if (observables.includes(value)) {
      onChange(observables.filter((v) => v !== value));
    } else {
      onChange([...observables, value]);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
          What do you observe?
        </p>
        <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
          Check all that apply. These are things you can see — not an assessment.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2" data-testid="observable-list">
        {OBSERVABLES.map((obs) => {
          const selected = observables.includes(obs.value);
          return (
            <button
              key={obs.value}
              type="button"
              onClick={() => toggle(obs.value)}
              data-testid={`observable-${obs.value}`}
              aria-pressed={selected}
              className="flex items-center gap-3 w-full text-left rounded-xl p-3 border-2 transition-all"
              style={{
                borderColor: selected ? 'var(--red)' : 'var(--border)',
                backgroundColor: selected ? 'var(--red-bg)' : 'var(--bg-surface)',
              }}
            >
              <span style={{ color: selected ? 'var(--red)' : 'var(--text-secondary)' }}>{obs.icon}</span>
              <span className="flex-1">
                <span className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{obs.label}</span>
                <span className="block text-xs" style={{ color: 'var(--bilingual-color)' }}>{obs.labelFil}</span>
              </span>
              <span
                className="w-5 h-5 rounded border flex items-center justify-center text-white text-xs"
                style={{ borderColor: selected ? 'var(--red)' : 'var(--border)', backgroundColor: selected ? 'var(--red)' : 'transparent' }}
                aria-hidden
              >
                {selected ? '✓' : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
