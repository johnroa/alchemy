"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const llmNavItems = [
  { href: "/provider-model", label: "Provider & Model" },
  { href: "/models", label: "Models" },
  { href: "/prompts", label: "Prompts" },
  { href: "/rules", label: "Rules" },
  { href: "/memory", label: "Memory" }
];

export function LlmSubnav(): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-2">
      {llmNavItems.map((item) => {
        const active = pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
