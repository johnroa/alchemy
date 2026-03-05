"use client";

import { useState, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  Globe,
  Lock,
  Search,
  Server,
  Shield,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AdminRoute {
  path: string;
  method: string;
}

interface OpenApiParam {
  name?: string;
  in?: string;
  required?: boolean;
  schema?: Record<string, unknown>;
  description?: string;
  /** $ref pointer — resolved manually from spec components */
  $ref?: string;
}

interface OpenApiOperation {
  summary?: string;
  description?: string;
  parameters?: OpenApiParam[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: Record<string, unknown> }>;
  };
  responses?: Record<string, {
    description?: string;
    content?: Record<string, { schema?: Record<string, unknown> }>;
  }>;
  security?: Array<Record<string, string[]>>;
  tags?: string[];
}

/** A single endpoint (one HTTP method on one path) extracted from the spec */
interface Endpoint {
  path: string;
  method: string;
  summary: string;
  description: string | undefined;
  parameters: ResolvedParam[];
  requestBody: {
    required: boolean;
    schema: Record<string, unknown> | null;
  } | undefined;
  responseDescription: string;
  responseSchema: Record<string, unknown> | null;
  auth: boolean;
}

interface ResolvedParam {
  name: string;
  in: string;
  required: boolean;
  type: string;
  description: string | undefined;
}

/** Group of endpoints sharing a resource prefix */
interface EndpointGroup {
  label: string;
  endpoints: Endpoint[];
}

/* ------------------------------------------------------------------ */
/*  Method badge styling — consistent color coding per HTTP verb       */
/* ------------------------------------------------------------------ */

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-emerald-100 text-emerald-800 border-emerald-300",
  POST: "bg-blue-100 text-blue-800 border-blue-300",
  PUT: "bg-amber-100 text-amber-800 border-amber-300",
  PATCH: "bg-orange-100 text-orange-800 border-orange-300",
  DELETE: "bg-red-100 text-red-800 border-red-300",
};

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
/*  Spec parsing helpers                                               */
/* ------------------------------------------------------------------ */

/**
 * Resolves a $ref string like "#/components/parameters/RecipeId" against
 * the root OpenAPI spec object. Returns the resolved object or undefined.
 */
function resolveRef(spec: Record<string, unknown>, ref: string): Record<string, unknown> | undefined {
  if (!ref.startsWith("#/")) return undefined;
  const parts = ref.slice(2).split("/");
  let current: unknown = spec;
  for (const part of parts) {
    if (current && typeof current === "object" && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current as Record<string, unknown> | undefined;
}

/** Extracts a concise type string from an OpenAPI schema object */
function schemaTypeLabel(schema: Record<string, unknown> | undefined): string {
  if (!schema) return "any";
  if (schema["$ref"]) {
    const ref = schema["$ref"] as string;
    return ref.split("/").pop() ?? "object";
  }
  const t = schema["type"];
  if (Array.isArray(t)) return t.filter((v) => v !== "null").join(" | ");
  if (t === "array") {
    const items = schema["items"] as Record<string, unknown> | undefined;
    return `${schemaTypeLabel(items)}[]`;
  }
  if (typeof t === "string") {
    if (schema["enum"]) return (schema["enum"] as string[]).join(" | ");
    if (schema["format"]) return `${t} (${schema["format"]})`;
    return t;
  }
  return "object";
}

/**
 * Parse the full OpenAPI spec object into a flat list of Endpoint objects.
 * Each path × method combination becomes one Endpoint.
 */
function parseEndpoints(spec: Record<string, unknown>): Endpoint[] {
  const paths = spec["paths"] as Record<string, Record<string, unknown>> | undefined;
  if (!paths) return [];

  /* Global security — if present, endpoints inherit auth by default */
  const globalSecurity = spec["security"] as Array<Record<string, string[]>> | undefined;
  const hasGlobalAuth = !!globalSecurity && globalSecurity.length > 0;

  const endpoints: Endpoint[] = [];

  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const op = pathItem[method] as OpenApiOperation | undefined;
      if (!op) continue;

      /* Resolve parameters (may include $ref pointers) */
      const rawParams = [...(pathItem["parameters"] as OpenApiParam[] ?? []), ...(op.parameters ?? [])];
      const resolvedParams: ResolvedParam[] = rawParams.map((p) => {
        const resolved = p.$ref ? resolveRef(spec, p.$ref) as OpenApiParam | undefined : p;
        if (!resolved) return { name: "?", in: "?", required: false, type: "unknown", description: undefined };
        return {
          name: resolved.name ?? "?",
          in: resolved.in ?? "?",
          required: resolved.required ?? false,
          type: schemaTypeLabel(resolved.schema as Record<string, unknown> | undefined),
          description: resolved.description,
        };
      });

      /* Request body */
      let requestBody: Endpoint["requestBody"] = undefined;
      if (op.requestBody) {
        const jsonContent = op.requestBody.content?.["application/json"];
        requestBody = {
          required: op.requestBody.required ?? false,
          schema: (jsonContent?.schema as Record<string, unknown>) ?? null,
        };
      }

      /* Primary success response */
      const successKey = Object.keys(op.responses ?? {}).find((k) => k.startsWith("2")) ?? "200";
      const successResp = op.responses?.[successKey];
      const respSchema = successResp?.content?.["application/json"]?.schema as Record<string, unknown> | null ?? null;

      /* Auth: endpoint has auth unless it explicitly sets security: [] */
      const explicitSecurity = op.security;
      const auth = explicitSecurity
        ? explicitSecurity.length > 0
        : hasGlobalAuth;

      endpoints.push({
        path,
        method: method.toUpperCase(),
        summary: op.summary ?? "",
        description: op.description,
        parameters: resolvedParams,
        requestBody,
        responseDescription: successResp?.description ?? "",
        responseSchema: respSchema,
        auth,
      });
    }
  }

  return endpoints;
}

