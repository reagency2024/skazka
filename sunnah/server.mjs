// Сервер «5 весомых сунн»: раздаёт приложение, синхронизирует отметки между устройствами,
// ведёт группы с общим рейтингом и присылает push-напоминания.
// Данные хранятся в одном JSON-файле (DATA_DIR/sunnah-db.json).

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import webpush from "web-push";
import {
  REMINDERS, MONTH_RE, emptyData, mergeData, monthStats, dayStats, todayIn, cleanReminders, defaultReminders,
} from "./public/core.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "public");
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(here, "data"));
const DB_FILE = path.join(DATA_DIR, "sunnah-db.json");
const PORT = Number(process.env.PORT) || 8080;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "https://github.com/reagency2024/skazka";

const LIMITS = { name: 40, groupName: 40, groupsPerUser: 20, membersPerGroup: 100, subsPerUser: 10, body: 1_000_000, days: 20_000 };
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 символа без похожих (0/O, 1/I)

/* ---------- База ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
let db = { users: {}, tokens: {}, groups: {}, vapid: null };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, "utf8"))); } catch (e) { /* первый запуск */ }

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  db.vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
} else if (!db.vapid) {
  db.vapid = webpush.generateVAPIDKeys();
}
webpush.setVapidDetails(VAPID_SUBJECT, db.vapid.publicKey, db.vapid.privateKey);

let writeTimer = null;
function persist() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(flush, 400);
}
function flush() {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
persist();

const randomCode = len => Array.from(crypto.randomBytes(len), b => ALPHABET[b & 31]).join("");
const hashToken = t => crypto.createHash("sha256").update(t).digest("hex");
const normCode = s => String(s || "").replace(/[^0-9a-z]/gi, "").toUpperCase();
const cleanName = (s, max) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);

function validTz(tz) {
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return tz; } catch (e) { return null; }
}

/* ---------- HTTP ---------- */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > LIMITS.body) { reject(new HttpError(413, "Слишком большой запрос")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (e) { reject(new HttpError(400, "Неверный формат запроса")); }
    });
    req.on("error", reject);
  });
}

function auth(req) {
  const m = /^Bearer\s+([0-9A-Za-z-]+)$/.exec(req.headers.authorization || "");
  const id = m && db.tokens[hashToken(normCode(m[1]))];
  if (!id || !db.users[id]) throw new HttpError(401, "Ключ синхронизации не найден");
  return db.users[id];
}

// Простое ограничение частоты регистраций с одного адреса.
const regHits = new Map();
function rateLimit(ip) {
  const now = Date.now(), hour = 3_600_000;
  const hits = (regHits.get(ip) || []).filter(t => now - t < hour);
  if (hits.length >= 20) throw new HttpError(429, "Слишком много новых профилей с этого адреса. Попробуйте через час.");
  hits.push(now); regHits.set(ip, hits);
}

function memberStats(user, y, m) {
  const st = monthStats(user.data, y, m, todayIn(user.tz || "UTC"));
  return { pct: st.pct === null ? null : Math.round(st.pct * 10) / 10, done: st.done, total: st.total };
}

function groupView(g, me, y, m) {
  const members = g.members.filter(id => db.users[id]).map(id => {
    const u = db.users[id];
    return { name: u.name, me: id === me.id, ...memberStats(u, y, m) };
  });
  members.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || a.name.localeCompare(b.name, "ru"));
  return { code: g.code, name: g.name, members };
}

