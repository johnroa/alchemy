import type { ErrorEnvelope, JsonValue } from "./types.ts";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: JsonValue;

  constructor(status: number, code: string, message: string, details?: JsonValue) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const jsonResponse = (status: number, body: unknown): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    }
  });
};

export const errorResponse = (requestId: string, error: unknown): Response => {
  if (error instanceof ApiError) {
    const payload: ErrorEnvelope = {
      code: error.code,
      message: error.message,
      details: error.details,
      request_id: requestId
    };
    return jsonResponse(error.status, payload);
  }

  const details =
    error instanceof Error
      ? { name: error.name, message: error.message }
      : typeof error === "string"
        ? { message: error }
        : undefined;

  const payload: ErrorEnvelope = {
    code: "internal_error",
    message: "Unexpected server error",
    details,
    request_id: requestId
  };
  return jsonResponse(500, payload);
};

export const requireJsonBody = async <T>(request: Request): Promise<T> => {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Expected application/json request body");
  }

  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError(400, "invalid_json", "Request body is not valid JSON");
  }
};
