import {
  SUNNAHS, EXCUSES, REMINDERS, keyOf, monthKey, parseKey, startOfDay, isFastDay,
  emptyData, dayStats, monthStats, level, mergeData, cleanReminders, defaultReminders,
} from "./core.js";
import { PROOFS } from "./proofs.js";

/* ---------- Хранилище ---------- */
const DATA_KEY = "sunnah5.v1";
const SETTINGS_KEY = "sunnah5.settings";

function readJSON(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function writeJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* хранилище недоступно — работаем в памяти */ }
}

// Записи первой версии не имели метки времени; t = 1 — «старше любой новой правки».
function loadData() {
  const raw = readJSON(DATA_KEY) || {};
  const data = mergeData(emptyData(), { days: raw.days || {}, money: raw.money || {} });
  for (const part of ["days", "money"]) for (const rec of Object.values(data[part])) if (!rec.t) rec.t = 1;
  return data;
}

let data = loadData();
let settings = Object.assign({ server: "", token: "", name: "", lastSync: 0 }, readJSON(SETTINGS_KEY) || {});
settings.reminders = cleanReminders(settings.reminders || defaultReminders());

const saveSettings = () => writeJSON(SETTINGS_KEY, settings);
function save() {
  writeJSON(DATA_KEY, data);
  scheduleSync();
}

/* ---------- Даты ---------- */
const today = () => startOfDay(new Date());
const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const MONTHS_GEN = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
const WEEKDAYS = ["воскресенье","понедельник","вторник","среда","четверг","пятница","суббота"];
const WD_SHORT = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return "UTC"; } })();

function hijri(d) {
  try {
    return new Intl.DateTimeFormat("ru-RU-u-ca-islamic-umalqura", { day: "numeric", month: "long", year: "numeric" }).format(d);
  } catch (e) { return ""; }
}

const LEVEL_TEXT = {
  0: ["Нет данных", "Отметки в этом месяце ещё не начинались."],
  4: ["Ярко-зелёный", "Более 75% — отличный месяц. Пусть Аллах примет."],
  3: ["Зелёный", "Более 50% — хороший уровень, держите постоянство."],
  2: ["Тёмно-зелёный", "Более 25% — начало положено, добавьте по одной сунне."],
  1: ["Чёрный", "До 25% — начните с малого: одна сунна каждый день."],
};
const fmtPct = p => p === null || p === undefined ? "—" : `${Math.round(p)}%`;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- Состояние экрана ---------- */
let curDay = today();
let viewY = curDay.getFullYear(), viewM = curDay.getMonth();
let currentView = "today";
const $ = id => document.getElementById(id);
const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function nextFastDay(from) {
  const d = new Date(from);
  do { d.setDate(d.getDate() + 1); } while (!isFastDay(d));
  return d;
}

function dayRec(d, create) {
  const k = keyOf(d);
  if (!data.days[k] && create) data.days[k] = { t: 0 };
  return data.days[k] || {};
}