const routes = {
  "GET /api/health": () => ({ ok: true, app: "sunnah5" }),

  "POST /api/register": async (req) => {
    rateLimit(req.socket.remoteAddress || "");
    const body = await readBody(req);
    const name = cleanName(body.name, LIMITS.name);
    if (!name) throw new HttpError(400, "Укажите имя");
    const token = randomCode(24);
    const id = crypto.randomUUID();
    db.users[id] = { id, name, created: Date.now(), tz: "UTC", data: emptyData(), groups: [], push: { subs: [], reminders: defaultReminders(), sent: {} } };
    db.tokens[hashToken(token)] = id;
    persist();
    return { token, name };
  },

  "GET /api/me": req => ({ name: auth(req).name }),

  "POST /api/me": async req => {
    const user = auth(req);
    const name = cleanName((await readBody(req)).name, LIMITS.name);
    if (!name) throw new HttpError(400, "Укажите имя");
    user.name = name; persist();
    return { name };
  },

  "POST /api/sync": async req => {
    const user = auth(req);
    const body = await readBody(req);
    const merged = mergeData(user.data, { days: body.days || {}, money: body.money || {} });
    if (Object.keys(merged.days).length > LIMITS.days) throw new HttpError(413, "Слишком много записей");
    user.data = merged;
    const tz = validTz(body.tz); if (tz) user.tz = tz;
    persist();
    return { ...merged, name: user.name };
  },

  "GET /api/groups": (req, url) => {
    const user = auth(req);
    const mk = url.searchParams.get("month") || "";
    const now = todayIn(user.tz || "UTC");
    const [y, m] = MONTH_RE.test(mk) ? mk.split("-").map(Number) : [now.getFullYear(), now.getMonth() + 1];
    const groups = user.groups.map(c => db.groups[c]).filter(Boolean).map(g => groupView(g, user, y, m - 1));
    return { groups };
  },

  "POST /api/groups": async req => {
    const user = auth(req);
    const name = cleanName((await readBody(req)).name, LIMITS.groupName);
    if (!name) throw new HttpError(400, "Укажите название группы");
    if (user.groups.length >= LIMITS.groupsPerUser) throw new HttpError(400, "Слишком много групп");
    let code; do { code = randomCode(6); } while (db.groups[code]);
    db.groups[code] = { code, name, owner: user.id, members: [user.id], created: Date.now() };
    user.groups.push(code);
    persist();
    return { code, name };
  },

  "POST /api/groups/join": async req => {
    const user = auth(req);
    const code = normCode((await readBody(req)).code);
    const g = db.groups[code];
    if (!g) throw new HttpError(404, "Группа с таким кодом не найдена");
    if (!g.members.includes(user.id)) {
      if (g.members.length >= LIMITS.membersPerGroup) throw new HttpError(400, "В группе нет мест");
      if (user.groups.length >= LIMITS.groupsPerUser) throw new HttpError(400, "Слишком много групп");
      g.members.push(user.id); user.groups.push(code); persist();
    }
    return { code, name: g.name };
  },

  "POST /api/groups/leave": async req => {
    const user = auth(req);
    const code = normCode((await readBody(req)).code);
    const g = db.groups[code];
    user.groups = user.groups.filter(c => c !== code);
    if (g) {
      g.members = g.members.filter(id => id !== user.id);
      if (!g.members.length) delete db.groups[code];
      else if (g.owner === user.id) g.owner = g.members[0];
    }
    persist();
    return { ok: true };
  },

  "GET /api/push/key": () => ({ key: db.vapid.publicKey }),

  "POST /api/push": async req => {
    const user = auth(req);
    const body = await readBody(req);
    const push = user.push || (user.push = { subs: [], reminders: defaultReminders(), sent: {} });
    push.reminders = cleanReminders(body.reminders);
    const tz = validTz(body.tz); if (tz) user.tz = tz;
    const sub = body.subscription;
    if (sub && typeof sub.endpoint === "string" && /^https:\/\//.test(sub.endpoint) && sub.keys && sub.keys.p256dh && sub.keys.auth) {
      push.subs = push.subs.filter(s => s.endpoint !== sub.endpoint);
      push.subs.push({ endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } });
      push.subs = push.subs.slice(-LIMITS.subsPerUser);
    }
    persist();
    return { ok: true };
  },
};

/* ---------- Статика ---------- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Не найдено"); return; }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      ...(file.endsWith("sw.js") ? { "Service-Worker-Allowed": "/" } : {}),
    });
    res.end(req.method === "HEAD" ? undefined : buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    // Приложение для телефона открывается не с этого адреса, поэтому разрешаем запросы с любого источника:
    // доступ к данным даёт только ключ в заголовке Authorization, cookie не используются.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return send(res, 404, { error: "Неизвестный адрес API" });
    try {
      send(res, 200, await handler(req, url));
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      send(res, e.status || 500, { error: e instanceof HttpError ? e.message : "Внутренняя ошибка сервера" });
    }
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
  serveStatic(req, res, url);
});

/* ---------- Push-напоминания ---------- */
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localClock(tz, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, weekday: WD[parts.weekday] };
}

// Какие напоминания пользователя пора отправить сейчас (каждое — не чаще раза в день).
export function dueReminders(user, now = new Date()) {
  const push = user.push;
  if (!push || !push.subs.length) return [];
  const clock = localClock(user.tz || "UTC", now);
  const due = [];
  for (const r of REMINDERS) {
    const v = push.reminders[r.id];
    if (!v || !v.on || v.time !== clock.time) continue;
    if (r.weekdays && !r.weekdays.includes(clock.weekday)) continue;
    if (push.sent[r.id] === clock.date) continue;
    push.sent[r.id] = clock.date;
    let body = r.body;
    if (r.id === "evening") {
      const st = dayStats(user.data, todayIn(user.tz || "UTC"));
      body = st.done === st.possible
        ? `Сегодня выполнены все ${st.possible} — ма ша Аллах! Проверьте, что всё отмечено.`
        : `Сегодня отмечено ${st.done} из ${st.possible}. Ещё есть время.`;
    }
    due.push({ title: r.push, body, tag: `sunnah5-${r.id}`, url: "./#today" });
  }
  return due;
}

async function pushTick() {
  for (const user of Object.values(db.users)) {
    const due = dueReminders(user);
    if (!due.length) continue;
    persist();
    for (const msg of due) {
      for (const sub of [...user.push.subs]) {
        try {
          await webpush.sendNotification(sub, JSON.stringify(msg), { TTL: 3600 });
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) {
            user.push.subs = user.push.subs.filter(s => s.endpoint !== sub.endpoint);
            persist();
          } else console.error("push:", e.statusCode || "", e.body || e.message);
        }
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  setInterval(() => pushTick().catch(e => console.error(e)), 20_000);
  server.listen(PORT, () => console.log(`5 весомых сунн: http://localhost:${PORT}  (данные: ${DB_FILE})`));
  const stop = () => { clearTimeout(writeTimer); flush(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

export { server, db };
