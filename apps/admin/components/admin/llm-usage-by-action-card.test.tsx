import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LlmUsageByActionCard } from "./llm-usage-by-action-card";

const rows = [
  {
    scope: "chat_generation",
    label: "Chat Generation",
    calls: 2,
    inputTokens: 800,
    outputTokens: 1200,
    totalTokens: 2_000,
    costUsd: 0.4,
    avgLatencyMs: 2000,
    callShare: 0.4,
    tokenShare: 0.5,
  },
  {
    scope: "chat_ideation",
    label: "Chat Ideation",
    calls: 5,
    inputTokens: 300,
    outputTokens: 600,
    totalTokens: 900,
    costUsd: 0.8,
    avgLatencyMs: 1500,
    callShare: 0.6,
    tokenShare: 0.3,
  },
];

describe("LlmUsageByActionCard", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    window.history.replaceState(null, "", "/analytics/llm?range=30d");
  });

  it("sorts rows in place without navigation and updates the URL query", () => {
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    render(<LlmUsageByActionCard initialRows={rows} initialSort="total_tokens" />);

    expect(screen.getByRole("button", { name: "Calls" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tokens" })).toBeInTheDocument();

    const labelsBefore = screen.getAllByText(/Chat /).map((node) => node.textContent);
    expect(labelsBefore.slice(0, 2)).toEqual(["Chat Generation", "Chat Ideation"]);

    fireEvent.click(screen.getByRole("button", { name: "Calls" }));

    const labelsAfter = screen.getAllByText(/Chat /).map((node) => node.textContent);
    expect(labelsAfter.slice(0, 2)).toEqual(["Chat Ideation", "Chat Generation"]);
    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/analytics/llm?range=30d&actionSort=total_calls");
  });
});
