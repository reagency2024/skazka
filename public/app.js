// Сказка про меня — клиентская часть (без сборки, чистый JS).

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $("#app");
const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const STEPS = ["photo", "story", "art", "voice", "book"];
let config = null;
let stopReader = () => {};

// ---------- утилиты ----------

async function api(url, { method = "GET", body } = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}

let toastTimer;
function toast(text, type = "") {
  const el = $("#toast");
  el.textContent = text;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast"), type === "error" ? 6000 : 3000);
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function setSteps(project, current) {
  const nav = $("#steps");
  nav.hidden = !current;
  if (!current) return;
  const reached = project ? STEPS.indexOf(project.step === "build" ? "book" : project.step) : 0;
  $$("li", nav).forEach((li, i) => {
    li.className = li.dataset.step === current ? "active" : i < Math.max(reached, STEPS.indexOf(current)) ? "done" : "";
    li.onclick = project && i <= reached ? () => go(`#/p/${project.id}/${li.dataset.step}`) : null;
    li.style.cursor = li.onclick ? "pointer" : "default";
  });
}

function loading(text) {
  return `<div class="loading"><div class="spinner"></div><div class="progress-msg">${esc(text)}</div></div>`;
}

function storyHtml(text) {
  const title = /^#\s*(.+)$/m.exec(text)?.[1];
  const body = text.replace(/^#\s*.+$/m, "").trim();
  return (title ? `<h3>${esc(title)}</h3>` : "") + esc(body);
}

const words = (t) => (t.match(/[\p{L}\d]+/gu) || []).length;

// Уменьшаем фото перед загрузкой: быстрее и бережнее к трафику.
function resizeImage(file, max = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * k);
      canvas.height = Math.round(img.height * k);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => reject(new Error("Не удалось открыть изображение"));
    img.src = URL.createObjectURL(file);
  });
}

// ---------- маршрутизация ----------

async function render() {
  stopReader();
  $("#toast").className = "toast";
  window.scrollTo(0, 0);
  config ??= await api("/api/config");
  const [, route, id, step] = location.hash.split("/");
  try {
    if (route === "new") return viewPhoto(null);
    if (route === "p" && id) {
      const project = await api(`/api/projects/${id}`);
      const target = step || (project.step === "build" ? "book" : project.step);
      const view = { photo: viewPhoto, story: viewStory, art: viewArt, voice: viewVoice, book: viewBook }[target];
      return (view || viewStory)(project);
    }
    return viewLibrary();
  } catch (err) {
    setSteps(null);
    app.innerHTML = `<div class="card"><h2>Что-то пошло не так</h2><p>${esc(err.message)}</p><a class="btn" href="#/">На главную</a></div>`;
  }
}
window.addEventListener("hashchange", render);

// ---------- библиотека ----------

async function viewLibrary() {
  setSteps(null);
  const projects = await api("/api/projects");
  const stepName = { story: "пишем сказку", art: "рисуем", voice: "выбираем голос", build: "собираем книгу", book: "готова" };
  app.innerHTML = `
    <section class="hero">
      <h1>Сказка, где главный герой — ваш ребёнок</h1>
      <p class="lead">Загрузите фото, расскажите, о чём должна быть сказка, — Claude её сочинит, художник нарисует, сказочник озвучит. А вы прочитаете её перед сном.</p>
      <a href="#/new" class="btn big">✨ Создать сказку</a>
    </section>
    <h2 style="color:var(--paper)">Моя полка</h2>
    ${
      projects.length
        ? `<div class="shelf">${projects
            .map(
              (p) => `
          <a class="tile" href="#/p/${p.id}">
            <div class="cover" style="background-image:url('${esc(p.cover || "")}')"></div>
            <div class="t"><b>${esc(p.title)}</b>
              <small>${esc(p.name || "")}</small><br>
              <span class="badge ${p.ready ? "ok" : ""}">${p.ready ? "📖 читать" : esc(stepName[p.step] || "черновик")}</span>
            </div>
          </a>`
            )
            .join("")}</div>`
        : `<p class="empty">Здесь появятся ваши книжки.</p>`
    }`;
}

