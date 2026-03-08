import { normalizeDelimitedToken } from "../../../../packages/shared/src/text-normalization.ts";
import {
  normalizeRecipeSemanticProfile,
  type RecipeSemanticDescriptor,
  type RecipeSemanticProfile,
  type SuggestedChip,
} from "../../../../packages/shared/src/recipe-semantics.ts";
import type { JsonValue, RecipePayload } from "../../_shared/types.ts";
import { canonicalizeRecipePayloadMetadata } from "../recipe-preview.ts";

const normalizeLabel = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const items: string[] = [];

  for (const entry of value) {
    const normalized = normalizeLabel(entry);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push(normalized);
  }

  return items;
};

const titleCaseToken = (value: string): string =>
  value
    .split(/[-_\s]+/)
    .filter((item) => item.length > 0)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(" ");

const descriptorFromAxisValue = (input: {
  axis: string;
  label: string;
  confidence: number;
}): RecipeSemanticDescriptor => {
  const axis = normalizeDelimitedToken(input.axis);
  const key = normalizeDelimitedToken(input.label);
  return {
    id: `${axis}:${key}`,
    axis,
    key,
    label: input.label,
    confidence: input.confidence,
  };
};

export const buildFallbackSemanticProfile = (
  metadata: Record<string, JsonValue> | undefined,
): RecipeSemanticProfile | undefined => {
  if (!metadata) {
    return undefined;
  }

  const descriptors = new Map<string, RecipeSemanticDescriptor>();
  const addDescriptor = (axis: string, label: string, confidence = 0.82) => {
    const descriptor = descriptorFromAxisValue({ axis, label, confidence });
    const existing = descriptors.get(descriptor.id);
    if (!existing || existing.confidence < descriptor.confidence) {
      descriptors.set(descriptor.id, descriptor);
    }
  };

  for (const label of normalizeStringList(metadata.cuisine_tags)) {
    addDescriptor("cuisine", label);
  }
  for (const label of normalizeStringList(metadata.cuisine)) {
    addDescriptor("cuisine", label);
  }
  for (const label of normalizeStringList(metadata.occasion_tags)) {
    addDescriptor("occasion", label);
  }
  for (const label of normalizeStringList(metadata.health_flags)) {
    addDescriptor("health", label);
  }
  for (const label of normalizeStringList(metadata.diet_tags)) {
    addDescriptor("diet", label);
  }
  for (const label of normalizeStringList(metadata.techniques)) {
    addDescriptor("technique", label);
  }
  for (const label of normalizeStringList(metadata.seasonality)) {
    addDescriptor("season", label);
  }
  for (const label of normalizeStringList(metadata.equipment)) {
    addDescriptor("equipment", label);
  }

  const vibe = normalizeLabel(metadata.vibe);
  if (vibe) {
    addDescriptor("mood", vibe);
  }

  const courseType = normalizeLabel(metadata.course_type);
  if (courseType) {
    addDescriptor("course", courseType);
  }

  const difficulty = normalizeLabel(metadata.difficulty);
  if (difficulty) {
    addDescriptor("effort", titleCaseToken(difficulty));
  }

  if (descriptors.size === 0) {
    return undefined;
  }

  return {
    descriptors: [...descriptors.values()].sort((left, right) => {
      if (left.axis !== right.axis) {
        return left.axis.localeCompare(right.axis);
      }
      return left.label.localeCompare(right.label);
    }),
  };
};

export const extractSemanticProfileFromMetadata = (
  metadata: Record<string, JsonValue> | undefined,
): RecipeSemanticProfile | undefined => {
  const explicitProfile = normalizeRecipeSemanticProfile(
    metadata?.semantic_profile,
  );
  return explicitProfile ?? buildFallbackSemanticProfile(metadata);
};

export const extractSemanticProfileFromPayload = (
  payload: RecipePayload | undefined,
): RecipeSemanticProfile | undefined => {
  if (!payload) {
    return undefined;
  }

  const metadata = canonicalizeRecipePayloadMetadata(payload);
  return extractSemanticProfileFromMetadata(metadata);
};

