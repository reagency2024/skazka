import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sunnah5-"));
const { server, db, dueReminders } = await import("../server.mjs");

let base;
test.before(() => new Promise(r => server.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); })));
test.after(() => server.close());

async function call(p, { method = "GET", body, token } = {}) {
  const res = await fetch(base + p, {
    method, body: body && JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  return { status: res.status, json: await res.json() };
}

test("профиль, синхронизация двух устройств и группа", async () => {
  assert.equal((await call("/api/health")).json.app, "sunnah5");

  const a = (await call("/api/register", { method: "POST", body: { name: "Абдулла" } })).json;
  const b = (await call("/api/register", { method: "POST", body: { name: "Марьям" } })).json;
  assert.match(a.token, /^[A-Z2-9]{24}$/);

  // Телефон 1 отмечает день, телефон 2 (тот же ключ, с дефисами) получает отметку.
  const t = new Date(); const k = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  await call("/api/sync", { method: "POST", token: a.token, body: { days: { [k]: { t: 10, quran: 1, duha: 1 } }, tz: "Europe/Moscow" } });
  const dashed = a.token.replace(/(.{4})(?=.)/g, "$1-");
  const s2 = (await call("/api/sync", { method: "POST", token: dashed, body: { days: {}, money: {} } })).json;
  assert.deepEqual(s2.days[k], { t: 10, quran: 1, duha: 1 });

  // Старая правка не затирает новую.
  await call("/api/sync", { method: "POST", token: a.token, body: { days: { [k]: { t: 5 } } } });
  assert.equal(db.users[Object.keys(db.users)[0]].data.days[k].quran, 1);

  const g = (await call("/api/groups", { method: "POST", token: a.token, body: { name: "Семья" } })).json;
  assert.match(g.code, /^[A-Z2-9]{6}$/);
  assert.equal((await call("/api/groups/join", { method: "POST", token: b.token, body: { code: g.code.toLowerCase() } })).json.name, "Семья");

  const list = (await call("/api/groups", { token: b.token })).json.groups;
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].members.map(m => [m.name, m.me]), [["Абдулла", false], ["Марьям", true]]);
  assert.ok(list[0].members[0].pct > 0);
  assert.equal(list[0].members[0].done, 2);
  assert.equal("days" in list[0].members[0], false); // отдельные отметки не раскрываются

  assert.equal((await call("/api/groups", { token: "WRONG" })).status, 401);
  assert.equal((await call("/api/groups/join", { method: "POST", token: b.token, body: { code: "NOPE00" } })).status, 404);

  await call("/api/groups/leave", { method: "POST", token: b.token, body: { code: g.code } });
  assert.equal((await call("/api/groups", { token: b.token })).json.groups.length, 0);
});

test("push: напоминание срабатывает в своё время и только раз в день", () => {
  const user = {
    tz: "Asia/Almaty", data: { days: {}, money: {} },
    push: { subs: [{ endpoint: "https://x" }], sent: {}, reminders: {
      tahajjud: { on: true, time: "04:00" }, quran: { on: false, time: "06:30" }, duha: { on: true, time: "09:00" },
      fast: { on: true, time: "21:00" }, evening: { on: true, time: "21:30" } } },
  };
  const at = iso => new Date(iso);
  // 04:00 в Алматы (UTC+5) = 23:00 UTC накануне
  assert.deepEqual(dueReminders(user, at("2026-10-27T23:00:10Z")).map(m => m.title), ["Время тахаджуда"]);
  assert.equal(dueReminders(user, at("2026-10-27T23:00:40Z")).length, 0);
  // среда 21:00 → напоминание о посте в четверг; пятница 21:00 — нет
  assert.deepEqual(dueReminders(user, at("2026-10-28T16:00:00Z")).map(m => m.title), ["Завтра день поста"]);
  assert.equal(dueReminders(user, at("2026-10-30T16:00:00Z")).length, 0);
  const ev = dueReminders(user, at("2026-10-28T16:30:00Z"));
  assert.match(ev[0].body, /отмечено 0 из/);
});
