import { readJsonBody } from "@/lib/admin-http";

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

const getMagicLinkToken = async (
  supabaseUrl: string,
  serviceKey: string,
  simulationUserEmail: string,
): Promise<string> => {
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
  const accessToken = String(toRecord(verifyPayload)["access_token"] ?? "");
  if (!verifyRes.ok || accessToken.length === 0) {
    throw new Error(`Magic link verify failed (${verifyRes.status})`);
  }

  return accessToken;
};

export const getAdminSimulationBearerToken = async (): Promise<string> => {
  const configured = process.env["ADMIN_SIMULATION_BEARER_TOKEN"]?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }

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

  return await getMagicLinkToken(supabaseUrl, serviceKey, simulationUserEmail);
};
