// Phase 8 browser suite: notification center, bell, preferences, saved-search alert controls, mobile, accessibility.
// Needs the Docker stack (api + worker + postgres + redis) and the frontend on :3000. Seeds controlled rows (removed at the end).
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const BASE = process.env.FE_URL ?? "http://localhost:3000";
const API = process.env.API_URL ?? "http://localhost:4000/api/v1";
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` :: ${detail}`}`);
};
const psql = (sql) => execSync(`docker exec ats-gem-postgres-1 psql -U ats_gem -d ats_gem -At -c "${sql.replace(/"/g, '\\"')}"`, { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }).trim();

const stamp = Date.now();
const email = `p8ui-${stamp}@example.com`;
const emptyEmail = `p8ui-empty-${stamp}@example.com`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource|net::ERR_FAILED/.test(m.text())) consoleErrors.push(`${page.url()} :: ${m.text()}`);
});
page.on("pageerror", (e) => consoleErrors.push(`${page.url()} :: ${e.message}`));

const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const settle = async () => {
  await page.waitForLoadState("networkidle");
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await page.waitForTimeout(150);
  }
  return false;
};

async function signUp(addr) {
  await page.goto(BASE + "/register", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Sign Up" }).click();
  await page.getByLabel("Full Name").fill("P8 UI Tester");
  await page.getByLabel("Email", { exact: true }).fill(addr);
  await page.locator("#register-password").fill("correct-horse-battery");
  await page.locator("#register-confirm").fill("correct-horse-battery");
  await page.locator("#register-terms").click();
  await page.getByRole("button", { name: "Create Account" }).click();
  await page.waitForURL("**/dashboard", { timeout: 15000 });
  psql(`UPDATE users SET is_email_verified = true WHERE email = '${addr}'`);
}

let tenderLive;
let tenderGone;
try {
  // ---- empty state for a brand-new user ----
  await signUp(emptyEmail);
  await page.goto(BASE + "/notifications", { waitUntil: "networkidle" });
  check("empty state for a user with no notifications", (await page.getByText("No notifications", { exact: true }).count()) === 1 && (await page.getByText("0 unread notifications").count()) === 1);
  const emptyAxe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  check("axe empty notification center: no serious/critical violations", emptyAxe.violations.filter((v) => ["serious", "critical"].includes(v.impact)).length === 0, emptyAxe.violations.map((v) => v.id).join(","));
  await ctx.clearCookies();
  await page.evaluate(() => localStorage.clear());

  // ---- seed a user with varied notifications ----
  await signUp(email);
  const uid = psql(`SELECT id FROM users WHERE email = '${email}'`);
  tenderLive = psql(`INSERT INTO tenders (id, title, published_at, currency, lifecycle, status, status_computed_at, last_synced_at, updated_at, state_code) VALUES (gen_random_uuid(), '[P8 UI FIXTURE] Live tender', now() - interval '2 days', 'INR', 'ACTIVE', 'OPEN', now(), now(), now(), 'MH') RETURNING id`).split("\n")[0];
  tenderGone = psql(`INSERT INTO tenders (id, title, published_at, currency, lifecycle, status, status_computed_at, last_synced_at, updated_at, state_code, deleted_at) VALUES (gen_random_uuid(), '[P8 UI FIXTURE] Removed tender', now() - interval '2 days', 'INR', 'ACTIVE', 'OPEN', now(), now(), now(), 'MH', now()) RETURNING id`).split("\n")[0];
  const ins = (type, title, message, { entity = "NULL", priority = "NORMAL", read = false, ageMin = 1, expires = "NULL" } = {}) =>
    psql(`INSERT INTO notifications (id, user_id, type, title, message, entity_type, entity_id, priority, metadata, dedup_key, is_read, read_at, expires_at, created_at) VALUES ('${randomUUID()}', '${uid}', '${type}', '${title}', '${message}', ${entity === "NULL" ? "NULL" : "'tender'"}, ${entity === "NULL" ? "NULL" : `'${entity}'`}, '${priority}', '{}'::jsonb, 'ui:${randomUUID()}', ${read}, ${read ? "now()" : "NULL"}, ${expires}, now() - interval '${ageMin} minutes')`);
  ins("TENDER_UPDATED", "Tender updated: Live tender", "The closing date is now 20 Nov 2026 (was 1 Oct 2026).", { entity: tenderLive, ageMin: 1 });
  ins("TENDER_CORRIGENDUM", "Corrigendum issued: Live tender", "Bid due date extended", { entity: tenderLive, priority: "HIGH", ageMin: 2 });
  ins("TENDER_CANCELLED", "Tender cancelled: Removed tender", "The procuring entity has cancelled this tender.", { entity: tenderGone, priority: "HIGH", ageMin: 3 });
  ins("SECURITY", "Your password was changed", "The password was just changed.", { priority: "CRITICAL", ageMin: 4 });
  ins("TENDER_DEADLINE", "Expired reminder", "should not be shown", { entity: tenderLive, expires: "now() - interval '1 hour'", ageMin: 5 });
  ins("ACCOUNT", "Old read item", "already read", { read: true, ageMin: 6 });
  for (let i = 0; i < 24; i++) ins("SAVED_SEARCH_MATCH", `Match number ${i}`, "Fixture match", { entity: tenderLive, ageMin: 10 + i, read: i % 2 === 0 });
  // total visible = 6 -1 expired + 24 = 29 ; unread = 4 + 12 = 16

  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  const bell = page.getByRole("button", { name: /^Notifications \(/ });
  check("bell shows the unread count in its accessible name (expired excluded)", await until(async () => (await bell.getAttribute("aria-label")) === "Notifications (16 unread)"), await bell.getAttribute("aria-label"));

  await bell.click();
  const menu = page.getByRole("dialog", { name: "Notifications" });
  await menu.getByRole("list", { name: "Recent notifications" }).waitFor();
  check("bell lists recent notifications (newest first) with a link to view all", (await menu.getByRole("listitem").count()) === 5 && (await menu.getByRole("link", { name: "View all notifications" }).count()) === 1);
  await menu.getByRole("link", { name: /Tender updated: Live tender/ }).click();
  await page.waitForURL(`**/tenders/${tenderLive}`);
  check("clicking a tender notification opens that tender (deep link)", (await page.getByText("[P8 UI FIXTURE] Live tender").count()) > 0);
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  check("opening it marked it read (badge decremented)", await until(async () => (await page.getByRole("button", { name: /^Notifications \(/ }).getAttribute("aria-label")) === "Notifications (15 unread)"));

  // ---- notification center ----
  await page.goto(BASE + "/notifications", { waitUntil: "networkidle" });
  await page.getByRole("list", { name: "Notifications" }).waitFor();
  check("center lists 20 per page with total 29 (expired hidden)", (await page.getByRole("list", { name: "Notifications" }).getByRole("listitem").count()) === 20 && (await page.getByText(/Page 1 of 2 · 29 total/).count()) === 1);
  check("unread items are announced as unread (not colour only)", (await page.getByText("Unread.", { exact: false }).count()) > 0);
  check("removed tender shows an explanation and no link", (await page.getByText("This tender is no longer available.").count()) === 1 && (await page.getByRole("link", { name: /Tender cancelled: Removed tender/ }).count()) === 0);
  check("live tender notifications are links", (await page.getByRole("link", { name: /Corrigendum issued: Live tender/ }).count()) === 1);
  check("critical and important priorities are labelled with text", (await page.getByText("Critical", { exact: true }).count()) === 1 && (await page.getByText("Important", { exact: true }).count()) >= 1);
  check("expired notification is hidden", (await page.getByText("Expired reminder").count()) === 0);

  const first = page.getByRole("button", { name: /^Mark as read: Corrigendum issued/ });
  await first.click();
  check("mark read toggles the row and updates the count", await until(async () => (await page.getByRole("button", { name: /^Mark as unread: Corrigendum issued/ }).count()) === 1 && (await page.getByText("14 unread notifications").count()) === 1));
  await page.getByRole("button", { name: /^Mark as unread: Corrigendum issued/ }).click();
  check("mark unread restores it", await until(async () => (await page.getByText("15 unread notifications").count()) === 1));

  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText(/Page 2 of 2/).waitFor();
  check("pagination shows the remaining items", (await page.getByRole("list", { name: "Notifications" }).getByRole("listitem").count()) === 9);
  await page.getByRole("button", { name: "Previous" }).click();

  await page.getByRole("tab", { name: "Unread" }).click();
  await page.getByText(/unread/i).first().waitFor();
  check("unread tab shows only unread (server-side)", await until(async () => (await page.getByRole("list", { name: "Notifications" }).getByRole("listitem").count()) === 15 && (await page.getByRole("button", { name: /^Mark as unread/ }).count()) === 0));
  await page.getByRole("tab", { name: "All" }).click();

  await page.getByLabel("Filter by notification type").click();
  await page.getByRole("option", { name: "Corrigendum" }).click();
  check("type filter narrows to one type", await until(async () => (await page.getByRole("list", { name: "Notifications" }).getByRole("listitem").count()) === 1));
  await page.getByLabel("Filter by notification type").click();
  await page.getByRole("option", { name: "Security" }).click();
  check("security filter shows the critical item", await until(async () => (await page.getByText("Your password was changed").count()) === 1));
  await page.getByLabel("Filter by notification type").click();
  await page.getByRole("option", { name: "Account" }).click();
  await page.getByLabel("Filter by notification type").click();
  await page.getByRole("option", { name: "Deadline reminder" }).click();
  check("a type with only expired items shows the empty state", await until(async () => (await page.getByText("No notifications of this type").count()) === 1));
  await page.getByLabel("Filter by notification type").click();
  await page.getByRole("option", { name: "All types" }).click();

  // focus-refresh picks up a new notification without a reload
  psql(`INSERT INTO notifications (id, user_id, type, title, message, dedup_key, priority, metadata) VALUES ('${randomUUID()}', '${uid}', 'SECURITY', 'Fresh security notice', 'x', 'ui:fresh-${stamp}', 'CRITICAL', '{}'::jsonb)`);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  check("a new notification is picked up on window focus (badge)", await until(async () => (await page.getByRole("button", { name: /^Notifications \(/ }).getAttribute("aria-label")) === "Notifications (16 unread)", 10000));

  // error + retry
  await page.route("**/notifications?**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "DEPENDENCY_UNAVAILABLE", message: "down" } }) }));
  await page.goto(BASE + "/notifications", { waitUntil: "networkidle" });
  const retry = page.getByRole("button", { name: /retry|try again/i });
  check("a failing notification API shows a retryable error, not a crash", await until(async () => (await retry.count()) > 0) && (await page.getByText("Something went wrong").count()) === 0);
  await page.unroute("**/notifications?**");
  await retry.first().click();
  check("retry recovers", await until(async () => (await page.getByRole("list", { name: "Notifications" }).count()) === 1));

  await page.getByRole("button", { name: "Mark all read" }).click();
  check("Mark all read clears the count and the badge", await until(async () => (await page.getByText("0 unread notifications").count()) === 1 && (await page.getByRole("button", { name: /^Notifications \(0 unread\)/ }).count()) === 1));
  await page.reload({ waitUntil: "networkidle" });
  check("read state persists after reload", (await page.getByText("0 unread notifications").count()) === 1);

  // ---- preferences ----
  await page.goto(BASE + "/profile?tab=notifications", { waitUntil: "networkidle" });
  check("preferences card is reachable from the alert-email link and receives focus", await until(async () => (await page.evaluate(() => document.activeElement?.id)) === "notifications"));
  const corrEmail = page.getByRole("switch", { name: "Corrigenda: email notifications" });
  check("preferences load from the backend with documented defaults", (await corrEmail.getAttribute("aria-checked")) === "true" && (await page.getByRole("checkbox", { name: "1 day before" }).getAttribute("aria-checked")) === "true" && (await page.getByRole("checkbox", { name: "3 hours before" }).getAttribute("aria-checked")) === "false");
  check("security row is locked on", (await page.getByRole("switch", { name: "Account and security: email notifications" }).isDisabled()) && (await page.getByRole("switch", { name: "Account and security: in-app notifications" }).isDisabled()));
  await corrEmail.click();
  await page.getByRole("checkbox", { name: "3 hours before" }).click();
  await page.getByRole("switch", { name: "Hold emails during quiet hours" }).click();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await page.getByText("Notification preferences saved").waitFor();
  check("saving persists (button disabled again)", await until(async () => await page.getByRole("button", { name: "Save preferences" }).isDisabled()));
  await page.reload({ waitUntil: "networkidle" });
  check("preferences persist across reload", (await page.getByRole("switch", { name: "Corrigenda: email notifications" }).getAttribute("aria-checked")) === "false" && (await page.getByRole("checkbox", { name: "3 hours before" }).getAttribute("aria-checked")) === "true" && (await page.getByLabel("Quiet hours start").inputValue()) === "22:00");
  const apiPrefs = psql(`SELECT count(*) FROM notification_preferences WHERE user_id = '${uid}' AND category = 'CORRIGENDA' AND channel = 'EMAIL' AND enabled = false`);
  check("the change is stored server-side (not just in the browser)", apiPrefs === "1");
  await page.getByRole("switch", { name: "Corrigenda: email notifications" }).click();
  await page.getByRole("button", { name: "Reset" }).click();
  check("Reset discards an unsaved change", (await page.getByRole("switch", { name: "Corrigenda: email notifications" }).getAttribute("aria-checked")) === "false");

  // ---- saved search alerts ----
  await page.goto(BASE + "/tenders?q=road&state=MH", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Save Search" }).click();
  await page.getByLabel("Search Name").fill("P8 alert search");
  await page.getByLabel("Alerts", { exact: true }).selectOption("DAILY");
  await page.getByRole("dialog").getByRole("button", { name: "Save Search" }).click();
  await page.getByText("Search saved").waitFor();
  check("saving a search with a daily digest stores the alert frequency", psql(`SELECT alert_frequency FROM saved_searches WHERE created_by = '${uid}' AND name = 'P8 alert search'`) === "DAILY");
  await page.goto(BASE + "/saved-searches", { waitUntil: "networkidle" });
  const sel = page.getByRole("combobox", { name: "Alerts for P8 alert search" });
  check("saved searches show the current alert setting", (await sel.inputValue()) === "DAILY");
  await sel.selectOption("IMMEDIATE");
  await page.getByText("You will be alerted as new tenders arrive").waitFor();
  check("changing alerts on a saved search persists", psql(`SELECT alert_frequency FROM saved_searches WHERE created_by = '${uid}' AND name = 'P8 alert search'`) === "IMMEDIATE");
  await sel.selectOption("OFF");
  await page.getByText("Alerts turned off").waitFor();

  // ---- accessibility ----
  const scan = async (label) => {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const bad = r.violations.filter((v) => ["serious", "critical"].includes(v.impact));
    check(`axe ${label}: no serious/critical violations`, bad.length === 0, bad.map((v) => `${v.id}(${v.nodes.length}): ${v.nodes[0]?.target?.join(" ")}`).join(" | "));
    return r.violations.length;
  };
  const axeAll = {};
  await page.goto(BASE + "/notifications", { waitUntil: "networkidle" });
  await page.getByRole("list", { name: "Notifications" }).waitFor();
  axeAll.center = await scan("notification center");
  await page.getByRole("button", { name: /^Notifications \(/ }).click();
  await page.getByRole("dialog", { name: "Notifications" }).getByRole("list", { name: "Recent notifications" }).waitFor();
  await page.waitForTimeout(700); // let the popover fade-in finish (axe reads mid-animation colours otherwise)
  axeAll.bell = await scan("bell menu open");
  await page.keyboard.press("Escape");
  await page.goto(BASE + "/profile?tab=notifications", { waitUntil: "networkidle" });
  await page.getByRole("switch", { name: "Corrigenda: email notifications" }).waitFor();
  axeAll.prefs = await scan("notification preferences");
  await page.goto(BASE + "/saved-searches", { waitUntil: "networkidle" });
  axeAll.saved = await scan("saved searches with alert controls");
  for (const path of ["/notifications", "/profile?tab=notifications"]) {
    await page.evaluate(() => localStorage.setItem("theme", "dark"));
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    axeAll[`dark ${path}`] = await scan(`dark ${path}`);
    await page.evaluate(() => localStorage.setItem("theme", "light"));
  }
  console.log("axe total violations (all impacts):", JSON.stringify(axeAll));

  // keyboard: the toggle button and item are reachable
  await page.goto(BASE + "/notifications", { waitUntil: "networkidle" });
  await page.getByRole("list", { name: "Notifications" }).waitFor();
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => /^Mark as (read|unread):/.test(document.activeElement?.getAttribute("aria-label") ?? ""));
  }
  check("keyboard users can reach the per-notification read/unread control", reached);

  // ---- responsive ----
  for (const w of [320, 375, 390, 414, 768, 1280]) {
    await page.setViewportSize({ width: w, height: 800 });
    for (const path of ["/notifications", "/profile?tab=notifications", "/saved-searches"]) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      check(`no horizontal overflow at ${w}px ${path}`, !(await overflow()));
    }
  }
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(BASE + "/notifications", { waitUntil: "networkidle" });
  const card = page.getByRole("list", { name: "Notifications" }).getByRole("listitem").first();
  const box = await card.boundingBox();
  check("notification rows stay readable on a 375px phone (within the viewport, titles visible)", !!box && box.x >= 0 && box.x + box.width <= 376 && (await card.getByText(/Fresh security notice|Tender updated|Match number/).count()) > 0);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(BASE + "/profile?tab=notifications", { waitUntil: "networkidle" });
  const sw = await page.getByRole("switch", { name: "Corrigenda: email notifications" }).boundingBox();
  check("preference switches are visible and tappable on a phone", !!sw && sw.x >= 0 && sw.x + sw.width <= 376 && sw.width >= 30);
  await page.setViewportSize({ width: 1280, height: 900 });

  check("no console/page errors during the run", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} catch (err) {
  check("script ran to completion", false, String(err).slice(0, 400));
} finally {
  psql(`DELETE FROM users WHERE email IN ('${email}', '${emptyEmail}')`);
  psql("DELETE FROM tenders WHERE title LIKE '[P8 UI FIXTURE]%'");
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
