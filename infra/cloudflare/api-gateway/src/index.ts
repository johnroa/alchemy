type Env = {
  SUPABASE_FUNCTIONS_BASE_URL: string;
};

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,apikey,x-client-info"
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

  return trimmed.replace(/\/+$/, "");
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
      upstreamBase = normalizeBase(env.SUPABASE_FUNCTIONS_BASE_URL);
    } catch (error) {
      return errorEnvelope(
        500,
        "gateway_config_error",
        error instanceof Error ? error.message : "Invalid gateway configuration",
        requestId
      );
    }

    const upstreamUrl = `${upstreamBase}${url.pathname}${url.search}`;
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
