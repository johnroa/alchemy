import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowDownToLine,
  BookOpen,
  Bot,
  Brain,
  Carrot,
  Database,
  FolderKanban,
  FlaskConical,
  History,
  Home,
  Image,
  Network,
  Radar,
  ScrollText,
  SlidersHorizontal,
  Users,
  Wrench,
} from "lucide-react";

export type AdminSectionKey = "overview" | "analytics" | "llm" | "content" | "operations" | "system";

export type AdminSectionMeta = {
  key: AdminSectionKey;
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
};

export type AdminPageMeta = {
  key: string;
  section: AdminSectionKey;
  title: string;
  navLabel: string;
  description: string;
  href: string;
  icon: LucideIcon;
  isSectionRoot?: boolean;
};

export const ADMIN_SECTIONS: AdminSectionMeta[] = [
  {
    key: "overview",
    title: "Overview",
    description: "Global command center, alerts, and quick actions.",
    href: "/",
    icon: Home,
  },
  {
    key: "analytics",
    title: "Analytics",
    description: "Cross-domain system, content, pipeline, and product telemetry.",
    href: "/analytics",
    icon: Brain,
  },
  {
    key: "llm",
    title: "LLM Config",
    description: "Model routes, registry entries, prompts, and rules.",
    href: "/llm",
    icon: Bot,
  },
  {
    key: "content",
    title: "Content",
    description: "Recipe, ingredient, and graph inspection workflows.",
    href: "/content",
    icon: FlaskConical,
  },
  {
    key: "operations",
    title: "Operations",
    description: "User operations and live queue management.",
    href: "/operations",
    icon: SlidersHorizontal,
  },
  {
    key: "system",
    title: "System",
    description: "Simulation, trace, changelog, docs, and development tools.",
    href: "/system",
    icon: Wrench,
  },
];

