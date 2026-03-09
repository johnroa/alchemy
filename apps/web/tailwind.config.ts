import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./content/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    container: {
      center: true,
      padding: "1.25rem",
      screens: {
        "2xl": "1240px"
      }
    },
    extend: {
      colors: {
        background: "rgb(var(--background) / <alpha-value>)",
        foreground: "rgb(var(--foreground) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        olive: {
          100: "rgb(var(--olive-100) / <alpha-value>)",
          300: "rgb(var(--olive-300) / <alpha-value>)",
          500: "rgb(var(--olive-500) / <alpha-value>)",
          700: "rgb(var(--olive-700) / <alpha-value>)"
        },
        saffron: {
          200: "rgb(var(--saffron-200) / <alpha-value>)",
          400: "rgb(var(--saffron-400) / <alpha-value>)",
          600: "rgb(var(--saffron-600) / <alpha-value>)"
        },
        paprika: {
          200: "rgb(var(--paprika-200) / <alpha-value>)",
          500: "rgb(var(--paprika-500) / <alpha-value>)"
        }
      },
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"]
      },
      boxShadow: {
        card: "0 24px 60px rgba(42, 47, 29, 0.12)"
      },
      backgroundImage: {
        "hero-grid":
          "radial-gradient(circle at top, rgba(205, 150, 49, 0.18), transparent 36%), linear-gradient(135deg, rgba(39, 62, 45, 0.12), transparent 55%), linear-gradient(rgba(42, 47, 29, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(42, 47, 29, 0.08) 1px, transparent 1px)"
      },
      backgroundSize: {
        "hero-grid": "auto, auto, 36px 36px, 36px 36px"
      }
    }
  },
  plugins: []
};

export default config;
