// Демо-режим: работает без ключей API, чтобы можно было пройти весь путь.
const PALETTES = {
  watercolor: ["#f6d7c3", "#c9e4de", "#f9f1d8", "#e8a0a0"],
  pencil: ["#f3ead8", "#d8c7a8", "#8a7b66", "#c46a4a"],
  classic: ["#7a1f1f", "#e3b44f", "#2f4f3a", "#f2e2c0"],
  pixar: ["#7cc6fe", "#ffd36e", "#ff8fab", "#b8f2e6"],
  flat: ["#264653", "#2a9d8f", "#e9c46a", "#f4a261"],
  night: ["#0f1a3d", "#26366b", "#f2c14e", "#ffe8a3"],
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function demoImage({ scene, styleKey, index = 0, quality }) {
  const [bg, mid, accent, warm] = PALETTES[styleKey] || PALETTES.watercolor;
  const stars = Array.from({ length: 18 }, (_, i) => {
    const x = (i * 83 + index * 37) % 1500;
    const y = (i * 47 + index * 19) % 420;
    return `<circle cx="${x}" cy="${y}" r="${2 + (i % 3)}" fill="${accent}" opacity=".7"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1536 1024" width="1536" height="1024">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${mid}"/></linearGradient></defs>
  <rect width="1536" height="1024" fill="url(#g)"/>${stars}
  <circle cx="${1200 - index * 60}" cy="200" r="90" fill="${accent}" opacity=".9"/>
  <path d="M0 760 Q 380 640 768 740 T 1536 700 V1024 H0Z" fill="${warm}" opacity=".85"/>
  <path d="M0 860 Q 420 780 860 860 T 1536 840 V1024 H0Z" fill="${mid}" opacity=".9"/>
  <g transform="translate(${520 + index * 40} 560)"><circle cx="0" cy="0" r="56" fill="#ffe0c2"/><path d="M-70 60 Q0 20 70 60 L60 210 H-60Z" fill="${accent}"/></g>
  <g transform="translate(${900 + index * 20} 690)"><ellipse cx="0" cy="0" rx="90" ry="50" fill="#a0703c"/><circle cx="90" cy="-40" r="40" fill="#a0703c"/><path d="M110 -80 l20 -40 l10 45z" fill="#7a5229"/></g>
  <text x="768" y="110" font-family="Georgia, serif" font-size="56" text-anchor="middle" fill="#1d1d1d" opacity=".75">${esc(scene.title || "Сцена")}</text>
  <text x="768" y="980" font-family="sans-serif" font-size="30" text-anchor="middle" fill="#1d1d1d" opacity=".6">Демо-${quality === "final" ? "иллюстрация" : "скетч"} · подключите Recraft или OpenAI для настоящих картинок</text>
</svg>`;
}

export function demoStory({ child, request, draft, feedback }) {
  const name = child.name || "Малыш";
  if (draft) {
    return draft.replace(/\n*$/, "") + `\n\n(Демо-режим: правка «${feedback}» была бы учтена Claude. Подключите ANTHROPIC_API_KEY.)`;
  }
  return `# ${name} и волшебный вечер

Жил-был на свете ${name} — самый любопытный и добрый ребёнок во всём городе. Однажды тёплым вечером, когда солнце уже спряталось за крыши, а фонари зажглись мягким жёлтым светом, ${name} отправился гулять в парк.

В парке пахло листьями и сладкой ватой. Под ногами шуршали дорожки: шур-шур, шур-шур. А рядом шёл верный друг — большой пушистый пёс с самыми добрыми глазами на свете.

Вдруг из-за кустов выскочили три лохматые дворняжки. «Гав! Гав! Гав!» — затявкали они. Но верный пёс встал рядом с ${name}, спокойно и важно, и сказал: «Здесь гуляют мои друзья. Хотите погулять с нами?» Дворняжки переглянулись, завиляли хвостами и смущённо уселись на траву.

Оказалось, что они вовсе не злые — просто им было скучно и одиноко. ${name} угостил их печеньем, и все вместе они дошли до старого пруда, где в воде отражались первые звёзды.

«Пора домой», — сказал пёс. И они пошли обратно по тихим дорожкам, а звёзды светили им вслед.

Дома ${name} забрался под тёплое одеяло. Пёс улёгся рядом на коврике и тихонько засопел. А за окном луна шепнула: «Спокойной ночи, ${name}. Завтра будет новый чудесный день».

(Это демо-сказка. Задача родителя: «${request.slice(0, 160)}». Подключите ANTHROPIC_API_KEY, и Claude напишет настоящую.)`;
}

export function demoStoryboard({ count }) {
  const titles = ["Вечер в парке", "Верный друг рядом", "Лохматые гости", "Новые друзья", "Звёзды над прудом", "Дорога домой", "Спокойной ночи", "Сладкие сны"];
  return {
    characters: "a big fluffy loyal dog with kind eyes; three scruffy little mongrel dogs",
    scenes: Array.from({ length: count }, (_, i) => ({
      title: titles[i % titles.length],
      caption: "Демо-описание сцены.",
      prompt: "demo scene",
    })),
  };
}

export function demoBook({ story, child, scenes }) {
  const lines = story.split("\n");
  const title = (lines.find((l) => l.startsWith("# ")) || "# Сказка").slice(2).trim();
  const paragraphs = story
    .replace(/^# .*$/m, "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const step = Math.max(1, Math.floor(paragraphs.length / Math.max(1, scenes.length)));
  return {
    title,
    dedication: `Для ${child.name || "самого любимого малыша"} — с любовью.`,
    pages: paragraphs.map((text, i) => ({
      text,
      scene: i % step === 0 && i / step < scenes.length ? i / step + 1 : 0,
    })),
    ending: "Спокойной ночи и сладких снов!",
  };
}