// ---------- шаг 1: фото ----------

function viewPhoto(project) {
  setSteps(project, "photo");
  const c = project?.child || {};
  app.innerHTML = `
    <div class="card">
      <h2>Кто герой сказки?</h2>
      <p class="lead">Загрузите фото ребёнка — по нему художник нарисует героя похожим.</p>
      <div class="photo-layout">
        <div>
          <div class="drop" id="drop" tabindex="0" role="button" aria-label="Загрузить фото">
            ${c.photoUrl ? `<img src="${esc(c.photoUrl)}" alt="Фото ребёнка">` : `<div><span class="big-icon">📷</span>Нажмите или перетащите фото сюда</div>`}
          </div>
          <input type="file" id="file" accept="image/*" hidden>
        </div>
        <div>
          <div class="grid2">
            <div class="field"><label for="name">Имя</label><input type="text" id="name" placeholder="Лола" value="${esc(c.name || "")}"></div>
            <div class="field"><label for="age">Возраст</label><input type="text" id="age" placeholder="5 лет" value="${esc(c.age || "")}"></div>
          </div>
          <div class="field"><label for="gender">Герой —</label>
            <select id="gender">
              ${["девочка", "мальчик", ""].map((g) => `<option value="${g}" ${c.gender === g ? "selected" : ""}>${g || "не важно"}</option>`).join("")}
            </select>
          </div>
          ${
            project
              ? `<div class="field"><label for="appearance">Как рисовать героя</label>
                 <textarea id="appearance" placeholder="Например: curly blond hair, blue eyes, yellow raincoat">${esc(c.appearance || "")}</textarea>
                 <div class="hint">Описание по фото — его использует художник. Можно поправить.</div></div>`
              : ""
          }
          <p class="privacy">🔒 Фото хранится только на вашем сервере. Claude смотрит на него, чтобы описать внешность героя; в GPT Image фото передаётся как образец, если выберете этот стиль рисования.</p>
          <div class="row end">
            <button class="btn" id="next">${project ? "Сохранить и дальше →" : "Дальше: придумать сказку →"}</button>
          </div>
        </div>
      </div>
    </div>`;

  let photo = null;
  const drop = $("#drop");
  const file = $("#file");
  const setFile = async (f) => {
    if (!f || !f.type.startsWith("image/")) return toast("Нужна картинка", "error");
    photo = await resizeImage(f);
    drop.innerHTML = `<img src="${photo}" alt="Фото ребёнка">`;
  };
  drop.onclick = () => file.click();
  drop.onkeydown = (e) => (e.key === "Enter" || e.key === " ") && file.click();
  file.onchange = () => setFile(file.files[0]);
  drop.ondragover = (e) => (e.preventDefault(), drop.classList.add("over"));
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => (e.preventDefault(), drop.classList.remove("over"), setFile(e.dataTransfer.files[0]));

  $("#next").onclick = async () => {
    const child = { name: $("#name").value.trim(), age: $("#age").value.trim(), gender: $("#gender").value };
    if (!child.name) return toast("Как зовут героя?", "error");
    const btn = $("#next");
    btn.disabled = true;
    try {
      if (project) {
        if (photo) toast("Чтобы сменить фото, создайте новую сказку");
        await api(`/api/projects/${project.id}`, { method: "PATCH", body: { child: { ...child, appearance: $("#appearance").value.trim() } } });
        go(`#/p/${project.id}/story`);
      } else {
        if (!photo) throw new Error("Загрузите фото ребёнка");
        btn.textContent = "Знакомимся с героем…";
        const created = await api("/api/projects", { method: "POST", body: { ...child, photo } });
        go(`#/p/${created.id}/story`);
      }
    } catch (err) {
      toast(err.message, "error");
      btn.disabled = false;
      btn.textContent = "Дальше: придумать сказку →";
    }
  };
}

