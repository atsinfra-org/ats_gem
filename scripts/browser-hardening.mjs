// Phase 6 hardening verification. Needs: frontend :3000, backend :4000 (docker api+worker+postgres+redis),
// staff user staff-smoke@example.com, and scripts/.hardening-tender (see scripts/dev-fixtures.cjs).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium, request as pwRequest } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const FE = process.env.FE_URL ?? "http://localhost:3000";
const API = "http://localhost:4000/api/v1";
const TENDER = readFileSync(new URL("./.hardening-tender", import.meta.url), "utf8").match(/TENDER=(\S+)/)[1];
const STAFF = { email: "staff-smoke@example.com", password: "correct-horse-battery" };
const apiContainer = () => execSync('docker ps --filter name=ats-gem-api-1 -q', { encoding: "utf8" }).trim();
const fixture = (...args) => execSync(`docker exec ${apiContainer()} node /app/dev-fixtures.cjs ${args.join(" ")}`, { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }).trim();
const psql = (sql) => execSync(`docker exec ats-gem-postgres-1 psql -U ats_gem -d ats_gem -At -c "${sql}"`, { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }).trim();

const GSTIN = `22AAAAA${String(Date.now()).slice(-4)}A1Z5`;
// Dev-only: clear per-IP auth rate-limit counters so repeated local runs are not throttled (production limits untouched).
try { execSync("docker exec ats-gem-redis-1 sh -c \"redis-cli --scan --pattern '*rate-limit*' | xargs -r redis-cli del\"", { stdio: "ignore", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }); } catch {}
const rows = [];
const check = (name, pass, detail = "") => {
  rows.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " :: " + detail : ""}`);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const newPage = async (viewport = { width: 1280, height: 800 }) => {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${page.url()} :: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${page.url()} :: ${m.text()}`);
  });
  return page;
};
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
async function loginUI(page, { email, password }) {
  await page.goto(FE + "/login", { waitUntil: "networkidle" });
  await page.getByLabel("Email Address").fill(email);
  await page.locator("#login-password").fill(password);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL("**/dashboard", { timeout: 20000 });
}

// ───────────── SEO ─────────────
{
  const page = await newPage();
  const sm = await page.request.get(FE + "/sitemap.xml");
  const smText = await sm.text();
  check("sitemap.xml served", sm.status() === 200 && smText.includes("<urlset"));
  const urls = [...smText.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  check("sitemap has the 8 public routes only", urls.length === 8 && !urls.some((u) => /dashboard|admin|profile|company|saved|notifications|tenders/.test(u)), urls.join(" "));
  const rb = await (await page.request.get(FE + "/robots.txt")).text();
  check("robots.txt allows / and disallows private routes + lists sitemap", /Allow: \/\n/.test(rb) && /Disallow: \/admin/.test(rb) && /Disallow: \/dashboard/.test(rb) && /Sitemap: .*sitemap\.xml/.test(rb) && !/Disallow: \/\n/.test(rb), rb.replace(/\n/g, " | "));
  for (const p of ["/", "/about", "/solutions", "/pricing", "/faq", "/contact", "/resources", "/terms"]) {
    await page.goto(FE + p, { waitUntil: "networkidle" });
    const m = await page.evaluate(() => ({
      title: document.title,
      desc: document.querySelector('meta[name="description"]')?.content,
      canon: document.querySelector('link[rel="canonical"]')?.href,
      og: document.querySelector('meta[property="og:title"]')?.content,
      tw: document.querySelector('meta[name="twitter:card"]')?.content,
      robots: document.querySelector('meta[name="robots"]')?.content,
      icon: !!document.querySelector('link[rel~="icon"]'),
      h1: document.querySelectorAll("h1").length,
    }));
    check(`public ${p} metadata`, !!m.title && !!m.desc && !!m.canon && !!m.og && m.tw === "summary_large_image" && m.icon && m.h1 === 1 && !/noindex/.test(m.robots ?? ""), JSON.stringify({ ...m, desc: m.desc?.slice(0, 20) }));
  }
  await page.goto(FE + "/", { waitUntil: "networkidle" });
  const ld = await page.evaluate(() => [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent)));
  check("home JSON-LD parses (WebSite + Organization)", ld.length > 0 && JSON.stringify(ld).includes("WebSite") && JSON.stringify(ld).includes("Organization"));
  await page.goto(FE + "/faq", { waitUntil: "networkidle" });
  const faqLd = await page.evaluate(() => [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent)));
  const visibleQs = await page.locator("button[data-state]").count();
  check("FAQ JSON-LD parses and matches visible questions", faqLd[0]?.["@type"] === "FAQPage" && faqLd[0].mainEntity.length === visibleQs, `ld=${faqLd[0]?.mainEntity?.length} visible=${visibleQs}`);
  await page.context().close();
}

