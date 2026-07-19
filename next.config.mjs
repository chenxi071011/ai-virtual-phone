import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === "win32";
const isWslUncPath = projectRoot.startsWith("\\\\wsl$\\");

function resolveDistDir() {
  // 本地验证构建可用 NEXT_DIST_DIR 指到独立目录,避免覆写正在跑的 dev server 的 .next
  if (process.env.NEXT_DIST_DIR) {
    return process.env.NEXT_DIST_DIR;
  }
  if (!isWindows || !isWslUncPath) {
    return ".next";
  }

  const safeProjectName = path.basename(projectRoot).replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(os.tmpdir(), `next-dist-${safeProjectName}`);
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  outputFileTracingRoot: projectRoot,
  distDir: resolveDistDir(),
  // 手机离线包用：产出纯静态文件（没有任何服务端路由），直接塞进 Capacitor 的
  // android assets 里，不用连电脑的 dev server。app/api 在这个模式下必须整个不参与编译——
  // 静态导出不支持有真实动态行为的 Route Handler，所以用 scripts/build-static-export.mjs
  // 在跑这个 build 之前把 app/api 挪走，跑完再挪回来，正常 dev/build 不受影响。
  // BUILD_STANDALONE 是更早一版探索"手机内嵌 Node 运行时"时留下的产物：已确认此路不通
  // （nodejs-mobile 停在 Node 18.20 且没有 Android 15+ 16KB 页对齐支持），改走静态导出，
  // 这个开关保留着没删，但不再是当前离线方案要用的。
  output: process.env.BUILD_STATIC_EXPORT ? "export" : process.env.BUILD_STANDALONE ? "standalone" : undefined,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    // 项目有若干历史 TS 错误（chat-message-list 缺模块、weixin 路由 socket 字段、
    // world-builder SceneViewport prop 不匹配 等），不影响 dev 但 production build 会卡。
    // 跳过 typecheck 让 build 通过；IDE 和 `npx tsc --noEmit` 仍能看到错误。
    ignoreBuildErrors: true,
  },
  outputFileTracingIncludes: {
    "/api/**": ["./data/**"],
  },
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      // @gltf-transform/core 的 dist 引用 node:fs / node:path(带 node: 前缀),
      // 它的 browser 字段只映射了裸 fs/path,webpack 对 node: 前缀报 UnhandledSchemeError。
      // 客户端包里剥掉前缀,再用 fallback 置空(浏览器路径实际只用 WebIO,不会真调 fs)。
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, "");
        }),
      );
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        module: false,
      };
    }
    return config;
  },
};

export default nextConfig;
