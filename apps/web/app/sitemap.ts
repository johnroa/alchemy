import type { MetadataRoute } from "next";
import { buildAbsoluteUrl } from "@/lib/env";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: buildAbsoluteUrl("/"),
      changeFrequency: "weekly",
      priority: 1
    },
    {
      url: buildAbsoluteUrl("/privacy"),
      changeFrequency: "monthly",
      priority: 0.2
    },
    {
      url: buildAbsoluteUrl("/terms"),
      changeFrequency: "monthly",
      priority: 0.2
    }
  ];
}