/* ---------- Сегодня ---------- */
function renderToday() {
  const d = curDay, t = today();
  const diff = Math.round((t - d) / 864e5);
  $("dayTitle").textContent = diff === 0 ? "Сегодня" : diff === 1 ? "Вчера" : `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
  $("daySub").textContent = `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]} · ${hijri(d)}`;
  $("nextDay").disabled = d >= t;

  const rec = dayRec(d);
  const fast = isFastDay(d);
  $("list").innerHTML = SUNNAHS.map((s, i) => {
    const off = s.id === "fast" && !fast;
    const on = !off && !!rec[s.id];
    let sub = s.sub;
    if (off) {
      const n = nextFastDay(d);
      sub = `не день поста · следующий: ${WEEKDAYS[n.getDay()]}, ${n.getDate()} ${MONTHS_GEN[n.getMonth()]}`;
    }
    return `<div class="item${off ? " off" : ""}">
      <button class="check" data-id="${s.id}" aria-pressed="${on}" ${off ? "disabled" : ""} aria-label="${s.title}">${CHECK_SVG}</button>
      <div class="body">
        <div class="row"><strong class="title">${i + 1}. ${s.title}</strong>
          <button class="linkbtn" data-proof="${s.id}">Доказательства</button></div>
        <span class="muted note">${sub}</span>
      </div></div>`;
  }).join("");

  const st = dayStats(data, d);
  $("dayBar").style.width = `${(st.done / st.possible) * 100}%`;
  $("dayCount").textContent = `${st.done} из ${st.possible}`;

  const ex = st.ex;
  $("excuse").innerHTML = [{ id: "", title: "Нет" }, ...EXCUSES].map(e =>
    `<button class="chip" role="radio" data-ex="${e.id}" aria-checked="${(ex || "") === e.id}">${e.title}</button>`).join("");
  $("excuseNote").textContent = ex
    ? "Невыполненные пункты этого дня не снижают рейтинг. Сделанное засчитывается."
    : "Болезнь, путь или хайд: отметьте причину, и пропуски этого дня не испортят рейтинг.";
  renderQuote(d);
}

function renderQuote(d) {
  const all = [];
  for (const s of SUNNAHS) for (const p of PROOFS[s.id].items) all.push({ ...p, sid: s.id });
  const start = new Date(d.getFullYear(), 0, 0);
  const doy = Math.floor((d - start) / 864e5);
  const q = all[doy % all.length];
  const title = SUNNAHS.find(s => s.id === q.sid).title;
  $("quote").innerHTML = `<div class="label">Напоминание дня · ${title}</div>
    ${q.ar ? `<p class="ar">${q.ar}</p>` : ""}<p>${q.tr}</p><span class="src">${q.src}</span>`;
}

function toggle(id) {
  const rec = dayRec(curDay, true);
  if (rec[id]) delete rec[id]; else rec[id] = 1;
  rec.t = Date.now();
  save();
  renderToday();
}

function setExcuse(ex) {
  const rec = dayRec(curDay, true);
  if (ex) rec.ex = ex; else delete rec.ex;
  rec.t = Date.now();
  save();
  renderToday();
}

/* ---------- Месяц ---------- */
function renderMonth() {
  const y = viewY, m = viewM, t = today();
  $("monthTitle").textContent = `${MONTHS[m]} ${y}`;
  $("monthSub").textContent = hijri(new Date(y, m, 15));
  $("nextMonth").disabled = new Date(y, m + 1, 1) > t;

  const st = monthStats(data, y, m, t);
  const lv = level(st.pct);
  const [name, hint] = LEVEL_TEXT[lv];
  $("score").className = `score lv${lv}`;
  $("score").innerHTML = `<div class="label" style="color:inherit;opacity:.8">Рейтинг месяца</div>
    <div class="pct num">${fmtPct(st.pct)}</div>
    <strong>${name}</strong>
    <span class="muted note">${hint}</span>
    <span class="muted note num">Выполнено ${st.done} из ${st.total} · учтено дней: ${st.days}${st.excused ? ` · с уважительной причиной: ${st.excused}` : ""}</span>`;

  $("breakdown").innerHTML = SUNNAHS.map(s => {
    const p = st.per[s.id];
    const pct = p.total ? (p.done / p.total) * 100 : 0;
    return `<div class="bd"><span>${s.title}</span><span class="num muted">${p.done}/${p.total}</span>
      <div class="bar"><i style="width:${pct}%"></i></div></div>`;
  }).join("");

  // календарь, неделя с понедельника
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7;
  const last = new Date(y, m + 1, 0).getDate();
  const start = startDayFor();
  let html = WD_SHORT.map(w => `<span class="wd">${w}</span>`).join("");
  for (let i = 0; i < lead; i++) html += "<span></span>";
  for (let i = 1; i <= last; i++) {
    const d = new Date(y, m, i);
    const fut = d > t;
    const ds = dayStats(data, d);
    let cls;
    if (fut) cls = "future";
    else if (ds.ex && ds.done === 0) cls = "exs";
    else if (d < start) cls = "lv0";
    else cls = `lv${level(ds.total ? (ds.done / ds.total) * 100 : 0)}`;
    const label = fut ? "впереди" : `${ds.done} из ${ds.possible}${ds.ex ? ", уважительная причина" : ""}`;
    html += `<button class="cell ${cls}${+d === +t ? " today" : ""}${isFastDay(d) ? " fd" : ""}" data-day="${keyOf(d)}"
      ${fut ? "disabled" : ""} aria-label="${i} ${MONTHS_GEN[m]}: ${label}">${i}</button>`;
  }
  $("cal").innerHTML = html;

  $("yearTitle").textContent = `${y} год`;
  $("year").innerHTML = MONTHS.map((n, i) => {
    const ms = new Date(y, i, 1) > t ? null : monthStats(data, y, i, t);
    const shown = ms && ms.pct !== null;
    return `<button class="lv${shown ? level(ms.pct) : 0}${i === m ? " cur" : ""}" data-month="${i}" ${ms ? "" : "disabled"}>
      <span>${n.slice(0, 3)}</span><strong class="num">${shown ? fmtPct(ms.pct) : "—"}</strong></button>`;
  }).join("");

  const money = data.money[monthKey(y, m)] || {};
  $("income").value = money.income ?? "";
  $("given").value = money.given ?? "";
  renderSadaqa();
}

function startDayFor() {
  // Первый день с отметкой (дни до него в календаре не окрашиваются).
  const keys = Object.entries(data.days).filter(([, r]) => SUNNAHS.some(s => r[s.id])).map(([k]) => k).sort();
  return keys.length ? parseKey(keys[0]) : today();
}

function renderSadaqa() {
  const inc = parseFloat($("income").value), giv = parseFloat($("given").value);
  const el = $("sadaqaCalc");
  if (!(inc > 0)) { el.textContent = "Укажите доход за месяц — приложение посчитает 10% и вашу долю."; return; }
  const goal = inc * 0.1, g = giv > 0 ? giv : 0, share = (g / inc) * 100;
  const f = n => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  el.innerHTML = `Цель 10%: <b class="num">${f(goal)}</b>. Отдано: <b class="num">${f(g)}</b> — это <b class="num">${share.toFixed(1)}%</b> дохода. ` +
    (g >= goal ? "Цель месяца достигнута, ма ша Аллах." : `До цели осталось <b class="num">${f(goal - g)}</b>.`);
}

function saveMoney() {
  const inc = $("income").value, giv = $("given").value;
  data.money[monthKey(viewY, viewM)] = { income: inc === "" ? null : +inc, given: giv === "" ? null : +giv, t: Date.now() };
  save();
  renderSadaqa();
}

/* ---------- Доказательства ---------- */
function renderProofs() {
  $("toc").innerHTML = SUNNAHS.map((s, i) => `<a href="#proofs" data-jump="${s.id}">${i + 1}. ${s.title}</a>`).join("");
  $("proofs").innerHTML = SUNNAHS.map((s, i) => {
    const p = PROOFS[s.id];
    return `<article class="proof" id="p-${s.id}">
      <header><span class="label">Сунна ${i + 1} · ${s.sub}</span><h2>${s.title}</h2><p class="muted">${p.lead}</p></header>
      ${p.items.map(e => `<div class="ev"><span class="kind">${e.kind}</span>
        ${e.ar ? `<p class="ar" lang="ar">${e.ar}</p>` : ""}
        <p class="tr">${e.tr}</p><span class="src">${e.src}</span>
        ${e.cm ? `<p class="cm">${e.cm}</p>` : ""}</div>`).join("")}
      <div class="practice"><strong>На практике.</strong> ${p.practice}</div>
    </article>`;
  }).join("");
}

/* ---------- Сервер и синхронизация ---------- */
const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
let serverDetected = false;

function serverBase() {
  const s = settings.server || (window.SUNNAH_CONFIG && window.SUNNAH_CONFIG.server) || (serverDetected ? location.origin : "");
  return s.replace(/\/+$/, "");
}

async function api(path, { method = "GET", body, auth = true } = {}) {
  const base = serverBase();
  if (!base) throw Object.assign(new Error("Сервер синхронизации не подключён"), { code: "noserver" });
  const headers = { "Content-Type": "application/json" };
  if (auth && settings.token) headers.Authorization = `Bearer ${settings.token}`;
  let res;
  try {
    res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw Object.assign(new Error("Нет связи с сервером"), { code: "network" });
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `Ошибка сервера (${res.status})`), { status: res.status });
  return json;
}

async function detectServer() {
  if (isNative() || !/^https?:$/.test(location.protocol)) return;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3000);
    const res = await fetch(`${location.origin}/api/health`, { signal: ctl.signal });
    clearTimeout(timer);
    const j = await res.json();
    serverDetected = !!(j && j.app === "sunnah5");
  } catch (e) { serverDetected = false; }
}

let syncTimer = null, syncing = false, syncState = "";
function scheduleSync() {
  if (!settings.token || !serverBase()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, 1500);
}

async function sync() {
  if (!settings.token || !serverBase() || syncing) return;
  syncing = true;
  try {
    const r = await api("/api/sync", { method: "POST", body: { days: data.days, money: data.money, tz: TZ } });
    data = mergeData(data, r);
    writeJSON(DATA_KEY, data);
    settings.lastSync = Date.now();
    if (r.name) settings.name = r.name;
    saveSettings();
    syncState = "";
    rerender();
  } catch (e) {
    if (e.status === 401) {
      syncState = "Ключ синхронизации не принят сервером. Подключите профиль заново.";
    } else syncState = e.message;
  } finally {
    syncing = false;
    renderSyncStatus();
  }
}

function renderSyncStatus() {
  const el = $("syncStatus");
  if (!el) return;
  if (syncState) { el.textContent = syncState; return; }
  if (!settings.token) { el.textContent = ""; return; }
  el.textContent = settings.lastSync
    ? `Синхронизировано в ${new Date(settings.lastSync).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
    : "Ещё не синхронизировано";
}

