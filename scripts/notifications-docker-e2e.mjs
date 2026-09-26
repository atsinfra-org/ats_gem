// Phase 8 end-to-end verification against the REAL Docker dev stack (api + worker + scheduler + postgres + redis, log e-mail driver).
// Nothing is mocked: events go through the transactional outbox -> relay -> BullMQ -> worker -> DB -> log email transport.
// Controlled fixtures (tagged "[P8 FIXTURE]" / p8e2e-*@example.com) stand in for crawler events and are removed at the end.
// Usage: node scripts/notifications-docker-e2e.mjs
import { execFileSync, execSync } from "node:child_process";

const API = process.env.API_URL ?? "http://localhost:4000/api/v1";
const ENV = { ...process.env, MSYS_NO_PATHCONV: "1" };
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` :: ${detail}`}`);
};
const sh = (cmd) => execSync(cmd, { encoding: "utf8", env: ENV, stdio: ["ignore", "pipe", "pipe"] }).trim();
const psql = (sql) => sh(`docker exec ats-gem-postgres-1 psql -U ats_gem -d ats_gem -At -c "${sql.replace(/"/g, '\\"')}"`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 30000, step = 500) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* retry */
    }
    await sleep(step);
  }
  return null;
};

async function http(method, path, token, body) {
  const res = await fetch(API + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, body: json };
}

const stamp = Date.now();
const created = { users: [], tenders: [], events: [] };

async function register(tag) {
  const email = `p8e2e-${tag}-${stamp}@example.com`;
  const r = await http("POST", "/auth/register", null, { name: `P8 ${tag}`, email, password: "correct-horse-battery", acceptTerms: true });
  if (r.status !== 201) throw new Error(`register ${tag} failed: ${r.status}`);
  psql(`UPDATE users SET is_email_verified = true WHERE email = '${email}'`);
  const id = psql(`SELECT id FROM users WHERE email = '${email}'`);
  created.users.push(email);
  return { email, id, token: r.body.data.accessToken };
}

function fixtureTender(title, { state = "MH", closingHours = null } = {}) {
  const closing = closingHours === null ? "NULL" : `now() + interval '${closingHours} hours'`;
  const id = psql(
    `INSERT INTO tenders (id, title, published_at, closing_at, currency, lifecycle, status, status_computed_at, last_synced_at, updated_at, state_code) VALUES (gen_random_uuid(), '${title}', now() - interval '3 days', ${closing}, 'INR', 'ACTIVE', 'OPEN', now(), now(), now(), '${state}') RETURNING id`,
  ).split("\n")[0];
  created.tenders.push(id);
  return id;
}

function outbox(eventType, aggregateId, payload) {
  const id = psql(
    `INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload) VALUES (gen_random_uuid(), '${eventType}', 'tender', '${aggregateId}', '${JSON.stringify(payload)}'::jsonb) RETURNING id`,
  ).split("\n")[0];
  created.events.push(id);
  return id;
}

const notifications = async (user, qs = "") => (await http("GET", `/notifications${qs}`, user.token)).body;
const ofType = async (user, type) => ((await notifications(user, `?type=${type}`)).data ?? []).length;
const deliveryStatus = (userId, template) => psql(`SELECT status FROM notification_deliveries WHERE user_id = '${userId}' AND template_key = '${template}' ORDER BY created_at DESC LIMIT 1`);

