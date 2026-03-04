import type { JsonValue } from "./types.ts";

const OUTPUT_ERROR_DETAIL_MAX_CHARS = 6_000;

export const truncateErrorDetailText = (value: string): string => {
  if (value.length <= OUTPUT_ERROR_DETAIL_MAX_CHARS) {
    return value;
  }
  return value.slice(0, OUTPUT_ERROR_DETAIL_MAX_CHARS);
};

export const normalizeTextValue = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const withValue = value as { value?: unknown };
    if (
      typeof withValue.value === "string" && withValue.value.trim().length > 0
    ) {
      return withValue.value;
    }
  }

  return null;
};

export const extractFirstJsonValue = (text: string): string | null => {
  let inString = false;
  let escaped = false;
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{" || char === "[") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }

    if (char === "}" || char === "]") {
      if (depth > 0) {
        depth -= 1;
      }

      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
};

export const parseJsonFromText = (
  raw: string,
): Record<string, JsonValue> | null => {
  const directAttempt = raw.trim();
  if (directAttempt.length === 0) {
    return null;
  }

  const attempts: string[] = [directAttempt];

  const fenced = directAttempt
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  if (fenced.length > 0 && fenced !== directAttempt) {
    attempts.push(fenced);
  }

  const fencedBlockMatch = directAttempt.match(
    /```(?:json)?\s*([\s\S]*?)```/i,
  );
  if (fencedBlockMatch?.[1]) {
    const fencedBlock = fencedBlockMatch[1].trim();
    if (fencedBlock.length > 0) {
      attempts.push(fencedBlock);
    }
  }

  const extracted = extractFirstJsonValue(directAttempt);
  if (extracted && extracted !== directAttempt) {
    attempts.push(extracted);
  }

  if (fenced.length > 0) {
    const extractedFromFenced = extractFirstJsonValue(fenced);
    if (extractedFromFenced && extractedFromFenced !== fenced) {
      attempts.push(extractedFromFenced);
    }
  }

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, JsonValue>;
      }

      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = parsed[0];
        if (first && typeof first === "object" && !Array.isArray(first)) {
          return first as Record<string, JsonValue>;
        }
      }
    } catch {
      // continue
    }
  }

  return null;
};

export const parseResponseOutputJson = (
  payload: unknown,
): Record<string, JsonValue> | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const withOutputArray = payload as {
    output?: Array<{
      json?: unknown;
      parsed?: unknown;
      content?: Array<{ json?: unknown; parsed?: unknown }>;
    }>;
  };

  if (Array.isArray(withOutputArray.output)) {
    for (const outputItem of withOutputArray.output) {
      if (!outputItem || typeof outputItem !== "object") {
        continue;
      }

      if (
        outputItem.json && typeof outputItem.json === "object" &&
        !Array.isArray(outputItem.json)
      ) {
        return outputItem.json as Record<string, JsonValue>;
      }

      if (
        outputItem.parsed && typeof outputItem.parsed === "object" &&
        !Array.isArray(outputItem.parsed)
      ) {
        return outputItem.parsed as Record<string, JsonValue>;
      }

      if (Array.isArray(outputItem.content)) {
        for (const contentItem of outputItem.content) {
          if (!contentItem || typeof contentItem !== "object") {
            continue;
          }

          if (
            contentItem.json && typeof contentItem.json === "object" &&
            !Array.isArray(contentItem.json)
          ) {
            return contentItem.json as Record<string, JsonValue>;
          }

          if (Array.isArray(contentItem.json) && contentItem.json.length > 0) {
            const first = contentItem.json[0];
            if (first && typeof first === "object" && !Array.isArray(first)) {
              return first as Record<string, JsonValue>;
            }
          }

          if (
            contentItem.parsed && typeof contentItem.parsed === "object" &&
            !Array.isArray(contentItem.parsed)
          ) {
            return contentItem.parsed as Record<string, JsonValue>;
          }

          if (
            Array.isArray(contentItem.parsed) && contentItem.parsed.length > 0
          ) {
            const first = contentItem.parsed[0];
            if (first && typeof first === "object" && !Array.isArray(first)) {
              return first as Record<string, JsonValue>;
            }
          }
        }
      }
    }
  }

  const withChoices = payload as {
    choices?: Array<{ message?: { content?: unknown; parsed?: unknown } }>;
  };

  const parsed = withChoices.choices?.[0]?.message?.parsed;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, JsonValue>;
  }

  if (Array.isArray(parsed) && parsed.length > 0) {
    const first = parsed[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      return first as Record<string, JsonValue>;
    }
  }

  const messageContent = withChoices.choices?.[0]?.message?.content;
  if (
    messageContent && typeof messageContent === "object" &&
    !Array.isArray(messageContent)
  ) {
    return messageContent as Record<string, JsonValue>;
  }

  return null;
};