const fmtKey = k => k.replace(/(.{4})(?=.)/g, "$1-");

function renderAccount() {
  const el = $("account");
  $("serverUrl").value = settings.server || "";
  $("serverUrl").placeholder = serverBase() || "https://sunnah.example.com";
  if (!serverBase()) {
    el.innerHTML = `<p class="note">Сервер синхронизации не подключён. Отметки хранятся только на этом устройстве.
      Чтобы синхронизировать телефоны и вступать в группы, разверните сервер (инструкция в README проекта) и укажите его адрес ниже.</p>`;
    renderSyncStatus();
    return;
  }
  if (!settings.token) {
    el.innerHTML = `<p class="note muted">Создайте профиль: отметки будут храниться на сервере, а на другом телефоне их можно будет подключить по ключу.</p>
      <form class="inline" id="registerForm">
        <input type="text" id="regName" placeholder="Ваше имя для групп" maxlength="40" required aria-label="Имя">
        <button class="btn primary" type="submit">Создать профиль</button>
      </form>
      <form class="inline" id="linkForm">
        <input type="text" id="linkKey" placeholder="Ключ с другого устройства" autocomplete="off" aria-label="Ключ синхронизации">
        <button class="btn" type="submit">Подключить</button>
      </form>`;
  } else {
    el.innerHTML = `<form class="inline" id="nameForm">
        <input type="text" id="myName" value="${esc(settings.name)}" maxlength="40" aria-label="Имя в группах">
        <button class="btn" type="submit">Сохранить имя</button>
      </form>
      <div class="stack-sm">
        <span class="label">Ключ синхронизации</span>
        <span class="keybox" id="keybox">${"•".repeat(4)}-${"•".repeat(4)}-…</span>
        <p class="note muted">Введите этот ключ на другом телефоне, чтобы подключить тот же профиль. Никому его не передавайте.</p>
      </div>
      <div class="btns">
        <button class="btn" id="showKey">Показать ключ</button>
        <button class="btn" id="copyKey">Скопировать ключ</button>
        <button class="btn primary" id="syncNow">Синхронизировать</button>
        <button class="btn danger" id="logout">Отключить устройство</button>
      </div>
      <div class="confirm" id="logoutConfirm" hidden>Отключить это устройство от профиля? Отметки останутся на телефоне.
        <button class="btn danger" id="logoutYes">Отключить</button><button class="btn" id="logoutNo">Отмена</button></div>`;
  }
  renderSyncStatus();
}

