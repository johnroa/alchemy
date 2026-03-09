import type { components } from "@alchemy/contracts";
import type { ErrorEnvelope } from "@alchemy/shared/index";
import { siteConfig } from "@/lib/env";

export type PublicRecipe = components["schemas"]["Recipe"];

const parseErrorEnvelope = async (response: Response): Promise<ErrorEnvelope | null> => {
  try {
    const payload = await response.json();
    if (
      payload &&
      typeof payload === "object" &&
      "code" in payload &&
      "message" in payload &&
      "request_id" in payload
    ) {
      return payload as ErrorEnvelope;
    }
  } catch {
    return null;
  }

  return null;
};

export const getPublicRecipe = async (id: string): Promise<PublicRecipe | null> => {
  const response = await fetch(`${siteConfig.apiBaseUrl}/recipes/${encodeURIComponent(id)}`, {
    next: { revalidate: 300 },
    headers: {
      accept: "application/json"
    }
  });

  if (response.ok) {
    return response.json() as Promise<PublicRecipe>;
  }

  const errorEnvelope = await parseErrorEnvelope(response);
  if (
    response.status === 404 ||
    response.status === 403 ||
    errorEnvelope?.code === "recipe_not_found" ||
    errorEnvelope?.code === "recipe_forbidden"
  ) {
    return null;
  }

  throw new Error(
    errorEnvelope?.message ?? `Recipe fetch failed with status ${response.status}`
  );
};
