"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { LaneOverrides, SimScope, SimulationRegistryModel } from "./types";
import { SIM_SCOPES } from "./types";

/**
 * Collapsible panel that lets the user override the model used for each
 * LLM scope within one simulation lane. Scopes left at "DB default" use
 * whatever model route is active in the database.
 */
export function OverridePanel({
  overrides,
  registryModels,
  onChange
}: {
  overrides: LaneOverrides;
  registryModels: SimulationRegistryModel[];
  onChange: (overrides: LaneOverrides) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const activeCount = Object.values(overrides).filter((o) => o?.model).length;
  const availableModels = registryModels.filter((m) => m.is_available);

  const selectedValue = (scope: SimScope): string => {
    const o = overrides[scope];
    return o ? `${o.provider}/${o.model}` : "";
  };

  const handleChange = (scope: SimScope, value: string): void => {
    if (!value) {
      const next = { ...overrides };
      delete next[scope];
      onChange(next);
      return;
    }

    const [provider, ...rest] = value.split("/");
    onChange({ ...overrides, [scope]: { provider, model: rest.join("/") } });
  };

  return (
    <div className="rounded-md border">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-xs"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-medium text-muted-foreground">
          Model overrides
          {activeCount > 0 && (
            <Badge className="ml-2 border-violet-300 bg-violet-50 text-violet-700 text-[10px]">
              {activeCount} active
            </Badge>
          )}
        </span>
        {open ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
      </button>

      {open && (
        <div className="space-y-2 border-t px-3 pb-3 pt-2">
          {SIM_SCOPES.map((scope) => (
            <div key={scope} className="grid w-full gap-1.5 sm:grid-cols-[minmax(10rem,13rem)_minmax(0,1fr)] sm:items-center sm:gap-3">
              <span className="min-w-0 break-all font-mono text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                {scope}
              </span>
              <select
                value={selectedValue(scope)}
                onChange={(e) => handleChange(scope, e.target.value)}
                className="w-full min-w-0 rounded-md border bg-background px-2 py-1 font-mono text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">- DB default -</option>
                {availableModels.map((model) => (
                  <option key={`${model.provider}/${model.model}`} value={`${model.provider}/${model.model}`}>
                    {model.display_name} ({model.provider})
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
