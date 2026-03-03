type Env = {
  SUPABASE_FUNCTIONS_BASE_URL?: string;
  SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_PROJECT_REF?: string;
};

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,apikey,x-client-info,x-sim-model-overrides"
};

const errorEnvelope = (status: number, code: string, message: string, requestId: string) =>
  new Response(
    JSON.stringify({
      code,
      message,
      request_id: requestId
    }),
    {
      status,
      headers: {
        "content-type": "application/json",
        ...corsHeaders
      }
    }
  );

const normalizeBase = (value: string | undefined): string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error("Missing SUPABASE_FUNCTIONS_BASE_URL");
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("SUPABASE_FUNCTIONS_BASE_URL must be an absolute URL");
  }

  const parsed = new URL(trimmed);
  const pathname = parsed.pathname.replace(/\/+$/, "");

  if (pathname.endsWith("/functions/v1/v1")) {
    return `${parsed.origin}/functions/v1/v1`;
  }

  if (pathname.endsWith("/functions/v1")) {
    return `${parsed.origin}/functions/v1/v1`;
  }

  if (parsed.host.endsWith(".functions.supabase.co")) {
    if (pathname.endsWith("/v1/v1")) {
      return `${parsed.origin}/v1/v1`;
    }
    if (pathname.endsWith("/v1")) {
      return `${parsed.origin}/v1/v1`;
    }
    return `${parsed.origin}/v1/v1`;
  }

  if (parsed.host.endsWith(".supabase.co")) {
    return `${parsed.origin}/functions/v1/v1`;
  }

  return `${parsed.origin}${pathname}/functions/v1/v1`;
};

const inferFunctionsBaseFromSupabaseUrl = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    const projectRef = parsed.host.split(".")[0];
    if (!projectRef) {
      return null;
    }
    return `https://${projectRef}.supabase.co/functions/v1/v1`;
  } catch {
    return null;
  }
};

const resolveUpstreamBase = (env: Env): string => {
  if (env.SUPABASE_FUNCTIONS_BASE_URL?.trim()) {
    return normalizeBase(env.SUPABASE_FUNCTIONS_BASE_URL);
  }

  const inferredFromUrl =
    inferFunctionsBaseFromSupabaseUrl(env.SUPABASE_URL) ??
    inferFunctionsBaseFromSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL) ??
    inferFunctionsBaseFromSupabaseUrl(env.EXPO_PUBLIC_SUPABASE_URL);

  if (inferredFromUrl) {
    return inferredFromUrl;
  }

  const projectRef = env.SUPABASE_PROJECT_REF?.trim();
  if (projectRef) {
    return `https://${projectRef}.supabase.co/functions/v1/v1`;
  }

  throw new Error(
    "Missing SUPABASE_FUNCTIONS_BASE_URL (or SUPABASE_URL / SUPABASE_PROJECT_REF for fallback resolution)"
  );
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    if (!url.pathname.startsWith("/v1")) {
      return errorEnvelope(404, "not_found", "Path must start with /v1", requestId);
    }

    let upstreamBase: string;
    try {
      upstreamBase = resolveUpstreamBase(env);
    } catch (error) {
      return errorEnvelope(
        500,
        "gateway_config_error",
        error instanceof Error ? error.message : "Invalid gateway configuration",
        requestId
      );
    }

    const upstreamPath = url.pathname.replace(/^\/v1/, "");
    const normalizedUpstreamPath = upstreamPath.startsWith("/") ? upstreamPath : `/${upstreamPath}`;
    const upstreamUrl = `${upstreamBase}${normalizedUpstreamPath}${url.search}`;
    const upstreamRequest = new Request(upstreamUrl, request);
    const upstreamResponse = await fetch(upstreamRequest);

    const headers = new Headers(upstreamResponse.headers);
    for (const [key, value] of Object.entries(corsHeaders)) {
      headers.set(key, value);
    }
    headers.set("x-request-id", requestId);

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers
    });
  }
};
