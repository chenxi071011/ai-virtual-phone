# 情趣玩具连接悬浮球设计

## 问题

玩具通过「互动设备」App 连接后，用户离开该页面就没有任何全局入口可以手动控制/急停，只能重新打开该 App。需要一个连接后自动出现的全局悬浮球，随时可以手动调整强度或一键急停。

## 方案

新增 `components/toy/toy-float.tsx`，挂载在 `desktop-shell.tsx` 里，和 `<QuickActionFloat />` / `<MascotFloat />` 同级、全局常驻（不依赖当前打开的是哪个 App/页面）。

### 显示逻辑

- 订阅 `toyController.subscribe()`（`lib/toy-ble.ts` 里已有的单例事件源，`toy-device-app.tsx` 已经在用同一套）。
- `toyController.connected === false` 时组件返回 `null`，不占用任何 DOM/事件。
- 一旦 `connected` 变为 `true`（不管是从互动设备页面连接的，还是以后任何入口触发的连接），悬浮球立刻出现；断开时立刻消失，面板一并关闭。

### 悬浮球交互

- 复用 `QuickActionFloat` 的拖拽实现模式：pointerdown 记录起点，pointermove 超过阈值判定为拖拽并跟随移动，pointerup 判断本次是点击还是拖拽（拖拽过的这次 click 不触发展开/收起）。
- 位置**不持久化**：每次挂载（即每次连接）都回到同一个默认位置，断开重连也一样，不用额外存储逻辑。
- 样式复用全局的 `.prompt-viewer-float-button` 基础类，新增 `.toy-float-button` 修饰类（区别于 mascot/quick-action 的配色，用暖色调，避免和其他悬浮球混淆），图标用 `HeartPulse`（和 `toy-device-app.tsx` 里那个状态圆点一致）。

### 面板内容（点击悬浮球展开，点击外部关闭）

- 顶部：设备名 + 关闭按钮。
- 强度滑块 0–100%：`onChange` 直接调用 `toyController.manualVibe(v)`，和 `toy-device-app.tsx` 里 `handleManualChange` 的逻辑一致（滑块本地 state 只做展示，真正的当前强度以 `toyController.currentIntensity` 为准，通过 subscribe 保持同步）。
- 急停按钮：调用 `toyController.emergencyStop()`。
- 断开连接按钮：调用 `toyController.disconnect()`——断开后 `connected` 变 false，悬浮球和面板一起自动消失，不需要额外处理。

### 不做的事

- 不做波浪/脉冲等模式选择，也不做吮吸/灯光控制——那些留在「互动设备」App 完整页面里，悬浮球只覆盖「手动强度 + 急停 + 断开」这三个最常用的紧急操作。
- 不做位置持久化。
- 不改动 `lib/toy-ble.ts` 的现有逻辑，纯 UI 消费方。

## 涉及文件

- 新增：`components/toy/toy-float.tsx`
- 修改：`components/desktop-shell.tsx`（挂载新组件）
- 修改：`styles/toy-device.css`（新增悬浮球/面板样式）或 `styles/components.css`（如果想复用 `.quick-action-*` 系列类名的结构，视实现时判断）