$("account").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    if (e.target.id === "registerForm") {
      const r = await api("/api/register", { method: "POST", body: { name: $("regName").value.trim() }, auth: false });
      Object.assign(settings, { token: r.token, name: r.name }); saveSettings();
      toast("Профиль создан"); await sync();
      if (anyReminderOn()) enableReminders(true);
    } else if (e.target.id === "linkForm") {
      const token = $("linkKey").value.replace(/[^0-9a-z]/gi, "").toUpperCase();
      if (!token) return;
      settings.token = token;
      try {
        const me = await api("/api/me");
        settings.name = me.name; saveSettings();
        toast("Устройство подключено"); await sync();
      } catch (err) { settings.token = ""; throw err; }
    } else if (e.target.id === "nameForm") {
      const r = await api("/api/me", { method: "POST", body: { name: $("myName").value.trim() } });
      settings.name = r.name; saveSettings(); toast("Имя сохранено");
    }
    renderAccount();
  } catch (err) { toast(err.message); }
});

$("account").addEventListener("click", e => {
  const id = e.target.id;
  if (id === "showKey") $("keybox").textContent = fmtKey(settings.token);
  if (id === "copyKey") copyText(fmtKey(settings.token), "Ключ скопирован");
  if (id === "syncNow") sync().then(() => toast(syncState || "Синхронизировано"));
  if (id === "logout") $("logoutConfirm").hidden = false;
  if (id === "logoutNo") $("logoutConfirm").hidden = true;
  if (id === "logoutYes") {
    Object.assign(settings, { token: "", name: "", lastSync: 0 }); saveSettings();
    syncState = ""; renderAccount(); toast("Устройство отключено");
  }
});

