/**
 * Low-level routing and error-classification helpers used by the main
 * request dispatcher. Handles path normalisation, query-string parsing,
 * UUID validation, and heuristic detection of Postgres schema-cache /
 * RLS errors so callers can degrade gracefully for optional capabilities.
 */

import { ApiError } from "../../_shared/errors.ts";

export const normalizePath = (pathname: string): string[] => {
  const withoutFnPrefix = pathname.replace(/^\/functions\/v1/, "");
  const withoutApiPrefix = withoutFnPrefix.startsWith("/v1")
    ? withoutFnPrefix.slice(3)
    : withoutFnPrefix;

  return withoutApiPrefix.split("/").filter(Boolean);
};

export const getLimit = (url: URL, fallback: number): number => {
  const raw = url.searchParams.get("limit");
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, 100);
};

export const parseUuid = (value: string): string => {
  if (!value || !/^[0-9a-fA-F-]{36}$/.test(value)) {
    throw new ApiError(400, "invalid_uuid", "Expected UUID value");
  }

  return value;
};

export const isSchemaMissingError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message = (error as { message?: string }).message?.toLowerCase() ?? "";
  const code = (error as { code?: string }).code?.toLowerCase() ?? "";

  return (
    message.includes("could not find the table") ||
    message.includes("not found in the schema cache") ||
    message.includes("schema cache") ||
    message.includes("does not exist") ||
    message.includes("undefined column") ||
    code === "42p01" ||
    code === "42703"
  );
};

export const isRlsError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message = (error as { message?: string }).message?.toLowerCase() ?? "";
  const code = (error as { code?: string }).code?.toLowerCase() ?? "";
  return code === "42501" || message.includes("row-level security");
};

export const isOptionalSemanticCapabilityUnavailable = (error: unknown): boolean => {
  return isSchemaMissingError(error) || isRlsError(error);
};
