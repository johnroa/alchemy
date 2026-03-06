"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  Carrot,
  Database,
  FlaskConical,
  FolderGit2,
  History,
  Home,
  Image,
  Network,
  Radar,
  ScrollText,
  Sparkles,
  Wrench,
  Users
} from "lucide-react";
import { cn } from "@/lib/utils";

const navGroups = [
  {
    category: "Operations",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: Home },
      { href: "/users", label: "Users", icon: Users },
      { href: "/simulation-recipe", label: "Recipe Simulations", icon: Activity },
      { href: "/simulation-image", label: "Image Simulations", icon: Image },
      { href: "/development", label: "Development", icon: Wrench }
    ]
  },
  {
    category: "Intelligence",
    items: [
      { href: "/provider-model", label: "Model Assignments", icon: Bot },
      { href: "/model-usage", label: "Model Usage", icon: BarChart3 },
      { href: "/models", label: "Models", icon: Database },
      { href: "/prompts", label: "Prompts", icon: Bot },
      { href: "/rules", label: "Rules", icon: ScrollText },
      { href: "/memory", label: "Memory", icon: Sparkles }
    ]
  },
  {
    category: "Content",
    items: [
      { href: "/recipes", label: "Recipes", icon: FlaskConical },
      { href: "/ingredients", label: "Ingredients", icon: Carrot },
      { href: "/graph", label: "Graph", icon: Network },
      { href: "/image-pipeline", label: "Image Pipeline", icon: Image },
      { href: "/metadata-pipeline", label: "Metadata Pipeline", icon: Database }
    ]
  },
  {
    category: "Audit",
    items: [
      { href: "/changelog", label: "Changelog", icon: History },
      { href: "/request-trace", label: "Request Trace", icon: Radar },
      { href: "/version-causality", label: "Version Causality", icon: FolderGit2 },
      { href: "/api-docs", label: "API Reference", icon: BookOpen }
    ]
  }
];

export function SideNav({ onNavigate }: { onNavigate?: () => void } = {}): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav className="space-y-5">
      {navGroups.map((group) => (
        <div key={group.category}>
          <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
            {group.category}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  {...(onNavigate ? { onClick: onNavigate } : {})}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-zinc-100 hover:text-foreground"
                  )}
                >
                  <Icon className={cn("h-4 w-4 flex-none", active ? "text-primary" : "text-muted-foreground/70")} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
