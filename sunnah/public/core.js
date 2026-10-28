// Общая логика трекера: используется и приложением, и сервером синхронизации.

export const SUNNAHS = [
  { id: "fast",     title: "Пост",               sub: "понедельник и четверг" },
  { id: "tahajjud", title: "Тахаджуд-намаз",     sub: "ночная молитва" },
  { id: "quran",    title: "Коран после фаджра", sub: "чтение после утреннего намаза" },
  { id: "duha",     title: "Духа-намаз",         sub: "утренняя молитва, 2–8 ракатов" },
  { id: "sadaqa",   title: "Садака",             sub: "10% дохода" },
];
export const SUNNAH_IDS = SUNNAHS.map(s => s.id);

// Уважительные причины: в такой день невыполненные пункты не снижают рейтинг.
export const EXCUSES = [
  { id: "ill",    title: "Болезнь" },
  { id: "travel", title: "В пути" },
  { id: "hayd",   title: "Хайд" },
  { id: "other",  title: "Другое" },
];
export const EXCUSE_IDS = EXCUSES.map(e => e.id);

/* ---------- Даты ---------- */
export const pad = n => String(n).padStart(2, "0");
export const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthKey = (y, m) => `${y}-${pad(m + 1)}`;
export const parseKey = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
export const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const isFastDay = d => d.getDay() === 1 || d.getDay() === 4;
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_RE = /^\d{4}-\d{2}$/;

// «Сегодня» в заданном часовом поясе (для сервера: у каждого участника своё «сегодня»).
export function todayIn(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return parseKey(parts);
  } catch (e) {
    return startOfDay(new Date());
  }
}

/* ---------- Данные ---------- */
export const emptyData = () => ({ days: {}, money: {} });
export const hasMarks = rec => !!rec && SUNNAH_IDS.some(id => rec[id]);

// Первый день с отметкой: дни до начала пользования рейтинг не снижают.
export function startDay(data, today) {
  let first = null;
  for (const [k, rec] of Object.entries(data.days)) if (hasMarks(rec) && (!first || k < first)) first = k;
  if (!first) return today;
  const s = parseKey(first);
  return s < today ? s : today;
}

export const applicable = d => SUNNAHS.filter(s => s.id !== "fast" || isFastDay(d));

export function dayStats(data, d) {
  const rec = data.days[keyOf(d)] || {};
  const items = applicable(d);
  const done = items.filter(s => rec[s.id]).length;
  const ex = EXCUSE_IDS.includes(rec.ex) ? rec.ex : null;
  // В день с уважительной причиной учитывается только сделанное.
  return { done, total: ex ? done : items.length, possible: items.length, ex };
}

// Учитываются дни месяца от начала пользования по сегодняшний (будущие дни не снижают рейтинг).
export function monthStats(data, y, m, today) {
  const last = new Date(y, m + 1, 0).getDate();
  const start = startDay(data, today);
  const per = Object.fromEntries(SUNNAH_IDS.map(id => [id, { done: 0, total: 0 }]));
  let done = 0, total = 0, days = 0, excused = 0;
  for (let i = 1; i <= last; i++) {
    const d = new Date(y, m, i);
    if (d > today) break;
    if (d < start) continue;
    days++;
    const rec = data.days[keyOf(d)] || {};
    const ex = EXCUSE_IDS.includes(rec.ex);
    if (ex) excused++;
    for (const s of applicable(d)) {
      const ok = !!rec[s.id];
      if (ex && !ok) continue;
      per[s.id].total++; total++;
      if (ok) { per[s.id].done++; done++; }
    }
  }
  return { done, total, days, excused, per, pct: total ? (done / total) * 100 : null };
}

// Шкала рейтинга: >75 ярко-зелёный, >50 зелёный темнее, >25 ещё темнее, до 25 — чёрный.
export function level(pct) {
  if (pct === null || pct === undefined) return 0;
  if (pct > 75) return 4;
  if (pct > 50) return 3;
  if (pct > 25) return 2;
  return 1;
}

export const LEVEL_NAMES = { 0: "Нет данных", 1: "Чёрный", 2: "Тёмно-зелёный", 3: "Зелёный", 4: "Ярко-зелёный" };

/* ---------- Синхронизация ---------- */

// Очищает запись дня от посторонних полей.
export function cleanDay(rec) {
  if (!rec || typeof rec !== "object") return null;
  const out = { t: Number(rec.t) || 0 };
  for (const id of SUNNAH_IDS) if (rec[id]) out[id] = 1;
  if (EXCUSE_IDS.includes(rec.ex)) out.ex = rec.ex;
  return out;
}

export function cleanMoney(rec) {
  if (!rec || typeof rec !== "object") return null;
  const num = v => (v === null || v === "" || v === undefined || !isFinite(+v) || +v < 0) ? null : +v;
  return { t: Number(rec.t) || 0, income: num(rec.income), given: num(rec.given) };
}

// Слияние: по каждому дню и месяцу побеждает более поздняя правка (поле t).
export function mergeData(a, b) {
  const out = emptyData();
  for (const part of ["days", "money"]) {
    const re = part === "days" ? DAY_RE : MONTH_RE;
    const clean = part === "days" ? cleanDay : cleanMoney;
    const keys = new Set([...Object.keys(a[part] || {}), ...Object.keys(b[part] || {})]);
    for (const k of keys) {
      if (!re.test(k)) continue;
      const x = clean((a[part] || {})[k]), y = clean((b[part] || {})[k]);
      const win = !x ? y : !y ? x : (y.t >= x.t ? y : x);
      if (win) out[part][k] = win;
    }
  }
  return out;
}

/* ---------- Напоминания ---------- */
// weekdays: дни недели (0 — воскресенье), когда напоминание срабатывает; без поля — каждый день.
export const REMINDERS = [
  { id: "tahajjud", title: "Тахаджуд", hint: "каждую ночь", def: "04:00",
    push: "Время тахаджуда", body: "Последняя треть ночи: Господь нисходит к ближнему небу. Хотя бы два раката." },
  { id: "quran", title: "Коран после фаджра", hint: "каждое утро", def: "06:30",
    push: "Коран после фаджра", body: "Не вставайте с коврика сразу — хотя бы одна страница." },
  { id: "duha", title: "Духа-намаз", hint: "каждое утро", def: "09:00",
    push: "Духа-намаз", body: "Два раката духа — садака за каждый сустав (Муслим, 720)." },
  { id: "fast", title: "Завтра пост", hint: "вечером в воскресенье и среду", def: "21:00", weekdays: [0, 3],
    push: "Завтра день поста", body: "Сделайте намерение и поставьте будильник на сухур." },
  { id: "evening", title: "Отметить день", hint: "каждый вечер", def: "21:30",
    push: "Отметьте сегодняшний день", body: "Загляните в трекер и поставьте галочки." },
];
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function defaultReminders() {
  return Object.fromEntries(REMINDERS.map(r => [r.id, { on: false, time: r.def }]));
}

export function cleanReminders(src) {
  const out = defaultReminders();
  for (const r of REMINDERS) {
    const v = (src || {})[r.id];
    if (!v) continue;
    out[r.id] = { on: !!v.on, time: TIME_RE.test(v.time) ? v.time : r.def };
  }
  return out;
}
