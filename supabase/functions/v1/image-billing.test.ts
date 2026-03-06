import { ApiError } from "../_shared/errors.ts";
import { estimateImageGenerationCostUsd } from "../_shared/image-billing.ts";
import type { GatewayConfig } from "../_shared/types.ts";

const buildImageConfig = (
  overrides: Partial<GatewayConfig>,
): GatewayConfig => ({
  promptTemplate: "prompt",
  rule: {},
  provider: "openai",
  model: "gpt-image-1.5",
  modelConfig: {},
  inputCostPer1m: 5,
  outputCostPer1m: 0,
  billingMode: "image",
  billingMetadata: {},
  ...overrides,
});

Deno.test("estimateImageGenerationCostUsd resolves OpenAI size and quality matrix", () => {
  const cost = estimateImageGenerationCostUsd(
    buildImageConfig({
      modelConfig: {
        quality: "high",
        size: "1536x1024",
      },
      billingMetadata: {
        pricing_type: "openai_image_quality_size",
        image_rates_usd: {
          high: {
            "1536x1024": 0.25,
          },
        },
      },
    }),
  );

  if (cost !== 0.25) {
    throw new Error(`unexpected image cost: ${String(cost)}`);
  }
});

Deno.test("estimateImageGenerationCostUsd resolves flat image pricing", () => {
  const cost = estimateImageGenerationCostUsd(
    buildImageConfig({
      provider: "google",
      model: "gemini-2.5-flash-image",
      billingMetadata: {
        pricing_type: "flat_image",
        cost_per_image_usd: 0.039,
      },
    }),
  );

  if (cost !== 0.039) {
    throw new Error(`unexpected flat image cost: ${String(cost)}`);
  }
});

Deno.test("estimateImageGenerationCostUsd rejects unsupported billing mode", () => {
  let thrown: unknown = null;
  try {
    estimateImageGenerationCostUsd(
      buildImageConfig({
        billingMode: "token",
      }),
    );
  } catch (error) {
    thrown = error;
  }

  if (!(thrown instanceof ApiError)) {
    throw new Error("expected ApiError");
  }
  if (thrown.code !== "image_billing_mode_invalid") {
    throw new Error(`unexpected error code: ${thrown.code}`);
  }
});
