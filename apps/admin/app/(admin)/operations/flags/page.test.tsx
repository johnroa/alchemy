import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FlagsPage from "./page";

const { getFeatureFlagsData } = vi.hoisted(() => ({
  getFeatureFlagsData: vi.fn(),
}));

vi.mock("@/lib/admin-data", () => ({
  getFeatureFlagsData,
}));

vi.mock("@/components/admin/feature-flags-panel", () => ({
  FeatureFlagsPanel: () => <div data-testid="feature-flags-panel" />,
}));

describe("FlagsPage", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    getFeatureFlagsData.mockResolvedValue({
      environments: [],
      flags: [
        { archived_at: null },
        { archived_at: null },
        { archived_at: "2026-03-08T12:00:00.000Z" },
      ],
    });
  });

  it("renders the operations flags page shell", async () => {
    render(await FlagsPage());

    expect(screen.getByText("Flags")).toBeInTheDocument();
    expect(screen.getByText(/DB-backed runtime flags/i)).toBeInTheDocument();
    expect(screen.getByText("2 active")).toBeInTheDocument();
    expect(screen.getByTestId("feature-flags-panel")).toBeInTheDocument();
  });
});