$("serverForm").addEventListener("submit", async e => {
  e.preventDefault();
  const v = $("serverUrl").value.trim().replace(/\/+$/, "");
  if (v && !/^https?:\/\//.test(v)) { toast("Адрес должен начинаться с https://"); return; }
  settings.server = v; saveSettings();
  if (v) {
    try { const j = await api("/api/health", { auth: false }); if (j.app !== "sunnah5") throw new Error(); toast("Сервер подключён"); }
    catch (err) { toast("По этому адресу сервер трекера не отвечает"); }
  }
  renderAccount(); renderReminders();
});

/* ---------- Группы ---------- */
async function renderGroups() {
  const gate = $("groupsGate"), list = $("groupsList");
  $("groupsForms").hidden = true;
  if (!serverBase()) {
    gate.hidden = false;
    gate.innerHTML = `<h3>Нужен сервер синхронизации</h3><p class="note">Группы работают через ваш сервер. Подключите его в настройках.</p>
      <div class="btns"><a class="btn" href="#more">Открыть настройки</a></div>`;
    list.innerHTML = "";
    return;
  }
  if (!settings.token) {
    gate.hidden = false;
    gate.innerHTML = `<h3>Создайте профиль</h3><p class="note">Чтобы вступить в группу, нужен профиль с именем. Это займёт секунду.</p>
      <div class="btns"><a class="btn primary" href="#more">Создать профиль</a></div>`;
    list.innerHTML = "";
    return;
  }
  gate.hidden = true;
  $("groupsForms").hidden = false;
  if (!list.children.length) list.innerHTML = `<p class="muted">Загружаю группы…</p>`;
  try {
    const t = today();
    const r = await api(`/api/groups?month=${monthKey(t.getFullYear(), t.getMonth())}`);
    if (!r.groups.length) {
      list.innerHTML = `<div class="panel"><h3>Пока нет групп</h3><p class="note muted">Создайте группу и отправьте код приглашения родным или друзьям. Или вступите по коду, который вам прислали.</p></div>`;
      return;
    }
    list.innerHTML = r.groups.map(g => `<div class="panel group" data-code="${esc(g.code)}">
      <div class="spread"><h3>${esc(g.name)}</h3><span class="muted note">${MONTHS[t.getMonth()]} · участников: ${g.members.length}</span></div>
      <div class="board">${g.members.map((m, i) => `<div class="member${m.me ? " me" : ""}">
          <span class="rank num">${i + 1}</span>
          <div class="who"><span>${esc(m.name)}${m.me ? " (вы)" : ""}</span><div class="bar"><i style="width:${m.pct ?? 0}%"></i></div></div>
          <span class="pill num lv${level(m.pct)}">${fmtPct(m.pct)}</span>
        </div>`).join("")}</div>
      <div class="spread"><span class="note">Код приглашения: <span class="code">${esc(g.code)}</span></span>
        <span class="btns"><button class="btn" data-act="copy">Скопировать код</button><button class="btn danger" data-act="leave">Выйти</button></span></div>
      <div class="confirm" data-confirm hidden>Выйти из группы «${esc(g.name)}»?
        <button class="btn danger" data-act="leaveYes">Выйти</button><button class="btn" data-act="leaveNo">Отмена</button></div>
    </div>`).join("");
  } catch (e) {
    list.innerHTML = `<div class="panel"><p class="note">${esc(e.message)}</p></div>`;
  }
}

$("groupsList").addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const card = b.closest("[data-code]"), code = card.dataset.code;
  const act = b.dataset.act;
  if (act === "copy") copyText(code, "Код скопирован");
  if (act === "leave") card.querySelector("[data-confirm]").hidden = false;
  if (act === "leaveNo") card.querySelector("[data-confirm]").hidden = true;
  if (act === "leaveYes") {
    try { await api("/api/groups/leave", { method: "POST", body: { code } }); toast("Вы вышли из группы"); renderGroups(); }
    catch (err) { toast(err.message); }
  }
});
$("joinForm").addEventListener("submit", async e => {
  e.preventDefault();
  const code = $("joinCode").value.replace(/[^0-9a-z]/gi, "").toUpperCase();
  if (!code) return;
  try {
    await sync();
    const r = await api("/api/groups/join", { method: "POST", body: { code } });
    $("joinCode").value = ""; toast(`Вы в группе «${r.name}»`); renderGroups();
  } catch (err) { toast(err.message); }
});
$("createForm").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("groupName").value.trim();
  if (!name) return;
  try {
    await sync();
    const r = await api("/api/groups", { method: "POST", body: { name } });
    $("groupName").value = ""; toast(`Группа создана. Код: ${r.code}`); renderGroups();
  } catch (err) { toast(err.message); }
});

