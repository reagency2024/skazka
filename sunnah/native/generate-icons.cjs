// Генерация всех иконок и заставок из public/icon.svg.
// Нужен Playwright с Chromium: node native/generate-icons.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const svg = fs.readFileSync(path.join(root, "public/icon.svg"), "utf8");
const res = path.join(root, "native/android-res");

// Отдельные слои для адаптивной иконки Android: фон и рисунок без фона.
// Холст 108dp, видимая часть — центральные 72dp, поэтому расширяем viewBox в 1.5 раза.
const wide = s => s.replace('viewBox="0 0 512 512"', 'viewBox="-128 -128 768 768"');
const layers = {
  full: svg,
  foreground: wide(svg.replace(/<rect id="bg"[^>]*\/>/, "")),
  background: wide(svg.replace(/<g id="art"[\s\S]*?<\/g>/, "")),
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  async function render(src, w, h, out, { radius = 0, bg = "transparent", scale = 1 } = {}) {
    const s = Math.round(Math.min(w, h) * scale);
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;background:${bg};display:grid;place-items:center">
      <div style="width:${s}px;height:${s}px;border-radius:${radius}%;overflow:hidden">${src.replace("<svg ", `<svg width="${s}" height="${s}" `)}</div></body></html>`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out, omitBackground: bg === "transparent" });
  }

  await render(layers.full, 192, 192, path.join(root, "public/icon-192.png"));
  await render(layers.full, 512, 512, path.join(root, "public/icon-512.png"));
  await render(layers.full, 180, 180, path.join(root, "public/apple-touch-icon.png"));

  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    const dir = path.join(res, `mipmap-${d}`);
    await render(layers.full, 48 * k, 48 * k, path.join(dir, "ic_launcher.png"), { radius: 22 });
    await render(layers.full, 48 * k, 48 * k, path.join(dir, "ic_launcher_round.png"), { radius: 50 });
    await render(layers.foreground, 108 * k, 108 * k, path.join(dir, "ic_launcher_foreground.png"));
    await render(layers.background, 108 * k, 108 * k, path.join(dir, "ic_launcher_background.png"));
  }

  const splash = {
    "drawable": [480, 320], "drawable-land-hdpi": [800, 480], "drawable-land-mdpi": [480, 320], "drawable-land-xhdpi": [1280, 720],
    "drawable-land-xxhdpi": [1600, 960], "drawable-land-xxxhdpi": [1920, 1280], "drawable-port-hdpi": [480, 800],
    "drawable-port-mdpi": [320, 480], "drawable-port-xhdpi": [720, 1280], "drawable-port-xxhdpi": [960, 1600], "drawable-port-xxxhdpi": [1280, 1920],
  };
  for (const [dir, [w, h]] of Object.entries(splash)) {
    await render(layers.full, w, h, path.join(res, dir, "splash.png"), { radius: 22, bg: "#060d0a", scale: 0.34 });
  }
  await browser.close();
  console.log("Иконки и заставки обновлены.");
})();
