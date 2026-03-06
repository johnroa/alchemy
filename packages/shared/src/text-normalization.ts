const COMBINING_MARKS_PATTERN = /[\u0300-\u036f]/g;

const escapeForCharacterClass = (value: string): string =>
  value.replace(/[\\\-\]^]/g, "\\$&");

const escapeForRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const stripUnicodeCombiningMarks = (value: string): string =>
  value.normalize("NFKD").replace(COMBINING_MARKS_PATTERN, "");

export const normalizeFoldedText = (
  value: string,
  options?: {
    separator?: string;
    preserveCharacters?: string;
  },
): string => {
  const separator = options?.separator ?? " ";
  const preserveCharacters = options?.preserveCharacters ?? "";
  const lowered = stripUnicodeCombiningMarks(value).trim().toLocaleLowerCase();
  if (!lowered) {
    return "";
  }

  const allowedCharacters =
    `a-z0-9\\s${escapeForCharacterClass(preserveCharacters)}`;
  const sanitized = lowered.replace(new RegExp(`[^${allowedCharacters}]`, "g"), " ");
  const collapsedWhitespace = sanitized.replace(/\s+/g, separator);

  if (!separator) {
    return collapsedWhitespace.trim();
  }

  const escapedSeparator = escapeForRegExp(separator);
  return collapsedWhitespace
    .replace(new RegExp(`${escapedSeparator}+`, "g"), separator)
    .replace(
      new RegExp(`^${escapedSeparator}+|${escapedSeparator}+$`, "g"),
      "",
    );
};

export const normalizeWhitespaceToken = (value: string): string =>
  normalizeFoldedText(value, { separator: " " });

export const normalizeDelimitedToken = (
  value: string,
  preserveCharacters = ":_-",
): string =>
  normalizeFoldedText(value, {
    separator: "_",
    preserveCharacters,
  });