// ---------- шаг 2: придумать сказку ----------

async function streamStory(project, body, out) {
  const res = await fetch(`/api/projects/${project.id}/story`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || "Ошибка сервера");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let result = null;
  out.classList.add("writing");
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = /^event: (.+)$/m.exec(chunk)?.[1];
      const data = JSON.parse(/^data: (.+)$/m.exec(chunk)?.[1] || "null");
      if (event === "delta") {
        text += data;
        out.innerHTML = storyHtml(text);
        out.scrollTop = out.scrollHeight;
      } else if (event === "done") result = data;
      else if (event === "error") throw new Error(data.error);
    }
  }
  out.classList.remove("writing");
  if (!result) throw new Error("Соединение прервалось");
  return result;
}

const IDEAS = [
  (n) => `Сказка на 10 минут чтения, где ${n} гуляет по парку, а верный пёс Артемон оберегает от злых дворняжек`,
  (n) => `${n} попадает в волшебный лес и помогает ёжику найти дорогу домой. 5 минут`,
  (n) => `Космическое путешествие: ${n} летит на Луну с плюшевым медведем и знакомится с лунными зайцами`,
  (n) => `${n} и дракончик, который боялся темноты. Про смелость и дружбу, 7 минут`,
];

function viewStory(project) {
  setSteps(project, "story");
  const s = project.story;
  const name = project.child.name || "малыш";
  const demo = !config.claude ? `<div class="demo-note">Демо-режим: добавьте ANTHROPIC_API_KEY в .env, чтобы сказку сочинял Claude.</div>` : "";

  if (!s.text) {
    app.innerHTML = `
      <div class="card">
        <h2>Придумать сказку</h2>
        <p class="lead">Опишите Claude, какую сказку вы хотите: кто в ней будет, что произойдёт, сколько минут читать.</p>
        ${demo}
        <div class="chips">${IDEAS.map((f, i) => `<button class="chip" data-i="${i}">${esc(f(name).slice(0, 60))}…</button>`).join("")}</div>
        <div class="field">
          <label for="req">Задание для сказочника</label>
          <textarea id="req" rows="5" placeholder="${esc(IDEAS[0](name))}">${esc(s.request || "")}</textarea>
        </div>
        <div class="row">
          <label for="dur" style="margin:0">Время чтения:</label>
          <select id="dur" style="width:auto">
            <option value="">как в задании</option><option>3 минуты</option><option>5 минут</option><option>10 минут</option><option>15 минут</option>
          </select>
          <span class="spacer"></span>
          <button class="btn" id="go">✨ Сочинить сказку</button>
        </div>
        <div id="out" class="story" style="margin-top:20px" hidden></div>
      </div>`;
    $$(".chip").forEach((b) => (b.onclick = () => ($("#req").value = IDEAS[b.dataset.i](name))));
    $("#go").onclick = async () => {
      let request = $("#req").value.trim();
      if (!request) return toast("Опишите, о чём сказка", "error");
      if ($("#dur").value) request += `\nВремя чтения: ${$("#dur").value}.`;
      $("#go").disabled = true;
      const out = $("#out");
      out.hidden = false;
      out.innerHTML = "";
      try {
        viewStory(await streamStory(project, { request }, out));
      } catch (err) {
        toast(err.message, "error");
        $("#go").disabled = false;
      }
    };
    return;
  }

  const n = words(s.text);
  app.innerHTML = `
    <div class="card">
      <div class="row"><h2 style="margin:0">Черновик сказки</h2><span class="spacer"></span>
        ${s.approved ? `<span class="badge ok">✓ утверждён</span>` : ""}
      </div>
      <p class="meta">${n} слов · примерно ${Math.max(1, Math.round(n / 130))} мин. чтения вслух</p>
      ${demo}
      <div id="out" class="story">${storyHtml(s.text)}</div>
      <div id="manual" hidden>
        <textarea class="edit-story" id="manualText">${esc(s.text)}</textarea>
        <div class="row end" style="margin-top:10px"><button class="btn light small" id="manualCancel">Отмена</button><button class="btn small" id="manualSave">Сохранить текст</button></div>
      </div>
    </div>
    <div class="card">
      <h3>Хотите что-то изменить?</h3>
      <div class="field">
        <textarea id="fb" rows="3" placeholder="Например: сделай пса смешнее, добавь бабочку, а конец — про звёзды"></textarea>
      </div>
      <div class="row">
        <button class="btn light" id="fix">✏️ Внести правки</button>
        ${s.history?.length ? `<button class="btn light" id="undo">↶ Предыдущий вариант</button>` : ""}
        <button class="btn light" id="manualBtn">Править вручную</button>
        <button class="btn light" id="restart">Новое задание</button>
        <span class="spacer"></span>
        <button class="btn big" id="approve">УТВЕРЖДЁН ✓</button>
      </div>
    </div>`;

  $("#fix").onclick = async () => {
    const feedback = $("#fb").value.trim();
    if (!feedback) return toast("Напишите, что поправить", "error");
    $$("button", app).forEach((b) => (b.disabled = true));
    const out = $("#out");
    out.innerHTML = "";
    try {
      viewStory(await streamStory(project, { feedback }, out));
      toast("Готово! Вот новый вариант");
    } catch (err) {
      toast(err.message, "error");
      viewStory(project);
    }
  };
  $("#undo") && ($("#undo").onclick = async () => viewStory(await api(`/api/projects/${project.id}/story/undo`, { method: "POST" })));
  $("#manualBtn").onclick = () => (($("#manual").hidden = false), ($("#out").hidden = true));
  $("#manualCancel").onclick = () => (($("#manual").hidden = true), ($("#out").hidden = false));
  $("#manualSave").onclick = async () =>
    viewStory(await api(`/api/projects/${project.id}`, { method: "PATCH", body: { story: { text: $("#manualText").value, approved: false } } }));
  $("#restart").onclick = async () => {
    if (!confirm("Начать с нового задания? Текущий текст сохранится в истории.")) return;
    project.story.text = "";
    viewStory(project);
  };
  $("#approve").onclick = async () => {
    await api(`/api/projects/${project.id}`, {
      method: "PATCH",
      body: { story: { approved: true }, step: project.step === "story" ? "art" : project.step },
    });
    go(`#/p/${project.id}/art`);
  };
}

