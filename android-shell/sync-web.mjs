// 把上层 Next 工程 `npm run build:static-export` 的产物（../out）灌进壳的 www/，
// 然后跑 cap sync 把它同步到 android/app/src/main/assets/public。
// 直接手工复制也行，这个脚本只是省事并保证 www 是干净的（先删再拷，避免上次构建的残留文件被打进包）。
import { cp, rm, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "out");
const www = path.join(here, "www");

try {
  await access(out);
} catch {
  console.error(`找不到 ${out}\n请先在上层目录执行：npm run build:static-export`);
  process.exit(1);
}

await rm(www, { recursive: true, force: true });
await cp(out, www, { recursive: true });
console.log("已同步 out/ → www/");

const r = spawnSync("npx", ["cap", "sync", "android"], {
  cwd: here,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(r.status ?? 1);
