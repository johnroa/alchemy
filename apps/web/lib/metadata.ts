import type { Metadata } from "next";
import { buildAbsoluteUrl, siteConfig } from "@/lib/env";

type PageMetadataInput = {
  title: string;
  description: string;
  pathname: string;
  image?: string;
};

export const buildPageMetadata = (input: PageMetadataInput): Metadata => ({
  title: input.title,
  description: input.description,
  alternates: {
    canonical: input.pathname
  },
  openGraph: {
    title: input.title,
    description: input.description,
    url: buildAbsoluteUrl(input.pathname),
    siteName: siteConfig.name,
    type: "website",
    ...(input.image ? { images: [input.image] } : {})
  },
  twitter: {
    card: input.image ? "summary_large_image" : "summary",
    title: input.title,
    description: input.description,
    ...(input.image ? { images: [input.image] } : {})
  }
});