// ---------- шаг 3: стиль и раскадровка ----------

const SWATCH = {
  watercolor: "linear-gradient(135deg,#f6d7c3,#c9e4de,#f9f1d8)",
  pencil: "repeating-linear-gradient(45deg,#f3ead8 0 6px,#d8c7a8 6px 8px)",
  classic: "linear-gradient(135deg,#7a1f1f,#e3b44f,#2f4f3a)",
  pixar: "radial-gradient(circle at 30% 30%,#ffd36e,#7cc6fe 60%,#ff8fab)",
  flat: "linear-gradient(90deg,#264653 25%,#2a9d8f 25% 50%,#e9c46a 50% 75%,#f4a261 75%)",
  night: "radial-gradient(circle at 70% 30%,#f2c14e 8%,#26366b 10%,#0f1a3d)",
};

function frameHtml(scene, i) {
  return `
    <div class="frame" data-i="${i}">
      <div class="img">${scene.image ? `<img src="${esc(scene.image)}" alt="${esc(scene.title)}" loading="lazy">` : `<span>нет изображения</span>`}</div>
      <div class="body">
        <span class="n">Кадр ${i + 1}</span>
        <b>${esc(scene.title)}</b>
        <span class="hint">${esc(scene.caption)}</span>
        ${scene.error ? `<span class="err">${esc(scene.error)}</span>` : ""}
        <textarea placeholder="Что поправить в кадре? Например: пёс побольше, на девочке красное платье"></textarea>
        <button class="btn light small redraw">↻ Перерисовать</button>
      </div>
    </div>`;
}