/**
 * Groups endpoints by their first path segment (the "resource").
 * e.g. /recipes/{id} and /recipes/cookbook → "Recipes"
 */
function groupEndpoints(endpoints: Endpoint[]): EndpointGroup[] {
  const map = new Map<string, Endpoint[]>();
  for (const ep of endpoints) {
    /* Strip leading slash and take first segment */
    const segments = ep.path.replace(/^\//, "").split("/");
    const resource = segments[0] ?? "other";
    if (!map.has(resource)) map.set(resource, []);
    map.get(resource)!.push(ep);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, eps]) => ({
      label: key.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      endpoints: eps,
    }));
}

/** Same grouping logic for admin routes (which don't come from OpenAPI) */
function groupAdminRoutes(routes: AdminRoute[]): EndpointGroup[] {
  const map = new Map<string, AdminRoute[]>();
  for (const r of routes) {
    /* /api/admin/llm/prompts → "llm" ; /api/admin/users → "users" */
    const segments = r.path.replace(/^\/api\/admin\//, "").split("/");
    const resource = segments[0] ?? "other";
    if (!map.has(resource)) map.set(resource, []);
    map.get(resource)!.push(r);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, eps]) => ({
      label: key.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      endpoints: eps.map((r): Endpoint => ({
        path: r.path,
        method: r.method,
        summary: "",
        description: undefined,
        parameters: [],
        requestBody: undefined,
        responseDescription: "",
        responseSchema: null,
        auth: true,
      })),
    }));
}

/* ------------------------------------------------------------------ */
/*  Expandable endpoint row                                            */
/* ------------------------------------------------------------------ */

