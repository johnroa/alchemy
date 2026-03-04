const SIM_USER_EMAIL = "sim-1772428603705@cookwithalchemy.com";
const SIM_USER_PASSWORD = "AlchemySim2026";

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const readJsonBody = async (response: Response): Promise<Record<string, unknown>> => {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
};

const signInSimulationUser = async (supabaseUrl: string, serviceKey: string): Promise<string> => {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: SIM_USER_EMAIL, password: SIM_USER_PASSWORD })
  });

  const payload = await readJsonBody(response);
  const token = String(payload["access_token"] ?? "");

  if (!response.ok || token.length === 0) {
    throw new Error(`Password sign-in failed (${response.status})`);
  }

  return token;
};

const getMagicLinkToken = async (supabaseUrl: string, serviceKey: string): Promise<string> => {
  const generateRes = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: SIM_USER_EMAIL })
  });

  const generatePayload = await readJsonBody(generateRes);
  const props = generatePayload["properties"];
  const properties = props && typeof props === "object" && !Array.isArray(props)
    ? (props as Record<string, unknown>)
    : {};
  const emailOtp = String(properties["email_otp"] ?? "");

  if (!generateRes.ok || emailOtp.length === 0) {
    throw new Error(`Magic link generation failed (${generateRes.status})`);
  }

  const verifyRes = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token: emailOtp, email: SIM_USER_EMAIL })
  });

  const verifyPayload = await readJsonBody(verifyRes);
  const accessToken = String(verifyPayload["access_token"] ?? "");
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

  const supabaseUrlRaw = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "";
  const serviceKey = (process.env["SUPABASE_SECRET_KEY"] ??
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ??
    "").trim();

  const supabaseUrl = trimTrailingSlash(supabaseUrlRaw.trim());
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Provide ADMIN_SIMULATION_BEARER_TOKEN or configure NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY"
    );
  }

  try {
    return await getMagicLinkToken(supabaseUrl, serviceKey);
  } catch {
    return await signInSimulationUser(supabaseUrl, serviceKey);
  }
};
