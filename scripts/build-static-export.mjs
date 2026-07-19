#!/usr/bin/env node
// 手机离线 App 用的静态导出构建。
//
// Next.js 的 output:"export" 不支持有真实动态行为（读 cookies/请求体/env 密钥）的
// Route Handler —— 这个仓库的 app/api/* 全都是这种，直接开 export 模式会在 build
// 时对每个路由报错。这些接口现在也确实不需要了：
//   - 转发类的（tool-proxy/image-generation/tripo/voice 等）本来就是给浏览器绕 CORS 用的，
//     手机原生层用 CapacitorHttp 不存在 CORS 问题；
//   - 网易云音乐已经整个搬到客户端直连（lib/netease/*），不再要本地代理；
//   - 账号/黑市/社区这些云端功能本来就没在自建（self-hosted）模式里用到。
// 所以这里的做法很直接：build 之前把 app/api 整个挪到别处，跑完 build 再挪回来，
// 不影响 `npm run dev` / 普通 `npm run build`（Netlify 线上部署走的是没有这个环境变量的
// 普通 build，api 路由完全不受影响）。
import { existsSync } from "node:fs";
import { rename } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// 静态导出不支持真正动态的 Route Handler，这几个在离线 App 里也用不上：
// app/api/* 全是转发/云端接口（见 next.config.mjs 里的说明）；manifest.webmanifest
// 是给浏览器装 PWA 用的 UA 嗅探路由，Capacitor 原生壳压根不走"安装 PWA"这条路。
const PARK_LIST = [
    path.join(projectRoot, "app", "api"),
    path.join(projectRoot, "app", "manifest.webmanifest"),
];

function run(cmd, args, env) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { cwd: projectRoot, stdio: "inherit", shell: true, env: { ...process.env, ...env } });
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`))));
        child.on("error", reject);
    });
}

async function main() {
    const parked = [];
    for (const dir of PARK_LIST) {
        if (!existsSync(dir)) continue;
        // 必须挪到 app/ 外面——Next 的 App Router 只要是 app/ 底下任意路径带 route.ts
        // 都会当路由收进去，光在原地改名（哪怕加后缀）还是会被扫到。
        const parkedPath = path.join(projectRoot, `.static-export-parked-${path.basename(dir)}`);
        console.log(`[static-export] 临时挪走 ${path.relative(projectRoot, dir)}…`);
        await rename(dir, parkedPath);
        parked.push({ dir, parkedPath });
    }
    try {
        await run("npx", ["next", "build"], { BUILD_STATIC_EXPORT: "1" });
        console.log("[static-export] 完成，静态文件在 ./out");
    } finally {
        for (const { dir, parkedPath } of parked) {
            await rename(parkedPath, dir);
        }
        if (parked.length) console.log("[static-export] 已还原挪走的目录。");
    }
}

main().catch((err) => {
    console.error("[static-export] 构建失败：", err);
    process.exit(1);
});