function viewArt(project) {
  setSteps(project, "art");
  if (!project.story.approved) {
    app.innerHTML = `<div class="card"><h2>Сначала утвердите сказку</h2><a class="btn" href="#/p/${project.id}/story">К тексту</a></div>`;
    return;
  }
  const a = project.art;
  const imgs = config.images;
  const provider = a.provider || (imgs.recraft ? "recraft" : imgs.openai ? "openai" : "demo");
  const scenes = a.scenes || [];

  app.innerHTML = `
    <div class="card">
      <h2>Стиль рисунков</h2>
      <p class="lead">Выберите художника и стиль — сначала нарисуем раскадровку из скетчей, её можно поправить.</p>
      ${!imgs.recraft && !imgs.openai ? `<div class="demo-note">Демо-режим: добавьте RECRAFT_API_KEY или OPENAI_API_KEY, чтобы рисовали настоящие нейросети.</div>` : ""}
      <div class="choice">
        <label class="provider-opt"><input type="radio" name="prov" value="recraft" ${provider === "recraft" ? "checked" : ""} ${imgs.recraft ? "" : "disabled"}>
          🎨 Recraft <small>${imgs.recraft ? "Книжные стили, мягкая иллюстрация. Герой рисуется по описанию внешности." : "не подключён"}</small></label>
        <label class="provider-opt"><input type="radio" name="prov" value="openai" ${provider === "openai" ? "checked" : ""} ${imgs.openai ? "" : "disabled"}>
          🖼 GPT Image <small>${imgs.openai ? "Фото ребёнка — образец: герой будет больше похож." : "не подключён"}</small></label>
        ${!imgs.recraft && !imgs.openai ? `<label class="provider-opt"><input type="radio" name="prov" value="demo" checked>🧪 Демо <small>Картинки-заглушки</small></label>` : ""}
      </div>
      <div class="styles">
        ${Object.entries(config.styles)
          .map(
            ([k, label]) => `<label class="style-opt"><input type="radio" name="style" value="${k}" ${a.style === k ? "checked" : ""}>
              <span class="sw" style="background:${SWATCH[k]}"></span>${esc(label)}</label>`
          )
          .join("")}
      </div>
      <div class="row" style="margin-top:18px">
        <label for="count" style="margin:0">Кадров:</label>
        <select id="count" style="width:auto">${[4, 5, 6, 7, 8].map((n) => `<option ${a.count == n ? "selected" : ""}>${n}</option>`).join("")}</select>
        <span class="spacer"></span>
        <button class="btn" id="board">${scenes.length ? "↻ Новая раскадровка" : "🎬 Нарисовать раскадровку"}</button>
      </div>
    </div>
    <div id="frames">
      ${
        scenes.length
          ? `<div class="card"><h2>Раскадровка</h2><p class="lead">Посмотрите скетчи. Если что-то не так — напишите правку под кадром и перерисуйте.</p>
             <div class="frames">${scenes.map(frameHtml).join("")}</div>
             <div class="row end" style="margin-top:20px"><button class="btn big" id="approveArt">Раскадровка утверждена ✓</button></div></div>`
          : ""
      }
    </div>`;

  $("#board").onclick = async () => {
    if (scenes.length && !confirm("Нарисовать раскадровку заново? Текущие кадры заменятся.")) return;
    const body = {
      provider: $("input[name=prov]:checked")?.value || "demo",
      style: $("input[name=style]:checked")?.value || "watercolor",
      count: Number($("#count").value),
    };
    $("#board").disabled = true;
    $("#frames").innerHTML = `<div class="card">${loading("Claude делит сказку на сцены, художник рисует скетчи… Это займёт минуту-другую.")}</div>`;
    try {
      viewArt(await api(`/api/projects/${project.id}/storyboard`, { method: "POST", body }));
    } catch (err) {
      toast(err.message, "error");
      viewArt(project);
    }
  };

  $$(".frame").forEach((el) => {
    $(".redraw", el).onclick = async () => {
      const i = el.dataset.i;
      const note = $("textarea", el).value.trim();
      $(".img", el).insertAdjacentHTML("beforeend", `<div class="spinner"></div>`);
      $$("button", el).forEach((b) => (b.disabled = true));
      try {
        const updated = await api(`/api/projects/${project.id}/scenes/${i}`, { method: "POST", body: { note } });
        viewArt(updated);
      } catch (err) {
        toast(err.message, "error");
        viewArt(project);
      }
    };
  });

  $("#approveArt") &&
    ($("#approveArt").onclick = async () => {
      await api(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: { art: { approved: true }, step: ["story", "art"].includes(project.step) ? "voice" : project.step },
      });
      go(`#/p/${project.id}/voice`);
    });
}

