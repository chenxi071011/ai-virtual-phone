// 用 resources/icon.png 生成 Android 全套原生启动闪屏（drawable*/splash.png）。
// 换闪屏只需替换 resources/icon.png 后跑 `node gen-splash.mjs`，与 gen-icons.mjs 同源。
// 这张图只在点开图标后、WebView 加载出网页开机动画之前露那么零点几秒。
import sharp from "sharp";
import { readdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "resources", "icon.png");
const RES = path.join(here, "android", "app", "src", "main", "res");

// 底色取源图左上角像素，跟 gen-icons.mjs 同一套做法：这样闪屏底色和图标底色一致，
// 换源图时不用手动改颜色。角落透明时退回白色。
async function pickBackground(src) {
  const { data } = await sharp(src)
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (data[3] < 128) return { r: 255, g: 255, b: 255, alpha: 1 };
  return { r: data[0], g: data[1], b: data[2], alpha: 1 };
}

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

if (!(await exists(SRC))) {
  console.error(`找不到 ${SRC}`);
  process.exit(1);
}

const BG = await pickBackground(SRC);
console.log(`底色取自源图左上角：rgb(${BG.r}, ${BG.g}, ${BG.b})`);

// 只覆盖已经存在 splash.png 的目录，保持 Capacitor 原有的密度矩阵不变。
const dirs = [];
for (const d of await readdir(RES)) {
  if (await exists(path.join(RES, d, "splash.png"))) dirs.push(d);
}

let count = 0;
for (const dir of dirs) {
  const file = path.join(RES, dir, "splash.png");
  const { width, height } = await sharp(file).metadata();

  // 图标占短边的 40%：竖屏/横屏都不会顶到边，跟系统 splash 的视觉分量接近。
  const logo = Math.round(Math.min(width, height) * 0.4);
  const art = await sharp(SRC).resize(logo, logo, { fit: "contain", background: BG }).png().toBuffer();

  await sharp({ create: { width, height, channels: 4, background: BG } })
    .composite([{ input: art, gravity: "centre" }])
    .png()
    .toFile(file);
  count += 1;
}

console.log(`已生成 ${count} 张 splash.png`);
