// lib/mixology/css-scope.ts
// 独家特调 · 装饰 CSS 的作用域封装。
//
// 装饰是可以互相分享的材料，但它的内容是 CSS，注入进页面就是全局生效的——
// 一句 body { display: none } 就能把整个应用弄白。小票和尾调跑在沙盒 iframe 里
// 没这个问题，装饰是唯一一类直接进主文档的可分享代码，必须先关进笼子。
//
// 做法：把每条规则的选择器前面挂上对局画面的作用域选择器，让装饰最多只能改到
// 对局画面里的东西。creator 常写的 body / html / :root 会被改写成作用域根本身，
// 因为他们的本意就是"这一整屏"。
//
// 这里是手写的扫描器而不是正则：CSS 里有注释、字符串、嵌套花括号和成组的
// at-rule，正则处理不干净，而处理不干净的后果是别人的装饰被改坏或越狱。

/** 对局画面根节点上的作用域类名 */
export const MIX_GARNISH_SCOPE = ".mix-garnish-scope";

/** 整份 CSS 的体积上限：超出的部分直接截掉，避免超大装饰拖垮渲染 */
const MAX_CSS_LENGTH = 200_000;

/** 会被整条丢掉的 at-rule：拉取外部样式表，既有隐私问题也有可用性问题 */
const DROPPED_AT_RULES = new Set(["import", "charset", "namespace"]);

/** 内部不含选择器的 at-rule：整块原样保留，不要去改里面的 0% / from / to */
const OPAQUE_AT_RULES = new Set(["keyframes", "font-face", "counter-style", "property", "page", "font-feature-values"]);

/** 内部还是普通规则的成组 at-rule：保留 prelude，递归处理内部 */
const NESTED_AT_RULES = new Set(["media", "supports", "layer", "container", "scope", "document"]);

/** 写这些就是想说「这一整屏」，改写成作用域根本身 */
const ROOT_SELECTORS = new Set([":root", "html", "body", "*", ":scope", "html body"]);

type Cursor = { text: string; pos: number };

function skipWhitespaceAndComments(cur: Cursor): void {
    for (;;) {
        while (cur.pos < cur.text.length && /\s/.test(cur.text[cur.pos])) cur.pos += 1;
        if (cur.text.startsWith("/*", cur.pos)) {
            const end = cur.text.indexOf("*/", cur.pos + 2);
            cur.pos = end < 0 ? cur.text.length : end + 2;
            continue;
        }
        return;
    }
}

/** 从当前位置读到本层的 { 或 ; 为止（跳过字符串与注释），返回读到的文本与终止符 */
function readPrelude(cur: Cursor): { text: string; terminator: "{" | ";" | "" } {
    const start = cur.pos;
    let depth = 0;
    while (cur.pos < cur.text.length) {
        const ch = cur.text[cur.pos];
        if (ch === "/" && cur.text.startsWith("/*", cur.pos)) {
            const end = cur.text.indexOf("*/", cur.pos + 2);
            cur.pos = end < 0 ? cur.text.length : end + 2;
            continue;
        }
        if (ch === '"' || ch === "'") {
            cur.pos = skipString(cur.text, cur.pos);
            continue;
        }
        if (ch === "(" || ch === "[") depth += 1;
        else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
        else if (depth === 0 && (ch === "{" || ch === ";")) {
            const text = cur.text.slice(start, cur.pos);
            cur.pos += 1;
            return { text, terminator: ch };
        }
        cur.pos += 1;
    }
    return { text: cur.text.slice(start, cur.pos), terminator: "" };
}

function skipString(text: string, pos: number): number {
    const quote = text[pos];
    let i = pos + 1;
    while (i < text.length) {
        if (text[i] === "\\") { i += 2; continue; }
        if (text[i] === quote) return i + 1;
        i += 1;
    }
    return text.length;
}

/** 从 { 之后读到配对的 } 为止，返回块内文本（不含两端花括号） */
function readBlock(cur: Cursor): string {
    const start = cur.pos;
    let depth = 1;
    while (cur.pos < cur.text.length) {
        const ch = cur.text[cur.pos];
        if (ch === "/" && cur.text.startsWith("/*", cur.pos)) {
            const end = cur.text.indexOf("*/", cur.pos + 2);
            cur.pos = end < 0 ? cur.text.length : end + 2;
            continue;
        }
        if (ch === '"' || ch === "'") {
            cur.pos = skipString(cur.text, cur.pos);
            continue;
        }
        if (ch === "{") depth += 1;
        else if (ch === "}") {
            depth -= 1;
            if (depth === 0) {
                const text = cur.text.slice(start, cur.pos);
                cur.pos += 1;
                return text;
            }
        }
        cur.pos += 1;
    }
    return cur.text.slice(start, cur.pos);
}

