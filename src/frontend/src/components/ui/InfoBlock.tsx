import { displayValue } from "@/lib/incident-utils";

interface Props {
  label: string;
  value: string | null | undefined;
  tone?: "default" | "primary";
}

export function InfoBlock({ label, value, tone = "default" }: Props) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div
        className={`${tone === "primary" ? "mt-1 text-base font-semibold" : "mt-0.5 text-sm font-medium"} break-words leading-relaxed`}
        style={{ color: 'var(--text-primary)' }}
      >
        {displayValue(value)}
      </div>
    </div>
  );
}
