import Link from "next/link";

export function SiteFooter(): React.JSX.Element {
  return (
    <footer className="border-t border-border/70 bg-surface/70">
      <div className="container flex flex-col gap-6 py-10 text-sm text-olive-700/72 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="font-display text-2xl text-olive-700">Alchemy</p>
          <p className="max-w-md">
            iPhone-first recipe generation, import, and personalization with canonical recipes and private variants.
          </p>
        </div>
        <div className="flex flex-wrap gap-4">
          <Link href="/privacy" className="transition hover:text-olive-700">
            Privacy
          </Link>
          <Link href="/terms" className="transition hover:text-olive-700">
            Terms
          </Link>
          <a href="mailto:hello@cookwithalchemy.com" className="transition hover:text-olive-700">
            Contact
          </a>
        </div>
      </div>
    </footer>
  );
}
