"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Globe, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SchemaPreview } from "./schema-viewer";
import { type Endpoint, METHOD_COLORS } from "./types";

function MethodBadge({ method }: { method: string }): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex min-w-[58px] items-center justify-center rounded border px-2 py-0.5 font-mono text-[11px] font-bold uppercase",
        METHOD_COLORS[method] ?? "bg-zinc-100 text-zinc-700 border-zinc-300"
      )}
    >
      {method}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Expandable endpoint row                                            */
/* ------------------------------------------------------------------ */

export function EndpointDetail({
  endpoint,
  spec,
}: {
  endpoint: Endpoint;
  spec: Record<string, unknown> | null;
  basePath?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-50 transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 flex-none text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 flex-none text-muted-foreground" />
        )}
        <MethodBadge method={endpoint.method} />
        <code className="flex-1 text-sm font-medium text-zinc-800">{endpoint.path}</code>
        {endpoint.auth ? (
          <span className="flex-none" aria-label="Requires authentication">
            <Lock className="h-3.5 w-3.5 text-amber-500" />
          </span>
        ) : (
          <span className="flex-none" aria-label="Public">
            <Globe className="h-3.5 w-3.5 text-emerald-500" />
          </span>
        )}
        {endpoint.summary && (
          <span className="hidden text-xs text-muted-foreground sm:inline">{endpoint.summary}</span>
        )}
      </button>

      {open && (
        <div className="border-t bg-zinc-50/60 px-4 py-3 pl-12 space-y-3">
          {endpoint.summary && (
            <p className="text-sm font-medium text-zinc-700">{endpoint.summary}</p>
          )}
          {endpoint.description && (
            <p className="text-xs text-muted-foreground">{endpoint.description}</p>
          )}

          {/* Parameters */}
          {endpoint.parameters.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Parameters
              </p>
              <div className="overflow-x-auto rounded border bg-white">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-zinc-50">
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Name</th>
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">In</th>
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Type</th>
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Required</th>
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {endpoint.parameters.map((p) => (
                      <tr key={`${p.in}-${p.name}`} className="border-b last:border-b-0">
                        <td className="px-3 py-1.5 font-mono font-medium text-zinc-800">{p.name}</td>
                        <td className="px-3 py-1.5">
                          <Badge variant="outline" className="text-[10px]">
                            {p.in}
                          </Badge>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-muted-foreground">{p.type}</td>
                        <td className="px-3 py-1.5">
                          {p.required ? (
                            <span className="text-red-600 font-medium">yes</span>
                          ) : (
                            <span className="text-muted-foreground">no</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground max-w-xs truncate">
                          {p.description ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Request body schema ref */}
          {endpoint.requestBody && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Request Body
                {endpoint.requestBody.required && <span className="ml-1 text-red-500">*</span>}
              </p>
              {endpoint.requestBody.schema && (
                <SchemaPreview schema={endpoint.requestBody.schema} spec={spec} />
              )}
            </div>
          )}

          {/* Response */}
          {endpoint.responseSchema && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Response {endpoint.responseDescription && `— ${endpoint.responseDescription}`}
              </p>
              <SchemaPreview schema={endpoint.responseSchema} spec={spec} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
