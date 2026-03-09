import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagsPanel } from "./feature-flags-panel";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const snapshot = {
  environments: [
    {
      key: "development",
      label: "Development",
      description: "Local values",
      revision: 2,
      updated_at: "2026-03-08T12:00:00.000Z",
    },
    {
      key: "production",
      label: "Production",
      description: "Live values",
      revision: 4,
      updated_at: "2026-03-08T12:01:00.000Z",
    },
  ],
  flags: [
    {
      id: "flag-1",
      key: "recipe_canon_match",
      name: "Recipe Canon Match",
      description: "Controls canon matching.",
      flag_type: "operational",
      owner: "backend",
      tags: ["recipes", "canon"],
      expires_at: null,
      archived_at: null,
      created_at: "2026-03-08T12:00:00.000Z",
      updated_at: "2026-03-08T12:00:00.000Z",
      configs: {
        development: {
          environment_key: "development",
          enabled: false,
          payload_json: { mode: "shadow" },
          revision: 2,
          updated_by: "admin@cookwithalchemy.com",
          created_at: "2026-03-08T12:00:00.000Z",
          updated_at: "2026-03-08T12:00:00.000Z",
        },
        production: {
          environment_key: "production",
          enabled: true,
          payload_json: { mode: "shadow" },
          revision: 4,
          updated_by: "admin@cookwithalchemy.com",
          created_at: "2026-03-08T12:00:00.000Z",
          updated_at: "2026-03-08T12:01:00.000Z",
        },
      },
    },
  ],
} as const;

describe("FeatureFlagsPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => false),
    });
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/flags/preview") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { environment: string };
        return new Response(
          JSON.stringify({
            ok: true,
            resolution: {
              environment: body.environment,
              revision: body.environment === "development" ? 2 : 4,
              flags: {
                recipe_canon_match: {
                  enabled: body.environment === "production",
                  payload: { mode: "shadow" },
                  reason: "resolved",
                  flag_type: "operational",
                },
              },
            },
          }),
          { status: 200 },
        );
      }

      if (url === "/api/admin/flags" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            ok: true,
            environments: snapshot.environments,
            flags: [
              ...snapshot.flags,
              {
                id: "flag-2",
                key: "same_canon_image_judge",
                name: "Same Canon Image Judge",
                description: "",
                flag_type: "operational",
                owner: "backend",
                tags: ["images"],
                expires_at: null,
                archived_at: null,
                created_at: "2026-03-08T12:02:00.000Z",
                updated_at: "2026-03-08T12:02:00.000Z",
                configs: {
                  development: null,
                  production: {
                    environment_key: "production",
                    enabled: true,
                    payload_json: null,
                    revision: 1,
                    updated_by: "admin@cookwithalchemy.com",
                    created_at: "2026-03-08T12:02:00.000Z",
                    updated_at: "2026-03-08T12:02:00.000Z",
                  },
                },
              },
            ],
            key: "same_canon_image_judge",
          }),
          { status: 200 },
        );
      }

      if (url === "/api/admin/flags" && init?.method === "PATCH") {
        return new Response(
          JSON.stringify({
            ok: true,
            environments: snapshot.environments,
            flags: [{
              ...snapshot.flags[0],
              archived_at: "2026-03-08T15:00:00.000Z",
            }],
            key: "recipe_canon_match",
          }),
          { status: 200 },
        );
      }

      if (url === "/api/admin/flags" && init?.method === "GET") {
        return new Response(
          JSON.stringify({
            ok: true,
            environments: snapshot.environments,
            flags: snapshot.flags,
          }),
          { status: 200 },
        );
      }

      throw new Error(`Unhandled fetch ${url}`);
    }));
  });

  it("renders registry data and loads preview for the selected flag", async () => {
    render(<FeatureFlagsPanel initialData={snapshot} />);

    expect(screen.getByText("Registry")).toBeInTheDocument();
    expect(screen.getByText("recipe_canon_match")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/"enabled": true/)).toBeInTheDocument();
    });
  });

  it("creates a new flag through the admin route", async () => {
    const user = userEvent.setup();
    render(<FeatureFlagsPanel initialData={snapshot} />);

    await user.click(screen.getAllByRole("button", { name: /new flag/i })[0]);
    fireEvent.change(screen.getAllByPlaceholderText("recipe_canon_match")[0], {
      target: { value: "same_canon_image_judge" },
    });
    fireEvent.change(screen.getAllByPlaceholderText("Recipe Canon Match")[0], {
      target: { value: "Same Canon Image Judge" },
    });
    fireEvent.change(screen.getAllByPlaceholderText("backend")[0], {
      target: { value: "backend" },
    });
    fireEvent.change(screen.getAllByPlaceholderText("recipes, canon, rollout")[0], {
      target: { value: "images" },
    });
    await user.click(screen.getByRole("button", { name: /create flag/i }));

    await waitFor(() => {
      expect(screen.getByText("same_canon_image_judge")).toBeInTheDocument();
    });
  });

  it("switches environments and archives an existing flag", async () => {
    const user = userEvent.setup();
    render(<FeatureFlagsPanel initialData={snapshot} />);

    const environmentSelect = screen.getAllByRole("combobox")[0];
    await user.click(environmentSelect);
    await user.click(await screen.findByText("Development"));

    await waitFor(() => {
      expect(screen.getByText(/Revision 2/i)).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole("button", { name: /^archive$/i })[0]);

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /^restore$/i }).length).toBeGreaterThan(0);
    });
  });
});
