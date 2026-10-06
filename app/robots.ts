import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/dashboard", "/tenders", "/saved-tenders", "/saved-searches", "/notifications", "/profile", "/company", "/support", "/verify-email", "/reset-password", "/invite"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
