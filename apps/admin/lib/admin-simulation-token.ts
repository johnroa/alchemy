import { readJsonBody } from "./admin-http";
import { createCachedBearerTokenProvider, type CachedBearerToken } from "./simulation-token-cache";

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const toRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const extractMagicLinkOtp = (payload: unknown): string => {
  const record = toRecord(payload);
  const properties = toRecord(record["properties"]);
  const otp = record["email_otp"] ?? properties["email_otp"];
  return typeof otp === "string" ? otp.trim() : "";
};

const decodeBase64Url = (value: string): string => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
};

const extractJwtExpiryMs = (token: string): number | null => {
  const [, payload] = token.split(".");
  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as Record<string, unknown>;
    const exp = parsed["exp"];
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
};

const extractAccessToken = (payload: unknown): CachedBearerToken => {
  const record = toRecord(payload);
  const accessToken = typeof record["access_token"] === "string" ? record["access_token"].trim() : "";
  if (accessToken.length === 0) {
    throw new Error("Magic link verify response missing access_token");
  }

  const expiresInRaw = record["expires_in"];
  if (typeof expiresInRaw === "number" && Number.isFinite(expiresInRaw) && expiresInRaw > 0) {
    return {
      accessToken,
      expiresAt: Date.now() + (expiresInRaw * 1000),
    };
  }

  return {
    accessToken,
    expiresAt: extractJwtExpiryMs(accessToken) ?? (Date.now() + (55 * 60 * 1000)),
  };
};

const fetchMagicLinkToken = async (
  supabaseUrl: string,
  serviceKey: string,
  simulationUserEmail: string,
): Promise<CachedBearerToken> => {
  const generateRes = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: simulationUserEmail })
  });

  const generatePayload = await readJsonBody(generateRes);
  const emailOtp = extractMagicLinkOtp(generatePayload);

  if (!generateRes.ok || emailOtp.length === 0) {
    throw new Error(`Magic link generation failed (${generateRes.status})`);
  }

  const verifyRes = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token: emailOtp, email: simulationUserEmail })
  });

  const verifyPayload = await readJsonBody(verifyRes);
  if (!verifyRes.ok) {
    throw new Error(`Magic link verify failed (${verifyRes.status})`);
  }

  return extractAccessToken(verifyPayload);
};

const getCachedMagicLinkToken = createCachedBearerTokenProvider(async () => {
  const simulationUserEmail = process.env["ADMIN_SIMULATION_USER_EMAIL"]?.trim() ?? "";
  const supabaseUrlRaw = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "";
  const serviceKey = (process.env["SUPABASE_SECRET_KEY"] ??
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ??
    "").trim();

  const supabaseUrl = trimTrailingSlash(supabaseUrlRaw.trim());
  if (!simulationUserEmail || !supabaseUrl || !serviceKey) {
    throw new Error(
      "Provide ADMIN_SIMULATION_BEARER_TOKEN or configure ADMIN_SIMULATION_USER_EMAIL + NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY"
    );
  }

  return await fetchMagicLinkToken(supabaseUrl, serviceKey, simulationUserEmail);
});

export const getAdminSimulationBearerToken = async (): Promise<string> => {
  const configured = process.env["ADMIN_SIMULATION_BEARER_TOKEN"]?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }

  return await getCachedMagicLinkToken();
};