/* ---------- Напоминания ---------- */
const anyReminderOn = () => REMINDERS.some(r => settings.reminders[r.id].on);
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
let lnPlugin = null;
const localNotifications = () => {
  const C = window.Capacitor;
  if (!lnPlugin && C) lnPlugin = (C.Plugins && C.Plugins.LocalNotifications) || (C.registerPlugin && C.registerPlugin("LocalNotifications")) || null;
  return lnPlugin;
};

function reminderMode() {
  if (isNative() && localNotifications()) return "native";
  if (pushSupported() && serverBase() && settings.token) return "push";
  return "none";
}

function renderReminders() {
  $("reminders").innerHTML = REMINDERS.map(r => {
    const v = settings.reminders[r.id];
    return `<div class="rem">
      <input type="checkbox" id="rem-${r.id}" data-rem="${r.id}" ${v.on ? "checked" : ""}>
      <label for="rem-${r.id}"><strong>${r.title}</strong><span class="note muted">${r.hint}</span></label>
      <input type="time" id="remt-${r.id}" data-remt="${r.id}" value="${v.time}" aria-label="Время: ${r.title}">
    </div>`;
  }).join("");
  const mode = reminderMode();
  $("remindMode").textContent = {
    native: "Уведомления приходят от самого приложения и работают без интернета.",
    push: "Уведомления присылает ваш сервер. На iPhone они работают, если приложение добавлено на экран «Домой».",
    none: !serverBase() || !settings.token
      ? "Чтобы получать уведомления в браузере, подключите сервер и профиль ниже. Вариант без сервера — «Добавить в календарь телефона»: напоминания будут приходить от календаря."
      : "Этот браузер не поддерживает уведомления. Используйте «Добавить в календарь телефона».",
  }[mode];
  $("icsReminders").hidden = isNative();
}

$("reminders").addEventListener("change", e => {
  const id = e.target.dataset.rem || e.target.dataset.remt;
  if (!id) return;
  settings.reminders[id] = { on: $(`rem-${id}`).checked, time: $(`remt-${id}`).value || settings.reminders[id].time };
  saveSettings();
  $("remindStatus").textContent = "Изменения вступят в силу после нажатия «Включить напоминания».";
});

const hm = time => time.split(":").map(Number);