/** 按顶层逗号切开选择器列表（括号、方括号、字符串里的逗号不算） */
function splitSelectorList(selector: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < selector.length; i += 1) {
        const ch = selector[i];
        if (ch === '"' || ch === "'") { i = skipString(selector, i) - 1; continue; }
        if (ch === "(" || ch === "[") depth += 1;
        else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
        else if (ch === "," && depth === 0) {
            parts.push(selector.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(selector.slice(start));
    return parts.map((part) => part.trim()).filter(Boolean);
}

/** 给一条选择器挂上作用域 */
function scopeOne(selector: string, scope: string): string[] {
    const trimmed = selector.trim();
    if (!trimmed) return [];
    // 原生嵌套里的 & 交给浏览器按父规则解析，外层已经限定住了
    if (trimmed.startsWith("&")) return [trimmed];
    const normalized = trimmed.replace(/\s+/g, " ");
    if (ROOT_SELECTORS.has(normalized)) return [scope];
    // html xxx / body xxx / :root xxx：前缀那一截换成作用域根
    const rootPrefix = /^(?::root|html|body)\s+(.*)$/.exec(normalized);
    if (rootPrefix) return [`${scope} ${rootPrefix[1]}`];
    // 既可能是作用域根的后代，也可能就是根自己（创作者直接写 .mix-game 之类）。
    // 后一种只在选择器以类/id/属性/伪类开头时才拼得出合法写法。
    const results = [`${scope} ${trimmed}`];
    if (/^[.#[:]/.test(trimmed)) results.push(`${scope}${trimmed}`);
    return results;
}

function scopeSelectorList(selector: string, scope: string): string {
    const scoped = splitSelectorList(selector).flatMap((part) => scopeOne(part, scope));
    return scoped.join(", ");
}

function transform(css: string, scope: string, depth: number): string {
    // 成组 at-rule 嵌太深多半是构造出来的，不再往下走
    if (depth > 8) return "";
    const cur: Cursor = { text: css, pos: 0 };
    const out: string[] = [];
    for (;;) {
        skipWhitespaceAndComments(cur);
        if (cur.pos >= cur.text.length) break;
        // 多余的右花括号：跳过，别让它把后面的内容顶飞
        if (cur.text[cur.pos] === "}") { cur.pos += 1; continue; }
        const { text: prelude, terminator } = readPrelude(cur);
        const head = prelude.trim();
        if (head.startsWith("@")) {
            const name = (/^@([\w-]+)/.exec(head)?.[1] ?? "").toLowerCase();
            if (terminator === "{") {
                const block = readBlock(cur);
                if (DROPPED_AT_RULES.has(name)) continue;
                if (OPAQUE_AT_RULES.has(name)) { out.push(`${head}{${block}}`); continue; }
                if (NESTED_AT_RULES.has(name)) { out.push(`${head}{${transform(block, scope, depth + 1)}}`); continue; }
                // 不认识的成组 at-rule：内部按普通规则处理，不放行未知语义
                out.push(`${head}{${transform(block, scope, depth + 1)}}`);
                continue;
            }
            // 单行 at-rule（@import 之类）：该丢的丢，其余原样
            if (!DROPPED_AT_RULES.has(name) && head) out.push(`${head};`);
            continue;
        }
        if (terminator !== "{") continue; // 没有块的裸文本，丢掉
        const block = readBlock(cur);
        const scoped = scopeSelectorList(head, scope);
        if (!scoped) continue;
        out.push(`${scoped}{${block}}`);
    }
    return out.join("\n");
}

/**
 * 根节点保命规则：装饰写 body { display: none } 时会被收口成作用域根，
 * 结果是把对局画面连同返回按钮一起隐藏掉，玩家看到一片空白也退不出去。
 * 这几条属性在收口之后再钉回去——比装饰的选择器多一层特异性，同为 !important
 * 时也压得住；其余属性（配色、字体、间距）一概不管，创作者照常发挥。
 */
function rootGuard(scope: string): string {
    const props = [
        "display: flex !important",
        "visibility: visible !important",
        "opacity: 1 !important",
        "pointer-events: auto !important",
    ];
    return `${scope}${scope}{${props.join(";")}}`;
}

/**
 * 把装饰 CSS 限制在对局画面内。
 * 返回可以直接塞进 <style> 的文本；输入为空或全是被丢弃的规则时返回空串。
 */
export function scopeMixCss(css: string, scope: string = MIX_GARNISH_SCOPE): string {
    const source = (css ?? "").slice(0, MAX_CSS_LENGTH);
    if (!source.trim()) return "";
    let scoped: string;
    try {
        scoped = transform(source, scope, 0);
    } catch {
        // 解析不了就整份丢掉——宁可这件装饰不生效，也不把没处理干净的 CSS 放进页面
        return "";
    }
    if (!scoped.trim()) return "";
    return `${scoped}\n${rootGuard(scope)}`;
}
