// Общая логика трекера: используется и приложением, и сервером синхронизации.

export const SUNNAHS = [
  { id: "fast",     title: "Пост",               sub: "понедельник и четверг" },
  { id: "tahajjud", title: "Тахаджуд-намаз",     sub: "ночная молитва" },
  { id: "quran",    title: "Коран после фаджра", sub: "чтение после утреннего намаза" },
  { id: "duha",     title: "Духа-намаз",         sub: "утренняя молитва, 2–8 ракатов" },
  { id: "sadaqa",   title: "Садака",             sub: "10% дохода" },
  // since: дата, с которой сунна появилась в трекере; раньше этого дня она рейтинг не снижает.
  { id: "dawah",    title: "Да‘ват",             sub: "хотя бы раз поговорить с кем-то об Исламе", since: "2026-11-05" },
  { id: "third",    title: "⅓ желудка",          sub: "есть мало — лишь чтобы поддержать силы", since: "2026-11-05" },
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
export const emptyData = () => ({ days: {}, money: {}, debts: {}, will: null });
export const hasMarks = rec => !!rec && SUNNAH_IDS.some(id => rec[id]);

// Первый день с отметкой: дни до начала пользования рейтинг не снижают.
export function startDay(data, today) {
  let first = null;
  for (const [k, rec] of Object.entries(data.days)) if (hasMarks(rec) && (!first || k < first)) first = k;
  if (!first) return today;
  const s = parseKey(first);
  return s < today ? s : today;
}

export const applicable = d => {
  const k = keyOf(d);
  return SUNNAHS.filter(s => (s.id !== "fast" || isFastDay(d)) && (!s.since || k >= s.since));
};

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
  return { t: Number(rec.t) || 0, income: num(rec.income), given: num(rec.given) };
}

const str = (v, max) => typeof v === "string" ? v.slice(0, max) : "";
const num = v => (v === null || v === "" || v === undefined || !isFinite(+v) || +v < 0) ? null : +v;
const day = v => DAY_RE.test(v) ? v : "";

export const DEBT_ID_RE = /^[0-9a-z]{6,32}$/i;

export function cleanDebt(rec) {
  if (!rec || typeof rec !== "object") return null;
  const t = Number(rec.t) || 0;
  if (rec.deleted) return { t, deleted: true };
  const payments = (Array.isArray(rec.payments) ? rec.payments : []).slice(0, 200)
    .map(p => ({ date: day(p && p.date), amount: num(p && p.amount) }))
    .filter(p => p.date && p.amount);
  return {
    t, kind: rec.kind === "lent" ? "lent" : "owe",
    person: str(rec.person, 80), amount: num(rec.amount) || 0, currency: str(rec.currency, 12),
    taken: day(rec.taken), due: day(rec.due), note: str(rec.note, 500), witness: str(rec.witness, 120), payments,
  };
}

export const WILL_TEXT_FIELDS = ["name", "birth", "city", "intro", "advice", "amanat", "obligations", "funeral", "executor", "executorContact", "witness1", "witness2", "other"];

export function cleanWill(rec) {
  if (!rec || typeof rec !== "object") return null;
  const out = { t: Number(rec.t) || 0 };
  for (const f of WILL_TEXT_FIELDS) out[f] = str(rec[f], 4000);
  out.bequests = (Array.isArray(rec.bequests) ? rec.bequests : []).slice(0, 50).map(b => ({
    to: str(b && b.to, 120), share: num(b && b.share), unit: b && b.unit === "sum" ? "sum" : "%", purpose: str(b && b.purpose, 300),
  }));
  out.heirs = (Array.isArray(rec.heirs) ? rec.heirs : []).slice(0, 50).map(h => ({
    name: str(h && h.name, 120), relation: str(h && h.relation, 60),
  }));
  return out;
}

const newer = (x, y) => !x ? y : !y ? x : (y.t >= x.t ? y : x);

// Слияние: по каждому дню, месяцу и долгу побеждает более поздняя правка (поле t);
// завещание сливается целиком.
export function mergeData(a, b) {
  const out = emptyData();
  const parts = { days: [DAY_RE, cleanDay], money: [MONTH_RE, cleanMoney], debts: [DEBT_ID_RE, cleanDebt] };
  for (const [part, [re, clean]] of Object.entries(parts)) {
    const keys = new Set([...Object.keys(a[part] || {}), ...Object.keys(b[part] || {})]);
    for (const k of keys) {
      if (!re.test(k)) continue;
      const win = newer(clean((a[part] || {})[k]), clean((b[part] || {})[k]));
      if (win) out[part][k] = win;
    }
  }
  out.will = newer(cleanWill(a.will), cleanWill(b.will));
  return out;
}

/* ---------- Долги ---------- */
const daysBetween = (from, to) => Math.round((parseKey(to) - parseKey(from)) / 864e5);

// Состояние долга: сколько возвращено и вовремя ли.
export function debtInfo(debt, today) {
  const paid = debt.payments.reduce((s, p) => s + p.amount, 0);
  const left = Math.max(0, Math.round((debt.amount - paid) * 100) / 100);
  const closed = debt.amount > 0 && left === 0;
  const closedOn = closed ? debt.payments.map(p => p.date).sort().pop() : "";
  const t = keyOf(today);
  let status = "open", late = 0, soon = null;
  if (closed) {
    late = debt.due ? Math.max(0, daysBetween(debt.due, closedOn)) : 0;
    status = late ? "late" : "ontime";
  } else if (debt.due) {
    const diff = daysBetween(t, debt.due);
    if (diff < 0) { status = "overdue"; late = -diff; } else if (diff <= 7) { status = "soon"; soon = diff; }
  }
  return { paid, left, closed, closedOn, status, late, soon };
}

export function debtSummary(debts, today) {
  const owe = {}, lent = {};
  let overdue = 0, closedWithDue = 0, onTime = 0;
  for (const d of Object.values(debts)) {
    if (!d || d.deleted) continue;
    const i = debtInfo(d, today);
    if (!i.closed) {
      const bucket = d.kind === "lent" ? lent : owe;
      bucket[d.currency] = (bucket[d.currency] || 0) + i.left;
      if (i.status === "overdue" && d.kind === "owe") overdue++;
    } else if (d.kind === "owe" && d.due) {
      closedWithDue++;
      if (i.status === "ontime") onTime++;
    }
  }
  return { owe, lent, overdue, closedWithDue, onTime, timeliness: closedWithDue ? (onTime / closedWithDue) * 100 : null };
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
