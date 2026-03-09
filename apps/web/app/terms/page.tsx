import { LegalDocument } from "@/components/legal-document";
import { termsOfUseSections } from "@/content/legal";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: "Terms of Use",
  description: "Terms of use for the Alchemy consumer website and app surfaces.",
  pathname: "/terms"
});

export default function TermsPage(): React.JSX.Element {
  return (
    <LegalDocument
      title="Terms of Use"
      intro="This starter terms page gives the public root domain a concrete legal destination today. Replace this draft with approved legal language before launch."
      sections={termsOfUseSections}
    />
  );
}
