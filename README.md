# Float — AI 虚拟手机（安卓版）

在手机上模拟一部完整的虚拟手机：和你创建的 AI 角色私聊、群聊、发朋友圈、玩剧情。

本仓库是 [xiaolongbao0709/ai-virtual-phone](https://github.com/xiaolongbao0709/ai-virtual-phone) 的 fork，
把原本的网页应用改造成了**装完即用的安卓 APP**，并补充了几个原版没有的功能。
应用本身的玩法说明请看上游仓库，这里只写本版本特有的内容。

## 安装

到 [Releases](../../releases) 下载 APK 装上就能用，**不需要服务器、不需要电脑**。

- 首次安装要在系统设置里允许「安装未知来源应用」。
- 如果装过其它来源的同名应用，得先卸载旧版——签名不同没法直接覆盖。
- 装好后打开 **设置 → API 设置**，填入你自己的 LLM API（Base URL + API Key，
  支持 OpenAI 兼容接口、Anthropic、Google Gemini），就可以开始聊了。

所有 LLM 调用都走**你自己的 API key**，本项目不内置任何模型服务。

> ⚠️ 数据全部存在手机本地（WebView 的 IndexedDB）。**卸载应用会连同角色和聊天记录一起清除**，
> 重要内容请定期用应用内的备份功能导出。覆盖安装不受影响。

## 本版本新增的功能

### 打包成安卓 APP

原版是网页应用，要部署或本地起服务才能用。这里加了静态导出构建，把整个应用塞进
Capacitor 安卓壳离线运行：

- `npm run build:static-export` 在构建期临时移出 `app/api`，产出纯静态站点。
  那些 API 路由是给浏览器绕 CORS 用的转发层，原生壳走 CapacitorHttp 不需要它们。
- 适配了安卓返回键 / 左滑手势。原本在任意界面返回都直接退出整个 APP，
  现在先交给当前界面的返回栈处理，只有已经在桌面时才「双击退出」。
- 接管了 `onRenderProcessGone`：筑境（World Builder）的 Three.js 场景比较重，
  部分机型会压垮 WebView 渲染进程，系统默认行为是杀掉整个 App 进程重启——
  也就是「打开筑境直接闪退回开屏动画」。现在只销毁重建 WebView，不再连累整个进程。

### 蓝牙体感设备直连

新增原生 BLE 插件（`android-shell/.../ToyBlePlugin.java`），扫描 → 连 GATT → 直接下发振动指令，
**不需要 Intiface，也不用手填设备地址**。配套有独立的设备 APP 界面和桌面悬浮控制窗。

支持的协议见 `ToyProtocols.java`：JoyHub、Galaku、Kiiroo、We-Vibe、Magic Motion、Svakom、
Libo、Picobong、Lovedistance、ZALO、Leten、Satisfyer、PrettyLove、谜姬等 **386 个具名型号**，
另加 Lovense 与 Satisfyer 的整条产品线（按 UUID / 名称通配匹配，不逐个列型号）。
识别以「GATT 服务 + 写特征 UUID」为主键，UUID 撞车时（`0000fff0` 被好几家共用）再用广播名消歧；
认不出的设备会明确提示「未能识别型号」，而不是假装连上。

协议数据来自 [Buttplug](https://github.com/buttplugio/buttplug) 公开的设备协议库（BSD-3-Clause），
归属声明见 [NOTICE](./NOTICE)。要加新设备就往 `ToyProtocols.TABLE` 里加一行；
连接时日志会 dump 完整 GATT，便于对未知设备摸协议。

AI 控制走「适用范围」标签授权——AI 只能在你授权的范围内触发设备。

### 网易云音乐客户端直连

把原先经服务端 API 代理转发的网易云请求整体搬到了客户端（`lib/netease/*`），
离线壳因此不再依赖任何服务端路由；同时补充了播放历史。

### 阅读 APP

书架每本书新增编辑入口，可以改书名、作者，以及选本地图片当封面（导入 txt 后原本没有任何修改入口）。

### 聊天与界面

- 思考过程（reasoning）折叠展示，适配推理模型的思维链输出
- 通话消息的操作菜单
- 发给模型的历史里，体感设备的控制记录会还原成原始指令格式，
  避免模型照着页面上的中文播报把格式学错
- 整页硬跳转返回时不再重放开机动画
- 聊天、朋友圈、世界书等模块的若干交互调整与修复

## 自己打包 APK

安卓壳的完整源码在 `android-shell/`（Capacitor 工程，appId `app.floatphone.shell`）。

**需要**：Node.js 20+、JDK 17+、Android SDK（compileSdk 36，minSdk 24）。

```bash
# 1. 装依赖（网页端 + 安卓壳各一份）
npm install
cd android-shell && npm install && cd ..

# 2. 构建静态站点，产出到 out/
npm run build:static-export

# 3. 同步进壳：把 out/ 拷进 android-shell/www/ 再跑 cap sync
cd android-shell && npm run sync

# 4. 打包（Windows 用 gradlew.bat，Linux/macOS 用 ./gradlew）
cd android && ./gradlew assembleDebug      # 调试包，直接可装
```

产物在 `android-shell/android/app/build/outputs/apk/`。

### 打正式发布包

`assembleRelease` 需要你自备签名密钥：

```bash
cd android-shell/android
keytool -genkeypair -v -keystore my-release.keystore -alias float \
        -keyalg RSA -keysize 2048 -validity 10000
```

然后在同目录建 `keystore.properties`：

```properties
storeFile=my-release.keystore
storePassword=你的口令
keyAlias=float
keyPassword=你的口令
```

```bash
./gradlew assembleRelease
```

该文件不存在时 gradle 会自动跳过签名配置，不影响 debug 构建。
**keystore 和 `keystore.properties` 都不要提交到 Git**（已在 `.gitignore` 中排除）。
另外记得自己另存一份 keystore：**弄丢了就再也无法给已安装的用户推更新**。

### 几个容易踩的坑

- `android-shell/www/` 和 `android/app/src/main/assets/public/` 都是同步产物，不进版本库，
  clone 下来是空的——必须先跑完上面第 2、3 步再打包。
- 别用 `npm run build:static-export | tail` 这类管道看输出，管道会把退出码吞掉，
  构建失败了也照样往下走，最后打出一个内容是旧的 APK。
- 装到手机前建议先验一下 APK 里的内容确实是新的：
  `unzip -p app-debug.apk assets/public/index.html | head`

## 换应用图标

替换 `android-shell/resources/icon.png`（建议 1024×1024），然后：

```bash
cd android-shell && node gen-icons.mjs
```

会生成各密度的传统图标与自适应图标图层到 `android/app/src/main/res/mipmap-*/`。

注意自适应图标的 `background` 图层必须**铺满整块 108dp 画布**，不能加 inset，
否则被系统裁成圆形后四角会透出去；`foreground` 才需要 16.7% 的 inset（对应 72dp 安全区）。
底色在 `gen-icons.mjs` 的 `BG` 常量里，换图标时记得跟着改成新图的背景色。

## License

GNU Affero General Public License v3.0 only（AGPL-3.0-only），与上游一致。详见 [LICENSE](./LICENSE)。

## Credits

本仓库是 [xiaolongbao0709/ai-virtual-phone](https://github.com/xiaolongbao0709/ai-virtual-phone) 的 fork，
「本版本新增的功能」之外的全部功能均由原项目实现，版权归原作者所有。

原项目为独立实现，但部分产品设计和系统抽象受 [SillyTavern](https://github.com/SillyTavern/SillyTavern)
启发，包括预设、正则处理、世界书 / lorebook / WorldInfo 等概念（SillyTavern 同为 AGPL-3.0）。

字体、贴纸素材、3D 模型等第三方资源的授权说明见 [NOTICE](./NOTICE)。
