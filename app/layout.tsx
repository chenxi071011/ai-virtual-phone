import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { ChatPluginBootstrap } from "@/components/chat-plugin-bootstrap";
import { ChatReasoningVisibilityController } from "@/components/chat-reasoning-visibility-controller";
import { CSSImportEnhancer } from "@/components/css-import-enhancer";
import { PWAManifestInjector } from "@/components/pwa-manifest-injector";
import { PWARegistrar } from "@/components/pwa-registrar";
import "../styles/fonts.css";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "float",
  description: "float",
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 筑境（World Builder）用整页硬跳转打开/返回，每次硬跳转浏览器都会先画出这个
            静态导出页面里预渲染好的开屏动画标记，JS 要等 hydrate 完才能把它摘掉——
            这个空档就是"返回后闪一下开屏动画"的来源。这段内联脚本在解析到 <body> 之前
            同步执行，本次会话已经进过一次（sessionStorage 标记，见 main-app.tsx）就直接
            用 CSS 隐藏开屏节点，画面上就完全不会闪了。 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(sessionStorage.getItem('float-boot-entered')==='1'){document.documentElement.classList.add('boot-skip')}}catch(e){}`,
          }}
        />
        {/* 原来"去掉模拟手机边框、铺满全屏"这套布局靠 CSS @media (max-width:500px)
            and (hover:none) and (pointer:coarse) 猜"这是不是手机小屏"，部分机型
            （大屏/折叠屏/系统显示比例设置导致 CSS 视口变宽，或 WebView 把 hover/pointer
            报成非触屏值）猜错，就会一直停在带模拟边框的桌面态布局里出不来。这个 App
            只会装在手机上跑，原生壳里不存在"要不要模拟边框"的问题——Capacitor 的原生
            桥在页面自己的脚本跑之前就已经同步挂好 window.Capacitor，这里直接读它，
            不再靠猜。Web/PWA 场景 window.Capacitor 不存在，行为不变。 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform()){document.documentElement.classList.add('cap-native')}}catch(e){}`,
          }}
        />
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
        <meta name="theme-color" content="#f8f7f2" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link rel="icon" href="/icon-192.png" type="image/png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="float" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body>
        <PWAManifestInjector />
        <PWARegistrar />
        <CSSImportEnhancer />
        <ChatPluginBootstrap />
        <ChatReasoningVisibilityController />
        {children}
      </body>
    </html>
  );
}
