export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ErrorEnvelope = {
  code: string;
  message: string;
  details?: JsonValue;
  request_id: string;
};

export type RecipePayload = {
  title: string;
  description?: string;
  servings: number;
  ingredients: Array<{
    name: string;
    amount: number;
    unit: string;
    preparation?: string;
  }>;
  steps: Array<{
    index: number;
    instruction: string;
    timer_seconds?: number;
    notes?: string;
  }>;
  notes?: string;
  pairings?: string[];
};

export type GatewayScope = "generate" | "tweak" | "classify" | "image";

export type GatewayConfig = {
  promptTemplate: string;
  rule: Record<string, JsonValue>;
  provider: string;
  model: string;
  modelConfig: Record<string, JsonValue>;
};