try {
  // ---- stack up ----
  const health = await fetch(API.replace("/api/v1", "") + "/health/ready").catch(() => null);
  const workerLog = () => sh("docker logs ats-gem-worker-1 --since 10m 2>&1");
  check("Docker stack: api reachable and worker running", (await http("GET", "/search/health")).status === 200 && sh("docker ps --filter name=ats-gem-worker-1 --filter status=running -q").length > 0, String(health?.status));
  psql("DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p8e2e-%')");

  // ---- users & saved searches ----
  const u1 = await register("u1");
  const u2 = await register("u2");
  const u3 = await register("u3");
  const hasFrequency = async (u, body) => (await http("POST", "/saved-searches", u.token, { name: "P8 alert", criteria: { q: "p8fixture road", state: "MH" }, ...body })).body.data;
  const s1 = await hasFrequency(u1, { alertFrequency: "IMMEDIATE" });
  const s2 = await hasFrequency(u2, {});
  await http("POST", "/saved-searches", u3.token, { name: "P8 other state", criteria: { q: "p8fixture road", state: "UP" }, alertFrequency: "IMMEDIATE" });
  check("saved search alerts are opt-in (default OFF) and IMMEDIATE persists", s1.alertFrequency === "IMMEDIATE" && s2.alertFrequency === "OFF");

  // ---- new tender -> saved-search alert (outbox -> relay -> queue -> worker) ----
  const t1 = fixtureTender("[P8 FIXTURE] p8fixture road works phase one");
  outbox("tender.created", t1, { tenderId: t1, sourceId: null });
  const got = await until(async () => (await ofType(u1, "SAVED_SEARCH_MATCH")) === 1);
  check("new-tender event produces a saved-search notification through the real queue and worker", !!got);
  const n1 = (await notifications(u1, "?type=SAVED_SEARCH_MATCH")).data?.[0];
  check("notification has the tender deep link data, priority and unread state", n1?.entityId === t1 && n1?.entityAvailable === true && n1?.priority === "NORMAL" && n1?.isRead === false, JSON.stringify(n1));
  await sleep(2500);
  check("only the matching, alert-enabled user was notified (OFF and other-state searches were not)", (await ofType(u2, "SAVED_SEARCH_MATCH")) === 0 && (await ofType(u3, "SAVED_SEARCH_MATCH")) === 0);

  // ---- email pipeline (log provider) ----
  const sent = await until(() => deliveryStatus(u1.id, "saved-search-match") === "SENT", 30000);
  check("email delivery reaches SENT through the email queue and worker", !!sent, deliveryStatus(u1.id, "saved-search-match"));
  const row = psql(`SELECT provider || '|' || attempts FROM notification_deliveries WHERE user_id = '${u1.id}' AND template_key = 'saved-search-match'`);
  check("delivery records the provider honestly: 'log' (captured, NOT delivered to a real mailbox)", row.startsWith("log|1"), row);
  const logs = workerLog();
  const mine = logs.split("\n").filter((l) => /email captured/.test(l) && /saved-search-match/.test(l));
  check("worker log shows the captured email with a masked recipient and template only (no body, no secrets)", mine.length >= 1 && !logs.includes(u1.email) && mine.every((l) => !/eyJ|subject|<html|View tender|"text"/i.test(l)) && mine.some((l) => /"to":"p\*\*\*@example\.com"/.test(l)));

  // ---- idempotency through the real queue ----
  const ev1 = created.events[0];
  const before = (await notifications(u1)).meta.pagination.total;
  docker("enqueue-job.cjs", "notification.dispatch", JSON.stringify({ eventId: ev1, eventType: "tender.created", subject: { type: "tender", id: t1 } }), `p8-replay-${stamp}`);
  await sleep(1500);
  check("replaying the same event does not create a duplicate notification or a second email", (await notifications(u1)).meta.pagination.total === before && psql(`SELECT count(*) FROM notification_deliveries WHERE user_id = '${u1.id}' AND template_key = 'saved-search-match'`) === "1");

  // ---- saved tender updates ----
  await http("POST", "/watchlist", u1.token, { tenderId: t1 });
  psql(`UPDATE tenders SET closing_at = now() + interval '40 days' WHERE id = '${t1}'`);
  psql(`INSERT INTO tender_versions (id, tender_id, version, change_type, diff) VALUES (gen_random_uuid(), '${t1}', 1, 'CORRIGENDUM', '{"closingAt":{"from":"2026-10-01T10:00:00.000Z","to":"2026-11-20T10:00:00.000Z"}}'::jsonb)`);
  outbox("tender.updated", t1, { tenderId: t1, changedFields: ["closingAt", "description"] });
  check("changed closing date on a saved tender notifies with the new and old dates", !!(await until(async () => (await ofType(u1, "TENDER_UPDATED")) === 1)));
  const upd = (await notifications(u1, "?type=TENDER_UPDATED")).data[0];
  check("update message states the new date and the previous one", /closing date is now 20 Nov 2026/.test(upd.message) && /was 1 Oct 2026/.test(upd.message), upd.message);
  outbox("tender.updated", t1, { tenderId: t1, changedFields: ["description", "city"] });
  await sleep(3000);
  check("cosmetic changes (description/city) do not notify", (await ofType(u1, "TENDER_UPDATED")) === 1);

  // ---- corrigendum through the real staff API ----
  const staff = await http("POST", "/auth/login", null, { email: "staff-smoke@example.com", password: "correct-horse-battery" });
  const staffToken = staff.body?.data?.accessToken;
  check("staff account available for the corrigendum API", !!staffToken);
  const corr = await http("POST", `/tenders/${t1}/corrigenda`, staffToken, { title: "P8 fixture: bid due date extended", publishedAt: new Date().toISOString() });
  check("corrigendum recorded through the API (emits the outbox event in the same transaction)", corr.status === 201, JSON.stringify(corr.body)?.slice(0, 160));
  check("corrigendum alert reaches the watcher exactly once (watcher + matching search collapse to one)", !!(await until(async () => (await ofType(u1, "TENDER_CORRIGENDUM")) === 1)));
  await sleep(2000);
  check("no duplicate corrigendum notification", (await ofType(u1, "TENDER_CORRIGENDUM")) === 1);
  check("corrigendum notification is HIGH priority", (await notifications(u1, "?type=TENDER_CORRIGENDUM")).data[0].priority === "HIGH");

  // ---- deadline reminder (scheduled job, run now through the queue) ----
  psql(`UPDATE tenders SET closing_at = now() + interval '20 hours' WHERE id = '${t1}'`);
  const sweep1 = docker("enqueue-job.cjs", "notification.deadline-sweep", "{}", `p8-sweep-a-${stamp}`);
  check("deadline sweep job completes in the worker", /completed/.test(sweep1), sweep1);
  check("saved tender closing within the default 24h offset gets one deadline reminder", (await ofType(u1, "TENDER_DEADLINE")) === 1);
  docker("enqueue-job.cjs", "notification.deadline-sweep", "{}", `p8-sweep-b-${stamp}`);
  check("a second sweep does not remind again", (await ofType(u1, "TENDER_DEADLINE")) === 1);

  // ---- read state, isolation ----
  const list = (await notifications(u1)).data;
  const unreadBefore = (await http("GET", "/notifications/unread-count", u1.token)).body.data.unreadCount;
  check("unread count matches the unread notifications", unreadBefore === list.filter((n) => !n.isRead).length && unreadBefore >= 4, `${unreadBefore}`);
  check("another user cannot read or modify someone else's notification (404)", (await http("PATCH", `/notifications/${list[0].id}/read`, u2.token)).status === 404 && (await http("GET", "/notifications", u2.token)).body.data.length === 0);
  await http("PATCH", `/notifications/${list[0].id}/read`, u1.token);
  check("mark read lowers the unread count by one", (await http("GET", "/notifications/unread-count", u1.token)).body.data.unreadCount === unreadBefore - 1);
  await http("PATCH", `/notifications/${list[0].id}/unread`, u1.token);
  await http("PATCH", "/notifications/read-all", u1.token);
  check("mark all read clears the unread count", (await http("GET", "/notifications/unread-count", u1.token)).body.data.unreadCount === 0);
  check("unauthenticated access is rejected", (await http("GET", "/notifications", null)).status === 401);

  // ---- preferences suppress email but not history ----
  const prefs = await http("PATCH", "/notifications/preferences", u1.token, { categories: { CORRIGENDA: { email: false } } });
  check("preferences persist", prefs.body.data.categories.CORRIGENDA.email === false && (await http("GET", "/notifications/preferences", u1.token)).body.data.categories.CORRIGENDA.email === false);
  check("security notifications cannot be disabled", (await http("PATCH", "/notifications/preferences", u1.token, { categories: { SYSTEM: { email: false } } })).status === 400);
  await http("POST", `/tenders/${t1}/corrigenda`, staffToken, { title: "P8 fixture: second corrigendum", publishedAt: new Date().toISOString() });
  await until(async () => (await ofType(u1, "TENDER_CORRIGENDUM")) === 2);
  await sleep(1500);
  const skipped = psql(`SELECT count(*) FROM notification_deliveries WHERE user_id = '${u1.id}' AND status = 'SKIPPED' AND skip_reason = 'PREFERENCE_DISABLED'`);
  check("with email off the alert is still recorded in-app and the email is skipped with a reason", (await ofType(u1, "TENDER_CORRIGENDUM")) === 2 && skipped === "1", skipped);

  // ---- security notification from a real password change ----
  const pw = await http("POST", "/auth/change-password", u3.token, { currentPassword: "correct-horse-battery", newPassword: "another-correct-horse-9" });
  check("password change API succeeds", pw.status < 300, String(pw.status));
  check("password change creates a critical security notification and a sent email", !!(await until(async () => (await ofType(u3, "SECURITY")) === 1)) && !!(await until(() => deliveryStatus(u3.id, "system-security") === "SENT")));
  check("security notification carries no secrets", !JSON.stringify((await notifications(u3, "?type=SECURITY")).data).match(/another-correct|correct-horse|token/i));

  // ---- Redis outage: the transactional outbox does not lose the event ----
  const t2 = fixtureTender("[P8 FIXTURE] p8fixture road works phase two");
  sh("docker stop ats-gem-redis-1");
  outbox("tender.created", t2, { tenderId: t2, sourceId: null });
  await sleep(4000);
  const pendingDuring = psql(`SELECT count(*) FROM outbox_events WHERE aggregate_id = '${t2}' AND published_at IS NULL`);
  check("while Redis is down the event stays safely in the outbox (unpublished)", pendingDuring === "1", pendingDuring);
  sh("docker start ats-gem-redis-1");
  const recovered = await until(async () => (await ofType(u1, "SAVED_SEARCH_MATCH")) === 2, 90000, 1000);
  check("after Redis returns the relay publishes it and the notification is created exactly once", !!recovered && psql(`SELECT count(*) FROM notifications WHERE user_id = '${u1.id}' AND entity_id = '${t2}' AND type = 'SAVED_SEARCH_MATCH'`) === "1");

  // ---- history is kept ----
  const total = (await notifications(u1)).meta.pagination.total;
  check("notification history is retained and paginated", total === 6 && (await notifications(u1, "?pageSize=3&page=2")).data.length === 3, String(total));
} catch (err) {
  check("script ran to completion", false, String(err).slice(0, 300));
} finally {
  try {
    sh("docker start ats-gem-redis-1");
  } catch {
    /* already running */
  }
  psql(`DELETE FROM users WHERE email LIKE 'p8e2e-%'`);
  psql(`DELETE FROM tenders WHERE title LIKE '[P8 FIXTURE]%'`);
  psql(`DELETE FROM outbox_events WHERE payload::text LIKE '%${created.tenders[0] ?? "none"}%' OR aggregate_id IN (${created.tenders.map((t) => `'${t}'`).join(",") || "'none'"})`);
  console.log(`cleanup: fixtures removed (users=${created.users.length}, tenders=${created.tenders.length}, events=${created.events.length})`);
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

function docker(script, ...args) {
  try {
    return execFileSync("docker", ["exec", "ats-gem-api-1", "node", `/app/${script}`, ...args], { encoding: "utf8", env: ENV }).trim();
  } catch (e) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`.slice(0, 300);
  }
}