function EndpointRow({
  endpoint,
  spec,
  basePath,
}: {
  endpoint: Endpoint;
  spec: Record<string, unknown> | null;
  basePath?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);

  /* Build the full display path, using basePath prefix if provided */
  const displayPath = basePath ? endpoint.path : endpoint.path;

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
        <code className="flex-1 text-sm font-medium text-zinc-800">{displayPath}</code>
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
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Parameters</p>
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
                          <Badge variant="outline" className="text-[10px]">{p.in}</Badge>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-muted-foreground">{p.type}</td>
                        <td className="px-3 py-1.5">
                          {p.required ? (
                            <span className="text-red-600 font-medium">yes</span>
                          ) : (
                            <span className="text-muted-foreground">no</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground max-w-xs truncate">{p.description ?? "—"}</td>
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
                Request Body{endpoint.requestBody.required && <span className="ml-1 text-red-500">*</span>}
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

/* ------------------------------------------------------------------ */
/*  Schema preview — shows a compact representation of a JSON schema   */
/* ------------------------------------------------------------------ */

function SchemaPreview({
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

/* ------------------------------------------------------------------ */
/*  Resource group — collapsible section of endpoints                   */
/* ------------------------------------------------------------------ */

function ResourceGroup({
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
            <EndpointRow
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

/* ------------------------------------------------------------------ */
/*  Main visualizer component                                          */
/* ------------------------------------------------------------------ */

interface ApiVisualizerProps {
  /** Parsed OpenAPI spec object */
  spec: Record<string, unknown>;
  /** Admin API routes discovered from filesystem */
  adminRoutes: AdminRoute[];
}

export function ApiVisualizer({ spec, adminRoutes }: ApiVisualizerProps): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"main" | "admin">("main");

  /* Parse the OpenAPI spec into grouped endpoints */
  const mainEndpoints = useMemo(() => parseEndpoints(spec), [spec]);
  const mainGroups = useMemo(() => groupEndpoints(mainEndpoints), [mainEndpoints]);
  const adminGroups = useMemo(() => groupAdminRoutes(adminRoutes), [adminRoutes]);

  /* Filter by search term */
  const searchLower = search.toLowerCase();
  const filteredMainGroups = useMemo(() => {
    if (!searchLower) return mainGroups;
    return mainGroups
      .map((g) => ({
        ...g,
        endpoints: g.endpoints.filter(
          (ep) =>
            ep.path.toLowerCase().includes(searchLower) ||
            ep.method.toLowerCase().includes(searchLower) ||
            ep.summary.toLowerCase().includes(searchLower)
        ),
      }))
      .filter((g) => g.endpoints.length > 0);
  }, [mainGroups, searchLower]);

  const filteredAdminGroups = useMemo(() => {
    if (!searchLower) return adminGroups;
    return adminGroups
      .map((g) => ({
        ...g,
        endpoints: g.endpoints.filter(
          (ep) =>
            ep.path.toLowerCase().includes(searchLower) ||
            ep.method.toLowerCase().includes(searchLower)
        ),
      }))
      .filter((g) => g.endpoints.length > 0);
  }, [adminGroups, searchLower]);

  const activeGroups = activeTab === "main" ? filteredMainGroups : filteredAdminGroups;
  const totalEndpoints = activeTab === "main"
    ? mainEndpoints.length
    : adminRoutes.length;

  /* Extract spec metadata */
  const info = spec["info"] as Record<string, unknown> | undefined;
  const specVersion = info?.["version"] as string | undefined;

  return (
    <div className="space-y-4">
      {/* Stat cards row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Server className="h-4 w-4" />
              Main API (v1)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{mainEndpoints.length}</p>
            <p className="text-xs text-muted-foreground">endpoints across {mainGroups.length} resources</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Shield className="h-4 w-4" />
              Admin API
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{adminRoutes.length}</p>
            <p className="text-xs text-muted-foreground">endpoints across {adminGroups.length} resources</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Globe className="h-4 w-4" />
              Spec Version
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold font-mono">{specVersion ?? "—"}</p>
            <p className="text-xs text-muted-foreground">OpenAPI 3.1.0</p>
          </CardContent>
        </Card>
      </div>

      {/* Tab bar + search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border bg-white p-0.5">
          <button
            type="button"
            onClick={() => setActiveTab("main")}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              activeTab === "main"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Main API
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("admin")}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              activeTab === "admin"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Admin API
          </button>
        </div>

        <div className="relative w-full sm:flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={`Search ${totalEndpoints} endpoints...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {activeTab === "main" && (
          <p className="w-full text-xs text-muted-foreground sm:ml-auto sm:w-auto">
            Base: <code className="font-mono text-zinc-700">api.cookwithalchemy.com/v1</code>
          </p>
        )}
        {activeTab === "admin" && (
          <p className="w-full text-xs text-muted-foreground sm:ml-auto sm:w-auto">
            Base: <code className="font-mono text-zinc-700">admin.cookwithalchemy.com</code>
          </p>
        )}
      </div>

      {/* Endpoint groups */}
      <div className="space-y-3">
        {activeGroups.length === 0 && (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">
                {search ? "No endpoints match your search" : "No endpoints found"}
              </p>
            </CardContent>
          </Card>
        )}
        {activeGroups.map((group) => (
          <ResourceGroup
            key={group.label}
            group={group}
            spec={activeTab === "main" ? spec : null}
            defaultOpen={activeGroups.length <= 3 || !!search}
          />
        ))}
      </div>
    </div>
  );
}