export const ADMIN_PAGES: AdminPageMeta[] = [
  {
    key: "overview",
    section: "overview",
    title: "Overview",
    navLabel: "Overview",
    description: "Global system health, alerts, recent activity, and shortcuts.",
    href: "/",
    icon: Home,
    isSectionRoot: true,
  },
  {
    key: "analytics-root",
    section: "analytics",
    title: "Analytics",
    navLabel: "Overview",
    description: "Cross-domain telemetry summary and domain entrypoints.",
    href: "/analytics",
    icon: Brain,
    isSectionRoot: true,
  },
  {
    key: "analytics-llm",
    section: "analytics",
    title: "LLM Performance",
    navLabel: "LLM",
    description: "Calls, cost, tokens, provider mix, latency, and errors.",
    href: "/analytics/llm",
    icon: Bot,
  },
  {
    key: "analytics-content",
    section: "analytics",
    title: "Content Health",
    navLabel: "Content",
    description: "Recipe, ingredient, graph, and variant health metrics.",
    href: "/analytics/content",
    icon: FlaskConical,
  },
  {
    key: "analytics-pipelines",
    section: "analytics",
    title: "Pipelines",
    navLabel: "Pipelines",
    description: "Queue health, throughput, latency, and failures.",
    href: "/analytics/pipelines",
    icon: Activity,
  },
  {
    key: "analytics-product",
    section: "analytics",
    title: "Product",
    navLabel: "Product",
    description: "Users, cookbook entries, saves, and variant adoption.",
    href: "/analytics/product",
    icon: Users,
  },
  {
    key: "llm-root",
    section: "llm",
    title: "LLM Config",
    navLabel: "Overview",
    description: "Configuration overview and quick access to routing controls.",
    href: "/llm",
    icon: Bot,
    isSectionRoot: true,
  },
  {
    key: "llm-routes",
    section: "llm",
    title: "Model Routes",
    navLabel: "Routes",
    description: "Active model assignments per scope.",
    href: "/llm/routes",
    icon: Bot,
  },
  {
    key: "llm-models",
    section: "llm",
    title: "Models",
    navLabel: "Models",
    description: "Registry metadata and billing configuration.",
    href: "/llm/models",
    icon: Database,
  },
  {
    key: "llm-prompts",
    section: "llm",
    title: "Prompts",
    navLabel: "Prompts",
    description: "Scoped prompt templates and active versions.",
    href: "/llm/prompts",
    icon: ScrollText,
  },
  {
    key: "llm-rules",
    section: "llm",
    title: "Rules",
    navLabel: "Rules",
    description: "Structured runtime rules and scope-specific policy.",
    href: "/llm/rules",
    icon: ScrollText,
  },
  {
    key: "content-root",
    section: "content",
    title: "Content",
    navLabel: "Overview",
    description: "Inspection entrypoint for recipes, ingredients, and graph data.",
    href: "/content",
    icon: FlaskConical,
    isSectionRoot: true,
  },
  {
    key: "content-recipes",
    section: "content",
    title: "Recipes",
    navLabel: "Recipes",
    description: "Recipe audit console and version inspection.",
    href: "/content/recipes",
    icon: FlaskConical,
  },
  {
    key: "content-ingredients",
    section: "content",
    title: "Ingredients",
    navLabel: "Ingredients",
    description: "Ingredient registry exploration and coverage review.",
    href: "/content/ingredients",
    icon: Carrot,
  },
  {
    key: "content-graph",
    section: "content",
    title: "Knowledge Graph",
    navLabel: "Graph",
    description: "Graph visualization and entity relationship tables.",
    href: "/content/graph",
    icon: Network,
  },
  {
    key: "operations-root",
    section: "operations",
    title: "Operations",
    navLabel: "Overview",
    description: "Queues, operators, and live operational workflows.",
    href: "/operations",
    icon: SlidersHorizontal,
    isSectionRoot: true,
  },
  {
    key: "operations-users",
    section: "operations",
    title: "Users",
    navLabel: "Users",
    description: "User search and account operations.",
    href: "/operations/users",
    icon: Users,
  },
  {
    key: "operations-images",
    section: "operations",
    title: "Images",
    navLabel: "Images",
    description: "Image request operations, assets, and quality review.",
    href: "/operations/images",
    icon: Image,
  },
  {
    key: "operations-imports",
    section: "operations",
    title: "Imports",
    navLabel: "Imports",
    description: "Import history, failures, and operational controls.",
    href: "/operations/imports",
    icon: ArrowDownToLine,
  },
  {
    key: "operations-metadata",
    section: "operations",
    title: "Metadata Pipeline",
    navLabel: "Metadata",
    description: "Recipe metadata queue inspection and controls.",
    href: "/operations/metadata",
    icon: Database,
  },
  {
    key: "operations-memory",
    section: "operations",
    title: "Memory",
    navLabel: "Memory",
    description: "Memory jobs, queue controls, and record inspection.",
    href: "/operations/memory",
    icon: FolderKanban,
  },
  {
    key: "system-root",
    section: "system",
    title: "System",
    navLabel: "Overview",
    description: "Simulation, diagnostics, documentation, and destructive tools.",
    href: "/system",
    icon: Wrench,
    isSectionRoot: true,
  },
  {
    key: "system-simulations",
    section: "system",
    title: "Simulations",
    navLabel: "Simulations",
    description: "Recipe and image simulations with live traces.",
    href: "/system/simulations",
    icon: Activity,
  },
  {
    key: "system-request-trace",
    section: "system",
    title: "Request Trace",
    navLabel: "Trace",
    description: "Request-level event and mutation inspection.",
    href: "/system/request-trace",
    icon: Radar,
  },
  {
    key: "system-changelog",
    section: "system",
    title: "Changelog",
    navLabel: "Changelog",
    description: "Immutable mutation log across the admin surface.",
    href: "/system/changelog",
    icon: History,
  },
  {
    key: "system-api-reference",
    section: "system",
    title: "API Reference",
    navLabel: "API Reference",
    description: "OpenAPI spec plus generated admin route inventory.",
    href: "/system/api-reference",
    icon: BookOpen,
  },
  {
    key: "system-development",
    section: "system",
    title: "Development",
    navLabel: "Development",
    description: "Development reset tools and destructive workflows.",
    href: "/system/development",
    icon: Wrench,
  },
];

export const getSectionPages = (section: AdminSectionKey): AdminPageMeta[] =>
  ADMIN_PAGES.filter((page) => page.section === section);

export const isActivePath = (pathname: string, href: string): boolean => {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
};

export const getPageForPathname = (pathname: string): AdminPageMeta =>
  [...ADMIN_PAGES]
    .sort((left, right) => right.href.length - left.href.length)
    .find((page) => isActivePath(pathname, page.href)) ?? ADMIN_PAGES[0]!;

export const getSectionForPathname = (pathname: string): AdminSectionMeta => {
  const page = getPageForPathname(pathname);
  return ADMIN_SECTIONS.find((section) => section.key === page.section) ?? ADMIN_SECTIONS[0]!;
};

export const getBreadcrumbsForPathname = (pathname: string): Array<{ label: string; href: string }> => {
  const page = getPageForPathname(pathname);
  if (page.section === "overview") {
    return [{ label: page.title, href: page.href }];
  }

  const section = getSectionForPathname(pathname);
  if (page.isSectionRoot) {
    return [{ label: section.title, href: section.href }];
  }

  return [
    { label: section.title, href: section.href },
    { label: page.title, href: page.href },
  ];
};

export const getLandingCardsForSection = (section: AdminSectionKey): AdminPageMeta[] =>
  getSectionPages(section).filter((page) => !page.isSectionRoot);
