// lib/css-examples.ts
// Shared CSS examples — used by CSS editors AND 小卷's CSS skill.
// Curated top 30-50 most impactful selectors per location, with clear comments.

export const CHAT_SESSION_CSS_EXAMPLE = `/* ═══ 单独聊天室 CSS 示例 ═══ */
/* 作用范围：只影响当前聊天室，不影响其他页面。 */

/* ── 颜色变量 ── */
:root {
  --c-header-bg: #FFFFFF;         /* 标题栏底色 */
  --c-page-body-bg: #FAFAFA;      /* 消息区底色 */

  --c-bubble-self: var(--c-action-blue, #246bfd); /* 我的气泡 */
  --c-bubble-other: #FFFFFF;      /* 对方气泡 */
  --c-text-title: #2C3440;        /* 主要文字 */
  --c-text: #797E85;              /* 次要文字 */
  --c-icon: #A0A3A8;              /* 普通图标 */
  --c-icon-active: #4A4A4A;       /* 强调色 */

  --c-input: #EBEBEB;
  --c-input-border: #DADBDF;
  --c-card: #FFFFFF;
  --c-card-border: #E0E0E0;
}

/* ── 聊天室背景 ── */
.chat-room-wrapper {
  background: var(--c-page-body-bg);
  /* background: url("图片链接") center/cover no-repeat; */
}

/* ── 标题栏 ── */
/* .page-header = 整个标题栏（含安全区），改背景/毛玻璃用这个 */
/* .page-header-content = 按钮+标题那一行，改 padding/布局用这个 */
.page-header {
  background: color-mix(in srgb, var(--c-header-bg) 75%, transparent);
  backdrop-filter: blur(20px);
  /* 关闭毛玻璃：backdrop-filter: none; background: var(--c-header-bg); */
}

.page-header-content {
  /* padding: 10px 14px; */
  /* gap: 8px; */
}

.page-title,
.page-back-btn {
  color: var(--c-text-title);
}

/* ── 消息列表 ── */
.chat-scroll-anchored {
  padding: 16px 16px 24px;
}

.chat-msg-wrapper {
  gap: 8px;
}

.chat-sys-msg {
  color: var(--c-text);
}

/* 系统指令注入卡片 */
.chat-system-instruction-card {
  background: var(--c-card);
  border: 1px solid var(--c-card-border);
  border-radius: 8px;
  box-shadow: var(--chat-bubble-shadow);
}

.chat-system-instruction-title {
  color: var(--c-text-title);
  font-weight: 600;
}

.chat-system-instruction-body {
  color: var(--c-text);
  text-indent: 2em;
}

/* 连续同一人发言：收紧间距（可选项） */
/*
.chat-msg-wrapper[data-consecutive] {
  margin-top: -12px !important;
}
*/
/* 连续同一人发言：隐藏头像（可选项） */
/*
.chat-msg-wrapper[data-consecutive] .chat-msg-avatar {
  opacity: 0;
  pointer-events: none;
}
*/

/* ── 气泡 ── */
.chat-bubble-role-user {
  background: var(--c-bubble-self);
  color: #fff;
  border-radius: 6px;
  padding: 10px 14px;
}

.chat-bubble-role-assistant {
  background: var(--c-bubble-other);
  color: var(--c-text-title);
  border-radius: 6px;
  padding: 10px 14px;
}

.chat-markdown {
  color: var(--c-text-title);
  font-size: calc(15px*var(--app-text-scale,1));
  line-height: 1.7;
}

/* 控制段落间距离 */
.chat-markdown p + p,
.chat-markdown-paragraph + .chat-markdown-paragraph {
  margin-top: 6px;
}

.chat-bubble-media {
  border-radius: 12px;
  overflow: visible;
}

/* ── 引用、编辑、长按菜单 ── */
.chat-quote-bar,
.chat-inline-edit-textarea {
  background: var(--c-input);
  border: 1px solid var(--c-input-border);
  border-radius: 8px;
}

.chat-inline-edit-btn-save {
  background: var(--c-icon-active);
  color: #ffffff;
}

.ctx-menu {
  background: #2c2c2c;
  border-radius: 8px;
}

.ctx-menu-btn {
  color: #ffffff;
}

.ctx-menu-btn-danger {
  color: #ff6b6b;
}

/* ── 输入栏 ── */
.chat-input-bar {
  background: color-mix(in srgb, var(--c-input) 55%, transparent);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
}

.chat-input-textarea {
  background: var(--c-input);
  border: 0.5px solid var(--c-input-border);
  color: var(--c-text-title);
  font-size: calc(15px*var(--app-text-scale,1));
}

.chat-input-actions {
  gap: 32px;
  justify-content: center;
}

/* ── 线下模式 ── */
.chat-offline-toggle.chat-offline-active {
  color: var(--c-text-title);
}

.chat-offline-body {
  padding: 16px 8px 24px;
  gap: 12px;
}

.chat-offline-empty,
.chat-offline-time {
  color: var(--c-icon);
}

.chat-offline-turn {
  border-radius: 12px;
  background: color-mix(in srgb, var(--c-card) 56%, transparent);
  border: 1px solid color-mix(in srgb, var(--c-card-border) 30%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.chat-offline-entry {
  padding: 10px 14px 10px 18px;
}

.chat-offline-entry + .chat-offline-entry {
  border-top: 1px solid color-mix(in srgb, var(--c-card-border) 22%, transparent);
}

.chat-offline-entry[data-role="user"]::before {
  background: color-mix(in srgb, var(--c-icon) 50%, transparent);
}

.chat-offline-entry[data-role="assistant"]::before {
  background: color-mix(in srgb, var(--c-text-title) 38%, transparent);
}

.chat-offline-label {
  border-radius: 4px;
  font-size: calc(11px*var(--app-text-scale,1));
  font-weight: 600;
}

.chat-offline-entry[data-role="user"] .chat-offline-label {
  color: var(--c-icon);
  background: color-mix(in srgb, var(--c-icon) 10%, transparent);
}

.chat-offline-entry[data-role="assistant"] .chat-offline-label {
  color: var(--c-text-title);
  background: color-mix(in srgb, var(--c-text-title) 7%, transparent);
}

.chat-offline-text {
  color: var(--c-text);
  font-size: calc(14.5px*var(--app-text-scale,1));
  line-height: 1.85;
}

.chat-offline-entry[data-role="assistant"] .chat-offline-text {
  color: var(--c-text-title);
}

.chat-offline-text[data-active] {
  background: color-mix(in srgb, var(--c-icon) 8%, transparent);
}

.chat-offline-summary-fold {
  background: color-mix(in srgb, var(--c-page-body-bg) 50%, transparent);
  border-radius: 6px;
}

.chat-offline-summary-fold > summary,
.chat-offline-summary-content,
.chat-offline-generating {
  color: var(--c-icon);
}

.chat-offline-summary-content {
  font-size: calc(13px*var(--app-text-scale,1));
  line-height: 1.8;
}

/* ── + 号菜单和表情面板（现在作为内部悬浮层） ── */
/* 
.chat-plus-menu,
.chat-emoji-panel-wrap {
  内联控制，如需调节高度可直接去调整。
}
*/

/* ── 语音条 ── */
.voice-msg-bubble {
  border-radius: 12px;
}

.voice-msg-icon {
  color: var(--c-icon-active);
}

.voice-msg-bar {
  background: var(--c-icon);
}

.voice-msg-bars[data-playing] .voice-msg-bar {
  background: var(--c-icon-active);
}

.voice-msg-dur {
  color: var(--c-text);
}

/* ── 内心独白 ── */
.chat-thought-card {
  background: linear-gradient(135deg, #fef9ef, #fdf3e0);
  border: 1px solid rgba(222,184,135,0.30);
  border-radius: 12px;
}

.chat-thought-title,
.chat-thought-sig {
  color: #c9a96e;
}

.chat-thought-body {
  color: #5a4a3a;
}

.chat-monologue-heart[data-active] {
  color: #e74c5e;
}

/* ── 卡片消息 ── */
.chat-red-packet-card,
.chat-transfer-card,
.chat-html-inline,
.chat-music-share-card {
  background: var(--c-card);
  border: 1px solid var(--c-card-border);
  border-radius: 14px;
}

.chat-red-packet-body {
  /* background: linear-gradient(135deg, #ff6a5f, #e8473f); */
}

.chat-transfer-body {
  /* background: linear-gradient(135deg, #ffb347, #ff8c2a); */
}

.ui-media-footer {
  background: var(--c-card);
  color: var(--c-text);
}

.ui-media-footer[data-status="declined"] {
  color: var(--c-icon);
}

.chat-html-inline-frame {
  max-height: min(36vh, 340px);
}

.chat-thought-card .chat-html-inline-frame,
.chat-status-bare .chat-html-inline-frame {
  max-height: min(52vh, 420px);
}

.chat-msg-content-wrap[data-html="true"] {
  /* 需要让 HTML 消息更宽时可改为：max-width: 100% !important; */
}

.chat-music-share-title {
  color: var(--c-text-title);
}

.chat-music-share-artist {
  color: var(--c-text);
}

/* 位置卡片 */
.chat-location-card {
  border-radius: 14px;
  overflow: hidden;
}

.chat-location-map {
  /* background: linear-gradient(135deg, #a7c7e7, #d8ecff); */
}

.chat-location-label {
  background: var(--c-input);
  color: var(--c-text);
}

/* 表情包 */
.chat-sticker {
  border-radius: 12px;
}

.chat-sticker-image img {
  width: 120px;
  height: 120px;
}

.chat-sticker-fallback {
  background: color-mix(in srgb, var(--c-icon) 10%, transparent);
  color: var(--c-text);
}

/* 引用消息 */
.chat-quote-preview {
  background: color-mix(in srgb, var(--c-icon) 10%, transparent);
  border-left-color: color-mix(in srgb, var(--c-icon) 35%, transparent);
  color: var(--c-icon);
}

/* 文件、图片、音频、视频附件 */
.chat-media-file-card {
  background: var(--c-card);
  border: 1px solid var(--c-card-border);
  border-radius: 12px;
}

.chat-media-file-title {
  color: var(--c-text-title);
}

.chat-media-file-time,
.chat-media-file-save {
  color: var(--c-text);
}

.chat-media-file-play,
.chat-media-file-progress-fill {
  background: var(--c-icon-active);
}

/* 礼物卡片 */
.chat-gift-card {
  background: #ffffff;
  border: none;
  border-radius: 0;
  overflow: visible;
  /* 不需要阴影可改为：box-shadow: none; */
  box-shadow: 0 1px 4px rgba(0,0,0,0.025);
  margin: 2px 0 4px;
}

.chat-gift-card-body {
  background: #ffffff;
  overflow: visible;
}

.chat-gift-card-status {
  background: rgba(0,0,0,0.055);
  color: var(--c-text-title);
}

.chat-gift-card-title {
  color: var(--c-text-title);
  font-size: calc(24px*var(--app-text-scale,1));
}

.chat-gift-card-divider {
  background: rgba(0,0,0,0.12);
}

.chat-gift-card-footer {
  border-top: 1px solid rgba(0,0,0,0.12);
}

.chat-gift-card-cell-label,
.chat-gift-card-kicker,
.chat-gift-card-label,
.chat-gift-card-brand {
  color: var(--c-icon);
}

.chat-gift-card-cell-value,
.chat-gift-card-source {
  color: var(--c-text);
}

/* 文字照片卡片 */
.chat-photo-card {
  background: #ffffff;
  border: none;
  border-radius: 0;
  overflow: visible;
  /* 不需要阴影可改为：box-shadow: none; */
  box-shadow: 0 1px 4px rgba(0,0,0,0.025);
  margin: 2px 0 4px;
}

.chat-photo-card-placeholder {
  background: #ffffff;
}

.chat-photo-card-text {
  color: var(--c-text-title);
  font-family: Georgia, "Times New Roman", serif;
  font-size: calc(13px*var(--app-text-scale,1));
  font-style: italic;
  line-height: 1.35;
  text-align: center;
}

.chat-photo-card-image {
  background: #ffffff;
}

/* 真实用户上传的图片走 .chat-photo-card--image 修饰类，
   容器自适应图片大小，图片保持原比例不裁切 */
.chat-photo-card--image {
  background: transparent;
  box-shadow: none;
}

.chat-photo-card--image .chat-photo-card-image {
  object-fit: contain;
}

/* 小红书分享卡片 */
.chat-xhs-share-card {
  background: #ffffff;
  border: none;
  border-radius: 8px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.02);
}

.chat-xhs-share-title {
  color: var(--c-text-title);
}

.chat-xhs-share-head,
.chat-xhs-share-author,
.chat-xhs-share-desc {
  color: var(--c-text);
}

.chat-xhs-share-mark {
  background: #ff2442;
  color: #ffffff;
}

.chat-xhs-share-cover {
  border-radius: 6px;
}

.chat-xhs-share-tags span {
  color: #ff2442;
  background: #fff0f3;
}

/* 支付卡片（微信扫码付 / 支付宝等） */
.scan-pay-card {
  background: var(--c-card);
  border: 1px solid var(--c-card-border);
  border-radius: 14px;
}
.scan-pay-title {
  color: var(--c-text-title);
}
.scan-pay-qr {
  border-radius: 8px;
}
.scan-pay-hint {
  color: var(--c-text);
}
.scan-pay-btn {
  border-radius: 999px;
}
.scan-pay-btn-primary {
  background: #07c160; /* 打开微信按钮（默认微信绿） */
  color: #ffffff;
}

/* 自定义 App 卡片（角色用富媒体指令生成的卡片，黑白档案风） */
/* 想整体换个墨色：只改 --cac-ink 一处，标题/数值/黑标签/主按钮会一起变 */
.chat-app-card {
  --cac-ink: #141414;             /* 主墨色：标题 / 数值 / 黑标签 / 主按钮 */
  --cac-ink-soft: #3b3b3b;        /* 正文、过程块文字 */
  --cac-ink-mute: #8c8c8c;        /* App名、副标题等弱化文字 */
  --cac-line: rgba(0,0,0,0.12);   /* 分隔线 / 小标签边框 */
  --cac-dash: rgba(0,0,0,0.30);   /* 区块之间的虚线 */
  background: #ffffff;            /* 卡片底色 */
  border-color: rgba(0,0,0,0.06); /* 卡片描边（想更清晰就把 0.06 调大） */
  /* 想要圆角：加 border-radius: 12px; */
}
/* 标题默认居中大写；不想大写就解开下面这行 */
.chat-app-card-title {
  /* text-transform: none; */
}
/* 只想给「黑标签 + 主按钮」单独换个彩色（正文仍保持墨色）就改这两处 */
.chat-app-card-section-title {
  background: var(--cac-ink);
  color: #ffffff;
}
.chat-app-card-actions button:last-child:not([data-style="danger"]) {
  background: var(--cac-ink);
  color: #ffffff;
}

/* ── 状态值面板 ── */
.state-panel {
  background: color-mix(in srgb, var(--c-card) 70%, transparent);
  border-radius: 6px;
}

.state-bar-track {
  height: 6px;
  border-radius: 3px;
}

/* ── 高级：自定义字体 ── */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* * { font-family: "ZCOOL KuaiLe", sans-serif; } */
`;

