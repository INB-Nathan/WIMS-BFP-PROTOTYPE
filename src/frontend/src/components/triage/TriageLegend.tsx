'use client';

/**
 * TriageLegend — HCI legend for the Civilian Triage Queue page.
 *
 * Explains what clusters vs singletons mean, how trust scores work,
 * severity colors, and other triage concepts so NATIONAL_VALIDATOR
 * users grasp the system at a glance.
 */

import {
  AlertTriangle,
  Clock,
  HelpCircle,
  Layers,
  MapPin,
  Shield,
  User,
} from 'lucide-react';

const LEGEND_ITEMS = [
  {
    icon: Layers,
    label: 'Cluster',
    description: 'Multiple reports grouped within ~100m / 1 hour, likely the same incident',
    color: '#b91c1c',
    bg: '#FEE2E2',
  },
  {
    icon: MapPin,
    label: 'Singleton',
    description: 'A single standalone report with no nearby matches',
    color: '#64748b',
    bg: '#F1F5F9',
  },
  {
    icon: Shield,
    label: 'Trust Score',
    description: 'Confidence rating (0–100). Higher = more reliable. Calculated from device history, proximity, and report consistency.',
    color: '#16A34A',
    bg: '#DCFCE7',
  },
  {
    icon: AlertTriangle,
    label: 'Life Safety Signal',
    description: 'Reporter indicated "I need help" or "Someone else needs help" — highest priority',
    color: '#b91c1c',
    bg: '#FEE2E2',
  },
  {
    icon: Clock,
    label: 'Timeout / Aging',
    description: 'Timeout risk = approaching 2h auto-close. Aging = report waiting >30 min without action.',
    color: '#D97706',
    bg: '#FEF3C7',
  },
  {
    icon: HelpCircle,
    label: 'Severity Colors',
    description: (
      <span>
        <span className="inline-block w-2 h-2 rounded-full bg-red-700 mr-1" />
        <strong>HIGH</strong> (red) ·{' '}
        <span className="inline-block w-2 h-2 rounded-full bg-orange-600 mr-1" />
        <strong>MEDIUM</strong> (orange) ·{' '}
        <span className="inline-block w-2 h-2 rounded-full bg-slate-500 mr-1" />
        <strong>LOW</strong> (gray)
      </span>
    ),
    color: '#64748b',
    bg: '#F8FAFC',
  },
  {
    icon: User,
    label: 'Claim & Review',
    description: 'Click a cluster on the map, then "Claim cluster" to take ownership. Act on reports via Inspect/Act.',
    color: '#7C3AED',
    bg: '#F3E8FF',
  },
];

export function TriageLegend() {
  return (
    <details className="group rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <summary className="flex cursor-pointer items-center gap-2 px-5 py-3 text-xs font-bold uppercase tracking-wider text-slate-600 select-none [&::-webkit-details-marker]:hidden">
        <Layers className="h-4 w-4 text-red-700" aria-hidden />
        <span>About this triage board</span>
        <span className="ml-auto text-[10px] font-normal text-slate-400 group-open:hidden">
          Click to expand
        </span>
        <span className="ml-auto text-[10px] font-normal text-slate-400 hidden group-open:inline">
          Click to collapse
        </span>
      </summary>

      <div className="border-t border-slate-100 px-5 pb-4 pt-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {LEGEND_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className="flex items-start gap-3 rounded-lg p-3 text-sm transition-colors hover:brightness-95"
                style={{ backgroundColor: item.bg }}
              >
                <span
                  className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: item.color, color: '#fff' }}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="font-bold text-slate-900">{item.label}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                    {item.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-4 text-center text-[11px] text-slate-400">
          Terminal actions (ACTIONED / REJECTED_*) update tracking only —
          they never create official BFP incidents.
        </p>
      </div>
    </details>
  );
}
