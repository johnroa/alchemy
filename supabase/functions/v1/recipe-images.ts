const normalizeText = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export const resolveRecipeImageUrl = (
  value: string | null | undefined,
): string | null => {
  return normalizeText(value);
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

  return normalizedStatus === "failed" ? "failed" : "pending";
};