export const CHAT_APP_CSS_EXAMPLE = `/* ═══ 聊天应用 CSS 示例 ═══ */
/* 作用范围：聊天 app 所有页面（消息、联系人、动态、个人主页、聊天室）。 */
/* 单独聊天室 CSS 优先级更高，可覆盖这里的样式。 */


/* ══════════════════════════
   1. 颜色变量
   ══════════════════════════ */
.chat-app {
  --c-header-bg: #FFFFFF;         /* 标题栏底色 */
  --c-page-body-bg: #FAFAFA;      /* 内容区底色 */

  --c-bubble-self: var(--c-action-blue, #246bfd); /* 我的气泡 */
  --c-bubble-other: #FFFFFF;      /* 对方气泡 */
  --c-card: #FFFFFF;              /* 卡片底色 */
  --c-card-border: #E0E0E0;       /* 卡片边框/分割线 */
  --c-input: #EBEBEB;             /* 输入框底色 */
  --c-input-border: #DADBDF;      /* 输入框边框 */
  --c-text-title: #2C3440;        /* 主要文字 */
  --c-text: #797E85;              /* 次要文字 */
  --c-icon: #A0A3A8;              /* 普通图标 */
  --c-icon-active: #4A4A4A;       /* 强调色 */
}


/* ══════════════════════════
   2. 标题栏（所有页面共享，默认毛玻璃）
   ══════════════════════════ */
/* .page-header = 整个标题栏（含安全区），改背景/毛玻璃用这个 */
/* .page-header-content = 按钮+标题那一行，改 padding/布局用这个 */
.page-header {
  background: color-mix(in srgb, var(--c-header-bg) 75%, transparent);
  backdrop-filter: blur(20px);
  /* 关闭毛玻璃：backdrop-filter: none; background: var(--c-header-bg); */
}

.page-header-content {
  /* padding: 10px 14px; */
  /* gap: 8px; */
}

.page-title,
.page-back-btn {
  color: var(--c-text-title);
}

.page-body {
  background: var(--c-page-body-bg);
}


/* ══════════════════════════
   3. 消息列表页
   ══════════════════════════ */
.chat-search-bar {
  background: var(--c-input);
  border: 1px solid var(--c-input-border);
  border-radius: 12px;
}

.chat-search-input {
  color: var(--c-text-title);
}

.chat-list-tab {
  color: var(--c-text);
}

.chat-list-tab.active {
  color: var(--c-text-title);
  font-weight: 600;
}

/* 消息列表现已采用无边界结构，可调整联系人/对话项 */
.contact-item {
  border-bottom: 0.5px solid var(--c-card-border);
}


/* ══════════════════════════
   4. 联系人页
   ══════════════════════════ */
.chat-contact-name,
.contact-name {
  color: var(--c-text-title);
}

.minimal-avatar-wrapper {
  border-radius: 8px;
}

.contact-letter-header {
  color: var(--c-text);
}


/* ══════════════════════════
   5. 全局交互元件 (按钮、胶囊、卡片)
   ══════════════════════════ */
.ui-btn {
  /* box-shadow: 0 4px 14px ...; */
  /* border-radius: 12px; */
}

/* 无边框胶囊 */
.ui-chip {
  /* background: color-mix(in srgb, var(--c-icon) 15%, transparent); */
}

/* 底部标签栏 */
.chat-tab-bar {
  background: color-mix(in srgb, var(--c-card) 55%, transparent);
  backdrop-filter: blur(20px) saturate(180%);
  border-top: 0.5px solid var(--c-card-border);
}

.chat-tab {
  color: var(--c-icon);
}

.chat-tab-active {
  color: var(--c-icon-active);
}

.chat-tab svg {
  stroke-width: 1.7;
}

.chat-tab-active svg {
  stroke-width: 1.8;
}


/* ══════════════════════════
   6. 聊天室（默认样式，可被单独聊天室 CSS 覆盖）
   ══════════════════════════ */
.chat-room-wrapper {
  background: var(--c-page-body-bg);
}

/* 只改聊天室的标题栏（不影响消息列表、联系人等页面） */
.chat-room-wrapper .page-header {
  /* background: rgba(0,0,0,0.3); */
  /* backdrop-filter: blur(30px); */
}

/* 连续同一人发言：收紧间距（可选项） */
/*
.chat-msg-wrapper[data-consecutive] {
  margin-top: -12px !important;
}
*/
/* 连续同一人发言：隐藏头像（可选项） */
/*
.chat-msg-wrapper[data-consecutive] .chat-msg-avatar {
  opacity: 0;
  pointer-events: none;
}
*/

.chat-bubble-role-user {
  background: var(--c-bubble-self);
  border-radius: 6px;
  padding: 10px 14px;
}

.chat-bubble-role-assistant {
  background: var(--c-bubble-other);
  border-radius: 6px;
  padding: 10px 14px;
}

.chat-bubble-media {
  overflow: visible;
}

/* 系统指令注入卡片 */
.chat-system-instruction-card {
  background: var(--c-card);
  border: 1px solid var(--c-card-border);
  border-radius: 8px;
  box-shadow: var(--chat-bubble-shadow);
}

.chat-system-instruction-title {
  color: var(--c-text-title);
  font-weight: 600;
}

.chat-system-instruction-body {
  color: var(--c-text);
  text-indent: 2em;
}

.chat-input-bar {
  background: color-mix(in srgb, var(--c-input) 55%, transparent);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
}

.chat-offline-toggle.chat-offline-active {
  color: var(--c-text-title);
}

.chat-offline-body {
  padding: 16px 8px 24px;
  gap: 12px;
}

.chat-offline-turn {
  border-radius: 12px;
  background: color-mix(in srgb, var(--c-card) 56%, transparent);
  border: 1px solid color-mix(in srgb, var(--c-card-border) 30%, transparent);
}

.chat-offline-time,
.chat-offline-empty,
.chat-offline-summary-content,
.chat-offline-generating {
  color: var(--c-icon);
}

.chat-offline-label {
  border-radius: 4px;
  font-size: calc(11px*var(--app-text-scale,1));
}

.chat-offline-text {
  color: var(--c-text);
  font-size: calc(14.5px*var(--app-text-scale,1));
  line-height: 1.85;
}

.chat-offline-entry[data-role="assistant"] .chat-offline-text {
  color: var(--c-text-title);
}

.chat-offline-summary-fold {
  background: color-mix(in srgb, var(--c-page-body-bg) 50%, transparent);
  border-radius: 6px;
}


/* ══════════════════════════
   7. 聊天卡片消息
   ══════════════════════════ */
.chat-html-inline,
.chat-music-share-card {
  background: var(--c-card);
  border: 1px solid var(--c-card-border);
  border-radius: 14px;
}

.chat-html-inline-frame {
  max-height: min(36vh, 340px);
}

.chat-thought-card .chat-html-inline-frame,
.chat-status-bare .chat-html-inline-frame {
  max-height: min(52vh, 420px);
}

/* 礼物卡片 */
.chat-gift-card {
  background: #ffffff;
  border: none;
  border-radius: 0;
  overflow: visible;
  /* 不需要阴影可改为：box-shadow: none; */
  box-shadow: 0 1px 4px rgba(0,0,0,0.025);
  margin: 2px 0 4px;
}

.chat-gift-card-body {
  background: #ffffff;
  overflow: visible;
}

.chat-gift-card-status {
  background: rgba(0,0,0,0.055);
  color: var(--c-text-title);
}

.chat-gift-card-title {
  color: var(--c-text-title);
  font-size: calc(24px*var(--app-text-scale,1));
}

.chat-gift-card-divider {
  background: rgba(0,0,0,0.12);
}

.chat-gift-card-footer {
  border-top: 1px solid rgba(0,0,0,0.12);
}

.chat-gift-card-cell-label,
.chat-gift-card-kicker,
.chat-gift-card-label,
.chat-gift-card-brand {
  color: var(--c-icon);
}

.chat-gift-card-cell-value,
.chat-gift-card-source {
  color: var(--c-text);
}

/* 文字照片卡片 */
.chat-photo-card {
  background: #ffffff;
  border: none;
  border-radius: 0;
  overflow: visible;
  /* 不需要阴影可改为：box-shadow: none; */
  box-shadow: 0 1px 4px rgba(0,0,0,0.025);
  margin: 2px 0 4px;
}

.chat-photo-card-placeholder {
  background: #ffffff;
}

.chat-photo-card-text {
  color: var(--c-text-title);
  font-family: Georgia, "Times New Roman", serif;
  font-size: calc(13px*var(--app-text-scale,1));
  font-style: italic;
  line-height: 1.35;
  text-align: center;
}

.chat-photo-card-image {
  background: #ffffff;
}

/* 真实用户上传的图片走 .chat-photo-card--image 修饰类，
   容器自适应图片大小，图片保持原比例不裁切 */
.chat-photo-card--image {
  background: transparent;
  box-shadow: none;
}

.chat-photo-card--image .chat-photo-card-image {
  object-fit: contain;
}

/* 小红书分享卡片 */
.chat-xhs-share-card {
  background: #ffffff;
  border: none;
  border-radius: 8px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.02);
}

.chat-xhs-share-title {
  color: var(--c-text-title);
}

.chat-xhs-share-head,
.chat-xhs-share-author,
.chat-xhs-share-desc {
  color: var(--c-text);
}

.chat-xhs-share-mark {
  background: #ff2442;
  color: #ffffff;
}

.chat-xhs-share-cover {
  border-radius: 6px;
}

.chat-xhs-share-tags span {
  color: #ff2442;
  background: #fff0f3;
}

/* 支付卡片（微信扫码付 / 支付宝等） */
.scan-pay-card {
  background: var(--c-card);
  border: 1px solid var(--c-card-border);
  border-radius: 14px;
}
.scan-pay-title {
  color: var(--c-text-title);
}
.scan-pay-qr {
  border-radius: 8px;
}
.scan-pay-hint {
  color: var(--c-text);
}
.scan-pay-btn {
  border-radius: 999px;
}
.scan-pay-btn-primary {
  background: #07c160; /* 打开微信按钮（默认微信绿） */
  color: #ffffff;
}

/* 自定义 App 卡片（角色用富媒体指令生成的卡片，黑白档案风） */
/* 想整体换个墨色：只改 --cac-ink 一处，标题/数值/黑标签/主按钮会一起变 */
.chat-app-card {
  --cac-ink: #141414;             /* 主墨色：标题 / 数值 / 黑标签 / 主按钮 */
  --cac-ink-soft: #3b3b3b;        /* 正文、过程块文字 */
  --cac-ink-mute: #8c8c8c;        /* App名、副标题等弱化文字 */
  --cac-line: rgba(0,0,0,0.12);   /* 分隔线 / 小标签边框 */
  --cac-dash: rgba(0,0,0,0.30);   /* 区块之间的虚线 */
  background: #ffffff;            /* 卡片底色 */
  border-color: rgba(0,0,0,0.06); /* 卡片描边（想更清晰就把 0.06 调大） */
  /* 想要圆角：加 border-radius: 12px; */
}
/* 标题默认居中大写；不想大写就解开下面这行 */
.chat-app-card-title {
  /* text-transform: none; */
}
/* 只想给「黑标签 + 主按钮」单独换个彩色（正文仍保持墨色）就改这两处 */
.chat-app-card-section-title {
  background: var(--cac-ink);
  color: #ffffff;
}
.chat-app-card-actions button:last-child:not([data-style="danger"]) {
  background: var(--cac-ink);
  color: #ffffff;
}


/* ══════════════════════════
   8. 动态页（朋友圈）
   ══════════════════════════ */
.chat-app .moments-feed-page > .page-body {
  background: var(--c-page-body-bg);
}

.moments-feed-page:not(.is-scrolled) .page-header {
  background: transparent;
  backdrop-filter: none;
  border-bottom-color: transparent;
}

.feed-cover-shell {
  margin-bottom: 16px;
}

.feed-cover-bg {
  background: var(--c-input);
}

.feed-cover-image {
  object-fit: cover;
}

.feed-profile {
  /* padding-top 控制头像与封面顶部距离，通常需要保留标题栏安全区 */
}

.feed-profile-avatar {
  border-color: var(--c-page-body-bg);
  background: var(--c-input);
}

.feed-profile-name {
  color: var(--c-text-title);
}

.feed-profile-stats,
.feed-profile-signature-text {
  color: var(--c-text);
}

.feed-profile-stat-value {
  color: var(--c-text-title);
}

.feed-notif-banner {
  background: color-mix(in srgb, var(--c-icon-active) 12%, var(--c-card));
  color: var(--c-icon-active);
}

.feed-post {
  background: transparent;
  /* background: var(--c-card); */
  border-color: var(--c-card-border);
}

.feed-post-author-name,
.feed-post-content {
  color: var(--c-text-title);
}

.feed-post-location {
  color: var(--c-icon);
}

.feed-post-like-btn,
.feed-post-comment-btn,
.feed-post-delete-btn {
  color: var(--c-icon-active);
}

.feed-like-summary {
  color: var(--c-text-title);
}

.feed-like-summary-icon {
  color: var(--c-icon);
}

.feed-comments {
  gap: 4px;
}

.feed-comment-avatar-root {
  width: 32px;
  height: 32px;
}

.feed-comment-avatar-child {
  width: 22px;
  height: 22px;
}

.feed-comment-author,
.feed-comment-reply-target {
  color: var(--c-text);
  opacity: 0.7;
}

.feed-comment-body,
.feed-comment-reply-prefix,
.feed-comment-reply-button {
  color: var(--c-text-title);
}

.feed-comment-time {
  color: var(--c-icon);
}

.feed-comment-replies {
  padding-left: 40px;
}

.feed-comment-input {
  background: var(--c-input);
}

.feed-comment-input-field {
  color: var(--c-text);
}

.feed-comment-input-send {
  color: var(--c-icon-active);
}

.feed-inline-translation-toggle {
  color: var(--c-icon-active);
}

.feed-inline-translation {
  color: var(--c-text-title);
}


/* ══════════════════════════
   9. 高级：自定义字体
   ══════════════════════════ */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* .chat-app { font-family: "ZCOOL KuaiLe", sans-serif; } */
`;

