import { normalizeDelimitedToken } from "../../../packages/shared/src/text-normalization.ts";

export type OntologyCatalogTerm = {
  term_type: string;
  term_key: string;
  label: string;
  usage_count?: number;
};

export type OntologyTermCandidate = {
  term_type: string;
  term_key?: string;
  label?: string;
  relation_type?: string;
};

export type CanonicalOntologyTerm = {
  term_type: string;
  term_key: string;
  label: string;
};

type CanonicalCatalogTerm = CanonicalOntologyTerm & {
  usage_count: number;
};

const normalizeOntologyToken = (value: string): string =>
  normalizeDelimitedToken(value);

const normalizeLabelKey = (value: string): string =>
  normalizeOntologyToken(value).replace(/_+/g, "_");

const humanizeOntologyKey = (value: string): string =>
  value
    .split("_")
    .filter((token) => token.length > 0)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");

const singularizeToken = (value: string): string => {
  if (value.length <= 3) {
    return value;
  }

  if (value.endsWith("ies") && value.length > 4) {
    return `${value.slice(0, -3)}y`;
  }

  if (
    value.endsWith("s") &&
    !value.endsWith("ss") &&
    !value.endsWith("us") &&
    !value.endsWith("is")
  ) {
    return value.slice(0, -1);
  }

  return value;
};

export const singularizeOntologyKey = (value: string): string => {
  const normalized = normalizeOntologyToken(value);
  if (!normalized) {
    return "";
  }

  return normalized
    .split("_")
    .map((token) => singularizeToken(token))
    .join("_");
};

const compareCatalogPreference = (
  left: CanonicalCatalogTerm,
  right: CanonicalCatalogTerm,
): number => {
  if (left.usage_count !== right.usage_count) {
    return right.usage_count - left.usage_count;
  }

  if (left.term_key.length !== right.term_key.length) {
    return left.term_key.length - right.term_key.length;
  }

  if (left.label.length !== right.label.length) {
    return left.label.length - right.label.length;
  }

  return left.term_key.localeCompare(right.term_key);
};

const pickPreferredCatalogTerm = (
  current: CanonicalCatalogTerm | undefined,
  candidate: CanonicalCatalogTerm,
): CanonicalCatalogTerm => {
  if (!current) {
    return candidate;
  }

  return compareCatalogPreference(candidate, current) < 0 ? candidate : current;
};

const resolveDietKey = (
  normalizedKey: string,
  normalizedLabel: string,
  dietTags: Set<string>,
): string | null => {
  if (dietTags.size === 0) {
    return null;
  }

  if (dietTags.has(normalizedKey)) {
    return normalizedKey;
  }

  if (normalizedLabel && dietTags.has(normalizedLabel)) {
    return normalizedLabel;
  }

  const tags = Array.from(dietTags).sort((left, right) =>
    right.length - left.length
  );

  for (const candidate of tags) {
    if (
      normalizedKey.startsWith(`${candidate}_`) ||
      normalizedKey.endsWith(`_${candidate}`) ||
      normalizedKey.includes(`_${candidate}_`)
    ) {
      return candidate;
    }

    if (
      normalizedLabel.startsWith(`${candidate}_`) ||
      normalizedLabel.endsWith(`_${candidate}`) ||
      normalizedLabel.includes(`_${candidate}_`)
    ) {
      return candidate;
    }
  }

  return null;
};

export type OntologyCanonicalizationCatalog = {
  exactByKey: Map<string, CanonicalCatalogTerm>;
  singularByKey: Map<string, CanonicalCatalogTerm>;
  labelByKey: Map<string, CanonicalCatalogTerm>;
  dietTags: Set<string>;
};

