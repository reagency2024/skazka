import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as claude from "./lib/claude.js";
import { illustrate, providers, STYLES } from "./lib/images.js";
import { listVoices, synthesize, voiceEnabled } from "./lib/voice.js";
import { demoBook, demoStory, demoStoryboard } from "./lib/demo.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(process.env.DATA_DIR || path.join(here, "data", "projects"));
await fs.mkdir(DATA, { recursive: true });

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(here, "public")));
app.use("/files", express.static(DATA, { maxAge: "1h" }));

// ---------- хранилище проектов (JSON-файлы на диске) ----------

const dir = (id) => path.join(DATA, id);
const validId = (id) => /^[0-9a-f-]{36}$/.test(id);

async function load(id) {
  if (!validId(id)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(dir(id), "project.json"), "utf8"));
  } catch {
    return null;
  }
}

// Сохранения одного проекта выполняются строго по очереди.
const queues = new Map();
function save(project) {
  project.updatedAt = new Date().toISOString();
  const prev = queues.get(project.id) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => fs.writeFile(path.join(dir(project.id), "project.json"), JSON.stringify(project, null, 2)));
  queues.set(project.id, next);
  return next.then(() => project);
}

async function writeFile(id, name, buffer) {
  await fs.writeFile(path.join(dir(id), name), buffer);
  return `/files/${id}/${name}`;
}

async function readPhoto(project) {
  if (!project.child.photo) return null;
  const buffer = await fs.readFile(path.join(dir(project.id), project.child.photo));
  return { buffer, mediaType: project.child.photoType };
}

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(err.status || 500).json({ error: err.message || "Ошибка сервера" });
  }
};

async function mustLoad(req) {
  const project = await load(req.params.id);
  if (!project) throw Object.assign(new Error("Проект не найден"), { status: 404 });
  return project;
}

// Параллельная обработка с ограничением одновременных запросов.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------- API ----------

app.get("/api/config", (req, res) => {
  res.json({
    claude: claude.claudeEnabled(),
    elevenlabs: voiceEnabled(),
    images: providers(),
    styles: Object.fromEntries(Object.entries(STYLES).map(([k, v]) => [k, v.label])),
  });
});

app.get(
  "/api/projects",
  wrap(async (req, res) => {
    const ids = (await fs.readdir(DATA)).filter(validId);
    const projects = (await Promise.all(ids.map(load))).filter(Boolean);
    projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    res.json(
      projects.map((p) => ({
        id: p.id,
        name: p.child.name,
        title: p.book?.title || p.story.title || "Новая сказка",
        cover: p.book?.cover || p.art.scenes?.[0]?.image || p.child.photoUrl,
        step: p.step,
        ready: p.book?.status === "ready",
        updatedAt: p.updatedAt,
      }))
    );
  })
);

// Шаг 1: фото ребёнка.
app.post(
  "/api/projects",
  wrap(async (req, res) => {
    const { name = "", age = "", gender = "", photo } = req.body;
    const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(photo || "");
    if (!match) return res.status(400).json({ error: "Загрузите фото в формате JPG, PNG или WEBP" });
    const [, mediaType, base64] = match;

    const id = randomUUID();
    await fs.mkdir(dir(id), { recursive: true });
    const photoName = `child.${mediaType.split("/")[1]}`;
    const photoUrl = await writeFile(id, photoName, Buffer.from(base64, "base64"));

    let appearance = "";
    if (claude.claudeEnabled()) {
      try {
        appearance = await claude.describeChild({ base64, mediaType, name, age });
      } catch (err) {
        console.warn("Не удалось описать внешность:", err.message);
      }
    }

    const project = {
      id,
      createdAt: new Date().toISOString(),
      step: "story",
      child: { name: name.trim(), age: String(age).trim(), gender, photo: photoName, photoType: mediaType, photoUrl, appearance },
      story: { request: "", text: "", title: "", approved: false, history: [] },
      art: { provider: "", style: "watercolor", count: 6, characters: "", scenes: [], approved: false },
      voice: { mode: "", voiceId: "", voiceName: "" },
      book: null,
    };
    res.json(await save(project));
  })
);

app.get("/api/projects/:id", wrap(async (req, res) => res.json(await mustLoad(req))));

app.delete(
  "/api/projects/:id",
  wrap(async (req, res) => {
    await mustLoad(req);
    await fs.rm(dir(req.params.id), { recursive: true, force: true });
    res.json({ ok: true });
  })
);