export const STORY_CSS_EXAMPLE = `/* ═══ 剧情模式样式示例 ═══ */
/* 此 CSS 仅作用于当前剧情会话 */

/* ══ 颜色变量 ══ */
:root {
  /* ── 页面背景 ── */
  --c-story-bg-top: #fafafa;         /* 顶部渐变色 */
  --c-story-bg-mid: #f5f5f5;         /* 中间渐变色 */
  --c-story-bg-bottom: #f0f0f0;      /* 底部渐变色 */
  --c-story-text: #3a3b3c;           /* 正文颜色 */
  --c-story-text-light: #64748b;     /* 次要文字 */
  --c-story-heading: #1e293b;        /* 标题颜色 */
  --c-story-sub: #94a3b8;            /* 辅助文字 */

  /* ── 气泡 ── */
  --c-story-bubble-bg: rgba(255,255,255,0.8);   /* AI气泡背景 */
  --c-story-bubble-border: rgba(0,0,0,0.06);    /* AI气泡边框 */
  --c-story-bubble-user: rgba(0,0,0,0.04);      /* 用户气泡背景 */
  --c-story-text-user: #1e293b;                  /* 用户气泡文字 */

  /* ── 装饰 ── */
  --c-story-ornament: rgba(148,163,184,0.15);    /* 装饰元素 */
  --c-story-ornament-soft: rgba(148,163,184,0.08);
  --c-story-accent: #64748b;                     /* 强调色 */
  --c-story-accent-light: #e2e8f0;               /* 浅强调色 */

  /* ── 输入区 ── */
  --c-story-input-bar: rgba(255,255,255,0.9);    /* 输入栏背景 */
  --c-story-input-bar-focus: rgba(255,255,255,0.95);
  --c-story-input-border: rgba(0,0,0,0.08);      /* 输入栏外框边缘 */
  --c-story-input-inner: rgba(248,250,252,0.78); /* 内层文字输入框 */
  --c-story-input-inner-focus: rgba(248,250,252,0.94);
  --c-story-send-bg-active: #0f172a;              /* 发送按钮激活 */
  --c-story-send-color: #64748b;                  /* 发送按钮颜色 */

  /* ── 按钮/面板 ── */
  --c-story-btn-bg: rgba(255,255,255,0.5);       /* 按钮背景 */
  --c-story-btn-border: rgba(0,0,0,0.08);        /* 按钮边框 */
  --c-story-panel: rgba(248,250,252,0.95);        /* 面板背景 */
  --c-story-panel-active: rgba(241,245,249,0.8);
  --c-story-panel-border: rgba(0,0,0,0.06);

  /* ── 抽屉/侧栏 ── */
  --c-story-drawer-top: #f8fafc;                  /* 抽屉顶部 */
  --c-story-drawer-bottom: #f1f5f9;               /* 抽屉底部 */
  --c-story-drawer-border: rgba(0,0,0,0.06);

  /* ── 代码块 ── */
  --c-story-code-bg: rgba(248,250,252,0.8);
  --c-story-code-color: #334155;

  /* ── 其他 ── */
  --c-story-fold-bg: rgba(248,250,252,0.6);       /* 折叠块背景 */
  --c-story-meta-bg: rgba(255,255,255,0.8);       /* 元数据卡片背景 */
  --c-story-meta-border: rgba(0,0,0,0.06);
  --c-story-cover-bg: #f1f5f9;                    /* 封面背景 */
  --c-story-cover-border: #fff;                   /* 封面边框 */
  --c-story-placeholder: #94a3b8;                 /* 占位符颜色 */
  --c-story-quote: #475569;                       /* 引用颜色 */
  --c-story-quote-bg: rgba(248,250,252,0.5);      /* 引用背景 */
  --c-story-table-header-bg: rgba(248,250,252,0.8); /* 表头背景 */
  --c-story-bold-highlight: rgba(148,163,184,0.2);  /* 加粗下划高亮 */
  --c-story-overlay: rgba(0,0,0,0.2);             /* 遮罩层 */
  --c-story-css-box-bg: rgba(248,250,252,0.6);    /* CSS编辑框背景 */
  --story-font: serif;                            /* 剧情字体 */
}

/* ══ 页面整体 ══ */
.story-app-shell {
  /* background: linear-gradient(160deg, var(--c-story-bg-top), var(--c-story-bg-mid), var(--c-story-bg-bottom)); */
  /* color: var(--c-story-text); */
}
.story-app-shell::before,
.story-app-shell::after {
  /* 装饰光晕 */
  /* background: radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%); */
}

/* ══ 顶部标题栏 ══ */
/* .story-header = 整个标题栏（含安全区），改背景用这个 */
/* .story-header-content = 按钮+标题那一行，改 padding/布局用这个 */
.story-header {
  /* background: linear-gradient(180deg, var(--c-story-bg-top) 60%, transparent); */
}
.story-header-content {
  /* padding: 0 20px 14px; */
}
.story-header-center {
  /* color: var(--c-story-sub); */
  /* font-size: calc(12px*var(--app-text-scale,1)); */
}
.story-top-btn {
  /* border: 1px solid var(--c-story-btn-border); */
  /* background: var(--c-story-btn-bg); */
  /* color: var(--c-story-text); */
  /* border-radius: 10px; */
}

/* ══ 可选：悬浮透明标题栏模板 ══ */
/* 使用时取消下面整段注释。不要覆盖 .story-app-shell 的 position。 */
/*
:root {
  --story-floating-header-height: 102px;
}

.story-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  width: auto;
  min-height: var(--story-floating-header-height);
  padding: 52px 20px 14px;
  box-sizing: border-box;
  z-index: 100;

  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;

  background: rgba(255,255,255,0.45);
  -webkit-backdrop-filter: blur(16px) saturate(120%);
  backdrop-filter: blur(16px) saturate(120%);
  border-bottom: 1px solid rgba(255,255,255,0.35);
}

.story-header-left {
  justify-content: flex-start;
}

.story-header-right {
  justify-content: flex-end;
  gap: 8px;
}

.story-stage {
  padding-top: calc(var(--story-floating-header-height) + 12px);
}

.story-row:first-of-type {
  margin-top: 0;
}
*/

/* ══ 消息行 ══ */
.story-row {
  /* padding: 4px 16px; */
}
.story-row[data-role="assistant"] .story-bubble {
  /* background: var(--c-story-bubble-bg); */
  /* border: 1px solid var(--c-story-bubble-border); */
  /* border-radius: 12px; */
}
.story-row[data-role="user"] .story-bubble {
  /* background: var(--c-story-bubble-user); */
  /* border-radius: 12px; */
  /* color: var(--c-story-text-user); */
}

/* ══ 气泡头部 (角色名 + 时间) ══ */
.story-bubble-head {
  /* font-size: calc(11px*var(--app-text-scale,1)); */
  /* color: var(--c-story-sub); */
}

/* ══ 头像 ══ */
.story-avatar-wrap {
  /* width: 36px; height: 36px; */
  /* border-radius: 50%; */
}

/* ══ 富文本内容 ══ */
.story-richtext {
  /* font-family: var(--story-font); */
  /* font-size: calc(15px*var(--app-text-scale,1)); */
  /* line-height: 1.8; */
  /* color: var(--c-story-text); */
}
.story-richtext strong {
  /* color: var(--c-story-heading); */
  /* background: linear-gradient(transparent 65%, var(--c-story-ornament) 65%); */
}
.story-richtext em, .story-richtext i {
  /* font-family: var(--story-font); */
  /* color: var(--c-story-text-light); */
}
.story-richtext blockquote {
  /* border-left: 2px solid var(--c-story-accent-light); */
  /* color: var(--c-story-quote); */
  /* font-family: var(--story-font); */
}
.story-richtext :is(h1,h2,h3,h4) {
  /* font-family: var(--story-font); */
  /* color: var(--c-story-heading); */
}
.story-richtext h2 {
  /* text-align: center; */  /* 章节标题居中 */
}
.story-richtext hr {
  /* border-color: var(--c-story-ornament); */
}
.story-richtext code {
  /* background: var(--c-story-code-bg); */
  /* color: var(--c-story-code-color); */
}
.story-richtext pre {
  /* background: var(--c-story-code-bg); */
  /* border-radius: 8px; */
}
.story-richtext img {
  /* border-radius: 8px; */
  /* max-width: 100%; */
}
.story-richtext table {
  /* border-color: var(--c-story-ornament); */
}

/* ══ 折叠块 (thinking/summary) ══ */
.story-fold-block {
  /* background: var(--c-story-fold-bg); */
  /* border-radius: 8px; */
}
.story-summary-fold {
  /* background: var(--c-story-fold-bg); */
  /* border-radius: 8px; */
}

/* ══ 底部输入区：外框 + 内层输入框 + 发送按钮 ══ */
.story-composer {
  /* background: var(--c-story-input-bar); */       /* 外层框背景 */
  /* border-color: var(--c-story-input-border); */  /* 外层框边缘 */
  /* border-radius: 18px; */
  /* padding: 6px; */
  /* box-shadow: 0 3px 8px rgba(0,0,0,0.02); */
}
.story-composer textarea {
  /* background: var(--c-story-input-inner); */      /* 内层文字框背景 */
  /* color: var(--c-story-text); */
  /* border-radius: 13px; */
  /* box-shadow: none; */
}
.story-composer:focus-within textarea {
  /* background: var(--c-story-input-inner-focus); */
}
.story-send-btn {
  /* background: linear-gradient(145deg, color-mix(in srgb, var(--c-story-send-bg-active) 88%, #64748b), var(--c-story-send-bg-active)); */
  /* color: var(--c-story-send-color); */
  /* border-radius: 12px; */
}

/* ══ 侧栏抽屉 (角色选择/设置) ══ */
.story-drawer {
  /* background: linear-gradient(var(--c-story-drawer-top), var(--c-story-drawer-bottom)); */
}
.story-drawer-overlay {
  /* background: rgba(0,0,0,0.3); */
}
.story-drawer-section {
  /* border-bottom: 1px solid var(--c-story-drawer-border); */
}
.story-drawer-eyebrow {
  /* color: var(--c-story-sub); */
  /* font-size: calc(11px*var(--app-text-scale,1)); */
}
.story-character-chip {
  /* border-radius: 10px; */
  /* background: var(--c-story-panel); */
}

/* ══ 元数据卡片 (封面/简介) ══ */
.story-meta {
  /* background: var(--c-story-meta-bg); */
  /* border: 1px solid var(--c-story-meta-border); */
  /* border-radius: 16px; */
}
.story-meta-title {
  /* font-family: var(--story-font); */
  /* color: var(--c-story-heading); */
}
.story-meta-desc {
  /* font-family: var(--story-font); */
  /* color: var(--c-story-text-light); */
}
.story-meta-cover {
  /* background: var(--c-story-cover-bg); */
  /* border-radius: 12px; */
}
.story-meta-tags {
  /* gap: 6px; */
}

/* ══ 空状态 ══ */
.story-empty {
  /* color: var(--c-story-placeholder); */
}

/* ══ 右键菜单 ══ */
.story-ctx-menu {
  /* background: var(--c-story-panel); */
  /* border-radius: 10px; */
}
.story-ctx-btn {
  /* color: var(--c-story-text); */
}
.story-ctx-btn-danger {
  /* color: var(--c-danger); */
}

/* ══ 内联编辑 ══ */
.story-inline-edit {
  /* background: var(--c-story-input-bar); */
  /* border-radius: 8px; */
}
.story-inline-edit-btn-save {
  /* background: var(--c-story-send-bg-active); */
  /* color: white; */
}

/* ══ 设置行 ══ */
.story-pref-row {
  /* padding: 10px 0; */
}

/* ══ CSS 编辑框 ══ */
.story-css-box {
  /* font-family: monospace; */
  /* background: var(--c-story-code-bg); */
}
`;


