import { NextResponse } from "next/server";

type ProxyRequestParams = {
  apiBase: string;
  token: string;
  path: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  errorMessage: string;
  headers?: Record<string, string>;
};

/**
 * Reads a JSON response body without assuming every upstream failure returns an
 * object. The proxy routes surface raw payloads in error details, so callers
 * need the original text when JSON parsing fails.
 */
export const readJsonBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

/**
 * Shared JSON proxy for admin worker routes that forward authenticated calls to
 * the public API. Centralizing this keeps status handling and error envelopes
 * consistent across the process/retry endpoints.
 */
export const proxyJsonRequest = async ({
  apiBase,
  token,
  path,
  method = "GET",
  body,
  errorMessage,
  headers,
}: ProxyRequestParams): Promise<NextResponse> => {
  const requestHeaders: Record<string, string> = {
    authorization: `Bearer ${token}`,
    ...headers,
  };

  if (body !== undefined) {
    requestHeaders["content-type"] = "application/json";
  }

  const requestInit: RequestInit = {
    method,
    headers: requestHeaders,
  };
  if (body !== undefined) {
    requestInit.body = JSON.stringify(body);
  }

  const response = await fetch(`${apiBase}${path}`, requestInit);

  const payload = await readJsonBody(response);
  if (!response.ok) {
    return NextResponse.json(
      {
        error: errorMessage,
        details: payload,
      },
      { status: response.status },
    );
  }

  return NextResponse.json(payload);
};