// ---------- шаг 4: озвучка ----------

async function viewVoice(project) {
  setSteps(project, "voice");
  app.innerHTML = `<div class="card">${loading("Загружаем голоса сказочников…")}</div>`;
  let voices = [];
  try {
    voices = (await api("/api/voices")).voices;
  } catch (err) {
    toast(err.message, "error");
  }
  const v = project.voice;
  const mode = v.mode || (config.elevenlabs ? "elevenlabs" : "self");
  const realArt = ["recraft", "openai"].includes(project.art.provider) && project.art.scenes.length;

  app.innerHTML = `
    <div class="card">
      <h2>Озвучить?</h2>
      <p class="lead">Сказку может прочитать сказочник — или вы сами, своим голосом.</p>
      <div class="choice">
        <label class="provider-opt"><input type="radio" name="mode" value="elevenlabs" ${mode === "elevenlabs" ? "checked" : ""} ${config.elevenlabs ? "" : "disabled"}>
          <span class="emoji">🎙</span>Голос сказочника <small>${config.elevenlabs ? "ElevenLabs: живой, выразительный голос" : "ElevenLabs не подключён (нужен ELEVENLABS_API_KEY)"}</small></label>
        <label class="provider-opt"><input type="radio" name="mode" value="browser" ${mode === "browser" ? "checked" : ""}>
          <span class="emoji">🔈</span>Голос устройства <small>Бесплатно, встроенный синтез речи браузера</small></label>
        <label class="provider-opt"><input type="radio" name="mode" value="self" ${mode === "self" ? "checked" : ""}>
          <span class="emoji">🤱</span>Я прочитаю сама <small>Без озвучки — только книга</small></label>
      </div>
      <div id="voiceList" ${mode === "elevenlabs" ? "" : "hidden"}>
        <h3>Выберите голос</h3>
        <div class="voices">
          ${voices
            .map(
              (x) => `<label class="voice-opt"><input type="radio" name="voice" value="${esc(x.id)}" data-name="${esc(x.name)}" ${v.voiceId === x.id ? "checked" : ""}>
                <b>${esc(x.name)}</b><div class="desc">${esc(x.description)}</div>
                ${x.preview ? `<button class="btn light small play" data-src="${esc(x.preview)}" type="button">▶ Послушать</button>` : ""}
              </label>`
            )
            .join("") || `<p class="hint">Голоса не найдены.</p>`}
        </div>
      </div>
    </div>
    <div class="card">
      <h2>Собрать книгу</h2>
      <p class="lead">Claude разложит сказку по страницам и подберёт к ним иллюстрации${mode === "elevenlabs" ? ", а сказочник озвучит каждую страницу" : ""}.</p>
      ${
        realArt
          ? `<label style="font-weight:600"><input type="checkbox" id="finalArt" checked> Перерисовать иллюстрации начисто в высоком качестве</label><p class="hint">Займёт ещё пару минут, но картинки будут красивее скетчей.</p>`
          : ""
      }
      <div class="row end"><button class="btn big" id="build">📖 Собрать сказочную книгу</button></div>
    </div>`;

  const audio = new Audio();
  $$(".play").forEach(
    (b) =>
      (b.onclick = (e) => {
        e.preventDefault();
        audio.src = b.dataset.src;
        audio.play();
      })
  );
  $$("input[name=mode]").forEach((r) => (r.onchange = () => ($("#voiceList").hidden = r.value !== "elevenlabs")));

  $("#build").onclick = async () => {
    audio.pause();
    const m = $("input[name=mode]:checked").value;
    const chosen = $("input[name=voice]:checked");
    if (m === "elevenlabs" && !chosen) return toast("Выберите голос сказочника", "error");
    $("#build").disabled = true;
    try {
      await api(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: { voice: { mode: m, voiceId: chosen?.value || "", voiceName: chosen?.dataset.name || "" } },
      });
      await api(`/api/projects/${project.id}/book`, { method: "POST", body: { finalArt: $("#finalArt")?.checked } });
      go(`#/p/${project.id}/book`);
    } catch (err) {
      toast(err.message, "error");
      $("#build").disabled = false;
    }
  };
}

