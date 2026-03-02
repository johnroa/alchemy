"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, FlaskConical, Home, Network, ScrollText, ShieldAlert, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const navGroups = [
  {
    category: "Operations",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: Home },
      { href: "/users", label: "Users", icon: Users },
      { href: "/moderation", label: "Moderation", icon: ShieldAlert }
    ]
  },
  {
    category: "LLM Control",
    items: [
      { href: "/provider-model", label: "Provider & Model", icon: Bot },
      { href: "/prompts", label: "Prompts", icon: Bot },
      { href: "/rules", label: "Rules", icon: ScrollText }
    ]
  },
  {
    category: "Recipe Data",
    items: [
      { href: "/recipes", label: "Recipes", icon: FlaskConical },
      { href: "/graph", label: "Graph", icon: Network }
    ]
  }
];

export function SideNav(): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav className="space-y-4">
      {navGroups.map((group) => (
        <div key={group.category} className="space-y-1">
          <p className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.category}</p>
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
