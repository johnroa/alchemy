import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LlmActionSortControl } from "./llm-action-sort-control";

describe("LlmActionSortControl", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
  });

  it("calls onChange with the clicked sort option", () => {
    const onChange = vi.fn();
    render(<LlmActionSortControl value="total_tokens" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Cost" }));

    expect(onChange).toHaveBeenCalledWith("total_cost");
  });
});
