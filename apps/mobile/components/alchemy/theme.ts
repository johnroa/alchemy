export const alchemyColors = {
  deepDark: "#060F1A",
  dark: "#1B2837",
  grey1: "#626E7B",
  grey2: "#B6BCC3",
  grey4: "#F1F3F6",
  skyBlueLight: "#DBE8EB",
  white: "#FFFFFF",
  success: "#1F9D73",
  danger: "#F87171",
  warning: "#F59E0B"
} as const;

export const alchemyTypography = {
  // Display
  titleXL: {
    fontSize: 34,
    fontWeight: "700" as const,
    letterSpacing: 0.4,
    lineHeight: 41
  },
  titleLG: {
    fontSize: 20,
    fontWeight: "600" as const,
    lineHeight: 26
  },
  // Body
  body: {
    fontSize: 17,
    fontWeight: "400" as const,
    lineHeight: 24
  },
  bodyBold: {
    fontSize: 17,
    fontWeight: "700" as const,
    lineHeight: 24
  },
  bodyLight: {
    fontSize: 17,
    fontWeight: "300" as const,
    lineHeight: 24
  },
  // Small body — recipe descriptions, subtitles
  bodySmall: {
    fontSize: 14,
    fontWeight: "300" as const,
    lineHeight: 22
  },
  // Captions
  caption: {
    fontSize: 13,
    fontWeight: "700" as const,
    lineHeight: 16
  },
  captionLight: {
    fontSize: 13,
    fontWeight: "300" as const,
    lineHeight: 21
  },
  // Micro / tab labels
  micro: {
    fontSize: 10,
    fontWeight: "400" as const,
    lineHeight: 16
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: "400" as const,
    lineHeight: 13,
    letterSpacing: 0.06
  }
} as const;

export const alchemySpacing = {
  xs: 6,
  sm: 10,
  sm2: 12,
  md: 16,
  lg2: 20,
  lg: 24,
  xl: 32,
  xxl: 36
} as const;

export const alchemyRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999
} as const;
