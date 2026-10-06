// Browser smoke test against a running frontend (3000) and backend (4000).
// Usage: node scripts/browser-smoke.mjs
import { chromium } from "playwright";

const BASE = process.env.FE_URL ?? "http://localhost:3000";
const results = [];
const consoleErrors = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${detail}`);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(`${page.url()} :: ${m.text()}`);
});
page.on("pageerror", (e) => consoleErrors.push(`${page.url()} :: ${e.message}`));

const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

// Public pages
for (const p of ["/", "/about", "/pricing", "/faq", "/contact", "/resources"]) {
  const res = await page.goto(BASE + p, { waitUntil: "networkidle" });
  ok(`public ${p}`, res?.status() === 200 && !(await overflow()));
}

// Unauthenticated guard
await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
ok("unauth /dashboard redirects home", new URL(page.url()).pathname === "/");

// Register through the dialog
const email = `smoke-${Date.now()}@example.com`;
await page.goto(BASE + "/register", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Sign Up" }).click();
await page.getByLabel("Full Name").fill("Smoke Tester");
await page.getByLabel("Email", { exact: true }).fill(email);
await page.locator("#register-password").fill("correct-horse-battery");
await page.locator("#register-confirm").fill("correct-horse-battery");
await page.locator("#register-terms").click();
await page.getByRole("button", { name: "Create Account" }).click();
await page.waitForURL("**/dashboard", { timeout: 15000 }).catch(() => {});
ok("register -> dashboard", page.url().endsWith("/dashboard"));

// Session survives reload (refresh cookie)
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
ok("session persists after reload", page.url().endsWith("/dashboard"));

// Search
await page.goto(BASE + "/tenders", { waitUntil: "networkidle" });
await page.waitForSelector("h3", { timeout: 15000 }).catch(() => {});
const cards = await page.locator("h3").count();
ok("tender search shows real tenders", cards > 0, `cards=${cards}`);

// Filter by keyword
await page.getByLabel("Search tenders").fill("road");
await page.waitForTimeout(1500);
ok("keyword search responds", (await page.locator("body").innerText()).length > 0);
await page.getByLabel("Search tenders").fill("");
await page.waitForTimeout(1200);

// Save first tender
const saveBtn = page.getByRole("button", { name: "Save tender" }).first();
await saveBtn.click();
await page.waitForTimeout(800);
ok("save tender toggles", (await page.getByRole("button", { name: "Remove from saved tenders" }).count()) > 0);

// Detail
await page.getByRole("link", { name: "View Details" }).first().click();
await page.waitForURL("**/tenders/*");
await page.waitForLoadState("networkidle");
ok("tender detail renders", (await page.locator("h1").first().innerText()).length > 0);
for (const tab of ["Requirements", "Timeline", "Corrigenda", "Documents"]) {
  await page.getByRole("tab", { name: new RegExp(tab) }).click();
  ok(`detail tab ${tab}`, true);
}

// Saved tenders page
await page.goto(BASE + "/saved-tenders", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
ok("saved tenders lists saved item", (await page.locator("h3").count()) >= 1);

// Save search
await page.goto(BASE + "/tenders", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Save Search" }).click();
await page.getByLabel("Search Name").fill("Smoke search");
await page.getByRole("button", { name: "Save Search" }).last().click();
await page.waitForTimeout(1000);
await page.goto(BASE + "/saved-searches", { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
ok("saved search listed", (await page.getByText("Smoke search").count()) > 0);

// Other authenticated pages
for (const p of ["/notifications", "/profile", "/company", "/support", "/admin"]) {
  await page.goto(BASE + p, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  ok(`page ${p}`, !(await overflow()), `url=${new URL(page.url()).pathname}`);
}

// Mobile overflow
await page.setViewportSize({ width: 375, height: 800 });
for (const p of ["/dashboard", "/tenders", "/saved-tenders", "/profile", "/company"]) {
  await page.goto(BASE + p, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  ok(`mobile 375 no overflow ${p}`, !(await overflow()));
}
await page.setViewportSize({ width: 768, height: 900 });
await page.goto(BASE + "/tenders", { waitUntil: "networkidle" });
ok("tablet 768 no overflow /tenders", !(await overflow()));

// 404
const nf = await page.goto(BASE + "/tenders/00000000-0000-0000-0000-000000000000", { waitUntil: "networkidle" });
ok("unknown tender shows not-found page", (await page.locator("body").innerText()).includes("Page not found") || nf?.status() === 404);

const filtered = consoleErrors.filter((e) => !/favicon|Failed to load resource: the server responded with a status of (401|404)/.test(e));
ok("no unexpected console errors", filtered.length === 0, filtered.slice(0, 5).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
