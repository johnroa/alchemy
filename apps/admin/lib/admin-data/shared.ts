export type RegistryModel = {
  id: string;
  provider: string;
  model: string;
  display_name: string;
  input_cost_per_1m_tokens: number;
  output_cost_per_1m_tokens: number;
  billing_mode: "token" | "image";
  billing_metadata: Record<string, unknown>;
  context_window_tokens: number | null;
  max_output_tokens: number | null;
  is_available: boolean;
  notes: string | null;
};

export const COUNTABLE_TABLE_COLUMNS = {
  cookbook_entries: "user_id",
} as const;

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
