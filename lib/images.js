// Иллюстрации: Recraft или OpenAI GPT Image. Без ключей — демо-заглушки (SVG).
import { demoImage } from "./demo.js";

export const STYLES = {
  watercolor: {
    label: "Акварель",
    prompt: "soft watercolor children's book illustration, gentle pastel colors, paper texture, dreamy and cosy",
    recraft: { style: "digital_illustration", substyle: "hand_drawn" },
  },
  pencil: {
    label: "Карандашный скетч",
    prompt: "colored pencil sketch, warm hand-drawn lines, light shading, classic picture book",
    recraft: { style: "digital_illustration", substyle: "hand_drawn_outline" },
  },
  classic: {
    label: "Классическая книжная",
    prompt: "classic Russian fairy tale book illustration, rich warm colors, ornamental details, in the spirit of mid-century Soviet picture books",
    recraft: { style: "digital_illustration", substyle: "2d_art_poster" },
  },
  pixar: {
    label: "3D-мультфильм",
    prompt: "cute 3D animated movie style, soft global illumination, expressive faces, rounded shapes",
    recraft: { style: "digital_illustration", substyle: "handmade_3d" },
  },
  flat: {
    label: "Плоская графика",
    prompt: "modern flat vector illustration for kids, simple shapes, limited calm palette, subtle grain",
    recraft: { style: "vector_illustration" },
  },
  night: {
    label: "Ночная сказка",
    prompt: "magical night-time picture book illustration, deep blues and warm golden light, stars and glowing lanterns, cosy and calm",
    recraft: { style: "digital_illustration" },
  },
};

export const providers = () => ({
  recraft: Boolean(process.env.RECRAFT_API_KEY),
  openai: Boolean(process.env.OPENAI_API_KEY),
});

function buildPrompt({ scene, characters, child, styleKey, note }) {
  const style = STYLES[styleKey] || STYLES.watercolor;
  return [
    style.prompt + ".",
    scene.prompt,
    child.appearance ? `The child hero: ${child.appearance}.` : "",
    characters ? `Other characters: ${characters}` : "",
    note ? `Changes requested: ${note}.` : "",
    "Wholesome bedtime story mood. No text, letters or captions in the image.",
  ]
    .filter(Boolean)
    .join(" ");
}

async function recraft(prompt, styleKey) {
  const { style, substyle } = (STYLES[styleKey] || STYLES.watercolor).recraft;
  const call = (body) =>
    fetch("https://external.api.recraft.ai/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RECRAFT_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const body = {
    prompt: prompt.slice(0, 1000), // лимит длины промпта у Recraft
    model: process.env.RECRAFT_MODEL || "recraftv3",
    style,
    size: "1365x1024",
    n: 1,
  };
  let res = await call(substyle ? { ...body, substyle } : body);
  // Если подстиль не поддерживается выбранной моделью — повторяем без него.
  if (!res.ok && substyle && res.status === 400) res = await call(body);
  if (!res.ok) throw new Error(`Recraft: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const img = await fetch(json.data[0].url);
  if (!img.ok) throw new Error(`Recraft: не удалось скачать изображение (${img.status})`);
  const type = img.headers.get("content-type") || "image/webp";
  return { buffer: Buffer.from(await img.arrayBuffer()), ext: type.includes("png") ? "png" : type.includes("svg") ? "svg" : "webp" };
}

async function openai(prompt, photo, quality) {
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  let res;
  if (photo) {
    // Фото ребёнка передаётся как референс, чтобы герой был похож.
    const form = new FormData();
    form.append("model", model);
    form.append(
      "prompt",
      "Use the child in the reference photo as the hero of this illustration, keeping their likeness, " +
        "but fully redraw them in the illustration style. " + prompt
    );
    form.append("image[]", new Blob([photo.buffer], { type: photo.mediaType }), `child.${photo.mediaType.split("/")[1] || "png"}`);
    form.append("size", "1536x1024");
    form.append("quality", quality);
    res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
  } else {
    res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, size: "1536x1024", quality }),
    });
  }
  if (!res.ok) throw new Error(`OpenAI: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { buffer: Buffer.from(json.data[0].b64_json, "base64"), ext: "png" };
}

// quality: "sketch" — быстрый черновик раскадровки, "final" — чистовая иллюстрация.
export async function illustrate({ provider, styleKey, scene, characters, child, note, photo, quality, index }) {
  const prompt = buildPrompt({ scene, characters, child, styleKey, note });
  const available = providers();
  if (provider === "openai" && available.openai) {
    return openai(prompt, photo, quality === "final" ? "high" : "low");
  }
  if (provider === "recraft" && available.recraft) {
    return recraft(prompt, styleKey);
  }
  return { buffer: Buffer.from(demoImage({ scene, styleKey, index, quality })), ext: "svg", demo: true };
}
