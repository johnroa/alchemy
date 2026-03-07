"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startTransition } from "react";
import type { AnalyticsCompare, AnalyticsGrain, AnalyticsQueryState, AnalyticsRange } from "@/lib/admin-analytics";
import { cn } from "@/lib/utils";

const RANGE_OPTIONS: AnalyticsRange[] = ["24h", "7d", "30d", "90d"];
const GRAIN_OPTIONS: AnalyticsGrain[] = ["hour", "day", "week"];
const COMPARE_OPTIONS: AnalyticsCompare[] = ["none", "previous"];

export function FilterBar({
  query,
  showGrain = true,
  showCompare = true,
}: {
  query: AnalyticsQueryState;
  showGrain?: boolean;
  showCompare?: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const updateQuery = (key: keyof AnalyticsQueryState, value: string): void => {
    const next = new URLSearchParams(searchParams.toString());
    next.set(key, value);
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  };

  const renderToggle = (
    title: string,
    current: string,
    values: string[],
    onSelect: (value: string) => void,
  ): React.JSX.Element => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground/70">{title}</span>
      <div className="flex flex-wrap gap-1 rounded-full border border-border/60 bg-muted/35 p-1">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onSelect(value)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              current === value
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
            )}
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-3 rounded-[1.25rem] border border-border/70 bg-card/80 p-4 shadow-sm backdrop-blur lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
      {renderToggle("Range", query.range, RANGE_OPTIONS, (value) => updateQuery("range", value))}
      {showGrain ? renderToggle("Grain", query.grain, GRAIN_OPTIONS, (value) => updateQuery("grain", value)) : null}
      {showCompare
        ? renderToggle("Compare", query.compare, COMPARE_OPTIONS, (value) => updateQuery("compare", value))
        : null}
    </div>
  );
}