async function enableReminders(quiet) {
  const status = $("remindStatus");
  const mode = reminderMode();
  try {
    if (mode === "native") {
      const LN = localNotifications();
      const perm = await LN.requestPermissions();
      if (perm.display !== "granted") throw new Error("Разрешите уведомления для приложения в настройках телефона.");
      const pending = await LN.getPending();
      if (pending.notifications.length) await LN.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
      const list = [];
      REMINDERS.forEach((r, i) => {
        const v = settings.reminders[r.id];
        if (!v.on) return;
        const [hour, minute] = hm(v.time);
        const base = { title: r.push, body: r.body, extra: { view: "today" } };
        if (r.weekdays) {
          for (const wd of r.weekdays) list.push({ ...base, id: 100 + i * 10 + wd, schedule: { on: { weekday: wd + 1, hour, minute }, allowWhileIdle: true } });
        } else list.push({ ...base, id: 100 + i * 10, schedule: { on: { hour, minute }, allowWhileIdle: true } });
      });
      if (list.length) await LN.schedule({ notifications: list });
      status.textContent = list.length ? `Включено напоминаний: ${list.length}.` : "Напоминания выключены.";
    } else if (mode === "push") {
      let sub = null;
      if (anyReminderOn()) {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") throw new Error("Браузер не разрешил уведомления. Разрешите их в настройках сайта.");
        const reg = await navigator.serviceWorker.ready;
        sub = await reg.pushManager.getSubscription();
        if (!sub) {
          const { key } = await api("/api/push/key", { auth: false });
          sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key) });
        }
      }
      await api("/api/push", { method: "POST", body: { subscription: sub ? sub.toJSON() : null, reminders: settings.reminders, tz: TZ } });
      status.textContent = anyReminderOn() ? "Напоминания включены. Их пришлёт сервер в указанное время." : "Напоминания выключены.";
    } else {
      throw new Error("Здесь уведомления недоступны. Нажмите «Добавить в календарь телефона».");
    }
    if (!quiet) toast("Готово");
  } catch (e) {
    status.textContent = e.message;
  }
}

function b64urlToBytes(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}