export const mergeSemanticProfiles = (
  base: RecipeSemanticProfile | undefined,
  overlay: RecipeSemanticProfile | undefined,
): RecipeSemanticProfile | undefined => {
  const descriptorById = new Map<string, RecipeSemanticDescriptor>();

  for (const source of [base, overlay]) {
    for (const descriptor of source?.descriptors ?? []) {
      const existing = descriptorById.get(descriptor.id);
      if (!existing || descriptor.confidence >= existing.confidence) {
        descriptorById.set(descriptor.id, descriptor);
      }
    }
  }

  if (descriptorById.size === 0) {
    return undefined;
  }

  return {
    descriptors: [...descriptorById.values()].sort((left, right) => {
      if (left.axis !== right.axis) {
        return left.axis.localeCompare(right.axis);
      }
      return left.label.localeCompare(right.label);
    }),
  };
};

export const buildMatchedChipIds = (params: {
  profile: RecipeSemanticProfile | undefined;
  chips: SuggestedChip[];
}): string[] => {
  if (!params.profile || params.chips.length === 0) {
    return [];
  }

  const descriptorIds = new Set(
    params.profile.descriptors.map((descriptor) => descriptor.id),
  );
  return params.chips
    .map((chip) => chip.id)
    .filter((chipId) => descriptorIds.has(chipId));
};

export const buildSuggestedChips = (params: {
  items: Array<{
    item_id: string;
    profile: RecipeSemanticProfile | undefined;
  }>;
  maxChips?: number;
}): SuggestedChip[] => {
  const maxChips = Number.isFinite(Number(params.maxChips))
    ? Math.max(1, Math.min(48, Number(params.maxChips)))
    : 28;

  const bucketByAxis = new Map<
    string,
    Array<{
      chip: SuggestedChip;
      averageConfidence: number;
    }>
  >();
  const aggregate = new Map<
    string,
    {
      label: string;
      axis: string;
      matchedIds: Set<string>;
      confidenceTotal: number;
      confidenceCount: number;
    }
  >();

  for (const item of params.items) {
    const seenForItem = new Set<string>();
    for (const descriptor of item.profile?.descriptors ?? []) {
      if (seenForItem.has(descriptor.id)) {
        continue;
      }
      seenForItem.add(descriptor.id);

      const next = aggregate.get(descriptor.id) ?? {
        label: descriptor.label,
        axis: descriptor.axis,
        matchedIds: new Set<string>(),
        confidenceTotal: 0,
        confidenceCount: 0,
      };
      next.matchedIds.add(item.item_id);
      next.confidenceTotal += descriptor.confidence;
      next.confidenceCount += 1;
      aggregate.set(descriptor.id, next);
    }
  }

  for (const [chipId, entry] of aggregate.entries()) {
    const averageConfidence = entry.confidenceCount > 0
      ? entry.confidenceTotal / entry.confidenceCount
      : 0;
    const bucket = bucketByAxis.get(entry.axis) ?? [];
    bucket.push({
      chip: {
        id: chipId,
        label: entry.label,
        matched_count: entry.matchedIds.size,
      },
      averageConfidence,
    });
    bucketByAxis.set(entry.axis, bucket);
  }

  const sortedBuckets = [...bucketByAxis.entries()]
    .map(([axis, entries]) => ({
      axis,
      entries: entries.sort((left, right) => {
        if (right.chip.matched_count !== left.chip.matched_count) {
          return right.chip.matched_count - left.chip.matched_count;
        }
        if (right.averageConfidence !== left.averageConfidence) {
          return right.averageConfidence - left.averageConfidence;
        }
        return left.chip.label.localeCompare(right.chip.label);
      }),
    }))
    .sort((left, right) => {
      const leftTop = left.entries[0]?.chip.matched_count ?? 0;
      const rightTop = right.entries[0]?.chip.matched_count ?? 0;
      if (rightTop !== leftTop) {
        return rightTop - leftTop;
      }
      return left.axis.localeCompare(right.axis);
    });

  const result: SuggestedChip[] = [];
  let cursor = 0;

  while (result.length < maxChips) {
    let appended = false;

    for (const bucket of sortedBuckets) {
      const entry = bucket.entries[cursor];
      if (!entry) {
        continue;
      }
      result.push(entry.chip);
      appended = true;
      if (result.length >= maxChips) {
        break;
      }
    }

    if (!appended) {
      break;
    }
    cursor += 1;
  }

  return result;
};
