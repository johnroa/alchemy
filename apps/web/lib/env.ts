import { API_BASE_PATH } from "@alchemy/shared/index";

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const normalizeAbsoluteUrl = (value: string, fallback: string): string => {
  try {
    return stripTrailingSlash(new URL(value).toString());
  } catch {
    return fallback;
  }
};

export const siteConfig = {
  name: "Alchemy",
  description:
    "Alchemy is an iPhone-first recipe app for generating, importing, and personalizing recipes around how people actually cook.",
  siteUrl: normalizeAbsoluteUrl(
    process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://cookwithalchemy.com",
    "https://cookwithalchemy.com"
  ),
  apiBaseUrl: normalizeAbsoluteUrl(
    process.env["API_BASE_URL"] ?? `https://api.cookwithalchemy.com${API_BASE_PATH}`,
    `https://api.cookwithalchemy.com${API_BASE_PATH}`
  )
} as const;

export const buildAbsoluteUrl = (pathname: string): string =>
  new URL(pathname, `${siteConfig.siteUrl}/`).toString();
