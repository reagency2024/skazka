import test from "node:test";
import assert from "node:assert/strict";
import { level, dayStats, monthStats, mergeData, emptyData } from "../public/core.js";

const d = (y, m, day) => new Date(y, m - 1, day);

test("шкала рейтинга: границы 75/50/25 строгие", () => {
  assert.equal(level(null), 0);
  assert.equal(level(100), 4);
  assert.equal(level(75.1), 4);
  assert.equal(level(75), 3);
  assert.equal(level(50), 2);
  assert.equal(level(25), 1);
  assert.equal(level(0), 1);
});

test("пост учитывается только в понедельник и четверг", () => {
  const data = emptyData();
  assert.equal(dayStats(data, d(2026, 10, 26)).possible, 5); // понедельник
  assert.equal(dayStats(data, d(2026, 10, 28)).possible, 4); // среда
});

test("уважительная причина: пропуски не снижают рейтинг", () => {
  const data = emptyData();
  data.days["2026-10-27"] = { t: 1, tahajjud: 1, quran: 1, duha: 1, sadaqa: 1 };
  data.days["2026-10-28"] = { t: 1, quran: 1, ex: "ill" };
  const st = monthStats(data, 2026, 9, d(2026, 10, 28));
  assert.equal(st.done, 5);
  assert.equal(st.total, 5);
  assert.equal(st.pct, 100);
  assert.equal(st.excused, 1);
});

test("дни до первой отметки не учитываются", () => {
  const data = emptyData();
  data.days["2026-10-28"] = { t: 1, quran: 1 };
  const st = monthStats(data, 2026, 9, d(2026, 10, 28));
  assert.equal(st.days, 1);
  assert.equal(st.pct, 25);
});

test("слияние: побеждает более поздняя правка, мусор отбрасывается", () => {
  const a = { days: { "2026-10-01": { t: 5, quran: 1 }, "2026-10-02": { t: 9, duha: 1 } }, money: {} };
  const b = { days: { "2026-10-01": { t: 7 }, "2026-10-02": { t: 3, fast: 1 }, "bad": { t: 9, quran: 1 } },
              money: { "2026-10": { t: 2, income: "1000", given: -5, hack: 1 } } };
  const m = mergeData(a, b);
  assert.deepEqual(m.days["2026-10-01"], { t: 7 });
  assert.deepEqual(m.days["2026-10-02"], { t: 9, duha: 1 });
  assert.equal(m.days.bad, undefined);
  assert.deepEqual(m.money["2026-10"], { t: 2, income: 1000, given: null });
});

test("да‘ват и ⅓ желудка учитываются с даты появления в трекере", async () => {
  const { applicable } = await import("../public/core.js");
  assert.equal(applicable(d(2026, 11, 4)).length, 4);  // среда до добавления
  assert.equal(applicable(d(2026, 11, 5)).length, 7);  // четверг: пост + 6
  assert.equal(applicable(d(2026, 11, 6)).length, 6);  // пятница
  const data = emptyData();
  data.days["2026-11-04"] = { t: 1, tahajjud: 1, quran: 1, duha: 1, sadaqa: 1 };
  const st = monthStats(data, 2026, 10, d(2026, 11, 4));
  assert.equal(st.pct, 100); // старые дни не «проседают» из-за новых сунн
});

test("долги: остаток, просрочка и возврат в срок", async () => {
  const { debtInfo, debtSummary } = await import("../public/core.js");
  const today = d(2026, 11, 20);
  const open = { kind: "owe", amount: 1000, currency: "сум", due: "2026-11-10", payments: [{ date: "2026-11-01", amount: 400 }] };
  const i1 = debtInfo(open, today);
  assert.deepEqual([i1.left, i1.status, i1.late], [600, "overdue", 10]);
  const ontime = { kind: "owe", amount: 500, currency: "сум", due: "2026-11-30", payments: [{ date: "2026-11-15", amount: 500 }] };
  assert.equal(debtInfo(ontime, today).status, "ontime");
  const late = { kind: "owe", amount: 500, currency: "сум", due: "2026-11-01", payments: [{ date: "2026-11-04", amount: 500 }] };
  assert.deepEqual([debtInfo(late, today).status, debtInfo(late, today).late], ["late", 3]);
  const soon = { kind: "lent", amount: 200, currency: "$", due: "2026-11-23", payments: [] };
  assert.deepEqual([debtInfo(soon, today).status, debtInfo(soon, today).soon], ["soon", 3]);
  const s = debtSummary({ a: open, b: ontime, c: late, d: soon, e: { t: 5, deleted: true } }, today);
  assert.deepEqual(s.owe, { "сум": 600 });
  assert.deepEqual(s.lent, { "$": 200 });
  assert.equal(s.overdue, 1);
  assert.equal(s.timeliness, 50);
});

test("слияние долгов и завещания: удаление и более поздняя правка побеждают", () => {
  const a = { days: {}, money: {}, debts: { x1abcd: { t: 5, kind: "owe", person: "Али", amount: 100, payments: [] } },
              will: { t: 3, name: "Старое", bequests: [], heirs: [] } };
  const b = { days: {}, money: {}, debts: { x1abcd: { t: 9, deleted: true }, "bad id!": { t: 1, amount: 1 } },
              will: { t: 7, name: "Новое", bequests: [{ to: "Мечеть", share: "10", unit: "%" }], heirs: [], hack: 1 } };
  const m = mergeData(a, b);
  assert.deepEqual(m.debts, { x1abcd: { t: 9, deleted: true } });
  assert.equal(m.will.name, "Новое");
  assert.equal(m.will.hack, undefined);
  assert.deepEqual(m.will.bequests, [{ to: "Мечеть", share: 10, unit: "%", purpose: "" }]);
});
