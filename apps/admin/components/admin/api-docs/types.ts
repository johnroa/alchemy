/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AdminRoute {
  path: string;
  method: string;
}

export interface OpenApiParam {
  name?: string;
  in?: string;
  required?: boolean;
  schema?: Record<string, unknown>;
  description?: string;
  /** $ref pointer — resolved manually from spec components */
  $ref?: string;
}

export interface OpenApiOperation {
  summary?: string;
  description?: string;
  parameters?: OpenApiParam[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: Record<string, unknown> }>;
  };
  responses?: Record<
    string,
    {
      description?: string;
      content?: Record<string, { schema?: Record<string, unknown> }>;
    }
  >;
  security?: Array<Record<string, string[]>>;
  tags?: string[];
}

/** A single endpoint (one HTTP method on one path) extracted from the spec */
export interface Endpoint {
  path: string;
  method: string;
  summary: string;
  description: string | undefined;
  parameters: ResolvedParam[];
  requestBody:
    | {
        required: boolean;
        schema: Record<string, unknown> | null;
      }
    | undefined;
  responseDescription: string;
  responseSchema: Record<string, unknown> | null;
  auth: boolean;
}

export interface ResolvedParam {
  name: string;
  in: string;
  required: boolean;
  type: string;
  description: string | undefined;
}

/** Group of endpoints sharing a resource prefix */
export interface EndpointGroup {
  label: string;
  endpoints: Endpoint[];
}

/* ------------------------------------------------------------------ */
/*  Method badge styling — consistent color coding per HTTP verb       */
/* ------------------------------------------------------------------ */

export const METHOD_COLORS: Record<string, string> = {
  GET: "bg-emerald-100 text-emerald-800 border-emerald-300",
  POST: "bg-blue-100 text-blue-800 border-blue-300",
  PUT: "bg-amber-100 text-amber-800 border-amber-300",
  PATCH: "bg-orange-100 text-orange-800 border-orange-300",
  DELETE: "bg-red-100 text-red-800 border-red-300",
};

/* ------------------------------------------------------------------ */
/*  Spec parsing helpers                                               */
/* ------------------------------------------------------------------ */

/**
 * Resolves a $ref string like "#/components/parameters/RecipeId" against
 * the root OpenAPI spec object. Returns the resolved object or undefined.
 */
export function resolveRef(
  spec: Record<string, unknown>,
  ref: string
): Record<string, unknown> | undefined {
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
export function schemaTypeLabel(schema: Record<string, unknown> | undefined): string {
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
export function parseEndpoints(spec: Record<string, unknown>): Endpoint[] {
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
      const rawParams = [
        ...((pathItem["parameters"] as OpenApiParam[]) ?? []),
        ...(op.parameters ?? []),
      ];
      const resolvedParams: ResolvedParam[] = rawParams.map((p) => {
        const resolved = p.$ref ? (resolveRef(spec, p.$ref) as OpenApiParam | undefined) : p;
        if (!resolved)
          return { name: "?", in: "?", required: false, type: "unknown", description: undefined };
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
      const successKey =
        Object.keys(op.responses ?? {}).find((k) => k.startsWith("2")) ?? "200";
      const successResp = op.responses?.[successKey];
      const respSchema =
        (successResp?.content?.["application/json"]?.schema as Record<string, unknown> | null) ??
        null;

      /* Auth: endpoint has auth unless it explicitly sets security: [] */
      const explicitSecurity = op.security;
      const auth = explicitSecurity ? explicitSecurity.length > 0 : hasGlobalAuth;

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
export function groupEndpoints(endpoints: Endpoint[]): EndpointGroup[] {
  const map = new Map<string, Endpoint[]>();
  for (const ep of endpoints) {
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
export function groupAdminRoutes(routes: AdminRoute[]): EndpointGroup[] {
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
      endpoints: eps.map(
        (r): Endpoint => ({
          path: r.path,
          method: r.method,
          summary: "",
          description: undefined,
          parameters: [],
          requestBody: undefined,
          responseDescription: "",
          responseSchema: null,
          auth: true,
        })
      ),
    }));
}
