export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://atsgem.example.com").replace(/\/$/, "");
export const SITE_NAME = "ATS GeM";
/** Public, indexable marketing routes. Everything else (app, admin, token pages) is private. */
export const PUBLIC_ROUTES = ["/", "/about", "/solutions", "/pricing", "/faq", "/contact", "/resources", "/terms"] as const;
