export const marketingNavigation = [
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/#recipes", label: "Recipe Pages" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" }
] as const;

export const heroStats = [
  { label: "Primary platform", value: "iPhone-first" },
  { label: "Recipe import", value: "URL, text, photo" },
  { label: "Personalization", value: "Variants, not duplicates" }
] as const;

export const productPillars = [
  {
    title: "Generate from intent, not filters",
    body:
      "Users talk through what they want to cook, then Alchemy turns that context into a recipe set they can refine before saving."
  },
  {
    title: "Import anything worth cooking",
    body:
      "A recipe link, cookbook page, or pasted text becomes a structured recipe draft that fits the same downstream pipeline."
  },
  {
    title: "Keep the canonical recipe clean",
    body:
      "Public recipes stay stable. Personal variants absorb dietary restrictions, equipment limits, and taste preferences."
  }
] as const;

export const websiteSlices = [
  {
    title: "Static by default",
    body:
      "Landing, legal, and SEO pages live in repo-local content so the public site stays fast and diff-friendly."
  },
  {
    title: "Typed API integration",
    body:
      "Live recipe pages use the existing OpenAPI contracts instead of hand-rolled web-only types."
  },
  {
    title: "Cloudflare-native deploys",
    body:
      "The consumer site follows the same OpenNext-on-Workers path as admin instead of introducing a second hosting model."
  }
] as const;

export const webFlow = [
  {
    title: "Land on a search-safe page",
    detail:
      "Editorial pages and legal routes are static, cache-friendly, and easy to evolve without a CMS."
  },
  {
    title: "Open a live recipe share route",
    detail:
      "Recipe pages fetch canonical data from the public API, then revalidate on an interval so shares stay current."
  },
  {
    title: "Hand off to the app",
    detail:
      "Calls to action stay lightweight today, then can expand into App Store, waitlist, or auth surfaces without reworking the stack."
  }
] as const;
