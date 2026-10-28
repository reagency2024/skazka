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
