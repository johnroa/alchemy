import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PromptsRulesSection } from "./prompts-rules-section";
import type { Prompt } from "./types";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const prompts: Prompt[] = [
  {
    id: "active-prompt",
    scope: "chat_ideation",
    version: 112,
    name: "my_chat_ideation_v112",
    template: "You are Alchemy, a recipe chat assistant.",
    is_active: true,
  },
  {
    id: "inactive-prompt",
    scope: "chat_ideation",
    version: 111,
    name: "my_chat_ideation_v111",
    template: "Older prompt template",
    is_active: false,
  },
];

describe("PromptsRulesSection", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
  });

  it("uses theme-safe surfaces for prompt previews", () => {
    render(
      <PromptsRulesSection
        kind="prompts"
        prompts={prompts}
        rules={[]}
        onPromptsChange={vi.fn()}
        onRulesChange={vi.fn()}
      />
    );

    const activePreview = screen.getByText("You are Alchemy, a recipe chat assistant.").closest("pre");
    expect(activePreview).toHaveClass("bg-background/80", "text-foreground", "border-emerald-500/25");

    fireEvent.click(screen.getByRole("button", { name: "Expand my_chat_ideation_v111" }));

    const inactivePreview = screen.getByText("Older prompt template").closest("pre");
    expect(inactivePreview).toHaveClass("bg-muted/35", "text-foreground/90", "border-border/80");
  });
});