export const parseResponseOutputText = (payload: unknown): string | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const withOutputText = payload as { output_text?: unknown };
  const topLevelOutputText = normalizeTextValue(withOutputText.output_text);
  if (topLevelOutputText) {
    return topLevelOutputText;
  }

  const withOutputArray = payload as {
    output?: Array<{
      content?: Array<{ type?: string; text?: unknown }>;
      type?: string;
      text?: unknown;
      output_text?: unknown;
    }>;
  };

  if (Array.isArray(withOutputArray.output)) {
    const parts: string[] = [];

    for (const outputItem of withOutputArray.output) {
      if (!outputItem || typeof outputItem !== "object") {
        continue;
      }

      if (Array.isArray(outputItem.content)) {
        for (const contentItem of outputItem.content) {
          if (!contentItem || typeof contentItem !== "object") {
            continue;
          }

          const contentText = normalizeTextValue(contentItem.text) ??
            normalizeTextValue(
              (contentItem as { output_text?: unknown }).output_text,
            );

          if (
            (contentItem.type === "output_text" ||
              contentItem.type === "text" ||
              typeof contentItem.type === "undefined") &&
            contentText
          ) {
            parts.push(contentText);
          }

          const contentJson = (contentItem as { json?: unknown }).json;
          if (
            contentJson && typeof contentJson === "object" &&
            !Array.isArray(contentJson)
          ) {
            parts.push(JSON.stringify(contentJson));
          }
        }
      } else {
        const outputText = normalizeTextValue(outputItem.text) ??
          normalizeTextValue(outputItem.output_text);
        if (outputText) {
          parts.push(outputText);
        }
      }

      const outputJson = (outputItem as { json?: unknown }).json;
      if (
        outputJson && typeof outputJson === "object" &&
        !Array.isArray(outputJson)
      ) {
        parts.push(JSON.stringify(outputJson));
      }
    }

    if (parts.length > 0) {
      return parts.join("\n");
    }
  }

  const withChoices = payload as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };

  const choiceContent = withChoices.choices?.[0]?.message?.content;
  const normalizedChoiceContent = normalizeTextValue(choiceContent);
  if (normalizedChoiceContent) {
    return normalizedChoiceContent;
  }

  if (Array.isArray(choiceContent)) {
    const parts = choiceContent
      .map((part) =>
        normalizeTextValue((part as { text?: unknown }).text) ??
          normalizeTextValue(part)
      )
      .filter((part): part is string => Boolean(part));

    if (parts.length > 0) {
      return parts.join("\n");
    }
  }

  const collectKnownOutputText = (value: unknown, parts: string[]): void => {
    if (!value) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        collectKnownOutputText(item, parts);
      }
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    const record = value as Record<string, unknown>;
    const directCandidates = [
      record.output_text,
      record.text,
      record.refusal,
      record.arguments,
    ];

    for (const candidate of directCandidates) {
      const text = normalizeTextValue(candidate);
      if (text) {
        parts.push(text);
      }
    }

    if (Array.isArray(record.summary)) {
      collectKnownOutputText(record.summary, parts);
    }
    if (Array.isArray(record.content)) {
      collectKnownOutputText(record.content, parts);
    }
    if (Array.isArray(record.output)) {
      collectKnownOutputText(record.output, parts);
    }
    if (record.message && typeof record.message === "object") {
      collectKnownOutputText(record.message, parts);
    }
  };

  const fallbackParts: string[] = [];
  collectKnownOutputText(payload, fallbackParts);
  if (fallbackParts.length > 0) {
    return fallbackParts.join("\n");
  }

  return null;
};
