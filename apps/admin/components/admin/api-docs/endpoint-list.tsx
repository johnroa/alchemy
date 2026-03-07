"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EndpointDetail } from "./endpoint-detail";
import type { EndpointGroup } from "./types";

/* ------------------------------------------------------------------ */
/*  Resource group — collapsible section of endpoints                   */
/* ------------------------------------------------------------------ */

export function ResourceGroup({
  group,
  spec,
  defaultOpen,
}: {
  group: EndpointGroup;
  spec: Record<string, unknown> | null;
  defaultOpen?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen ?? false);

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-6 py-3 text-left hover:bg-zinc-50/50 transition-colors"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 flex-none text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" />
        )}
        <span className="text-sm font-semibold">{group.label}</span>
        <Badge variant="secondary" className="ml-auto text-[10px]">
          {group.endpoints.length} endpoint{group.endpoints.length !== 1 ? "s" : ""}
        </Badge>
      </button>
      {open && (
        <div className="border-t">
          {group.endpoints.map((ep) => (
            <EndpointDetail
              key={`${ep.method}-${ep.path}`}
              endpoint={ep}
              spec={spec}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