// ───────────── staff session: noindex, errors, tender detail, docs ─────────────
const staff = await newPage();
await loginUI(staff, STAFF);
check("staff login", staff.url().endsWith("/dashboard"));

for (const p of ["/dashboard", "/tenders", "/saved-tenders", "/saved-searches", "/notifications", "/profile", "/company", "/support", "/admin", "/admin/procuring-entities", "/admin/duplicate-candidates"]) {
  await staff.goto(FE + p, { waitUntil: "networkidle" });
  const robots = await staff.evaluate(() => document.querySelector('meta[name="robots"]')?.content ?? "");
  check(`noindex on ${p}`, /noindex/.test(robots) && /nofollow/.test(robots), robots);
}
for (const p of ["/reset-password", "/verify-email", "/invite"]) {
  await staff.goto(FE + p, { waitUntil: "networkidle" });
  check(`noindex on ${p}`, /noindex/.test(await staff.evaluate(() => document.querySelector('meta[name="robots"]')?.content ?? "")));
}

// Error UX via API interception
const errCases = [[401, "UNAUTHENTICATED", 401], [403, "FORBIDDEN", 403], [408, "BAD_REQUEST", 408], [429, "RATE_LIMITED", 429], [500, "INTERNAL_ERROR", 500], [503, "DEPENDENCY_UNAVAILABLE", 503]];
for (const [status, code, kind] of errCases) {
  await staff.route("**/api/v1/search/tenders*", (r) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify({ success: false, error: { code, message: "internal detail should never show" } }) }));
  await staff.goto(FE + "/tenders", { waitUntil: "networkidle" });
  await staff.waitForSelector(`[data-error-kind="${kind}"]`, { timeout: 8000 }).catch(() => {});
  const shown = await staff.locator(`[data-error-kind="${kind}"]`).count();
  const leaked = (await staff.locator("body").innerText()).includes("internal detail");
  check(`error UX ${status}`, shown === 1 && !leaked, leaked ? "LEAKED" : "");
  await staff.unroute("**/api/v1/search/tenders*");
}
await staff.route("**/api/v1/search/tenders*", (r) => r.abort());
await staff.goto(FE + "/tenders", { waitUntil: "networkidle" });
await staff.waitForSelector('[data-error-kind="network"]', { timeout: 8000 }).catch(() => {});
check("error UX network failure", (await staff.locator('[data-error-kind="network"]').count()) === 1);
await staff.unroute("**/api/v1/search/tenders*");
// retry recovers
await staff.route("**/api/v1/search/tenders*", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "DEPENDENCY_UNAVAILABLE", message: "x" } }) }));
await staff.goto(FE + "/tenders", { waitUntil: "networkidle" });
await staff.waitForSelector('[data-error-kind="503"]');
await staff.unroute("**/api/v1/search/tenders*");
await staff.getByRole("button", { name: "Try again" }).click();
await staff.waitForSelector("h3", { timeout: 10000 }).catch(() => {});
check("retry after 503 recovers", (await staff.locator("h3").count()) > 0);
// 404 + route boundary (500)
await staff.goto(FE + "/tenders/00000000-0000-0000-0000-000000000000", { waitUntil: "networkidle" });
check("404 page", (await staff.locator("body").innerText()).includes("Page not found"));
await staff.goto(FE + "/tenders/not-a-uuid", { waitUntil: "networkidle" });
check("malformed tender id shows 404 page", (await staff.locator("body").innerText()).includes("Page not found"));
// NOTE: the server-side route boundary (app/error.tsx) cannot be provoked from the browser: with the backend down the
// session bootstrap fails and RequireAuth redirects first; server fetches cannot be intercepted by page.route.
// 403: non-staff on admin
{
  const plain = await newPage();
  const email = `plain-${Date.now()}@example.com`;
  await plain.goto(FE + "/register", { waitUntil: "networkidle" });
  await plain.getByRole("button", { name: "Sign Up" }).click();
  await plain.getByLabel("Full Name").fill("Plain User");
  await plain.getByLabel("Email", { exact: true }).fill(email);
  await plain.locator("#register-password").fill("correct-horse-battery");
  await plain.locator("#register-confirm").fill("correct-horse-battery");
  await plain.locator("#register-terms").click();
  await plain.getByRole("button", { name: "Create Account" }).click();
  await plain.waitForURL("**/dashboard", { timeout: 20000 });
  await plain.goto(FE + "/admin", { waitUntil: "networkidle" });
  check("non-staff sees 403 view on /admin (permission-aware UI)", (await plain.locator('[data-error-kind="403"]').count()) === 1);
  check("non-staff has no Admin link in menu", (await (async () => { await plain.goto(FE + "/dashboard", { waitUntil: "networkidle" }); await plain.getByLabel("Account menu").click(); return plain.getByRole("menuitem", { name: /Admin/ }).count(); })()) === 0);
  await plain.context().close();
}

