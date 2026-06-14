"use client";

import { useState, useRef, useEffect } from "react";
import { Plus } from "lucide-react";
import type { WidgetDefinition } from "./widget-definitions";

export interface AddWidgetDropdownProps {
  availableAdditions: WidgetDefinition[];
  onAddWidget: (id: string) => void;
}

/**
 * Dropdown for adding new widgets to the dashboard.
 *
 * Lists all available widgets not yet added, filtered by role.
 * Positioned at the top-right of the dashboard.
 */
export function AddWidgetDropdown({ availableAdditions, onAddWidget }: AddWidgetDropdownProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  if (availableAdditions.length === 0) {
    return null;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="card flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Plus className="w-4 h-4" />
        Add Widget
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 w-64 rounded-xl bg-white shadow-lg border py-1"
          style={{ borderColor: "var(--border-color)" }}
        >
          <div className="px-3 py-2 text-xs font-semibold uppercase text-gray-500">
            Available Widgets
          </div>
          <ul role="listbox" aria-label="Available widgets">
            {availableAdditions.map((w) => {
              const IconComp = w.icon;
              return (
                <li key={w.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      onAddWidget(w.id);
                      setOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50 transition-colors text-left"
                  >
                    <IconComp className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
                    <span style={{ color: "var(--text-primary)" }}>{w.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