// ---------- шаг 5: книга ----------

async function viewBook(project) {
  setSteps(project, "book");
  const b = project.book;
  if (!b) {
    app.innerHTML = `<div class="card"><h2>Книга ещё не собрана</h2><a class="btn" href="#/p/${project.id}/voice">К озвучке и сборке</a></div>`;
    return;
  }
  if (b.status === "building") {
    app.innerHTML = `<div class="card">${loading(b.message || "Собираем книгу…")}<p class="hint" style="text-align:center">Можно не закрывать страницу — книга появится сама.</p></div>`;
    const timer = setTimeout(async () => {
      if (!location.hash.startsWith(`#/p/${project.id}`)) return;
      const fresh = await api(`/api/projects/${project.id}`).catch(() => project);
      viewBook(fresh);
    }, 2000);
    stopReader = () => clearTimeout(timer);
    return;
  }
  if (b.status === "error") {
    app.innerHTML = `<div class="card"><h2>Не получилось собрать книгу</h2><p>${esc(b.message)}</p>
      <a class="btn" href="#/p/${project.id}/voice">Попробовать ещё раз</a></div>`;
    return;
  }
  reader(project);
}

function reader(project) {
  setSteps(null);
  const b = project.book;
  const voice = project.voice.mode;
  const pages = [
    { kind: "cover", image: b.cover, audio: b.titleAudio, speak: b.title },
    { kind: "dedication", speak: b.dedication },
    ...b.pages.map((p) => ({ kind: "page", ...p, speak: p.text })),
    { kind: "end", audio: b.endingAudio, speak: b.ending },
  ];
  let at = 0;
  let playing = false;
  const audio = new Audio();
  const canNarrate = voice === "elevenlabs" || (voice === "browser" && "speechSynthesis" in window);

  const paragraphs = (t) => t.split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join("");
  const spread = (p, i) => {
    if (p.kind === "cover")
      return `<div class="spread ${p.image ? "" : "single"} cover-page">${p.image ? `<div class="pic"><img src="${esc(p.image)}" alt=""></div>` : ""}
        <div class="txt no-cap"><p class="hint">Сказка про ${esc(project.child.name || "тебя")}</p><h1>${esc(b.title)}</h1></div></div>`;
    if (p.kind === "dedication")
      return `<div class="spread single cover-page"><div class="txt no-cap">
        ${project.child.photoUrl ? `<img class="photo-round" src="${esc(project.child.photoUrl)}" alt="">` : ""}
        <p style="font-style:italic">${esc(b.dedication)}</p></div></div>`;
    if (p.kind === "end")
      return `<div class="spread single cover-page"><div class="txt no-cap"><div style="font-size:64px">🌙</div><h2>Конец</h2><p style="font-style:italic">${esc(b.ending)}</p></div></div>`;
    return `<div class="spread ${p.image ? "" : "single"}">${p.image ? `<div class="pic"><img src="${esc(p.image)}" alt=""></div>` : ""}
      <div class="txt">${paragraphs(p.text)}<div class="pnum">— ${i - 1} —</div></div></div>`;
  };

  app.innerHTML = `
    <div class="reader">
      <div class="reader-bar">
        <a class="btn ghost small" href="#/" style="color:var(--paper)">← Полка</a>
        <span class="title">${esc(b.title)}</span>
        ${canNarrate ? `<button class="btn small" id="play">▶ Слушать сказку</button>` : ""}
        <button class="btn ghost small" id="print" style="color:var(--paper)">🖨 Печать / PDF</button>
        <a class="btn ghost small" href="#/p/${project.id}/story" style="color:var(--paper)">Изменить</a>
      </div>
      <div id="page"></div>
      <div class="pager">
        <button class="btn round light" id="prev" aria-label="Назад">‹</button>
        <div class="dots">${pages.map((_, i) => `<button data-i="${i}" aria-label="Страница ${i + 1}"></button>`).join("")}</div>
        <button class="btn round" id="next" aria-label="Дальше">›</button>
      </div>
    </div>`;

  const show = (i) => {
    at = Math.max(0, Math.min(pages.length - 1, i));
    $("#page").innerHTML = spread(pages[at], at);
    $$(".dots button").forEach((d, k) => d.classList.toggle("on", k === at));
    $("#prev").disabled = at === 0;
    $("#next").disabled = at === pages.length - 1;
    if (playing) narrate();
  };

  // Озвучка: ElevenLabs — готовые mp3, браузер — speechSynthesis.
  const stopSound = () => {
    audio.pause();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  };
  const after = () => {
    if (!playing) return;
    if (at < pages.length - 1) setTimeout(() => playing && show(at + 1), 900);
    else setPlaying(false);
  };
  function narrate() {
    stopSound();
    const p = pages[at];
    if (voice === "elevenlabs") {
      if (!p.audio) return after();
      audio.src = p.audio;
      audio.onended = after;
      audio.play().catch(() => setPlaying(false));
    } else {
      const u = new SpeechSynthesisUtterance(p.speak || "");
      u.lang = "ru-RU";
      u.rate = 0.9;
      const ru = speechSynthesis.getVoices().find((x) => x.lang?.startsWith("ru"));
      if (ru) u.voice = ru;
      u.onend = after;
      speechSynthesis.speak(u);
    }
  }
  function setPlaying(on) {
    playing = on;
    const btn = $("#play");
    if (btn) btn.textContent = on ? "⏸ Пауза" : "▶ Слушать сказку";
    if (on) narrate();
    else stopSound();
  }

  $("#play") && ($("#play").onclick = () => setPlaying(!playing));
  $("#prev").onclick = () => show(at - 1);
  $("#next").onclick = () => show(at + 1);
  $$(".dots button").forEach((d) => (d.onclick = () => show(Number(d.dataset.i))));
  $("#print").onclick = () => {
    setPlaying(false);
    $("#page").innerHTML = pages.map(spread).join("");
    setTimeout(() => {
      window.print();
      show(at);
    }, 300);
  };
  const onKey = (e) => {
    if (e.key === "ArrowRight") show(at + 1);
    if (e.key === "ArrowLeft") show(at - 1);
  };
  let x0 = null;
  const onTouchStart = (e) => (x0 = e.touches[0].clientX);
  const onTouchEnd = (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) show(at + (dx < 0 ? 1 : -1));
    x0 = null;
  };
  document.addEventListener("keydown", onKey);
  $("#page").addEventListener("touchstart", onTouchStart, { passive: true });
  $("#page").addEventListener("touchend", onTouchEnd);
  stopReader = () => {
    playing = false;
    stopSound();
    document.removeEventListener("keydown", onKey);
  };
  show(0);
}

render();