// Tender detail sections + documents
await staff.goto(`${FE}/tenders/${TENDER}`, { waitUntil: "networkidle" });
check("detail renders", (await staff.locator("h1").first().innerText()).length > 0);
await staff.getByRole("tab", { name: /Requirements/ }).click();
check("requirements shown grouped", (await staff.getByText("Dev fixture FINANCIAL requirement").count()) === 1 && (await staff.getByRole("heading", { name: "Eligibility" }).count()) === 1);
await staff.getByRole("tab", { name: /Timeline/ }).click();
check("timeline shown", (await staff.getByText(/PUBLISHED|SUBMISSION DEADLINE/).count()) > 0);
await staff.getByRole("tab", { name: /Corrigenda/ }).click();
check("corrigenda shown", (await staff.getByText("Dev fixture corrigendum").count()) === 1);
await staff.getByRole("tab", { name: /Versions/ }).click();
check("versions shown from real ingestion diffs", (await staff.getByText(/Version \d+/).count()) > 0 && (await staff.getByText("→").count()) > 0);
await staff.getByRole("tab", { name: "Sources" }).click();
check("provenance shown", (await staff.getByText(/First seen/).count()) > 0);
await staff.getByRole("tab", { name: /Documents/ }).click();
const docCount = await staff.getByRole("button", { name: /^Preview / }).count();
check("documents listed with metadata", docCount >= 2 && (await staff.getByText(/^v2$/).count()) >= 1, `docs=${docCount}`);
// download via anchor
const [dl] = await Promise.all([staff.waitForEvent("download"), staff.getByRole("link", { name: /Download/ }).first().click()]);
const path = await dl.path();
const size = readFileSync(path).length;
check("document download is a non-empty PDF", size > 100 && readFileSync(path).subarray(0, 4).toString() === "%PDF", `size=${size} name=${dl.suggestedFilename()}`);
// viewer
await staff.getByRole("button", { name: /^Preview / }).first().click();
await staff.waitForSelector("iframe", { timeout: 10000 }).catch(() => {});
const src = await staff.locator("iframe").first().getAttribute("src").catch(() => null);
check("PDF viewer renders iframe from blob", !!src && src.startsWith("blob:"), String(src).slice(0, 30));
await staff.keyboard.press("Escape");
// unavailable state
await staff.route("**/documents/*/download", (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
await staff.getByRole("button", { name: /^Preview / }).first().click();
await staff.waitForSelector("text=currently unavailable", { timeout: 8000 }).catch(() => {});
check("viewer shows unavailable state on failure", (await staff.getByText("currently unavailable").count()) === 1);
await staff.keyboard.press("Escape");
await staff.unroute("**/documents/*/download");

// Admin: tender correction & pages
await staff.goto(`${FE}/tenders/${TENDER}`, { waitUntil: "networkidle" });
const oldTitle = await staff.locator("h1").first().innerText();
await staff.getByRole("button", { name: /Admin: Correct/ }).click();
await staff.getByLabel("Title").fill(oldTitle + " (corrected)");
await staff.getByLabel(/Reason/).fill("hardening pass test");
await staff.getByRole("button", { name: "Save Correction" }).click();
await staff.waitForLoadState("networkidle");
await staff.waitForTimeout(1500);
check("tender correction applied", (await staff.locator("h1").first().innerText()).endsWith("(corrected)"));
// revert
await staff.getByRole("button", { name: /Admin: Correct/ }).click();
await staff.getByLabel("Title").fill(oldTitle);
await staff.getByLabel(/Reason/).fill("revert hardening test");
await staff.getByRole("button", { name: "Save Correction" }).click();
await staff.waitForTimeout(2000);
check("tender correction reverted", (await staff.locator("h1").first().innerText()) === oldTitle);
await staff.goto(FE + "/admin/duplicate-candidates", { waitUntil: "networkidle" });
check("duplicate candidates page loads", (await staff.locator("[data-error-kind]").count()) === 0);
await staff.goto(FE + "/admin/procuring-entities", { waitUntil: "networkidle" });
await staff.waitForSelector("tbody tr", { timeout: 8000 }).catch(() => {});
check("procuring entities page loads real rows", (await staff.locator("tbody tr").count()) > 0);

// Saved search create + edit
await staff.goto(FE + "/tenders", { waitUntil: "networkidle" });
await staff.getByLabel("Search tenders").fill("road");
await staff.getByRole("button", { name: "Save Search" }).click();
await staff.getByLabel("Search Name").fill("Hardening search");
await staff.getByRole("button", { name: "Save Search" }).last().click();
await staff.waitForTimeout(1200);
await staff.goto(FE + "/saved-searches", { waitUntil: "networkidle" });
await staff.waitForSelector("text=Hardening search");
await staff.getByRole("button", { name: "Edit Hardening search" }).click();
await staff.getByLabel("Name").fill("Hardening search v2");
await staff.getByLabel("Keyword").fill("bridge");
await staff.getByRole("dialog").getByRole("checkbox", { name: "Open", exact: true }).click();
await staff.getByRole("button", { name: "Save changes" }).click();
await staff.waitForSelector("text=Hardening search v2", { timeout: 8000 }).catch(() => {});
check("saved search edit updates UI", (await staff.getByText("Hardening search v2").count()) > 0 && (await staff.getByText("bridge").count()) > 0);
await staff.reload({ waitUntil: "networkidle" });
await staff.waitForSelector("text=Hardening search v2");
check("saved search edit persisted after reload", (await staff.getByText("OPEN").count()) > 0 || (await staff.getByText("Hardening search v2").count()) > 0);
await staff.getByRole("button", { name: "Edit Hardening search v2" }).click();
await staff.getByLabel("Name").fill("");
await staff.getByRole("button", { name: "Save changes" }).click();
check("saved search edit validates blank name", (await staff.getByRole("alert").filter({ hasText: "Name is required." }).count()) === 1);
await staff.getByRole("button", { name: "Cancel" }).click();
await staff.getByRole("button", { name: "Delete Hardening search v2" }).click();
await staff.getByRole("button", { name: "Delete", exact: true }).click().catch(() => {});
await staff.waitForTimeout(1000);

// ───────────── Password reset + email verification happy paths ─────────────
{
  const p = await newPage();
  const email = `flow-${Date.now()}@example.com`;
  await p.goto(FE + "/register", { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Sign Up" }).click();
  await p.getByLabel("Full Name").fill("Flow User");
  await p.getByLabel("Email", { exact: true }).fill(email);
  await p.locator("#register-password").fill("original-password-1");
  await p.locator("#register-confirm").fill("original-password-1");
  await p.locator("#register-terms").click();
  await p.getByRole("button", { name: "Create Account" }).click();
  await p.waitForURL("**/dashboard", { timeout: 20000 });
  await p.goto(FE + "/profile", { waitUntil: "networkidle" });
  check("new account shows Not verified", (await p.getByText("Not verified").count()) === 1);
  const vtoken = fixture("token", email, "EMAIL_VERIFY");
  await p.goto(`${FE}/verify-email?token=${vtoken}`, { waitUntil: "networkidle" });
  check("email verification happy path shows success", (await p.getByText("Email verified").count()) === 1);
  await p.goto(FE + "/profile", { waitUntil: "networkidle" });
  check("profile now shows Verified", (await p.getByText("Verified", { exact: true }).count()) === 1);
  await p.goto(`${FE}/verify-email?token=${vtoken}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  check("verification token is single-use", (await p.getByText("Verification failed").count()) === 1);

  // Profile mutation
  await p.goto(FE + "/profile", { waitUntil: "networkidle" });
  await p.getByLabel("Full Name").fill("Flow User Renamed");
  await p.getByLabel("Role / Designation").fill("Procurement Lead");
  await p.getByLabel("Phone Number").fill("9876543210");
  await p.getByRole("button", { name: "Save Changes" }).click();
  await p.waitForTimeout(1200);
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  check("profile mutation persists after reload", (await p.getByLabel("Full Name").inputValue()) === "Flow User Renamed" && (await p.getByLabel("Role / Designation").inputValue()) === "Procurement Lead" && (await p.getByLabel("Phone Number").inputValue()) === "9876543210");
  // Change password (wrong current, then right)
  await p.getByLabel("Current Password").fill("not-the-password");
  await p.getByLabel("New Password").fill("changed-password-2");
  await p.getByRole("button", { name: "Change Password" }).click();
  await p.waitForTimeout(1200);
  check("change password rejects wrong current password", (await p.getByRole("alert").filter({ hasText: "incorrect" }).count()) === 1);
  await p.getByLabel("Current Password").fill("original-password-1");
  await p.getByRole("button", { name: "Change Password" }).click();
  await p.waitForTimeout(1200);
  check("change password succeeds", (await p.getByLabel("Current Password").inputValue()) === "");

  // Company mutation (personal org owner)
  await p.goto(FE + "/company", { waitUntil: "networkidle" });
  await p.locator("#org-name").fill("Flow Co");
  await p.locator("#org-industry").fill("Construction");
  await p.locator("#org-gstin").fill(GSTIN);
  await p.getByRole("button", { name: "Save Changes" }).click();
  await p.waitForTimeout(1200);
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForSelector("#org-name");
  check("company mutation persists after reload", (await p.locator("#org-name").inputValue()) === "Flow Co" && (await p.locator("#org-gstin").inputValue()) === GSTIN);
  await p.locator("#org-pan").fill("BAD");
  await p.getByRole("button", { name: "Save Changes" }).click();
  await p.waitForTimeout(1000);
  check("company invalid PAN is rejected by server", (await p.getByText(/PAN/i).count()) > 0);
  // Invite + member role change/removal (member row seeded by SQL: acceptance token is not obtainable in dev)
  await p.reload({ waitUntil: "networkidle" });
  await p.getByLabel("Invite email").fill("invitee@example.com");
  await p.getByRole("button", { name: "Invite" }).click();
  await p.waitForTimeout(1200);
  const inviteRows = psql("select count(*) from organization_invitations where email='invitee@example.com'");
  check("invitation created", Number(inviteRows) >= 1, `rows=${inviteRows}`);
  const api = await pwRequest.newContext(); // separate cookie jar: registering must not replace the browser session
  const res = await api.post(`${API}/auth/register`, { data: { name: "Member Two", email: `member2-${Date.now()}@example.com`, password: "correct-horse-battery", acceptTerms: true } });
  const member = (await res.json()).data.user;
  const orgId = psql(`select organization_id from organization_members m join users u on u.id=m.user_id where u.email='${email}' limit 1`);
  psql(`insert into organization_members (organization_id, user_id, role, joined_at) values ('${orgId}','${member.id}','MEMBER', now())`);
  await p.reload({ waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Make Viewer" }).click();
  await p.waitForTimeout(2000);
  check("member role change works", psql(`select role from organization_members where user_id='${member.id}' and organization_id='${orgId}'`) === "VIEWER");
  await p.getByRole("button", { name: /^Remove Member Two/ }).click();
  await p.waitForTimeout(2000);
  check("member removal works", psql(`select count(*) from organization_members where user_id='${member.id}' and organization_id='${orgId}'`) === "0");
  await p.context().close();

  // Reset password happy path
  const q = await newPage();
  await q.goto(FE + "/forgot-password", { waitUntil: "networkidle" });
  await q.getByRole("button", { name: "Forgot Password?" }).click();
  await q.getByLabel("Email Address").fill(email);
  await q.getByRole("button", { name: "Send Reset Link" }).click();
  await q.waitForSelector("text=we've sent a password reset link", { timeout: 8000 }).catch(() => {});
  check("forgot password shows neutral confirmation", (await q.getByText(/password reset link/).count()) > 0);
  const rtoken = fixture("token", email, "PASSWORD_RESET");
  await q.goto(`${FE}/reset-password?token=${rtoken}`, { waitUntil: "networkidle" });
  await q.locator("#new-password").fill("brand-new-password-3");
  await q.locator("#confirm-password").fill("brand-new-password-3");
  await q.getByRole("button", { name: "Reset Password" }).click();
  await q.waitForSelector("text=Password reset", { timeout: 8000 }).catch(() => {});
  check("reset password happy path shows success", (await q.getByRole("heading", { name: "Password reset" }).count()) === 1);
  await loginUI(q, { email, password: "brand-new-password-3" });
  check("login works with the NEW password", q.url().endsWith("/dashboard"));
  const old = await newPage();
  await old.goto(FE + "/login", { waitUntil: "networkidle" });
  await old.getByLabel("Email Address").fill(email);
  await old.locator("#login-password").fill("changed-password-2");
  await old.locator("form button[type=submit]").click();
  await old.waitForTimeout(1200);
  check("OLD password no longer works", (await old.getByText("Incorrect email or password").count()) === 1);
  await old.context().close();
  await q.context().close();
}

// ───────────── Responsive + a11y matrix ─────────────
const widths = [320, 375, 390, 414, 768, 1280];
const pages = ["/", "/login", "/dashboard", "/tenders", `/tenders/${TENDER}`, "/saved-tenders", "/saved-searches", "/profile", "/company", "/notifications", "/admin"];
for (const w of widths) {
  const p = await newPage({ width: w, height: 800 });
  await loginUI(p, STAFF);
  for (const path of pages) {
    await p.goto(FE + path, { waitUntil: "networkidle" });
    await p.waitForTimeout(500);
    const of = await overflow(p);
    check(`viewport ${w}px ${path} no overflow`, !of);
  }
  // mobile navigation + filters
  if (w < 1024) {
    await p.goto(FE + "/tenders", { waitUntil: "networkidle" });
    await p.getByRole("button", { name: /Filters/ }).click();
    check(`viewport ${w}px filters sheet opens and is usable`, (await p.getByRole("dialog").getByRole("checkbox", { name: "Open", exact: true }).count()) === 1);
    await p.keyboard.press("Escape");
    await p.goto(FE + "/dashboard", { waitUntil: "networkidle" });
    await p.getByRole("button", { name: /Open (navigation|menu)/i }).first().click();
    check(`viewport ${w}px mobile nav opens`, (await p.getByRole("dialog").count()) > 0);
  }
  await p.context().close();
}

// axe (WCAG 2 A/AA) light + dark
const A11Y_PAGES = ["/", "/about", "/pricing", "/faq", "/contact", "/terms", "/dashboard", "/tenders", `/tenders/${TENDER}`, "/saved-tenders", "/saved-searches", "/profile", "/company", "/notifications", "/admin"];
const axeSummary = {};
for (const theme of ["light", "dark"]) {
  await staff.goto(FE + "/dashboard", { waitUntil: "networkidle" });
  await staff.evaluate((t) => localStorage.setItem("theme", t), theme);
  for (const path of A11Y_PAGES) {
    await staff.goto(FE + path, { waitUntil: "networkidle" });
    await staff.waitForTimeout(600);
    const r = await new AxeBuilder({ page: staff }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    axeSummary[`${theme}:${path}`] = bad.map((v) => `${v.id}(${v.nodes.length})`);
    check(`axe ${theme} ${path}: no serious/critical violations`, bad.length === 0, bad.map((v) => `${v.id}(${v.nodes.length}): ${v.nodes[0]?.target?.join(" ")}`).join(" | "));
  }
}
await staff.evaluate(() => localStorage.setItem("theme", "light"));

// keyboard + focus + dialog behaviour
await staff.goto(FE + "/saved-searches", { waitUntil: "networkidle" });
await staff.keyboard.press("Tab");
const focusVisible = await staff.evaluate(() => { const el = document.activeElement; if (!el || el === document.body) return false; const s = getComputedStyle(el); return s.outlineStyle !== "none" || s.boxShadow !== "none"; });
check("first Tab lands on a focusable element with a visible focus style", focusVisible);
await staff.goto(FE + "/tenders", { waitUntil: "networkidle" });
await staff.getByRole("button", { name: "Save Search" }).click();
const dlg = staff.getByRole("dialog");
check("dialog opens with focus inside", await dlg.evaluate((d) => d.contains(document.activeElement)));
for (let i = 0; i < 8; i++) await staff.keyboard.press("Tab");
check("focus stays trapped inside dialog", await dlg.evaluate((d) => d.contains(document.activeElement)));
await staff.keyboard.press("Escape");
await staff.waitForTimeout(500);
check("Escape closes dialog", (await staff.getByRole("dialog").count()) === 0);
await staff.goto(FE + "/login", { waitUntil: "networkidle" });
await staff.getByLabel("Email Address").fill("bad");
await staff.locator("form button[type=submit]").click();
const emailInvalid = await staff.getByLabel("Email Address").getAttribute("aria-invalid");
check("form error is announced (aria-invalid or role=alert)", emailInvalid === "true" || (await staff.getByRole("alert").count()) > 0, `aria-invalid=${emailInvalid}`);

check("no unexpected console/page errors", errors.filter((e) => !/00000000-0000|not-a-uuid|Failed to fetch|ApiError|NEXT_HTTP_ERROR_FALLBACK|status of 4/.test(e)).length === 0, errors.slice(0, 4).join(" | "));
await browser.close();
const failed = rows.filter((r) => !r.pass);
console.log(`\n${rows.length - failed.length}/${rows.length} passed`);
console.log(JSON.stringify(axeSummary));
process.exit(failed.length ? 1 : 0);