// Небольшие правки состояния: шаг, утверждение, ручная правка текста, выбор голоса.
app.patch(
  "/api/projects/:id",
  wrap(async (req, res) => {
    const project = await mustLoad(req);
    const { step, child, story, art, voice } = req.body;
    if (step) project.step = step;
    if (child) Object.assign(project.child, pick(child, ["name", "age", "gender", "appearance"]));
    if (story) {
      Object.assign(project.story, pick(story, ["request", "text", "approved"]));
      if (story.text !== undefined) project.story.title = titleOf(story.text);
    }
    if (art) Object.assign(project.art, pick(art, ["provider", "style", "count", "approved"]));
    if (voice) Object.assign(project.voice, pick(voice, ["mode", "voiceId", "voiceName"]));
    res.json(await save(project));
  })
);

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const titleOf = (text) => (/^#\s*(.+)$/m.exec(text || "")?.[1] || "").trim();

// Шаг 2: сочинение сказки (поток текста через Server-Sent Events).
app.post(
  "/api/projects/:id/story",
  wrap(async (req, res) => {
    const project = await mustLoad(req);
    const { request, feedback } = req.body;
    const isEdit = Boolean(feedback && project.story.text);
    if (!isEdit && !request?.trim()) return res.status(400).json({ error: "Опишите, какую сказку хотите" });

    if (!isEdit) project.story.request = request.trim();
    const input = {
      child: project.child,
      request: project.story.request,
      draft: isEdit ? project.story.text : "",
      feedback: isEdit ? feedback.trim() : "",
    };

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    try {
      let text;
      if (claude.claudeEnabled()) {
        text = await claude.streamStory(input, (delta) => send("delta", delta));
      } else {
        text = demoStory(input);
        for (const chunk of text.match(/[\s\S]{1,40}/g)) {
          send("delta", chunk);
          await new Promise((r) => setTimeout(r, 15));
        }
      }
      if (project.story.text) project.story.history.push(project.story.text);
      project.story.history = project.story.history.slice(-10);
      project.story.text = text.trim();
      project.story.title = titleOf(text);
      project.story.approved = false;
      await save(project);
      send("done", project);
    } catch (err) {
      console.error(err);
      send("error", { error: err.message });
    }
    res.end();
  })
);

// Откат к предыдущему варианту сказки.
app.post(
  "/api/projects/:id/story/undo",
  wrap(async (req, res) => {
    const project = await mustLoad(req);
    const prev = project.story.history.pop();
    if (prev) {
      project.story.text = prev;
      project.story.title = titleOf(prev);
      project.story.approved = false;
    }
    res.json(await save(project));
  })
);

// Шаг 3: раскадровка + скетчи.
async function drawScene(project, i, { note = "", quality = "sketch" } = {}) {
  const scene = project.art.scenes[i];
  const photo = project.art.provider === "openai" ? await readPhoto(project) : null;
  const img = await illustrate({
    provider: project.art.provider,
    styleKey: project.art.style,
    scene,
    characters: project.art.characters,
    child: project.child,
    note: [scene.note, note].filter(Boolean).join("; "),
    photo,
    quality,
    index: i,
  });
  const name = `${quality}-${i + 1}-${Date.now().toString(36)}.${img.ext}`;
  return writeFile(project.id, name, img.buffer);
}

app.post(
  "/api/projects/:id/storyboard",
  wrap(async (req, res) => {
    const project = await mustLoad(req);
    if (!project.story.approved) return res.status(400).json({ error: "Сначала утвердите текст сказки" });
    const { provider, style, count } = req.body;
    project.art.provider = provider;
    project.art.style = STYLES[style] ? style : "watercolor";
    project.art.count = Math.min(10, Math.max(3, Number(count) || 6));
    project.art.approved = false;

    const board = claude.claudeEnabled()
      ? await claude.makeStoryboard({ story: project.story.text, child: project.child, count: project.art.count })
      : demoStoryboard({ count: project.art.count });
    project.art.characters = board.characters;
    project.art.scenes = board.scenes.map((s) => ({ ...s, note: "", image: "", error: "" }));

    await mapLimit(project.art.scenes, 3, async (scene, i) => {
      try {
        scene.image = await drawScene(project, i);
      } catch (err) {
        console.error(err);
        scene.error = err.message;
      }
    });
    res.json(await save(project));
  })
);

// Перерисовать один кадр с правками.
app.post(
  "/api/projects/:id/scenes/:index",
  wrap(async (req, res) => {
    const project = await mustLoad(req);
    const i = Number(req.params.index);
    const scene = project.art.scenes[i];
    if (!scene) return res.status(404).json({ error: "Кадр не найден" });
    const { note = "", caption } = req.body;
    if (note.trim()) scene.note = [scene.note, note.trim()].filter(Boolean).join("; ");
    if (caption) scene.caption = caption;
    project.art.approved = false;
    try {
      scene.image = await drawScene(project, i);
      scene.error = "";
    } catch (err) {
      scene.error = err.message;
    }
    res.json(await save(project));
  })
);

// Шаг 4: голоса.
app.get(
  "/api/voices",
  wrap(async (req, res) => {
    if (!voiceEnabled()) return res.json({ enabled: false, voices: [] });
    res.json({ enabled: true, voices: await listVoices() });
  })
);

// Шаг 5: сборка книги — долгий процесс в фоне, клиент опрашивает статус.
async function buildBook(id, { finalArt }) {
  const project = await load(id);
  const progress = async (message, extra = {}) => {
    Object.assign(project.book, { message, ...extra });
    await save(project);
  };
  try {
    const scenes = project.art.scenes;
    await progress("Claude раскладывает сказку по страницам…");
    const layout = claude.claudeEnabled()
      ? await claude.layoutBook({ story: project.story.text, child: project.child, scenes })
      : demoBook({ story: project.story.text, child: project.child, scenes });

    if (finalArt && project.art.provider && scenes.length) {
      let done = 0;
      await progress(`Рисуем чистовые иллюстрации: 0 из ${scenes.length}`);
      await mapLimit(scenes, 3, async (scene, i) => {
        try {
          scene.final = await drawScene(project, i, { quality: "final" });
        } catch (err) {
          console.error(err);
        }
        await progress(`Рисуем чистовые иллюстрации: ${++done} из ${scenes.length}`);
      });
    }

    // Каждую иллюстрацию ставим один раз; если Claude какую-то пропустил — добавляем.
    const used = new Set();
    const pages = layout.pages.map((p) => {
      const s = scenes[p.scene - 1];
      let image = "";
      if (s && !used.has(p.scene)) {
        used.add(p.scene);
        image = s.final || s.image;
      }
      return { text: p.text.trim(), image, audio: "" };
    });
    scenes.forEach((s, i) => {
      if (used.has(i + 1)) return;
      const target = pages.find((p, k) => !p.image && k >= Math.floor((i / scenes.length) * pages.length));
      if (target) target.image = s.final || s.image;
    });

    Object.assign(project.book, {
      title: layout.title || project.story.title,
      dedication: layout.dedication,
      ending: layout.ending,
      cover: scenes[0]?.final || scenes[0]?.image || project.child.photoUrl,
      pages,
      titleAudio: "",
      endingAudio: "",
    });

    if (project.voice.mode === "elevenlabs" && project.voice.voiceId && voiceEnabled()) {
      const vid = project.voice.voiceId;
      const parts = [
        { key: "titleAudio", text: `${project.book.title}.` },
        ...pages.map((p, i) => ({ page: i, text: p.text })),
        { key: "endingAudio", text: project.book.ending },
      ];
      let done = 0;
      await progress(`Сказочник озвучивает страницы: 0 из ${parts.length}`);
      await mapLimit(parts, 2, async (part, i) => {
        const url = await writeFile(id, `voice-${i}-${Date.now().toString(36)}.mp3`, await synthesize(vid, part.text));
        if (part.key) project.book[part.key] = url;
        else pages[part.page].audio = url;
        await progress(`Сказочник озвучивает страницы: ${++done} из ${parts.length}`);
      });
    }

    project.step = "book";
    await progress("Книга готова!", { status: "ready", builtAt: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    await progress(err.message, { status: "error" });
  }
}

app.post(
  "/api/projects/:id/book",
  wrap(async (req, res) => {
    const project = await mustLoad(req);
    if (!project.story.approved) return res.status(400).json({ error: "Текст сказки не утверждён" });
    if (project.book?.status === "building") return res.json(project);
    project.book = { status: "building", message: "Начинаем собирать книгу…" };
    project.step = "build";
    await save(project);
    buildBook(project.id, { finalArt: Boolean(req.body.finalArt) });
    res.json(project);
  })
);

app.get("*", (req, res) => res.sendFile(path.join(here, "public", "index.html")));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  const on = (b) => (b ? "подключён" : "демо-режим");
  console.log(`\n  Сказка про меня → http://localhost:${port}\n`);
  console.log(`  Claude:      ${on(claude.claudeEnabled())}`);
  console.log(`  Recraft:     ${on(providers().recraft)}`);
  console.log(`  GPT Image:   ${on(providers().openai)}`);
  console.log(`  ElevenLabs:  ${on(voiceEnabled())}\n`);
});
