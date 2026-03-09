type SectionShellProps = {
  id?: string;
  eyebrow: string;
  title: string;
  body: string;
  children: React.ReactNode;
};

export function SectionShell({
  id,
  eyebrow,
  title,
  body,
  children
}: SectionShellProps): React.JSX.Element {
  return (
    <section id={id} className="py-16 sm:py-24">
      <div className="container space-y-8">
        <div className="max-w-2xl space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-olive-500">
            {eyebrow}
          </p>
          <h2 className="font-display text-3xl leading-tight text-olive-700 sm:text-5xl">
            {title}
          </h2>
          <p className="text-base leading-7 text-olive-700/72 sm:text-lg">{body}</p>
        </div>
        {children}
      </div>
    </section>
  );
}
