import { requireJsonBody } from "../../_shared/errors.ts";
import {
  isFeatureFlagKey,
  normalizeFeatureFlagKey,
  type ResolveFlagsRequest,
  type ResolveFlagsResponse,
} from "../../../../packages/shared/src/feature-flags.ts";
import { resolveRuntimeFlags } from "../lib/feature-flags.ts";
import type { RouteContext } from "./shared.ts";

type ResolveRuntimeFlagsFn = typeof resolveRuntimeFlags;

export const handleFeatureFlagRoutes = async (
  context: RouteContext,
  deps: {
    resolveRuntimeFlags: ResolveRuntimeFlagsFn;
  } = {
    resolveRuntimeFlags,
  },
): Promise<Response | null> => {
  const { request, segments, method, serviceClient, respond } = context;

  if (
    segments.length !== 2 ||
    segments[0] !== "flags" ||
    segments[1] !== "resolve" ||
    method !== "POST"
  ) {
    return null;
  }

  const body = await requireJsonBody<ResolveFlagsRequest>(request);
  if (
    !Array.isArray(body.keys) ||
    body.keys.length === 0 ||
    body.keys.some((value) => typeof value !== "string")
  ) {
    return respond(400, {
      code: "invalid_flag_keys",
      message: "keys must be a non-empty array",
      request_id: context.requestId,
    });
  }

  const normalizedKeys = body.keys.map((value) => normalizeFeatureFlagKey(value));
  if (normalizedKeys.some((value) => !isFeatureFlagKey(value))) {
    return respond(400, {
      code: "invalid_flag_key",
      message:
        "Each flag key must match ^[a-z0-9][a-z0-9._-]*$ after normalization",
      request_id: context.requestId,
    });
  }

  const resolved: ResolveFlagsResponse = await deps.resolveRuntimeFlags({
    serviceClient,
    keys: normalizedKeys,
    requestUrl: request.url,
  });

  return respond(200, resolved);
};
