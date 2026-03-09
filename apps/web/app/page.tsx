import Link from "next/link";
import {
  heroStats,
  productPillars,
  websiteSlices,
  webFlow
} from "@/content/marketing";
import { buildPageMetadata } from "@/lib/metadata";
import { SectionShell } from "@/components/section-shell";

export const metadata = buildPageMetadata({
  title: "Your Private Sous Chef",
  description:
    "Static-first public website scaffolding for Alchemy with room for SEO pages, legal pages, and live recipe shares.",
  pathname: "/"
});

export default function HomePage(): React.JSX.Element {
  return (
    <>
      <section className="overflow-hidden border-b border-border/60">
        <div className="container grid gap-12 py-14 sm:py-20 lg:grid-cols-[1.2fr_0.8fr] lg:items-center lg:py-24">
          <div className="space-y-8">
            <div className="inline-flex rounded-full border border-olive-300/80 bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.32em] text-olive-500 shadow-card">
              Consumer website starter
            </div>
            <div className="space-y-5">
              <h1 className="max-w-4xl font-display text-5xl leading-[0.95] text-olive-700 sm:text-6xl lg:text-7xl">
                A calmer way to decide what&apos;s for dinner.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-olive-700/75 sm:text-xl">
                This public site is static by default, typed against the existing API contract, and ready for
                Cloudflare Workers deployment through OpenNext.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <a
                href="mailto:hello@cookwithalchemy.com?subject=Alchemy%20iOS"
                className="rounded-full bg-olive-700 px-6 py-3 text-center text-sm font-semibold text-white transition hover:bg-olive-500"
              >
                Request iPhone access
              </a>
              <Link
                href="/#recipes"
                className="rounded-full border border-olive-300 bg-white/72 px-6 py-3 text-center text-sm font-semibold text-olive-700 transition hover:border-olive-500"
              >
                Explore the web architecture
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {heroStats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-[1.5rem] border border-border/70 bg-white/70 p-4 shadow-card backdrop-blur"
                >
                  <p className="text-xs uppercase tracking-[0.24em] text-olive-500">{stat.label}</p>
                  <p className="mt-2 text-lg font-semibold text-olive-700">{stat.value}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="relative">
            <div className="absolute inset-0 translate-x-8 translate-y-6 rounded-[2rem] bg-saffron-200/50 blur-3xl" />
            <div className="relative space-y-4 rounded-[2.2rem] border border-border/70 bg-white/76 p-6 shadow-card backdrop-blur">
              <div className="rounded-[1.8rem] bg-hero-grid bg-hero-grid p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-olive-500">
                  Static landing + live recipe shares
                </p>
                <div className="mt-6 grid gap-4">
                  <div className="rounded-[1.5rem] bg-olive-700 p-5 text-white">
                    <p className="text-sm uppercase tracking-[0.24em] text-white/64">Hero route</p>
                    <p className="mt-3 font-display text-3xl">cookwithalchemy.com</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-[1.4rem] bg-white/82 p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-olive-500">Legal</p>
                      <p className="mt-2 text-lg font-semibold text-olive-700">/privacy and /terms</p>
                    </div>
                    <div className="rounded-[1.4rem] bg-white/82 p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-olive-500">ISR page</p>
                      <p className="mt-2 text-lg font-semibold text-olive-700">/recipes/[id]</p>
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-sm leading-7 text-olive-700/72">
                The starter keeps repo-local content in code today, then leaves room for a CMS later if marketing
                operations need it.
              </p>
            </div>
          </div>
        </div>
      </section>

      <SectionShell
        id="how-it-works"
        eyebrow="Product"
        title="The website mirrors how the product actually works"
        body="The public site stays honest about the system: chat-driven generation, import from real sources, and private personalization layered on canonical recipes."
      >
        <div className="grid gap-5 lg:grid-cols-3">
          {productPillars.map((pillar) => (
            <article
              key={pillar.title}
              className="rounded-[2rem] border border-border/70 bg-white/72 p-6 shadow-card"
            >
              <h3 className="font-display text-2xl text-olive-700">{pillar.title}</h3>
              <p className="mt-3 text-sm leading-7 text-olive-700/74">{pillar.body}</p>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell
        eyebrow="Architecture"
        title="Static first, then selective revalidation where the content is truly live"
        body="The starter gives the marketing surface strong defaults without turning the whole site into a permanently server-rendered app."
      >
        <div className="grid gap-5 md:grid-cols-3">
          {websiteSlices.map((slice) => (
            <article
              key={slice.title}
              className="rounded-[2rem] border border-border/70 bg-surface/80 p-6 shadow-card"
            >
              <h3 className="text-xl font-semibold text-olive-700">{slice.title}</h3>
              <p className="mt-3 text-sm leading-7 text-olive-700/72">{slice.body}</p>
            </article>
          ))}
        </div>
      </SectionShell>

      <SectionShell
        id="recipes"
        eyebrow="Flow"
        title="Where SSR and ISR belong in this stack"
        body="Use live rendering sparingly: canonical recipe pages, light personalization, and future referral or waitlist edges. Everything else can stay static and cheap."
      >
        <div className="grid gap-5 lg:grid-cols-3">
          {webFlow.map((item, index) => (
            <article
              key={item.title}
              className="rounded-[2rem] border border-border/70 bg-white/74 p-6 shadow-card"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-saffron-400/20 text-sm font-semibold text-saffron-600">
                0{index + 1}
              </div>
              <h3 className="font-display text-2xl text-olive-700">{item.title}</h3>
              <p className="mt-3 text-sm leading-7 text-olive-700/72">{item.detail}</p>
            </article>
          ))}
        </div>
      </SectionShell>

      <section className="pb-16 sm:pb-24">
        <div className="container">
          <div className="rounded-[2.2rem] border border-border/70 bg-olive-700 px-8 py-10 text-white shadow-card sm:px-12">
            <div className="max-w-2xl space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-white/64">Ready to extend</p>
              <h2 className="font-display text-4xl sm:text-5xl">Start static. Add live recipe pages only where they earn their keep.</h2>
              <p className="text-base leading-7 text-white/76">
                The public site now has a clear home in the monorepo, a typed API seam, and deployment scaffolding that matches your existing Cloudflare model.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
