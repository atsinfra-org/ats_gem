// Auth/admin/theme smoke test. Requires a staff user (see README): staff-smoke@example.com / correct-horse-battery
import { chromium } from "playwright";

const BASE = process.env.FE_URL ?? "http://localhost:3000";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${detail}`);
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

// Wrong password -> inline error
await page.goto(BASE + "/login", { waitUntil: "networkidle" });
await page.getByLabel("Email Address").fill("staff-smoke@example.com");
await page.locator("#login-password").fill("wrong-password-here");
await page.locator('form button[type=submit]').click();
await page.waitForTimeout(1500);
ok("wrong password shows error", (await page.getByText("Incorrect email or password").count()) > 0);

// Correct login
await page.locator("#login-password").fill("correct-horse-battery");
await page.locator('form button[type=submit]').click();
await page.waitForURL("**/dashboard", { timeout: 15000 }).catch(() => {});
ok("login -> dashboard", page.url().endsWith("/dashboard"));

// Facets: state filter round-trip
await page.goto(BASE + "/tenders", { waitUntil: "networkidle" });
await page.waitForSelector("h3");
await page.getByRole("checkbox", { name: "Open", exact: true }).click();
await page.waitForTimeout(1500);
ok("status filter applies without error", (await page.getByText("Something went wrong").count()) === 0);

// Sort
await page.getByLabel("Sort results").click();
await page.getByRole("option", { name: "Value: high to low" }).click();
await page.waitForTimeout(1200);
ok("sort applies without error", (await page.getByText("Something went wrong").count()) === 0);

// Pagination
const next = page.getByRole("button", { name: "Next", exact: true });
if (await next.isEnabled()) {
  await next.click();
  await page.waitForTimeout(1200);
  ok("pagination next works", (await page.getByText(/Page 2 of/).count()) > 0);
} else ok("pagination next works", true, "(single page)");

// Admin pages (staff)
for (const p of ["/admin", "/admin/procuring-entities", "/admin/duplicate-candidates"]) {
  await page.goto(BASE + p, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  ok(`admin ${p} accessible`, new URL(page.url()).pathname === p);
}
await page.goto(BASE + "/admin/procuring-entities", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
ok("procuring entities load real rows", (await page.locator("tbody tr").count()) > 0);

// Dark mode
await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
await page.getByLabel("Account menu").click();
await page.getByRole("menuitem", { name: /Dark Mode/ }).click();
await page.waitForTimeout(500);
ok("dark mode toggles class", await page.evaluate(() => document.documentElement.classList.contains("dark")));

// Logout
await page.getByLabel("Account menu").click();
await page.getByRole("menuitem", { name: /Log Out/ }).click();
await page.waitForTimeout(1500);
await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
ok("after logout /dashboard is guarded", new URL(page.url()).pathname === "/");

ok("no uncaught page errors", errs.length === 0, errs.slice(0, 3).join(" | "));
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
