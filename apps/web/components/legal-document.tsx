import type { LegalSection } from "@/content/legal";

type LegalDocumentProps = {
  title: string;
  intro: string;
  sections: LegalSection[];
};

export function LegalDocument({
  title,
  intro,
  sections
}: LegalDocumentProps): React.JSX.Element {
  return (
    <div className="container py-16 sm:py-24">
      <div className="mx-auto max-w-3xl rounded-[2rem] border border-border/80 bg-white/78 p-8 shadow-card backdrop-blur sm:p-12">
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-olive-500">
            Legal
          </p>
          <h1 className="font-display text-4xl text-olive-700 sm:text-5xl">{title}</h1>
          <p className="text-base leading-7 text-olive-700/72">{intro}</p>
        </div>
        <div className="mt-10 space-y-8">
          {sections.map((section) => (
            <section key={section.heading} className="space-y-3">
              <h2 className="font-display text-2xl text-olive-700">{section.heading}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph} className="text-sm leading-7 text-olive-700/78 sm:text-base">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
