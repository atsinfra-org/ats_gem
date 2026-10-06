import type { MetadataRoute } from "next";
import { PUBLIC_ROUTES, SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((path) => ({ url: `${SITE_URL}${path === "/" ? "" : path}`, changeFrequency: "monthly", priority: path === "/" ? 1 : 0.6 }));
}