export const buildOntologyCanonicalizationCatalog = (params: {
  terms: OntologyCatalogTerm[];
  dietTags?: string[];
}): OntologyCanonicalizationCatalog => {
  const exactByKey = new Map<string, CanonicalCatalogTerm>();
  const singularByKey = new Map<string, CanonicalCatalogTerm>();
  const labelByKey = new Map<string, CanonicalCatalogTerm>();
  const dietTags = new Set<string>();

  for (const value of params.dietTags ?? []) {
    const normalized = normalizeOntologyToken(value);
    if (normalized.length > 0) {
      dietTags.add(normalized);
    }
  }

  for (const rawTerm of params.terms) {
    const term_type = normalizeOntologyToken(rawTerm.term_type);
    const term_key = normalizeOntologyToken(rawTerm.term_key);
    const labelRaw = typeof rawTerm.label === "string" ? rawTerm.label.trim() : "";
    const label = labelRaw.length > 0 ? labelRaw : humanizeOntologyKey(term_key);
    if (!term_type || !term_key || !label) {
      continue;
    }

    const usageCountRaw = Number(rawTerm.usage_count ?? 0);
    const usage_count = Number.isFinite(usageCountRaw) && usageCountRaw > 0
      ? usageCountRaw
      : 0;

    const candidate: CanonicalCatalogTerm = {
      term_type,
      term_key,
      label,
      usage_count,
    };

    const exactKey = `${term_type}:${term_key}`;
    exactByKey.set(
      exactKey,
      pickPreferredCatalogTerm(exactByKey.get(exactKey), candidate),
    );

    const singularKey = singularizeOntologyKey(term_key);
    if (singularKey.length > 0) {
      const singularLookup = `${term_type}:${singularKey}`;
      singularByKey.set(
        singularLookup,
        pickPreferredCatalogTerm(singularByKey.get(singularLookup), candidate),
      );
    }

    const labelKey = normalizeLabelKey(label);
    if (labelKey.length > 0) {
      const labelLookup = `${term_type}:${labelKey}`;
      labelByKey.set(
        labelLookup,
        pickPreferredCatalogTerm(labelByKey.get(labelLookup), candidate),
      );
    }

    if (term_type === "diet") {
      dietTags.add(term_key);
    }
  }

  return {
    exactByKey,
    singularByKey,
    labelByKey,
    dietTags,
  };
};

export const canonicalizeOntologyTerm = (params: {
  term: OntologyTermCandidate;
  catalog: OntologyCanonicalizationCatalog;
}): CanonicalOntologyTerm | null => {
  const rawType = typeof params.term.term_type === "string"
    ? params.term.term_type
    : "";
  const normalizedType = normalizeOntologyToken(rawType);
  if (!normalizedType) {
    return null;
  }

  const rawLabel = typeof params.term.label === "string"
    ? params.term.label.trim()
    : "";
  const rawKey = typeof params.term.term_key === "string"
    ? params.term.term_key
    : rawLabel;
  const normalizedKey = normalizeOntologyToken(rawKey);
  if (!normalizedKey) {
    return null;
  }

  const relationType = normalizeOntologyToken(
    typeof params.term.relation_type === "string" ? params.term.relation_type : "",
  );

  const normalizedLabel = normalizeLabelKey(rawLabel);

  const isDietRelation = normalizedType === "diet" ||
    relationType === "compatible_with_diet";
  if (isDietRelation) {
    const canonicalDietKey = resolveDietKey(
      normalizedKey,
      normalizedLabel,
      params.catalog.dietTags,
    );
    if (canonicalDietKey) {
      const dietLookup = `diet:${canonicalDietKey}`;
      const exactDiet = params.catalog.exactByKey.get(dietLookup);
      if (exactDiet) {
        return {
          term_type: exactDiet.term_type,
          term_key: exactDiet.term_key,
          label: exactDiet.label,
        };
      }

      return {
        term_type: "diet",
        term_key: canonicalDietKey,
        label: humanizeOntologyKey(canonicalDietKey),
      };
    }
  }

  const singularKey = singularizeOntologyKey(normalizedKey);
  if (singularKey.length > 0 && singularKey !== normalizedKey) {
    const singularMatch = params.catalog.singularByKey.get(
      `${normalizedType}:${singularKey}`,
    );
    if (singularMatch) {
      return {
        term_type: singularMatch.term_type,
        term_key: singularMatch.term_key,
        label: singularMatch.label,
      };
    }
  }

  const exactMatch = params.catalog.exactByKey.get(
    `${normalizedType}:${normalizedKey}`,
  );
  if (exactMatch) {
    return {
      term_type: exactMatch.term_type,
      term_key: exactMatch.term_key,
      label: exactMatch.label,
    };
  }

  if (normalizedLabel.length > 0) {
    const labelMatch = params.catalog.labelByKey.get(
      `${normalizedType}:${normalizedLabel}`,
    );
    if (labelMatch) {
      return {
        term_type: labelMatch.term_type,
        term_key: labelMatch.term_key,
        label: labelMatch.label,
      };
    }
  }

  if (singularKey.length > 0) {
    const singularMatch = params.catalog.singularByKey.get(
      `${normalizedType}:${singularKey}`,
    );
    if (singularMatch) {
      return {
        term_type: singularMatch.term_type,
        term_key: singularMatch.term_key,
        label: singularMatch.label,
      };
    }
  }

  return {
    term_type: normalizedType,
    term_key: normalizedKey,
    label: rawLabel.length > 0 ? rawLabel : humanizeOntologyKey(normalizedKey),
  };
};
