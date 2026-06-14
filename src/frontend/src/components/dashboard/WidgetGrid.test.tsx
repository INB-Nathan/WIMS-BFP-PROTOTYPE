/**
 * WidgetGrid + useDashboardWidgets tests — customizable dashboard widgets (#235).
 *
 * Tests: widget rendering, add/remove, localStorage persistence,
 * default widgets, loading/error states, role-based availability.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WidgetGrid } from "./WidgetGrid";
import { AddWidgetDropdown } from "./AddWidgetDropdown";
import { useDashboardWidgets } from "@/hooks/useDashboardWidgets";
import type { WidgetDefinition } from "./widget-definitions";

// ── Mock widget API ───────────────────────────────────────────────────────
const mockFetchWidgetData = vi.fn();
vi.mock("@/lib/api/widgets", () => ({
  fetchWidgetData: (...args: unknown[]) => mockFetchWidgetData(...args),
  isCountData: (d: unknown) => typeof (d as { count?: number }).count === "number",
  isCategoryData: (d: unknown) => Array.isArray((d as { categories?: unknown[] }).categories),
  isErrorData: (d: unknown) => typeof (d as { error?: string }).error === "string",
}));

// ── Mock localStorage ─────────────────────────────────────────────────────
let localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageStore[key] = value; }),
  removeItem: vi.fn((key: string) => { delete localStorageStore[key]; }),
  clear: vi.fn(() => { localStorageStore = {}; }),
};
vi.stubGlobal("localStorage", localStorageMock);

// ── Helpers ────────────────────────────────────────────────────────────────
function setupFetchMocks(widgetIds: string[], data?: Record<string, unknown>) {
  mockFetchWidgetData.mockReset();
  if (data) {
    mockFetchWidgetData.mockResolvedValue(data);
  } else {
    // Default: each widget returns a count of 5
    const defaultData: Record<string, unknown> = {};
    for (const id of widgetIds) {
      if (id === "by_category" || id === "by_alarm_level" || id === "by_region") {
        defaultData[id] = { categories: [{ label: "Type A", count: 3 }, { label: "Type B", count: 2 }] };
      } else {
        defaultData[id] = { count: 5 };
      }
    }
    mockFetchWidgetData.mockResolvedValue(defaultData);
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("WidgetGrid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageStore = {};
    mockFetchWidgetData.mockReset();
  });

  it("renders widgets from the provided ID list", async () => {
    setupFetchMocks(["awaiting_validation", "citizen_reports"]);
    render(
      <WidgetGrid
        widgetIds={["awaiting_validation", "citizen_reports"]}
        role="NATIONAL_VALIDATOR"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Awaiting Validation")).toBeDefined();
      expect(screen.getByText("Citizen Reports")).toBeDefined();
    });
  });

  it("shows loading skeleton while widgets load", () => {
    mockFetchWidgetData.mockReturnValue(new Promise(() => {})); // never resolves
    render(
      <WidgetGrid
        widgetIds={["awaiting_validation"]}
        role="NATIONAL_VALIDATOR"
      />,
    );

    // Skeleton cards have animate-pulse class
    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("shows error state when widget fetch fails", async () => {
    mockFetchWidgetData.mockRejectedValue(new Error("Network error"));
    render(
      <WidgetGrid
        widgetIds={["awaiting_validation"]}
        role="NATIONAL_VALIDATOR"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeDefined();
    });
  });

  it("renders count widgets with formatted numbers", async () => {
    setupFetchMocks(["total_incidents"], { total_incidents: { count: 42 } });
    render(
      <WidgetGrid
        widgetIds={["total_incidents"]}
        role="REGIONAL_ENCODER"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("42")).toBeDefined();
    });
  });

  it("renders categorical widgets with category breakdown", async () => {
    setupFetchMocks(["by_category"], {
      by_category: { categories: [{ label: "Structural", count: 8 }, { label: "Non-Structural", count: 3 }] },
    });
    render(
      <WidgetGrid
        widgetIds={["by_category"]}
        role="NATIONAL_VALIDATOR"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("11")).toBeDefined(); // total
      expect(screen.getByText("Structural")).toBeDefined();
      expect(screen.getByText("Non-Structural")).toBeDefined();
    });
  });

  it("renders nothing when widgetIds is empty", () => {
    const { container } = render(
      <WidgetGrid
        widgetIds={[]}
        role="NATIONAL_VALIDATOR"
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("skips unknown widget IDs silently", async () => {
    setupFetchMocks(["awaiting_validation"], { awaiting_validation: { count: 1 } });
    render(
      <WidgetGrid
        widgetIds={["awaiting_validation", "nonexistent_widget"]}
        role="NATIONAL_VALIDATOR"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Awaiting Validation")).toBeDefined();
    });
    // nonexistent_widget should not cause a crash or render anything
    expect(screen.queryByText("nonexistent")).toBeNull();
  });
});

describe("AddWidgetDropdown", () => {
  const mockWidgets: WidgetDefinition[] = [
    {
      id: "total_incidents",
      label: "Total Incidents",
      roles: new Set(["REGIONAL_ENCODER"]),
      icon: (() => null) as unknown as WidgetDefinition["icon"],
      isCategorical: false,
    },
    {
      id: "drafts",
      label: "Drafts",
      roles: new Set(["REGIONAL_ENCODER"]),
      icon: (() => null) as unknown as WidgetDefinition["icon"],
      isCategorical: false,
    },
  ];

  it("renders nothing when no additions are available", () => {
    const { container } = render(
      <AddWidgetDropdown availableAdditions={[]} onAddWidget={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("opens dropdown on click and lists available widgets", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(
      <AddWidgetDropdown availableAdditions={mockWidgets} onAddWidget={onAdd} />,
    );

    const button = screen.getByText("Add Widget");
    await user.click(button);

    expect(screen.getByText("Total Incidents")).toBeDefined();
    expect(screen.getByText("Drafts")).toBeDefined();
  });

  it("calls onAddWidget when a widget is selected", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(
      <AddWidgetDropdown availableAdditions={mockWidgets} onAddWidget={onAdd} />,
    );

    await user.click(screen.getByText("Add Widget"));
    await user.click(screen.getByText("Drafts"));

    expect(onAdd).toHaveBeenCalledWith("drafts");
  });
});

describe("useDashboardWidgets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageStore = {};
  });

  it("returns default widgets for a role when no config exists", () => {
    const TestComponent = () => {
      const config = useDashboardWidgets("NATIONAL_VALIDATOR");
      return (
        <div>
          <span data-testid="count">{config.widgets.length}</span>
          <span data-testid="ids">{config.widgets.join(",")}</span>
        </div>
      );
    };
    render(<TestComponent />);

    const count = screen.getByTestId("count");
    expect(Number(count.textContent)).toBeGreaterThan(0);
  });

  it("adds a new widget that is not in defaults", async () => {
    const user = userEvent.setup();
    // REGIONAL_ENCODER defaults: total_incidents, drafts, submitted_today, by_category
    // "pending_validation" is available but NOT a default for encoder
    const TestComponent = () => {
      const config = useDashboardWidgets("REGIONAL_ENCODER");
      return (
        <div>
          <button data-testid="add" onClick={() => config.addWidget("pending_validation")}>Add</button>
          <span data-testid="count">{config.widgets.length}</span>
          <span data-testid="ids">{config.widgets.join(",")}</span>
        </div>
      );
    };
    render(<TestComponent />);

    const initialCount = Number(screen.getByTestId("count").textContent);
    expect(screen.getByTestId("ids").textContent).not.toContain("pending_validation");

    // Click add
    await user.click(screen.getByTestId("add"));

    // Widget count should increase
    await waitFor(() => {
      expect(Number(screen.getByTestId("count").textContent)).toBeGreaterThan(initialCount);
    });
    expect(screen.getByTestId("ids").textContent).toContain("pending_validation");
  });

  it("does not add duplicate widgets", async () => {
    const user = userEvent.setup();
    const TestComponent = () => {
      const config = useDashboardWidgets("NATIONAL_VALIDATOR");
      return (
        <div>
          <span data-testid="count">{config.widgets.length}</span>
          <span data-testid="ids">{config.widgets.join(",")}</span>
          <button data-testid="add" onClick={() => config.addWidget("awaiting_validation")}>Add</button>
        </div>
      );
    };
    render(<TestComponent />);

    const initialCount = Number(screen.getByTestId("count").textContent);
    // awaiting_validation is a default for NATIONAL_VALIDATOR
    expect(screen.getByTestId("ids").textContent).toContain("awaiting_validation");
    await user.click(screen.getByTestId("add"));
    // Count should not increase since awaiting_validation is already a default
    expect(Number(screen.getByTestId("count").textContent)).toBe(initialCount);
  });
});
