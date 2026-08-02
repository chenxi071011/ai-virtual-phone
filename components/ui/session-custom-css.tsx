"use client";

import { useMemo } from "react";
import { extractCssImports, scopeSessionCSS } from "@/lib/css-scoper";

/**
 * 会话自定义 CSS 注入器。
 *
 * 把用户 CSS 里的 @import（多为 Google Fonts）抽成独立的 <link rel="stylesheet">，
 * 其余规则加作用域后走内联 <style>。@import 若留在 <style> 里，iOS WebKit 在其
 * 加载/重试期间会挂起整张样式表，网络不通时页面会在有 CSS/无 CSS 之间反复闪烁
 * （剧情模式拉到顶/底时最明显）。
 *
 * <link> 带 precedence 属性由 React 19 提升进 <head> 并按 href 去重，跨重渲染
 * 保持稳定；字体加载失败只缺字体，不影响其余自定义样式。
 */
export function SessionCustomCSS({ css, scope }: { css: string; scope: string }) {
    const { imports, body } = useMemo(() => {
        const extracted = extractCssImports(css || "");
        return { imports: extracted.imports, body: extracted.css };
    }, [css]);
    const scoped = useMemo(() => scopeSessionCSS(body, scope), [body, scope]);

    return (
        <>
            {imports.map((href) => (
                <link key={href} rel="stylesheet" href={href} precedence="default" />
            ))}
            {scoped ? <style dangerouslySetInnerHTML={{ __html: scoped }} /> : null}
        </>
    );
}
