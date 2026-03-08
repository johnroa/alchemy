"use client";

import {
  MODEL_USAGE_ACTION_SORT_OPTIONS,
  type ModelUsageActionSort,
} from "@/lib/llm-analytics";
import { cn } from "@/lib/utils";

export function LlmActionSortControl({
  value,
  onChange,
}: {
  value: ModelUsageActionSort;
  onChange: (value: ModelUsageActionSort) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/70">Sort</span>
      <div className="flex flex-wrap gap-1 rounded-full border border-border/60 bg-muted/35 p-1">
        {MODEL_USAGE_ACTION_SORT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              value === option.value
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