export const VN_CSS_EXAMPLE = `/* ═══ 漫卷模式(VN)样式示例 ═══ */
/* 所有颜色已变量化，改变量即可全局换色 */
/* 变量定义在 [data-vn-theme] 中，这里覆盖即可 */

/* ══ 全部颜色变量（覆盖当前主题） ══ */
[data-vn-theme] {
  /* ── 页面 ── */
  /* --vn-bg: #08060e; */                          /* 页面背景 */
  /* --vn-font: "PingFang SC", system-ui; */       /* 字体 */

  /* ── 对话框 ── */
  /* --vn-box-bg: rgba(10, 8, 20, 0.75); */       /* 对话框背景 */
  /* --vn-box-border: rgba(255, 255, 255, 0.15); */ /* 对话框边框 */
  /* --vn-box-radius: 2px; */                      /* 对话框圆角 */
  /* --vn-box-glow: 0 0 20px rgba(180,160,220,0.1); */ /* 对话框光晕 */

  /* ── 名牌 ── */
  /* --vn-name-bg: rgba(10, 8, 20, 0.75); */      /* 名牌背景 */
  /* --vn-name-color: #ddd6e8; */                  /* 名牌文字 */
  /* --vn-name-border: rgba(255, 255, 255, 0.1); */ /* 名牌边框 */

  /* ── 对话文字 ── */
  /* --vn-text-color: rgba(255, 255, 255, 0.9); */ /* 对话文字 */
  /* --vn-text-shadow: 0 1px 3px rgba(0,0,0,0.5); */ /* 文字阴影 */
  /* --vn-text-size: 15px; */                      /* 对话字号 */
  /* --vn-narration-color: rgba(200,190,220,0.8); */ /* 旁白色 */

  /* ── 控制按钮 ── */
  /* --vn-control-bg: rgba(0, 0, 0, 0.3); */      /* 按钮背景 */
  /* --vn-control-color: rgba(255,255,255,0.6); */ /* 按钮图标 */
  /* --vn-control-active: rgba(255,255,255,0.9); */ /* 按钮激活 */

  /* ── UI面板/弹窗 ── */
  /* --vn-ui-panel: rgba(10, 8, 20, 0.88); */     /* 面板背景 */
  /* --vn-ui-border: rgba(255,255,255,0.08); */    /* 边框 */
  /* --vn-ui-text: rgba(255,255,255,0.65); */      /* 主文字 */
  /* --vn-ui-text-dim: rgba(255,255,255,0.3); */   /* 次要文字 */
  /* --vn-ui-text-bright: rgba(255,255,255,0.85); */ /* 高亮文字 */
  /* --vn-ui-accent: rgba(180,165,220,0.85); */    /* 强调色 */
  /* --vn-ui-accent-dim: rgba(180,165,220,0.25); */ /* 淡强调 */
  /* --vn-ui-accent-bg: rgba(180,165,220,0.06); */ /* 强调背景 */
  /* --vn-ui-input: rgba(255,255,255,0.04); */     /* 输入框背景 */
  /* --vn-ui-input-border: rgba(255,255,255,0.1); */ /* 输入框边框 */
  /* --vn-ui-input-text: rgba(255,255,255,0.8); */ /* 输入框文字 */
  /* --vn-ui-overlay: rgba(0, 0, 0, 0.35); */     /* 遮罩 */
  /* --vn-ui-danger: rgba(220,90,75,0.8); */       /* 危险色 */
  /* --vn-ui-success: rgba(90,180,130,0.7); */     /* 成功色 */

  /* ── 标签 ── */
  /* --vn-tag-dialogue: rgba(130,190,160,0.65); */ /* 对话标签 */
  /* --vn-tag-narration: rgba(180,165,220,0.65); */ /* 旁白标签 */
  /* --vn-tag-scene: rgba(150,175,210,0.65); */    /* 场景标签 */

  /* ── 滑动条 ── */
  /* --vn-slider-track: rgba(255,255,255,0.12); */ /* 滑轨 */
  /* --vn-slider-thumb: rgba(180,165,220,0.85); */ /* 滑块 */
}

/* ══ 对话框 ══ */
.vn-dialogue-inner {
  /* background: var(--vn-box-bg); */
  /* border: 1px solid var(--vn-box-border); */
  /* border-radius: var(--vn-box-radius); */
  /* backdrop-filter: blur(10px); */
}

/* ══ 名牌 ══ */
.vn-name {
  /* background: var(--vn-name-bg); */
  /* color: var(--vn-name-color); */
  /* letter-spacing: 0.1em; */
}

/* ══ 对话文字 ══ */
.vn-text {
  /* font-size: var(--vn-text-size); */
  /* color: var(--vn-text-color); */
  /* line-height: 1.9; */
}
.vn-text-narration {
  /* color: var(--vn-narration-color); */
}

/* ══ 控制按钮 ══ */
.vn-ctrl-btn {
  /* background: var(--vn-control-bg); */
  /* color: var(--vn-control-color); */
}
.vn-topbar-btn {
  /* color: var(--vn-control-color); */
}

/* ══ 输入区 ══ */
.vn-input-field {
  /* background: var(--vn-ui-input); */
  /* border: 1px solid var(--vn-ui-input-border); */
  /* color: var(--vn-ui-input-text); */
}
.vn-send-btn {
  /* background: var(--vn-ui-input-border); */
  /* color: var(--vn-ui-text); */
}
.vn-mode-btn {
  /* border: 1px solid var(--vn-ui-input-border); */
  /* color: var(--vn-ui-text-dim); */
}

/* ══ 选项（选择肢） ══ */
.vn-option-btn {
  /* border: 1px solid var(--vn-ui-input-border); */
  /* background: var(--vn-ui-input); */
  /* color: var(--vn-text-color); */
}

/* ══ 面板（历史/节拍/场景） ══ */
.vn-history-panel,
.vn-beats-panel,
.vn-scene-picker {
  /* background: var(--vn-ui-panel); */
  /* border-left: 1px solid var(--vn-ui-border); */
}
.vn-history-speaker { /* color: var(--vn-ui-accent); */ }
.vn-history-text { /* color: var(--vn-ui-text); */ }

/* ══ 节拍 ══ */
.vn-beat-item {
  /* border: 1px solid var(--vn-ui-input); */
}
.vn-beat-item[data-active="true"] {
  /* border-color: var(--vn-ui-accent-dim); */
  /* background: var(--vn-ui-accent-bg); */
}
.vn-beat-name { /* color: var(--vn-ui-text); */ }

/* ══ 右键菜单 ══ */
.vn-ctx-menu {
  /* background: var(--vn-ui-panel); */
}
.vn-ctx-btn { /* color: var(--vn-ui-text); */ }
.vn-ctx-btn-danger { /* color: var(--vn-ui-danger); */ }

/* ══ 结局画面 ══ */
.vn-end {
  /* background: var(--vn-ui-overlay); */
}
.vn-end-text { /* color: var(--vn-ui-text-dim); */ }
.vn-end-btn {
  /* border: 1px solid var(--vn-ui-border); */
  /* color: var(--vn-ui-text); */
}

/* ══ 滑动条（布局面板中） ══ */
.vn-shell .ui-slider {
  /* background: var(--vn-slider-track); */
}
.vn-shell .ui-slider::-webkit-slider-thumb {
  /* background: var(--vn-slider-thumb); */
}
.vn-shell .ui-slider-label {
  /* color: var(--vn-ui-text); */
}
.vn-shell .ui-slider-value {
  /* color: var(--vn-ui-text-dim); */
}

/* ═══════════════════════════════
   选人页面 (.vns-*)
   ═══════════════════════════════ */

/* ══ 选人页整体 ══ */
.vns-shell {
  /* background: var(--vn-bg); */
}

/* ══ 顶栏 ══ */
.vns-topbar {
  /* padding: 52px 16px 12px; */
}
.vns-back {
  /* color: var(--vn-control-color); */
}
.vns-title {
  /* color: var(--vn-ui-text-dim); */
  /* letter-spacing: 0.25em; */
}

/* ══ 角色卡片条 ══ */
.vns-strips {
  /* gap: 4px; */
  /* padding: 80px 16px 20px; */
}
.vns-strip {
  /* width: 72px; */
  /* height: 55%; */
  /* border: 1px solid var(--vn-ui-border); */
}
.vns-strip[data-active="true"] {
  /* width: min(220px, 50vw); */
  /* border-color: var(--vn-ui-accent-dim); */
  /* box-shadow: 0 0 20px var(--vn-ui-accent-bg); */
}

/* ══ 角色卡片背景滤镜 ══ */
.vns-strip:not([data-active="true"]) .vns-strip-bg {
  /* filter: brightness(0.4) saturate(0.6); */  /* 深色主题 */
  /* filter: brightness(0.85) saturate(0.8); */ /* 浅色主题 */
}
.vns-strip[data-active="true"] .vns-strip-bg {
  /* filter: brightness(0.7) saturate(0.9); */  /* 深色主题 */
  /* filter: brightness(1) saturate(1); */      /* 浅色主题 */
}

/* ══ 角色名/副标题 ══ */
.vns-strip-name {
  /* color: rgba(255,255,255,0.9); */
  /* font-size: calc(16px*var(--app-text-scale,1)); */
}
.vns-strip-sub {
  /* color: rgba(255,255,255,0.45); */
}

/* ══ 进入按钮 ══ */
.vns-enter {
  /* border: 1px solid var(--vn-ui-accent-dim); */
  /* background: var(--vn-ui-accent-bg); */
  /* color: var(--vn-ui-text-bright); */
  /* border-radius: 24px; */
}

/* ══ 空状态 ══ */
.vns-empty {
  /* color: var(--vn-ui-text-dim); */
}

/* ══ 装饰光晕 ══ */
.vns-shell::before,
.vns-shell::after {
  /* opacity: 0; */  /* 隐藏装饰 */
}

/* ═══════════════════════════════
   星图页面 (.vnc-*)
   ═══════════════════════════════ */

/* ══ 星图页整体 ══ */
.vnc-shell {
  /* background: var(--vn-bg); */
}

/* ══ 顶栏 ══ */
.vnc-btn {
  /* color: var(--vn-control-color); */
}
.vnc-char-name {
  /* color: var(--vn-ui-text); */
  /* letter-spacing: 0.12em; */
}
.vnc-char-sub {
  /* color: var(--vn-ui-text-dim); */
}

/* ══ 星图路径 ══ */
.vnc-path {
  /* stroke: var(--vn-ui-accent-dim); */
}
.vnc-path-glow {
  /* stroke: var(--vn-ui-border); */
}

/* ══ 星点节点 ══ */
.vnc-star-ring {
  /* border: 1px solid var(--vn-ui-border); */
}
.vnc-star-ray {
  /* background: linear-gradient(90deg, transparent, var(--vn-ui-accent-dim), transparent); */
}

/* ══ 章节标题 ══ */
.vnc-chapter-title {
  /* color: var(--vn-ui-text-bright); */
  /* letter-spacing: 0.1em; */
}
.vnc-chapter-sub {
  /* color: var(--vn-ui-text-dim); */
}

/* ══ 操作按钮（播放/归档） ══ */
.vnc-action-btn {
  /* border: 1px solid var(--vn-ui-border); */
  /* background: var(--vn-ui-input); */
  /* color: var(--vn-ui-text-dim); */
}

/* ══ 新建章节 ══ */
.vnc-new {
  /* color: var(--vn-ui-text-dim); */
}
.vnc-new-dot {
  /* border: 1px dashed var(--vn-ui-border); */
}

/* ══ 星图装饰（星空粒子/星云） ══ */
.vnc-shell::before,
.vnc-shell::after {
  /* opacity: 0; */  /* 隐藏星空装饰 */
}
`;

