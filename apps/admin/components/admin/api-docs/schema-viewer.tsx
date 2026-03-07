"use client";

import { cn } from "@/lib/utils";
import { resolveRef, schemaTypeLabel } from "./types";

/* ------------------------------------------------------------------ */
/*  Schema preview — shows a compact representation of a JSON schema   */
/* ------------------------------------------------------------------ */

export function SchemaPreview({
  schema,
  spec,
  depth = 0,
}: {
  schema: Record<string, unknown>;
  spec: Record<string, unknown> | null;
  depth?: number;
}): React.JSX.Element {
  /* Prevent infinitely deep rendering */
  if (depth > 3) {
    return <span className="text-xs text-muted-foreground italic">...</span>;
  }

  /* Handle $ref */
  if (schema["$ref"] && spec) {
    const refName = (schema["$ref"] as string).split("/").pop();
    const resolved = resolveRef(spec, schema["$ref"] as string) as Record<string, unknown> | undefined;
    if (resolved) {
      return (
        <div className="rounded border bg-white px-3 py-2">
          <p className="mb-1 font-mono text-xs font-semibold text-violet-700">{refName}</p>
          <SchemaProperties schema={resolved} spec={spec} depth={depth + 1} />
        </div>
      );
    }
    return <code className="text-xs font-mono text-violet-700">{refName}</code>;
  }

  /* Inline object with properties */
  if (schema["type"] === "object" || schema["properties"]) {
    return (
      <div className="rounded border bg-white px-3 py-2">
        <SchemaProperties schema={schema} spec={spec} depth={depth} />
      </div>
    );
  }

  /* Array */
  if (schema["type"] === "array" && schema["items"]) {
    const items = schema["items"] as Record<string, unknown>;
    return (
      <div className="rounded border bg-white px-3 py-2">
        <p className="text-[10px] font-medium text-muted-foreground mb-1">array of:</p>
        <SchemaPreview schema={items} spec={spec} depth={depth + 1} />
      </div>
    );
  }

  /* Primitive */
  return (
    <code className="rounded border bg-white px-2 py-0.5 text-xs font-mono text-zinc-600">
      {schemaTypeLabel(schema)}
    </code>
  );
}

function SchemaProperties({
  schema,
  spec,
  depth,
}: {
  schema: Record<string, unknown>;
  spec: Record<string, unknown> | null;
  depth: number;
}): React.JSX.Element {
  const props = schema["properties"] as Record<string, Record<string, unknown>> | undefined;
  const required = new Set((schema["required"] as string[]) ?? []);

  if (!props) {
    return <span className="text-xs text-muted-foreground italic">{schemaTypeLabel(schema)}</span>;
  }

  return (
    <div className="space-y-1">
      {Object.entries(props).map(([name, propSchema]) => (
        <div key={name} className="flex items-start gap-2 text-xs">
          <code className={cn("font-mono", required.has(name) ? "text-zinc-800 font-medium" : "text-zinc-500")}>
            {name}
            {required.has(name) && <span className="text-red-500">*</span>}
          </code>
          <span className="text-muted-foreground">:</span>
          <span className="font-mono text-zinc-500">{schemaTypeLabel(propSchema)}</span>
        </div>
      ))}
    </div>
  );
}
