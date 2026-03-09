import Link from "next/link";

export default function NotFound(): React.JSX.Element {
  return (
    <div className="container py-20 sm:py-28">
      <div className="mx-auto max-w-2xl rounded-[2rem] border border-border/70 bg-white/74 p-10 text-center shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-olive-500">404</p>
        <h1 className="mt-4 font-display text-4xl text-olive-700 sm:text-5xl">This page didn&apos;t make it to the table.</h1>
        <p className="mt-4 text-base leading-7 text-olive-700/72">
          The requested route does not exist, or the recipe is no longer public.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex rounded-full bg-olive-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-olive-500"
        >
          Back to Alchemy
        </Link>
      </div>
    </div>
  );
}
