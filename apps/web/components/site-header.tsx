import Link from "next/link";
import { marketingNavigation } from "@/content/marketing";

export function SiteHeader(): React.JSX.Element {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur">
      <div className="container flex h-16 items-center justify-between gap-6">
        <Link href="/" className="font-display text-2xl text-olive-700">
          Alchemy
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-medium text-olive-700/80 md:flex">
          {marketingNavigation.map((item) => (
            <Link key={item.href} href={item.href} className="transition hover:text-olive-700">
              {item.label}
            </Link>
          ))}
        </nav>
        <a
          href="mailto:hello@cookwithalchemy.com?subject=Alchemy%20iOS"
          className="rounded-full bg-olive-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-olive-500"
        >
          Request Access
        </a>
      </div>
    </header>
  );
}
