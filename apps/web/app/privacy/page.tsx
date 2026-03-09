import { LegalDocument } from "@/components/legal-document";
import { privacyPolicySections } from "@/content/legal";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: "Privacy Policy",
  description: "Privacy policy for the Alchemy consumer website and app surfaces.",
  pathname: "/privacy"
});

export default function PrivacyPage(): React.JSX.Element {
  return (
    <LegalDocument
      title="Privacy Policy"
      intro="This starter policy gives the consumer website a real legal endpoint instead of placeholder links. Update the language with counsel before broad launch."
      sections={privacyPolicySections}
    />
  );
}
