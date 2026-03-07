export const formatCost = (usd: number | null | undefined): string => {
  const value = Number(usd ?? 0);
  if (!Number.isFinite(value) || value === 0) return "$0.00";
  if (Math.abs(value) < 0.001) return `$${value.toFixed(6)}`;
  if (Math.abs(value) < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
};

export const formatMs = (ms: number | null | undefined): string => {
  if (ms == null || !Number.isFinite(ms)) return "n/a";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

export const formatTokens = (tokens: number | null | undefined): string => {
  const value = Number(tokens ?? 0);
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
};

export const formatPercent = (value: number | null | undefined, digits = 0): string => {
  const ratio = Number(value ?? 0);
  if (!Number.isFinite(ratio)) return "0%";
  return `${(ratio * 100).toFixed(digits)}%`;
};

export const timeAgo = (dateLike: string | number | Date | null | undefined): string => {
  if (!dateLike) return "n/a";
  const timestamp = new Date(dateLike).getTime();
  if (!Number.isFinite(timestamp)) return "n/a";

  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(timestamp).toLocaleDateString();
};

export const toDecimal = (value: number | null | undefined, digits = 2): string => {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "0";
  return numeric.toFixed(digits);
};

export const toShortInteger = (value: number | null | undefined): string => {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "0";
  return Math.round(numeric).toLocaleString();
};