export const CALENDAR_CSS_EXAMPLE = `/* ══════════════════════════════════════════
   日历页面自定义样式 — 焦糖奶茶主题
   修改后点击「应用」即刻生效
   清空全部内容应用即恢复默认
   ══════════════════════════════════════════ */

/* ━━ 全部色彩变量 ━━ */
.calendar-app-shell {
  /* 页面底色 / 灰色块 / 弹层底色 */
  --c-calendar-bg: #F7F0E6;
  --c-calendar-surface: #EDE2D2;
  --c-calendar-surface-2: #E2D4BF;
  --c-calendar-sheet: #FFFBF4;
  /* 文字三级 */
  --c-calendar-ink: #453425;
  --c-calendar-sub: #94816C;
  --c-calendar-faint: #C8B8A2;
  /* 今天强调色 */
  --c-calendar-today: #C96F2E;
  /* 选中态色块 */
  --c-calendar-sel-bg: #453425;
  --c-calendar-sel-fg: #FFF9F0;
  /* 弹层遮罩 */
  --c-calendar-scrim: rgba(69, 52, 37, 0.35);

  /* 事件色板（每色一对：浅底 bg + 深字 fg） */
  --c-calendar-ev-blue-bg: #D8E6EE;   --c-calendar-ev-blue-fg: #35617C;
  --c-calendar-ev-green-bg: #DEEBD2;  --c-calendar-ev-green-fg: #4C6B35;
  --c-calendar-ev-amber-bg: #F6E3C5;  --c-calendar-ev-amber-fg: #96601C;
  --c-calendar-ev-rose-bg: #F4DCDC;   --c-calendar-ev-rose-fg: #A04A4E;
  --c-calendar-ev-violet-bg: #E5DEEC; --c-calendar-ev-violet-fg: #6A5390;
  --c-calendar-ev-teal-bg: #D6EAE4;   --c-calendar-ev-teal-fg: #2F6E5F;
  --c-calendar-ev-slate-bg: #E5E1DA;  --c-calendar-ev-slate-fg: #5C574E;
  --c-calendar-ev-lilac-bg: #EEDFEC;  --c-calendar-ev-lilac-fg: #8A4E80;
}

/* ━━ 顶栏 / 悬浮按钮 ━━ */
.calendar-pill-btn,
.calendar-icon-btn {
  /* border-radius: 12px; */
}
.calendar-fab-primary {
  /* background: var(--c-calendar-today); */
}

/* ━━ 主人切换条 ━━ */
.calendar-owner-chip {
  /* border-radius: 12px; */
}

/* ━━ 整页月历 ━━ */
.calendar-month-title strong {
  /* font-family: Georgia, "Songti SC", serif; */
}
.calendar-month-num {
  /* font-weight: 700; */
}
.calendar-month-lunar {
  /* display: none; */  /* 隐藏农历小字 */
}
.calendar-month-week {
  /* border-top: none; */  /* 去掉周分隔线 */
}

/* ━━ 详情页周条 ━━ */
.calendar-strip-bubble {
  /* border-radius: 14px; */  /* 方圆选中块 */
}
.calendar-strip-range {
  /* background: var(--c-calendar-ev-blue-bg); */
}

/* ━━ 双日时间轴 ━━ */
.calendar-tl-event {
  /* border-radius: 10px; */
  /* border-left-width: 5px; */
}
.calendar-tl-event span {
  /* display: none; */  /* 只显示标题行 */
}
.calendar-tl-headrow {
  /* background: var(--c-calendar-surface); */  /* 列头版头行底色 */
}
.calendar-tl-day-head b {
  /* color: var(--c-calendar-sub); */  /* 列头日期文字 */
}

/* ━━ 经期打卡行 ━━ */
.calendar-cycle-line {
  /* border-bottom: none; */
}
.calendar-mini-btn[data-variant="primary"] {
  /* background: var(--c-calendar-ev-violet-bg); color: var(--c-calendar-ev-violet-fg); */
}

/* ━━ 弹窗 ━━ */
.calendar-edit-modal {
  /* border-radius: 24px; */
}`;

