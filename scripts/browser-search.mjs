// Phase 7 search & discovery browser suite. Requires the frontend (3000), the API (4000) and the dev fixtures
// (`scripts/dev-fixtures.cjs`: 25 tenders across 10 organizations). Usage: node scripts/browser-search.mjs
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const BASE = process.env.FE_URL ?? "http://localhost:3000";
const API = process.env.API_URL ?? "http://localhost:4000/api/v1";
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` :: ${detail}`}`);
};

import { execSync } from "node:child_process";

// Controlled, removable dev fixture: two districts named "DevFix ..." attached to existing dev tenders by city.
// Torn down (district_id cleared, districts deleted) after the district/city section, even on failure.
const psql = (sql) => execSync(`docker exec ats-gem-postgres-1 psql -U ats_gem -d ats_gem -At -c "${sql}"`, { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }).trim();
function setupDistrictFixture() {
  teardownDistrictFixture();
  psql("INSERT INTO districts (id, state_code, name) VALUES (gen_random_uuid(), 'MH', 'DevFix Pune'), (gen_random_uuid(), 'GJ', 'DevFix Gandhinagar')");
  psql("UPDATE tenders SET district_id = (SELECT id FROM districts WHERE name = 'DevFix Pune') WHERE lower(city) = 'pune' AND state_code = 'MH'");
  psql("UPDATE tenders SET district_id = (SELECT id FROM districts WHERE name = 'DevFix Gandhinagar') WHERE lower(city) = 'gandhinagar'");
  return { puneId: psql("SELECT id FROM districts WHERE name = 'DevFix Pune'") };
}
function teardownDistrictFixture() {
  psql("UPDATE tenders SET district_id = NULL WHERE district_id IN (SELECT id FROM districts WHERE name LIKE 'DevFix %')");
  psql("DELETE FROM districts WHERE name LIKE 'DevFix %'");
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource/.test(m.text())) consoleErrors.push(`${page.url()} :: ${m.text()}`);
});
page.on("pageerror", (e) => consoleErrors.push(`${page.url()} :: ${e.message}`));

const settle = async () => {
  await page.waitForLoadState("networkidle");
  await page.getByText("Searching...").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
};
const cards = () => page.locator("h3").filter({ hasNotText: "Filters" });
const url = () => new URL(page.url());
const param = (k) => url().searchParams.get(k);
const box = () => page.getByRole("combobox", { name: "Search tenders" });
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const titles = async () => (await page.locator('a[href^="/tenders/"] h3').allInnerTexts()).map((t) => t.trim());
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await page.waitForTimeout(150);
  }
  return false;
};
const total = async () => {
  const t = await page.getByRole("status").filter({ hasText: "results" }).first().innerText();
  return Number(/of\s+([\d,]+)/.exec(t)?.[1].replace(/,/g, "") ?? -1);
};

// ---- sign up (fresh user => empty history) ----
const email = `search-${Date.now()}@example.com`;
await page.goto(BASE + "/register", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Sign Up" }).click();
await page.getByLabel("Full Name").fill("Search Tester");
await page.getByLabel("Email", { exact: true }).fill(email);
await page.locator("#register-password").fill("correct-horse-battery");
await page.locator("#register-confirm").fill("correct-horse-battery");
await page.locator("#register-terms").click();
await page.getByRole("button", { name: "Create Account" }).click();
await page.waitForURL("**/dashboard", { timeout: 15000 }).catch(() => {});
check("registered and signed in", page.url().endsWith("/dashboard"));

// ---- 1. URL is the source of truth ----
await page.goto(BASE + "/tenders?q=road&state=GJ", { waitUntil: "networkidle" });
await settle();
check("deep link restores keyword in the search box", (await box().inputValue()) === "road");
check("deep link shows state chip with its name", (await page.getByRole("button", { name: "Remove filter State: Gujarat" }).count()) === 1);
const gj = await titles();
check("deep link results are real and filtered", gj.some((t) => /bypass road, Gandhinagar/.test(t)), gj.join(" | "));
check("match reason badge is shown for keyword search", (await page.getByText("Title match").count()) + (await page.getByText("Title words").count()) > 0);

// ---- 2. typing & submit update the URL; back/forward work ----
await box().fill("solar");
await box().press("Enter");
await page.waitForURL(/q=solar/);
await settle();
check("submit puts the keyword in the URL", param("q") === "solar" && param("state") === "GJ");
await page.goBack();
await page.waitForURL(/q=road/);
await settle();
check("back restores the previous search", await until(async () => (await box().inputValue()) === "road" && (await titles()).some((t) => /bypass road/.test(t))));
await page.goForward();
await page.waitForURL(/q=solar/);
check("forward re-applies the next search", await until(async () => (await box().inputValue()) === "solar"));

// ---- 3. legacy + invalid params ----
await page.goto(BASE + "/tenders?keyword=desilting", { waitUntil: "networkidle" });
await settle();
check("legacy ?keyword= is normalised to ?q=", param("q") === "desilting" && param("keyword") === null);
check("legacy keyword search returns results", (await titles()).some((t) => /Desilting/.test(t)));
await page.goto(BASE + "/tenders?state=zz9&sort=bogus&minValue=abc&page=-4", { waitUntil: "networkidle" });
await settle();
check("invalid params are reported and stripped from the URL", (await page.getByText("were ignored").count()) === 1 && url().search === "");
check("invalid params never break the page (all tenders load)", (await total()) >= 25, String(await total()));
check("no crash screen on invalid params", (await page.getByText("Something went wrong").count()) === 0);

// ---- 4. reference & typo search, match reasons ----
await page.goto(BASE + "/tenders?q=" + encodeURIComponent("DJB/2026/0011"), { waitUntil: "networkidle" });
await settle();
check("exact reference search ranks the tender first with an 'Exact reference' reason", /Desilting of storm water drains, New Delhi/.test((await titles())[0] ?? "") && (await page.getByText("Exact reference").count()) === 1, (await titles()).join(" | "));
await page.goto(BASE + "/tenders?q=desiltng", { waitUntil: "networkidle" });
await settle();
check("typo search still finds the tender and says why", (await titles()).some((t) => /Desilting/.test(t)) && (await page.getByText("Similar spelling").count()) > 0);
await page.goto(BASE + "/tenders?q=zzzzqqqq", { waitUntil: "networkidle" });
await settle();
check("no-results state is explained and offers a way out", (await page.getByText("No tenders found").count()) === 1 && (await page.getByRole("button", { name: "Clear search and filters" }).count()) === 1);

// ---- 5. combobox suggestions ----
await page.goto(BASE + "/tenders", { waitUntil: "networkidle" });
await settle();
check("combobox starts collapsed with the right ARIA", (await box().getAttribute("aria-expanded")) === "false" && (await box().getAttribute("aria-autocomplete")) === "list");
await box().click();
check("focusing an empty box offers the user's recent searches", await until(async () => (await page.getByRole("group", { name: "Recent searches" }).count()) === 1));
await box().fill("kolk");
await page.getByRole("option", { name: /Kolkata Municipal Corporation/ }).first().waitFor({ timeout: 8000 });
check("typing shows grouped suggestions and expands the combobox", (await box().getAttribute("aria-expanded")) === "true" && (await page.getByRole("group", { name: "Organizations" }).count()) === 1);
const orgIndex = await page.getByRole("option").evaluateAll((els) => els.findIndex((e) => /Kolkata Municipal Corporation/.test(e.textContent ?? "")));
for (let i = 0; i <= orgIndex; i++) await box().press("ArrowDown");
const active = await box().getAttribute("aria-activedescendant");
check("arrow keys move aria-activedescendant to the option", !!active && /Kolkata Municipal/.test(await page.locator(`[id="${active}"]`).innerText()));
await box().press("Enter");
await page.waitForURL(/procuringEntity=/);
await settle();
check("picking an organization applies it as a filter chip", (await page.getByRole("button", { name: /Remove filter Organization: Kolkata Municipal Corporation/ }).count()) === 1);
const kmc = await titles();
check("organization filter narrows results to that organization", kmc.length > 0 && kmc.every((t) => /Kolkata|Kolkata Municipal/.test(t) || /Desilting|street lighting|Kolkata/.test(t)) && (await total()) >= 3 && (await total()) <= 5, `${await total()} ${kmc.join("|")}`);
await box().fill("del");
await page.getByRole("listbox").waitFor({ state: "visible" });
await box().press("Escape");
check("Escape closes the popup", (await box().getAttribute("aria-expanded")) === "false");
await page.goto(BASE + "/tenders", { waitUntil: "networkidle" });

// ---- 6. filters, chips, sort, pagination ----
await settle();
const allTotal = await total();
await page.getByRole("checkbox", { name: "Closed", exact: true }).click();
await page.waitForURL(/status=CLOSED/);
await settle();
const closedTotal = await total();
check("status checkbox filters and updates the URL", closedTotal > 0 && closedTotal < allTotal, `${closedTotal}/${allTotal}`);
await page.getByRole("checkbox", { name: "Rajasthan" }).click();
await page.waitForURL(/state=RJ/);
await settle();
check("multiple filters combine (status + state)", (await total()) > 0 && (await total()) < closedTotal && url().searchParams.get("status") === "CLOSED", `${await total()}`);
await page.getByRole("checkbox", { name: "Gujarat" }).click();
await page.waitForURL(/state=(RJ%2CGJ|GJ%2CRJ)/);
await settle();
check("state is a real multi-select (two states)", url().searchParams.get("state").split(",").length === 2);
await page.getByRole("button", { name: "Remove filter State: Rajasthan" }).click();
await page.waitForURL((u) => u.searchParams.get("state") === "GJ");
check("removing a chip removes only that value", param("state") === "GJ" && param("status") === "CLOSED");
await page.getByRole("button", { name: "Clear all", exact: true }).click();
await page.waitForURL((u) => u.search === "");
await settle();
check("Clear all resets every filter", (await total()) === allTotal);

await page.getByRole("button", { name: "Estimated Value (₹)" }).waitFor();
await page.getByLabel("Value minimum").fill("1000000000");
await page.waitForTimeout(900);
await settle();
check("money range is debounced into the URL and filters results", param("minValue") === "1000000000" && (await total()) < allTotal, `${await total()}`);
await page.getByLabel("Value maximum").fill("5");
await page.waitForTimeout(900);
check("inverted range shows an alert and is not sent", (await page.getByRole("alert").filter({ hasText: "Minimum is greater than maximum" }).count()) === 1 && param("maxValue") === null);
await page.goto(BASE + "/tenders", { waitUntil: "networkidle" });
await settle();

await page.getByRole("button", { name: "Dates" }).click();
await page.getByLabel("Closing from").fill("2020-01-01");
await page.getByLabel("Closing to").fill("2020-12-31");
await page.waitForTimeout(900);
await settle();
check("closing date range filters (nothing closes in 2020) and is in the URL", param("closingFrom") === "2020-01-01" && param("closingTo") === "2020-12-31" && (await total()) === 0, `${await total()}`);
await page.goto(BASE + "/tenders", { waitUntil: "networkidle" });
await settle();

await page.getByLabel("Sort results").click();
check("'Best match' is not offered without a keyword", (await page.getByRole("option", { name: "Best match" }).count()) === 0);
await page.getByRole("option", { name: "Value: high to low" }).click();
await page.waitForURL(/sort=valueHigh/);
await settle();
check("sort choice is in the URL and results reload", param("sort") === "valueHigh" && (await titles()).length > 0);

await page.goto(BASE + "/tenders", { waitUntil: "networkidle" });
await settle();
const p1 = await titles();
await page.getByRole("button", { name: "Next" }).click();
await page.waitForURL(/page=2/);
await settle();
const p2 = await titles();
check("page 2 has different results and the page is in the URL", p2.length > 0 && p1.join() !== p2.join());
await page.goBack();
await page.waitForURL((u) => u.searchParams.get("page") === null);
await settle();
check("back returns to page 1", await until(async () => (await titles()).join() === p1.join()));
await page.goto(BASE + "/tenders?page=99", { waitUntil: "networkidle" });
await settle();
check("a page past the end is handled, not a crash", (await page.getByText("No results on this page").count()) === 1);
await page.goto(BASE + "/tenders?page=10000", { waitUntil: "networkidle" });
await settle();
check("a page beyond the pageable window explains the limit", (await page.getByText("out of reach").count()) === 1);

// ---- 7. history ----
await page.goto(BASE + "/tenders?q=bypass", { waitUntil: "networkidle" });
await settle();
await page.goto(BASE + "/tenders?q=solar&state=KA", { waitUntil: "networkidle" });
await settle();
await page.waitForTimeout(800);
await page.getByRole("button", { name: "History", exact: true }).click();
const dialog = page.getByRole("dialog", { name: "Search history" });
await dialog.getByText("solar").first().waitFor();
check("history lists the signed-in user's searches with filters", (await dialog.getByText("bypass").count()) === 1 && (await dialog.getByText(/State: KA/).count()) === 1);
await dialog.getByRole("button", { name: "Remove search bypass from history" }).click();
await dialog.getByText("bypass").waitFor({ state: "detached" });
check("a history item can be removed", (await dialog.getByText("bypass").count()) === 0);
await dialog.locator("li", { hasText: "State: KA" }).getByRole("button", { name: /Run search solar/ }).click();
await page.waitForURL(/q=solar/);
await dialog.waitFor({ state: "detached" });
check("running a history item re-applies the query and its filters", param("q") === "solar" && param("state") === "KA");
await page.getByRole("button", { name: "History", exact: true }).click();
await page.getByRole("button", { name: "Clear all history" }).click();
await page.getByText("No search history yet.").waitFor();
check("history can be cleared entirely", true);
await page.keyboard.press("Escape");

// ---- 8. saved searches ----
await page.goto(BASE + "/tenders?q=road&state=MH,GJ&status=OPEN", { waitUntil: "networkidle" });
await settle();
await page.getByRole("button", { name: "Save Search" }).click();
await page.getByLabel("Search Name").fill("Roads west");
await page.getByRole("dialog").getByRole("button", { name: "Save Search" }).click();
await page.getByText("Search saved").waitFor();
await page.goto(BASE + "/saved-searches", { waitUntil: "networkidle" });
check("saved search shows all its criteria as chips", (await page.getByText("Status: Open").count()) >= 1 && (await page.getByText(/State: (Maharashtra|MH)/).count()) >= 1);
await page.getByRole("button", { name: "Run Search" }).first().click();
await page.waitForURL(/\/tenders\?/);
await settle();
check("Run Search restores keyword, multi-state and status", param("q") === "road" && param("state") === "MH,GJ" && param("status") === "OPEN");

const token = await page.evaluate(async () => {
  const r = await fetch("http://localhost:4000/api/v1/auth/refresh", { method: "POST", credentials: "include", headers: { "X-Requested-With": "XMLHttpRequest" } });
  return (await r.json()).data.accessToken;
});
const legacy = await page.evaluate(async ({ token, api }) => {
  const r = await fetch(`${api}/saved-searches`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: "Legacy search", criteria: { q: "bypass", state: "GJ", status: "OPEN" } }) });
  return r.status;
}, { token, api: API });
check("legacy single-string criteria are still accepted by the API", legacy === 201, String(legacy));
await page.goto(BASE + "/saved-searches", { waitUntil: "networkidle" });
const legacyCard = page.getByRole("heading", { name: "Legacy search" }).locator("xpath=ancestor::div[.//button[contains(., 'Run Search')]][1]");
await legacyCard.getByRole("button", { name: "Run Search" }).click();
await page.waitForURL(/q=bypass/);
await settle();
check("a legacy saved search runs and returns results", param("state") === "GJ" && (await titles()).some((t) => /bypass road/.test(t)));

// ---- 8b. district & city filters (controlled, removable DevFix districts; see teardown) ----
const distFixture = setupDistrictFixture();
try {
  const totalMH = await (async () => {
    await page.goto(BASE + "/tenders?state=MH", { waitUntil: "networkidle" });
    await settle();
    return total();
  })();
  await page.getByRole("button", { name: "District", exact: true }).click();
  await page.getByRole("checkbox", { name: "DevFix Pune" }).click();
  await page.waitForURL(/district=/);
  await settle();
  const pune = await titles();
  check("district filter narrows results and lists real districts", pune.length > 0 && pune.every((t) => /Pune/.test(t)) && (await total()) < totalMH, `${pune.join("|")}`);
  check("district chip shows the district name", (await page.getByRole("button", { name: "Remove filter District: DevFix Pune" }).count()) === 1);
  await page.reload({ waitUntil: "networkidle" });
  await settle();
  check("district filter survives reload", param("district") !== null && (await page.getByRole("button", { name: "Remove filter District: DevFix Pune" }).count()) === 1 && (await titles()).every((t) => /Pune/.test(t)));
  await page.goBack();
  await page.waitForURL((u) => u.searchParams.get("district") === null);
  check("back removes the district filter", await until(async () => (await total()) === totalMH));
  await page.goForward();
  await page.waitForURL(/district=/);
  check("forward re-applies the district filter", await until(async () => (await page.getByRole("button", { name: "Remove filter District: DevFix Pune" }).count()) === 1));
  await page.getByRole("button", { name: "Remove filter District: DevFix Pune" }).click();
  await page.waitForURL((u) => u.searchParams.get("district") === null);
  check("district chip removes only that filter", param("state") === "MH");

  await page.goto(BASE + "/tenders", { waitUntil: "networkidle" });
  await settle();
  const allNow = await total();
  await page.getByRole("button", { name: "City", exact: true }).click();
  await page.getByLabel("Search cities").fill("p");
  await page.waitForTimeout(500);
  check("city lookup waits for 2 characters", (await page.getByRole("checkbox", { name: /Pune/ }).count()) === 0);
  await page.getByLabel("Search cities").fill("pun");
  await page.getByRole("checkbox", { name: /Pune/ }).first().click();
  await page.waitForURL(/city=Pune/);
  await settle();
  const puneCity = await titles();
  check("city filter (server-side lookup) narrows results", puneCity.length > 0 && puneCity.every((t) => /Pune/.test(t)) && (await total()) < allNow, puneCity.join("|"));
  check("city chip is shown", (await page.getByRole("button", { name: "Remove filter City: Pune" }).count()) === 1);
  await page.reload({ waitUntil: "networkidle" });
  await settle();
  check("city filter survives reload", param("city") === "Pune" && (await titles()).every((t) => /Pune/.test(t)));
  await page.getByRole("button", { name: "City", exact: true }).click();
  await page.getByLabel("Search cities").fill("zzqq");
  check("city lookup shows an empty state", await until(async () => (await page.getByText("No cities found.").count()) === 1));
  await page.goto(BASE + "/tenders?q=data&city=Pune&district=" + distFixture.puneId + "&state=MH", { waitUntil: "networkidle" });
  await settle();
  check("district + city + state + keyword combine", (await titles()).length > 0 && (await titles()).every((t) => /data centre/i.test(t) && /Pune/.test(t)));
  await page.goto(BASE + "/tenders?city=Pune&state=GJ", { waitUntil: "networkidle" });
  await settle();
  check("a city/state combination with no match shows the empty state", (await page.getByText("No tenders found").count()) === 1);
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await page.waitForURL((u) => u.search === "");
  check("Clear all removes district/city filters too", true);

  await page.route("**/search/cities**", (route) => route.abort());
  await page.goto(BASE + "/tenders", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "City", exact: true }).click();
  await page.getByLabel("Search cities").fill("pun");
  check("city lookup failure shows an error, not a crash", await until(async () => (await page.getByText("City search is unavailable right now.").count()) === 1));
  await page.unroute("**/search/cities**");
  await page.route("**/meta/districts**", (route) => route.abort());
  await page.goto(BASE + "/tenders", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "District", exact: true }).click();
  check("district load failure shows an error", await until(async () => (await page.getByText("Districts could not be loaded.").count()) === 1));
  await page.unroute("**/meta/districts**");

  const eid = await page.evaluate(async (api) => (await (await fetch(`${api}/search/entities?q=kolkata`)).json()).data[0].id, API);
  await page.goto(BASE + "/tenders?procuringEntity=" + eid, { waitUntil: "networkidle" });
  await settle();
  check("shared URL resolves the organization label", await until(async () => (await page.getByRole("button", { name: /Remove filter Organization: Kolkata Municipal Corporation/ }).count()) === 1));

  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(BASE + "/tenders", { waitUntil: "networkidle" });
  await settle();
  await page.getByRole("button", { name: /^Filters/ }).click();
  const locSheet = page.getByRole("dialog", { name: "Filters" });
  await locSheet.getByRole("button", { name: "City", exact: true }).click();
  await locSheet.getByLabel("Search cities").fill("kol");
  await locSheet.getByRole("checkbox", { name: /Kolkata/ }).first().click();
  await page.waitForURL(/city=Kolkata/);
  await locSheet.getByRole("button", { name: "District", exact: true }).click();
  check("mobile sheet offers district and city and applies city", (await locSheet.getByRole("checkbox", { name: /DevFix/ }).count()) >= 1 && param("city") === "Kolkata" && !(await overflow()));
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(BASE + "/tenders", { waitUntil: "networkidle" });
  await settle();
  await page.getByRole("button", { name: "District", exact: true }).click();
  await page.getByRole("button", { name: "City", exact: true }).click();
  await page.getByLabel("Search cities").fill("pun");
  await page.getByRole("checkbox", { name: /Pune/ }).first().waitFor();
  const locAxe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const locBad = locAxe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  check("axe district/city filters: no serious/critical violations", locBad.length === 0, locBad.map((v) => `${v.id}(${v.nodes.length}): ${v.nodes[0]?.target?.join(" ")}`).join(" | "));
  console.log("axe district/city total violations:", locAxe.violations.length);
} finally {
  teardownDistrictFixture();
}

// ---- 9. axe on the search page ----
await page.goto(BASE + "/tenders?q=road", { waitUntil: "networkidle" });
await settle();
const scan = async (label) => {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  check(`axe ${label}: no serious/critical violations`, bad.length === 0, bad.map((v) => `${v.id}(${v.nodes.length}): ${v.nodes[0]?.target?.join(" ")}`).join(" | "));
  return r.violations.length;
};
const axeCounts = { results: await scan("results (light)") };
await box().fill("del");
await page.getByRole("listbox").waitFor({ state: "visible" });
await page.getByRole("option").first().waitFor({ timeout: 8000 });
axeCounts.combobox = await scan("combobox open");
await box().press("Escape");
await page.getByRole("button", { name: "Dates" }).click();
await page.getByRole("button", { name: "Organization" }).click();
axeCounts.filters = await scan("advanced filters expanded");
await page.getByRole("button", { name: "History", exact: true }).click();
await page.getByRole("dialog", { name: "Search history" }).waitFor();
axeCounts.history = await scan("history dialog");
await page.keyboard.press("Escape");
await page.evaluate(() => localStorage.setItem("theme", "dark"));
await page.reload({ waitUntil: "networkidle" });
await settle();
axeCounts.dark = await scan("results (dark)");
await page.evaluate(() => localStorage.setItem("theme", "light"));
console.log("axe total violations (all impacts):", JSON.stringify(axeCounts));

// ---- 10. responsive + mobile drawer ----
for (const w of [320, 375, 390, 414, 768, 1280]) {
  await page.setViewportSize({ width: w, height: 800 });
  await page.goto(BASE + "/tenders?q=road&state=MH,GJ&minValue=1000", { waitUntil: "networkidle" });
  await settle();
  check(`no horizontal overflow at ${w}px`, !(await overflow()));
}
await page.setViewportSize({ width: 375, height: 800 });
await page.goto(BASE + "/tenders", { waitUntil: "networkidle" });
await settle();
await page.getByRole("button", { name: /^Filters/ }).click();
const sheet = page.getByRole("dialog", { name: "Filters" });
await sheet.waitFor();
await sheet.getByRole("checkbox", { name: "Gujarat" }).click();
await page.waitForURL(/state=GJ/);
await settle();
check("mobile drawer applies a filter and shows the live result count", (await sheet.getByRole("button", { name: /Show \d+ results/ }).count()) === 1);
await sheet.getByRole("button", { name: /Show \d+ results/ }).click();
await sheet.waitFor({ state: "detached" });
check("mobile drawer closes and the filter is active", (await page.getByRole("button", { name: "Remove filter State: Gujarat" }).count()) === 1 && !(await overflow()));
await page.setViewportSize({ width: 1280, height: 900 });

// ---- 11. failure handling ----
await page.route("**/search/tenders**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "DEPENDENCY_UNAVAILABLE", message: "Search is temporarily unavailable." } }) }));
await page.goto(BASE + "/tenders?q=road", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /retry|try again/i }).waitFor({ timeout: 8000 });
check("a search backend failure shows a retryable error, not a crash", (await page.getByText("Something went wrong").count()) === 0 && (await box().inputValue()) === "road");
await page.unroute("**/search/tenders**");
await page.getByRole("button", { name: /retry|try again/i }).click();
await settle();
check("retry recovers once the backend is back", await until(async () => (await titles()).length > 0));
await page.route("**/search/suggestions**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "DEPENDENCY_UNAVAILABLE", message: "down" } }) }));
await box().fill("road");
await box().press("Enter");
await settle();
check("suggestion failure does not block searching", await until(async () => (await titles()).length > 0));
await page.unroute("**/search/suggestions**");

check("no console/page errors during the run", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
