// 用 resources/icon.png 生成 Android 全套启动图标。
// 换图标只需替换 resources/icon.png（建议 1024×1024）后跑 `node gen-icons.mjs`。
import sharp from "sharp";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "resources", "icon.png");
const RES = path.join(here, "android", "app", "src", "main", "res");

// 自适应图标的背景底色：取源图左上角像素。前景 inset 16.7% 后四周会露出这块底，
// 底色跟图不一致的话，被系统裁成圆形后边缘会有一圈色差。
// 自动取色是为了让自用版和发布版共用同一份脚本，只靠换 resources/icon.png 区分。
async function pickBackground(src) {
  const { data } = await sharp(src)
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // 角落透明时退回白色。透明底铺在自适应图标上会露出系统壁纸。
  if (data[3] < 128) return { r: 255, g: 255, b: 255, alpha: 1 };
  return { r: data[0], g: data[1], b: data[2], alpha: 1 };
}

// 传统图标尺寸（全出血方形 + 圆形），给 Android 8.0 以下的启动器用
const LEGACY = { ldpi: 36, mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
// 自适应图标图层尺寸（108dp 画布）
const ADAPTIVE = { ldpi: 81, mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

const circleMask = (size) =>
  Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);

if (!(await exists(SRC))) {
  console.error(`找不到 ${SRC}`);
  process.exit(1);
}

const BG = await pickBackground(SRC);
console.log(`底色取自源图左上角：rgb(${BG.r}, ${BG.g}, ${BG.b})`);

let count = 0;
for (const [dens, size] of Object.entries(LEGACY)) {
  const dir = path.join(RES, `mipmap-${dens}`);
  if (!(await exists(dir))) continue;

  const square = await sharp(SRC).resize(size, size, { fit: "cover" }).png().toBuffer();
  await sharp(square).toFile(path.join(dir, "ic_launcher.png"));
  await sharp(square)
    .composite([{ input: circleMask(size), blend: "dest-in" }])
    .png()
    .toFile(path.join(dir, "ic_launcher_round.png"));
  count += 2;
}

for (const [dens, size] of Object.entries(ADAPTIVE)) {
  const dir = path.join(RES, `mipmap-${dens}`);
  if (!(await exists(dir))) continue;

  // 背景层必须铺满整块 108dp 画布。mipmap-anydpi-v26/ic_launcher.xml 里
  // 特意没给 background 加 inset——加了的话被系统裁成圆形后四角会透出去。
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .png()
    .toFile(path.join(dir, "ic_launcher_background.png"));

  // 前景层放整张图标。XML 对 foreground inset 16.7%，
  // 最终可见区 = 108 * (1 - 0.334) ≈ 72dp，正好是自适应图标的安全区。
  await sharp(SRC).resize(size, size, { fit: "cover" }).png()
    .toFile(path.join(dir, "ic_launcher_foreground.png"));
  count += 2;
}

console.log(`已生成 ${count} 个图标文件`);
