import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://safa-8f76e.web.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "orders", "invoices", "integrations", "saved-information", "operations", "settings"];

  return routes.map((route) => ({
    url: `${siteUrl}/${route}`,
    lastModified: new Date()
  }));
}
