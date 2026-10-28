// Донастройка Android-проекта после `cap add android`:
// иконки приложения, разрешения для точных напоминаний и адрес сервера по умолчанию.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const res = path.join(root, "android/app/src/main/res");
if (!fs.existsSync(res)) {
  console.error("Нет папки android/. Сначала выполните: npx cap add android");
  process.exit(1);
}

fs.cpSync(path.join(root, "native/android-res"), res, { recursive: true });
// Адаптивная иконка Capacitor по умолчанию перекрыла бы нашу на Android 8+.
fs.rmSync(path.join(res, "mipmap-anydpi-v26"), { recursive: true, force: true });

const manifestPath = path.join(root, "android/app/src/main/AndroidManifest.xml");
let manifest = fs.readFileSync(manifestPath, "utf8");
for (const perm of ["android.permission.POST_NOTIFICATIONS", "android.permission.SCHEDULE_EXACT_ALARM", "android.permission.RECEIVE_BOOT_COMPLETED"]) {
  if (!manifest.includes(perm)) manifest = manifest.replace("</manifest>", `    <uses-permission android:name="${perm}" />\n</manifest>`);
}
fs.writeFileSync(manifestPath, manifest);

// Заставка Android 12+: фон в цвет приложения вместо белого.
const stylesPath = path.join(res, "values/styles.xml");
let styles = fs.readFileSync(stylesPath, "utf8");
if (!styles.includes("windowSplashScreenBackground")) {
  styles = styles.replace('<item name="android:background">@drawable/splash</item>',
    '<item name="android:background">@drawable/splash</item>\n        <item name="windowSplashScreenBackground">#0b1411</item>');
  fs.writeFileSync(stylesPath, styles);
}

const server = (process.env.SUNNAH_SERVER || "").trim().replace(/\/+$/, "");
if (server) {
  fs.writeFileSync(path.join(root, "public/config.js"),
    `// Адрес сервера синхронизации (подставлен при сборке приложения).\nwindow.SUNNAH_CONFIG = { server: ${JSON.stringify(server)} };\n`);
  console.log(`Сервер по умолчанию: ${server}`);
}
console.log("Android-проект настроен.");
