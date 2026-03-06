import { ApiError } from "./errors.ts";
import type { GatewayConfig, JsonValue } from "./types.ts";

const toRecord = (value: unknown): Record<string, JsonValue> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, JsonValue>;
};

const toFiniteNumber = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const getImageRateRecord = (
  metadata: Record<string, JsonValue>,
  quality: string,
): Record<string, JsonValue> => {
  const rates = toRecord(metadata.image_rates_usd);
  const byQuality = toRecord(rates[quality]);
  if (Object.keys(byQuality).length === 0) {
    throw new ApiError(
      500,
      "image_billing_metadata_invalid",
      `Missing image billing rate table for quality: ${quality}`,
    );
  }
  return byQuality;
};

export const estimateImageGenerationCostUsd = (
  config: GatewayConfig,
): number => {
  if (config.billingMode !== "image") {
    throw new ApiError(
      500,
      "image_billing_mode_invalid",
      `Image generation scope requires image billing metadata, received: ${config.billingMode}`,
    );
  }

  const metadata = toRecord(config.billingMetadata);
  const pricingType = typeof metadata.pricing_type === "string"
    ? metadata.pricing_type
    : "";

  if (pricingType === "flat_image") {
    const flatCost = toFiniteNumber(metadata.cost_per_image_usd);
    if (flatCost === null || flatCost < 0) {
      throw new ApiError(
        500,
        "image_billing_metadata_invalid",
        "Flat image billing requires cost_per_image_usd",
      );
    }
    return Number(flatCost.toFixed(6));
  }

  if (pricingType === "openai_image_quality_size") {
    const defaultQuality = typeof metadata.default_quality === "string"
      ? metadata.default_quality
      : "high";
    const defaultSize = typeof metadata.default_size === "string"
      ? metadata.default_size
      : "1536x1024";
    const quality = typeof config.modelConfig.quality === "string"
      ? config.modelConfig.quality
      : defaultQuality;
    const size = typeof config.modelConfig.size === "string"
      ? config.modelConfig.size
      : defaultSize;
    const ratesBySize = getImageRateRecord(metadata, quality);
    const cost = toFiniteNumber(ratesBySize[size]);
    if (cost === null || cost < 0) {
      throw new ApiError(
        500,
        "image_billing_metadata_invalid",
        `Missing image billing rate for quality=${quality} size=${size}`,
      );
    }
    return Number(cost.toFixed(6));
  }

  throw new ApiError(
    500,
    "image_billing_metadata_invalid",
    `Unsupported image billing pricing_type: ${pricingType || "unknown"}`,
  );
};
