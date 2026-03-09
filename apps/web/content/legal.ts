export type LegalSection = {
  heading: string;
  body: string[];
};

export const privacyPolicySections: LegalSection[] = [
  {
    heading: "What We Collect",
    body: [
      "Alchemy collects the information required to operate the product, including account details, recipe activity, preference data, and diagnostics needed to keep the service reliable.",
      "If you submit recipe links, pasted text, or photos for import, that source content may be processed so the app can extract and structure the recipe."
    ]
  },
  {
    heading: "How We Use Data",
    body: [
      "We use product data to deliver recipe generation, saving, personalization, import, security checks, and service analytics.",
      "Telemetry is used to understand product quality, conversion, and reliability. It is not a promise of individualized advertising."
    ]
  },
  {
    heading: "Sharing",
    body: [
      "We share data with infrastructure providers and subprocessors only when that is required to operate the product, secure the service, or comply with the law.",
      "We do not sell personal information in the ordinary meaning of that phrase."
    ]
  },
  {
    heading: "Retention",
    body: [
      "We keep data for as long as it is needed to provide the service, meet legal obligations, resolve disputes, and improve the product.",
      "Retention periods may differ across account data, analytics logs, and support records."
    ]
  },
  {
    heading: "Contact",
    body: [
      "Questions about privacy can be sent to hello@cookwithalchemy.com."
    ]
  }
];

export const termsOfUseSections: LegalSection[] = [
  {
    heading: "Service Scope",
    body: [
      "Alchemy provides recipe generation, recipe import, personalization, and related product features. The service may change over time as features are added, modified, or removed.",
      "You are responsible for how you cook, store food, and account for allergies, dietary needs, and ingredient safety."
    ]
  },
  {
    heading: "Accounts",
    body: [
      "You are responsible for maintaining the security of your account and any device sessions linked to it.",
      "Do not use the service to upload unlawful, infringing, or malicious content."
    ]
  },
  {
    heading: "Content",
    body: [
      "You retain rights to content you submit, subject to the rights needed for us to host, process, and display that content to provide the service.",
      "Imported source material should only be submitted when you have the right to access and use it."
    ]
  },
  {
    heading: "Availability",
    body: [
      "We work to keep Alchemy available and accurate, but the service is provided on an as-available basis without guarantees that every recipe, import, or AI output will be error free."
    ]
  },
  {
    heading: "Contact",
    body: [
      "Questions about these terms can be sent to hello@cookwithalchemy.com."
    ]
  }
];