// Файл календаря (.ics) с повторяющимися событиями и сигналом — работает без сервера.
function buildICS() {
  const p = n => String(n).padStart(2, "0");
  const icsEsc = s => s.replace(/\\/g, "\\\\").replace(/[,;]/g, m => "\\" + m).replace(/\n/g, "\\n");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//5 sunnah//RU", "CALSCALE:GREGORIAN"];
  for (const r of REMINDERS) {
    const v = settings.reminders[r.id];
    if (!v.on) continue;
    const [h, mi] = hm(v.time);
    const d = new Date(); d.setDate(d.getDate() + 1);
    if (r.weekdays) while (!r.weekdays.includes(d.getDay())) d.setDate(d.getDate() + 1);
    const byday = r.weekdays ? `;BYDAY=${r.weekdays.map(w => ["SU","MO","TU","WE","TH","FR","SA"][w]).join(",")}` : "";
    lines.push("BEGIN:VEVENT", `UID:sunnah5-${r.id}@tracker`, `DTSTAMP:${stamp}`,
      `DTSTART:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(h)}${p(mi)}00`, "DURATION:PT15M",
      `RRULE:FREQ=${r.weekdays ? "WEEKLY" : "DAILY"}${byday}`,
      `SUMMARY:${icsEsc(r.push)}`, `DESCRIPTION:${icsEsc(r.body)}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(r.push)}`, "TRIGGER:PT0M", "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

$("saveReminders").onclick = () => enableReminders(false);
$("icsReminders").onclick = () => {
  if (!anyReminderOn()) { $("remindStatus").textContent = "Отметьте хотя бы одно напоминание."; return; }
  const url = URL.createObjectURL(new Blob([buildICS()], { type: "text/calendar;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "5-sunnah-napominaniya.ics" });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  $("remindStatus").textContent = "Откройте скачанный файл — телефон предложит добавить события в календарь.";
};

/* ---------- Резервная копия ---------- */
function copyText(text, msg) {
  const fallback = () => toast("Не получилось скопировать — выделите текст вручную");
  try { navigator.clipboard.writeText(text).then(() => toast(msg), fallback); } catch (e) { fallback(); }
}
$("copyBackup").onclick = () => { $("backup").value = JSON.stringify(data); copyText($("backup").value, "Скопировано"); };
$("restoreBackup").onclick = () => {
  try {
    const parsed = JSON.parse($("backup").value);
    if (!parsed || typeof parsed.days !== "object") throw new Error();
    // Восстановленные записи считаются свежими правками, чтобы попасть на сервер.
    const now = Date.now();
    const fresh = mergeData(emptyData(), { days: parsed.days || {}, money: parsed.money || {} });
    for (const part of ["days", "money"]) for (const rec of Object.values(fresh[part])) rec.t = now;
    data = mergeData(data, fresh);
    save(); toast("Данные восстановлены");
  } catch (e) { toast("Не получилось: вставьте текст резервной копии целиком"); }
};

/* ---------- Навигация ---------- */
const VIEWS = ["today", "month", "groups", "proofs", "more"];
let pendingJump = null;

function rerender() {
  if (currentView === "today") renderToday();
  if (currentView === "month") renderMonth();
}

function route() {
  const h = location.hash.slice(1);
  const v = VIEWS.includes(h) ? h : "today";
  currentView = v;
  for (const name of VIEWS) $(`view-${name}`).hidden = name !== v;
  document.querySelectorAll(".tabs a").forEach(a => a.setAttribute("aria-current", a.dataset.tab === v ? "page" : "false"));
  if (v === "today") renderToday();
  if (v === "month") renderMonth();
  if (v === "groups") renderGroups();
  if (v === "more") { renderReminders(); renderAccount(); $("backup").value = JSON.stringify(data); }
  if (v === "proofs" && pendingJump) {
    const el = $(`p-${pendingJump}`); pendingJump = null;
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
  } else window.scrollTo(0, 0);
}
function go(view, jump) {
  pendingJump = jump || null;
  if (location.hash === `#${view}`) route(); else location.hash = view;
}

function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------- События ---------- */
$("list").addEventListener("click", e => {
  const c = e.target.closest(".check"); if (c && !c.disabled) return toggle(c.dataset.id);
  const p = e.target.closest("[data-proof]"); if (p) go("proofs", p.dataset.proof);
});
$("excuse").addEventListener("click", e => {
  const c = e.target.closest("[data-ex]"); if (c) setExcuse(c.dataset.ex);
});
$("prevDay").onclick = () => { curDay = new Date(curDay.getFullYear(), curDay.getMonth(), curDay.getDate() - 1); renderToday(); };
$("nextDay").onclick = () => { if (curDay < today()) { curDay = new Date(curDay.getFullYear(), curDay.getMonth(), curDay.getDate() + 1); renderToday(); } };
$("prevMonth").onclick = () => { viewM--; if (viewM < 0) { viewM = 11; viewY--; } renderMonth(); };
$("nextMonth").onclick = () => { viewM++; if (viewM > 11) { viewM = 0; viewY++; } renderMonth(); };
$("cal").addEventListener("click", e => {
  const c = e.target.closest("[data-day]"); if (!c || c.disabled) return;
  curDay = parseKey(c.dataset.day); go("today");
});
$("year").addEventListener("click", e => {
  const b = e.target.closest("[data-month]"); if (!b || b.disabled) return;
  viewM = +b.dataset.month; renderMonth();
});
$("toc").addEventListener("click", e => {
  const a = e.target.closest("[data-jump]"); if (!a) return;
  e.preventDefault(); $(`p-${a.dataset.jump}`).scrollIntoView({ block: "start", behavior: "smooth" });
});
$("income").addEventListener("input", saveMoney);
$("given").addEventListener("input", saveMoney);
window.addEventListener("hashchange", route);

// Вернулись в приложение: мог наступить новый день, а на другом телефоне — появиться отметки.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  $("hijri").textContent = hijri(today());
  route();
  sync();
});

/* ---------- Запуск ---------- */
$("hijri").textContent = hijri(today());
renderProofs();
route();

if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol) && !isNative()) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
detectServer().then(() => {
  if (currentView === "more") route();
  if (currentView === "groups") renderGroups();
  sync();
});
