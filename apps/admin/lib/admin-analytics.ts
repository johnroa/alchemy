export type AnalyticsRange = "24h" | "7d" | "30d" | "90d";
export type AnalyticsGrain = "hour" | "day" | "week";
export type AnalyticsCompare = "none" | "previous";

export type AnalyticsQueryState = {
  range: AnalyticsRange;
  grain: AnalyticsGrain;
  compare: AnalyticsCompare;
  segment?: string;
};

type SearchValue = string | string[] | undefined;

const RANGE_VALUES = new Set<AnalyticsRange>(["24h", "7d", "30d", "90d"]);
const GRAIN_VALUES = new Set<AnalyticsGrain>(["hour", "day", "week"]);
const COMPARE_VALUES = new Set<AnalyticsCompare>(["none", "previous"]);

export const DEFAULT_ANALYTICS_QUERY: AnalyticsQueryState = {
  range: "30d",
  grain: "day",
  compare: "previous",
};

export const PIPELINE_ANALYTICS_QUERY: AnalyticsQueryState = {
  range: "24h",
  grain: "hour",
  compare: "none",
};

const getValue = (value: SearchValue): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
};

export const parseAnalyticsQueryState = (
  searchParams: Record<string, SearchValue>,
  defaults: AnalyticsQueryState = DEFAULT_ANALYTICS_QUERY,
): AnalyticsQueryState => {
  const range = getValue(searchParams["range"]);
  const grain = getValue(searchParams["grain"]);
  const compare = getValue(searchParams["compare"]);
  const segment = getValue(searchParams["segment"])?.trim();

  const query: AnalyticsQueryState = {
    range: range && RANGE_VALUES.has(range as AnalyticsRange) ? (range as AnalyticsRange) : defaults.range,
    grain: grain && GRAIN_VALUES.has(grain as AnalyticsGrain) ? (grain as AnalyticsGrain) : defaults.grain,
    compare:
      compare && COMPARE_VALUES.has(compare as AnalyticsCompare)
        ? (compare as AnalyticsCompare)
        : defaults.compare,
  };

  if (segment && segment.length > 0) {
    query.segment = segment;
  }

  return query;
};

export const getHoursForRange = (range: AnalyticsRange): number => {
  if (range === "24h") return 24;
  if (range === "7d") return 7 * 24;
  if (range === "30d") return 30 * 24;
  return 90 * 24;
};

export const getDaysForRange = (range: AnalyticsRange): number => {
  return Math.ceil(getHoursForRange(range) / 24);
};