export const MUSIC_CSS_EXAMPLE = `/* ══════════════════════════════════════════
   音乐页面自定义样式 — 极光紫夜主题
   （适配「夜光 Lumen」新版界面）
   修改后点击「保存」即刻生效
   清空全部内容保存即恢复默认
   ══════════════════════════════════════════ */

/* ━━ 全部色彩变量 ━━
   注：桌面悬浮球(.music-float)与聊天小窗(.mini-app-window)
   已独立为浅色配色，不受这里的变量影响 */
.music-app,
.music-player {
  /* 页面底色 */
  --c-music-bg: #0c0a1a;
  /* 背景渐变 · 5 层 */
  --c-music-bg-mint: rgba(100, 60, 220, 0.35);
  --c-music-bg-cream: rgba(180, 80, 200, 0.2);
  --c-music-bg-lime: rgba(60, 120, 255, 0.2);
  --c-music-bg-mint-dim: rgba(80, 40, 180, 0.25);
  --c-music-bg-center: rgba(60, 40, 200, 0.3);
  /* 全屏播放器背景光 */
  --c-music-bg-glow: rgba(140, 80, 255, 0.15);
  --c-music-bg-mist: rgba(80, 40, 160, 0.15);
  /* 玻璃面板 / 边框 / 不透明弹窗 / 极淡装饰 */
  --c-music-surface: rgba(255, 255, 255, 0.06);
  --c-music-surface-solid: rgba(255, 255, 255, 0.12);
  --c-music-panel: rgba(26, 20, 46, 0.96);
  --c-music-glass-dim: rgba(255, 255, 255, 0.06);
  /* 文字 / 次级文字 / 纯白 */
  --c-music-white: #ffffff;
  --c-music-text: #e0d8f0;
  --c-music-accent: #b49de8;
  --c-music-accent-dim: rgba(180, 157, 232, 0.12);
  /* 主强调色（红心/播放全部/榜单序号） */
  --c-music-primary: #c86bff;
  --c-music-primary-dim: rgba(200, 107, 255, 0.14);
  /* 发光歌词月光色 / 光晕 / 遮罩 / 红心 */
  --c-music-glowtext: #ead8ff;
  --c-music-gold: rgba(210, 170, 255, 0.4);
  --c-music-overlay: rgba(0, 0, 0, 0.5);
  --c-music-liked: #ff5c8a;
}

/* ━━ 页面整体 ━━ */
.music-app {
  /* 提示：想换背景图请优先用「设置→App页面背景」，
     也可在这里强行覆盖： */
  /* background-image: linear-gradient(135deg, #0c0a1a, #1a1030) !important; */
}

/* ━━ 底部区域（Tab栏+播放条 同一块玻璃） ━━ */
.music-bottom-dock {
  background: rgba(16, 10, 30, 0.45);
  backdrop-filter: blur(28px) saturate(160%);
}
.music-tabbar-item {
  font-size: calc(9.9px*var(--app-text-scale,1));
}
.music-tabbar-item[data-active] svg {
  /* 选中Tab图标发光色 */
  color: var(--c-music-primary);
  filter: drop-shadow(0 0 6px rgba(200, 107, 255, 0.5));
}
.music-now-bar-title {
  font-size: calc(11.7px*var(--app-text-scale,1));
}
/* 小鸟装饰 */
.music-bird {
  /* opacity: 0; */ /* 隐藏小鸟 */
  /* filter: hue-rotate(180deg); */ /* 变色 */
}

/* ━━ 首页 ━━ */
.music-greet-hello {
  font-size: calc(19.8px*var(--app-text-scale,1));
  letter-spacing: 0.02em;
}
.music-search-pill {
  border-radius: 12px;
}
.music-daily-card {
  border-radius: 18px;
  /* height: 128px; */
}
.music-daily-title {
  font-size: calc(16.2px*var(--app-text-scale,1));
}
.music-rail-cover {
  border-radius: 14px;
}
.music-rail-count {
  /* 播放量角标 */
  background: rgba(20, 8, 40, 0.5);
}
.music-chart-card {
  border-radius: 16px;
  background: var(--c-music-surface);
  border: 1px solid var(--c-music-surface-solid);
}
.music-chart-track em {
  /* 榜单前三序号颜色 */
  color: var(--c-music-primary);
}
.music-hot-rank[data-top] {
  color: var(--c-music-primary);
}

/* ━━ 歌曲列表（扁平行） ━━ */
.music-song {
  border-radius: 14px;
  padding: 10px 10px;
}
.music-song-title {
  font-size: calc(13.5px*var(--app-text-scale,1));
  letter-spacing: 0.3px;
}
.music-song-artist {
  font-size: calc(11px*var(--app-text-scale,1));
}
/* 正在播放行 */
.music-song[data-playing] {
  background: var(--c-music-primary-dim);
}
.music-song[data-playing] .music-song-title {
  color: var(--c-music-primary);
}

/* ━━ 歌单详情 ━━ */
.music-pl-hero-cover {
  border-radius: 16px;
}
.music-pl-hero-name {
  font-size: calc(14.4px*var(--app-text-scale,1));
}
.music-pl-hero-tags span {
  /* 标签胶囊 */
}
.music-playlist-play-all {
  /* 播放全部按钮渐变 */
  background: linear-gradient(120deg, #a44bff, #ff5cd0);
  box-shadow: 0 8px 20px rgba(180, 80, 255, 0.3);
}
.music-pl-chip {
  /* 收藏/评论胶囊 */
  border-radius: 999px;
}

/* ━━ 全屏播放页（现代封面态） ━━ */
/* 封面取色光斑：想固定颜色可强制覆盖 */
.mp-blob-1 { /* background: rgba(140, 80, 255, 0.5) !important; */ }
.mp-blob-2 { /* background: rgba(255, 92, 208, 0.35) !important; */ }
.mp-blob-3 { /* background: rgba(60, 120, 255, 0.3) !important; */ }
.mp-cover {
  border-radius: 24px;
  /* max-width: 276px; */
}
.mp-song {
  font-size: calc(17px*var(--app-text-scale,1));
}
.mp-lyric-peek {
  /* 封面态底部歌词预览行 */
}

/* ━━ 发光歌词 ━━ */
.mp-lyric-line {
  font-size: calc(15.3px*var(--app-text-scale,1));
  letter-spacing: 0.08em;
}
.mp-lyric-line[data-active] {
  font-size: calc(18.9px*var(--app-text-scale,1));
  /* 发光颜色（三层光晕） */
  text-shadow:
    0 0 10px rgba(240, 220, 255, 0.9),
    0 0 30px rgba(200, 140, 255, 0.6),
    0 0 66px rgba(160, 80, 255, 0.35);
}

/* ━━ 波形进度条 ━━ */
.mp-wave i {
  /* 未播放波形 */
  background: rgba(200, 170, 255, 0.18);
}
.mp-wave i[data-lit] {
  /* 已播放波形 */
  background: rgba(240, 220, 255, 0.85);
  box-shadow: 0 0 6px rgba(220, 180, 255, 0.7);
}
.mp-wave i[data-head] {
  /* 播放头 */
  box-shadow: 0 0 10px rgba(240, 220, 255, 0.95), 0 0 20px rgba(200, 120, 255, 0.7);
}

/* ━━ 播放控制 ━━ */
.mp-ctrl-play {
  width: 64px;
  height: 64px;
  /* background: #fff; color: #1a1030; */
  box-shadow: 0 10px 30px rgba(200, 140, 255, 0.2);
}
.mp-social-btn {
  /* 喜欢/评论/分享胶囊 */
  border-radius: 999px;
}
.mp-social-btn[data-liked] {
  color: var(--c-music-liked);
}

/* ━━ 黑胶模式（右上角圆盘按钮切换） ━━ */
.music-player-vinyl {
  /* width: 240px; height: 240px; */
}
.music-player-vinyl-glow {
  /* 唱片背后的光晕 */
  background: radial-gradient(circle,
    rgba(180, 120, 255, 0.35) 0%, transparent 60%);
}
.music-player-tonearm {
  /* transform: rotate(-25deg); */ /* 休息角度 */
}

/* ━━ 评论区 ━━ */
.mcmt-song {
  border-radius: 14px;
}
.mcmt-sort[data-on] {
  background: var(--c-music-primary-dim);
  color: var(--c-music-primary);
}
.mcmt-likes[data-hot] {
  color: var(--c-music-primary);
}
.mcmt-send {
  background: var(--c-music-primary);
}

/* ━━ 歌手主页 ━━ */
.mart-name {
  font-size: calc(21.6px*var(--app-text-scale,1));
}
.mart-song-idx[data-top] {
  color: var(--c-music-primary);
}

/* ━━ 我的页 · 头部 ━━ */
.music-mine-ava {
  /* 头像光环（双层描边+投影） */
  box-shadow: 0 0 0 2px rgba(220, 180, 255, 0.4), 0 0 0 6px rgba(180, 120, 255, 0.12), 0 8px 24px rgba(0, 0, 0, 0.35);
  /* width: 76px; height: 76px; */
}
.music-mine-name {
  font-size: calc(16.2px*var(--app-text-scale,1));
}
.music-mine-sig {
  /* 签名 */
  /* font-style: italic; */
}
.music-mine-stats b {
  /* 关注/粉丝/等级 数字 */
  color: var(--c-music-white);
}
.music-mine-chips button {
  /* 最近/本地/歌单/设置 快捷块 */
  border-radius: 12px;
  background: var(--c-music-surface-solid);
}

/* ━━ 我的页 · 歌单横滑卡 ━━ */
.music-mine-cover-card {
  border-radius: 14px;
  /* flex-basis: 104px; height: 104px; */
}

/* ━━ 我的页 · 音乐/播客/笔记 tabs ━━ */
.music-mine-tabs button[data-active]::after {
  /* 选中下划线颜色 */
  background: var(--c-music-primary);
}
.music-mine-subtabs button[data-active] {
  color: var(--c-music-white);
}

/* ━━ 我的页 · 歌单/专辑/播客行 ━━ */
.music-mine-pl-row:active {
  background: var(--c-music-surface);
}
.music-mine-pl-cover {
  border-radius: 10px;
}
.music-mine-like-heart {
  /* 我喜欢封面上的红心 */
  color: var(--c-music-liked);
}
.music-heart-btn {
  /* 心动模式按钮 */
  background: linear-gradient(135deg, #c86bff, #ff5c8a);
}

/* ━━ 我的页 · 笔记（动态卡） ━━ */
.music-mine-event-card {
  border-radius: 14px;
  background: var(--c-music-surface);
}
.music-mine-event-song {
  /* 动态附带的歌曲行 */
  background: var(--c-music-surface-solid);
}

/* ━━ 我的页 · 听歌周报卡 ━━ */
.music-week-card {
  border-radius: 18px;
  /* background: linear-gradient(140deg, #241a3d, #16102a 70%); */
}
.music-week-bar i {
  /* 柱状图颜色 */
  background: linear-gradient(180deg, rgba(230, 210, 255, 0.9), rgba(180, 130, 255, 0.45));
}

/* ━━ 搜索页 ━━ */
.music-search-bar {
  border-radius: 20px;
}
.music-search-input {
  font-size: calc(14px*var(--app-text-scale,1));
}

/* ━━ 空状态 / 浮动按钮 ━━ */
.music-empty {
  opacity: 0.4;
}
.music-fab-add {
  border-radius: 50%;
  box-shadow: 0 4px 20px rgba(140, 80, 255, 0.3);
}

/* ━━ 弹窗 / 抽屉（底色由 --c-music-panel 控制） ━━ */
.music-settings-modal-dialog {
  border-radius: 24px;
}
.music-playlist-picker {
  /* border-radius: 20px 20px 0 0; */
}
.music-queue-drawer {
  /* width: 75%; */
}
.music-queue-item[data-current] {
  /* background: var(--c-music-accent-dim); */
}
`;
