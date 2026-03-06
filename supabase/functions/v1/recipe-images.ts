export const TEMP_RECIPE_PLACEHOLDER_IMAGE_URL =
  "https://www.eatingwell.com/thmb/AADqyJzanmxhohPE6ieAi4okuQo=/1500x0/filters:no_upscale():max_bytes(150000):strip_icc()/Extra-CrispyEggplantParmesan-Beauty-01-89d65a140a3640e3aba7b80ad8865dba.jpg";

const normalizeText = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export const resolveRecipeImageUrl = (
  value: string | null | undefined,
): string => {
  return normalizeText(value) ?? TEMP_RECIPE_PLACEHOLDER_IMAGE_URL;
};

export const resolveRecipeImageStatus = (
  imageUrl: string | null | undefined,
  status: string | null | undefined,
): "pending" | "ready" | "failed" => {
  const normalizedStatus = normalizeText(status);
  if (normalizeText(imageUrl)) {
    return normalizedStatus === "failed" || normalizedStatus === "pending"
      ? normalizedStatus
      : "ready";
  }

  return "ready";
};
