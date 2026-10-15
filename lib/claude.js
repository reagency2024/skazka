// Всё, что делает Claude: описание внешности ребёнка, сочинение сказки,
// раскадровка и вёрстка итоговой книги.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

export const claudeEnabled = () =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let client;
const getClient = () => (client ??= new Anthropic());

// Общие параметры: адаптивное мышление включено у модели всегда,
// глубину задаём через effort; при отказе классификатора запрос
// автоматически повторяется на рекомендованной модели.
const base = (effort) => ({
  model: MODEL,
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
  output_config: { effort },
});

export class RefusalError extends Error {}

function textOf(message) {
  if (message.stop_reason === "refusal") {
    throw new RefusalError(
      "Claude отказался выполнять этот запрос. Попробуйте переформулировать задачу."
    );
  }
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

async function jsonCall({ system, content, schema, effort = "medium", maxTokens = 32000 }) {
  const stream = getClient().beta.messages.stream({
    ...base(effort),
    max_tokens: maxTokens,
    output_config: {
      effort,
      format: { type: "json_schema", schema },
    },
    system,
    messages: [{ role: "user", content }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "max_tokens") {
    throw new Error("Ответ Claude оказался слишком длинным и был обрезан.");
  }
  return JSON.parse(textOf(message));
}

// 1. Короткое описание внешности для промптов иллюстраций (на английском,
// так генераторы изображений работают стабильнее).
export async function describeChild({ base64, mediaType, name, age }) {
  const message = await getClient().beta.messages.create({
    ...base("low"),
    max_tokens: 2000,
    system:
      "You help create illustrated bedtime storybooks. Describe only visible, " +
      "non-sensitive appearance details useful for an illustrator.",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          {
            type: "text",
            text:
              `This is ${name || "the child"}${age ? `, age ${age}` : ""}, the hero of a bedtime story. ` +
              "In one or two English sentences (max 60 words), describe how to draw this child as a " +
              "storybook character: approximate age, hair colour and style, eye colour, skin tone, " +
              "notable clothing or accessories. No names, no guesses about anything not visible. " +
              "Return only the description.",
          },
        ],
      },
    ],
  });
  return textOf(message).trim();
}

// 2. Сочинение / правка сказки. Каждый запрос самодостаточен: исходная
// задача + текущий черновик + правки родителя. Текст стримится.
const STORY_SYSTEM = `Ты — добрый и талантливый детский писатель. Ты пишешь сказки на ночь на русском языке, которые родители читают вслух своему ребёнку.

Правила:
- Главный герой — ребёнок, о котором рассказывает родитель. Используй его имя и детали, которые дал родитель.
- Персонажи, место действия и сюжет — те, что попросил родитель.
- Сказка должна быть доброй и безопасной: никакой жестокости и настоящего страха; злодеи могут быть смешными или исправляться; в конце всё хорошо, спокойно и уютно, чтобы ребёнку было легко уснуть.
- Пиши живым, образным, но простым языком, с диалогами, повторами и звукоподражаниями — это приятно читать вслух.
- Объём: при чтении вслух примерно 130 слов в минуту. Если родитель указал время, выдерживай объём.
- Деление на абзацы — пустая строка между абзацами.

Формат ответа: первая строка — «# Название сказки», затем пустая строка и сам текст сказки. Без вступлений, пояснений и комментариев до или после сказки.`;

export async function streamStory({ child, request, draft, feedback }, onText) {
  const parts = [
    `О ребёнке: имя — ${child.name || "не указано"}` +
      (child.age ? `, возраст — ${child.age}` : "") +
      (child.gender ? `, ${child.gender}` : "") +
      (child.appearance ? `.\nВнешность (по фото): ${child.appearance}` : "") +
      ".",
    `Задача от родителя:\n${request}`,
  ];
  if (draft) {
    parts.push(`Текущий вариант сказки:\n<draft>\n${draft}\n</draft>`);
    parts.push(
      `Правки родителя:\n${feedback}\n\nПерепиши сказку с учётом правок и выдай её полностью. Всё, что родитель не просил менять, сохрани.`
    );
  }

  const stream = getClient().beta.messages.stream({
    ...base("medium"),
    max_tokens: 32000,
    system: STORY_SYSTEM,
    messages: [{ role: "user", content: parts.join("\n\n") }],
  });
  stream.on("text", onText);
  const message = await stream.finalMessage();
  return textOf(message);
}

// 3. Раскадровка: сцены для иллюстраций.
const STORYBOARD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["characters", "scenes"],
  properties: {
    characters: {
      type: "string",
      description: "English visual description of every recurring character (except the child), to keep them consistent across images",
    },
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "caption", "prompt"],
        properties: {
          title: { type: "string", description: "Короткое название сцены по-русски" },
          caption: { type: "string", description: "Что происходит на картинке, 1 предложение по-русски" },
          prompt: {
            type: "string",
            description: "English image prompt: composition, characters, action, setting, lighting, mood. No style words, no text in the image.",
          },
        },
      },
    },
  },
};

export async function makeStoryboard({ story, child, count }) {
  return jsonCall({
    system:
      "You are the art director of an illustrated children's bedtime book. " +
      "You split a story into key illustrated scenes, in story order, evenly covering beginning, middle and ending.",
    content:
      `Child hero: ${child.name || "the child"}. Appearance: ${child.appearance || "not specified"}.\n\n` +
      `Story (Russian):\n<story>\n${story}\n</story>\n\n` +
      `Create exactly ${count} scenes. In every prompt refer to the hero as "the child hero" and ` +
      "describe the scene so it can be drawn on its own (repeat key character traits each time). " +
      "Keep everything gentle and cosy.",
    schema: STORYBOARD_SCHEMA,
  });
}

// 4. Вёрстка книги: разбиение текста на развороты и привязка иллюстраций.
const BOOK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "dedication", "pages", "ending"],
  properties: {
    title: { type: "string" },
    dedication: { type: "string", description: "Короткое тёплое посвящение ребёнку, 1–2 предложения" },
    pages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "scene"],
        properties: {
          text: { type: "string", description: "Фрагмент текста сказки для этой страницы, дословно" },
          scene: {
            type: "integer",
            description: "Номер иллюстрации (с 1), которая лучше всего подходит к странице, или 0 — без иллюстрации",
          },
        },
      },
    },
    ending: { type: "string", description: "Короткое пожелание спокойной ночи в конце книги" },
  },
};

export async function layoutBook({ story, child, scenes }) {
  const list = scenes.map((s, i) => `${i + 1}. ${s.title} — ${s.caption}`).join("\n");
  return jsonCall({
    system:
      "Ты — верстальщик детских книжек. Ты раскладываешь готовую сказку по страницам книги, не меняя её текст.",
    content:
      `Сказка:\n<story>\n${story}\n</story>\n\nИллюстрации:\n${list}\n\n` +
      `Ребёнок: ${child.name || "малыш"}.\n\n` +
      "Разбей сказку на страницы по 60–130 слов, по границам абзацев или предложений. " +
      "Текст переноси дословно и полностью, ничего не пропуская и не добавляя (заголовок в страницы не включай). " +
      "Каждую иллюстрацию используй ровно один раз — на той странице, где происходит её сцена; " +
      "остальным страницам ставь scene = 0.",
    schema: BOOK_SCHEMA,
  });
}
