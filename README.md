# AI Virtual Phone（二改版）

> 本仓库是 [xiaolongbao0709/ai-virtual-phone](https://github.com/xiaolongbao0709/ai-virtual-phone) 的 fork，
> 在原项目基础上做了二次开发，主要方向是**把它做成一个能装在手机上离线运行的安卓 APP**，
> 并补充了几个原版没有的功能。原项目的全部功能与文档在此保留，部署方式与上游一致。
>
> 原作者的著作权与许可（AGPL-3.0-only）均予保留，详见 [License](#license) 与 [Credits](#credits)。

一个基于 Next.js 的 AI 虚拟互动手机：在浏览器中模拟一部完整的手机，支持与你创建的 AI 角色进行仿真聊天、朋友圈互动与剧情创作。

主要功能：

- 仿真聊天：私聊 / 群聊 / 朋友圈 / 语音消息 / 转账红包卡片，AI 角色有作息、记忆和长期关系
- 创作系统：角色卡、世界书、预设、正则，附带桌面 AI 助手「小卷」帮你写这些内容
- 剧情玩法：剧情模式、视觉小说、查手机、访谈、地图冒险、日记、便签墙
- 扩展生态：应用市场（用 SDK 写自定义 APP）、游戏大厅、内置小游戏
- 多媒体：AI 生图、Minimax 语音合成、网易云在线音乐（需自配 API）、3D 世界搭建（Tripo）
- 桌面美化：主题、壁纸、贴纸小组件、自定义 CSS，支持 PWA 安装到手机桌面

所有 LLM 调用都使用**你自己的 API key**，本项目不内置任何模型服务。

## 本 fork 的改动

### 安卓 APP（离线运行）

原版是网页应用，需要部署或本地起服务才能用。本 fork 增加了静态导出构建，可以把整个应用打包进
Capacitor 安卓壳，**装完即用、不需要服务器**（AI 对话本身仍然需要网络访问你的 API）。

- 新增 `npm run build:static-export`：构建期临时移出 `app/api`，产出可直接塞进原生壳的纯静态页面。
  这些 API 路由都是给浏览器绕 CORS 用的转发层，原生壳走 CapacitorHttp 不需要它们；
  普通的 `npm run dev` / `npm run build` 完全不受影响，线上部署行为与上游一致。
- 安卓返回键 / 左滑手势适配：原本在任意界面返回都会直接退出整个 APP，现在改为先交给
  当前界面的返回栈处理，只有已经在桌面时才「双击退出」。

打包好的 APK 见本仓库 [Releases](../../releases)。

### 蓝牙体感设备控制

新增通过 BLE 直连体感设备的支持，包含独立的设备 APP 界面与桌面悬浮控制窗，
并接入了按「适用范围」标签授权的 AI 控制机制——AI 只能在你授权的范围内触发设备。

### 网易云音乐客户端直连

把原先经服务端 API 代理转发的网易云请求整体搬到了客户端（`lib/netease/*`），
移动端离线壳因此不再依赖任何服务端路由；同时补充了播放历史。

### 聊天与界面

- 思考过程（reasoning）折叠展示，适配推理模型的思维链输出
- 通话消息的操作菜单
- 阅读 APP 支持重命名书籍与设置封面
- 聊天、朋友圈、世界书等模块的若干交互调整与修复

## 运行要求

- Node.js 20+（Next.js 15 要求 ≥ 18.18）
- 任意 OpenAI 兼容的 LLM API（OpenAI / DeepSeek / 中转站等），或 Anthropic / Google Gemini 官方 API

## 快速开始（本地运行）

```bash
git clone https://github.com/chenxi071011/ai-virtual-phone.git
cd ai-virtual-phone
npm install
cp .env.example .env.local
npm run dev
```

浏览器打开 `http://localhost:3001`（默认端口 3001，可用 `PORT` 环境变量修改）。

`.env.example` 已默认开启：

```env
NEXT_PUBLIC_SELF_HOSTED_MODE=true
```

这个模式跳过账号/激活码门禁，用本地单机账号直接进入，适合个人使用。其余环境变量全部可选，功能按需启用（见下表）。

## 首次使用

进入应用后只差一步就能开聊：

1. 打开**设置 → API 设置**，添加你的 LLM API（填 Base URL + API Key，支持 OpenAI 兼容接口、Anthropic、Google Gemini）；
2. 创建或导入角色卡，开始聊天；
3. 可选：在设置里继续配置生图、Minimax 语音、网易云音乐 API 等增强功能。

## 安装安卓 APP

直接从 [Releases](../../releases) 下载 APK 安装即可，无需自行构建。

首次安装需要在系统里允许「安装未知来源应用」。如果之前装过其它来源的同名应用，
需要先卸载旧版再安装（签名不同无法直接覆盖）。

### 自行打包

需要 JDK 17+ 与 Android SDK：

```bash
npm run build:static-export     # 产出静态站点
# 将产物同步进 Capacitor 工程后：
cd android && ./gradlew assembleRelease
```

正式发布需要自备签名密钥（keystore），并在 `android/keystore.properties` 中配置
`storeFile` / `storePassword` / `keyAlias` / `keyPassword`。
**该文件与 keystore 均不可提交到 Git**（已在 `.gitignore` 中排除）。

## 部署到 Netlify / Vercel

两个平台都可以直接导入本仓库部署：

1. 新建站点 / 项目，关联你 fork 或 clone 的仓库，选择 `main` 或 `test` 分支；
2. 构建设置保持默认即可（Netlify 会自动读取仓库里的 `netlify.toml`；Vercel 自动识别 Next.js）；
3. **在平台后台添加环境变量**（平台不会读取仓库里的 `.env.example`）：

   ```env
   NEXT_PUBLIC_SELF_HOSTED_MODE=true
   ```

4. 部署完成后打开站点，按「首次使用」配置即可。

## 环境变量总表

除 `NEXT_PUBLIC_SELF_HOSTED_MODE` 外全部可选，不填时对应功能自动隐藏或停用。

| 变量 | 用途 |
|---|---|
| `NEXT_PUBLIC_SELF_HOSTED_MODE` | `true`=单机模式（推荐自部署开启）；`false`=启用账号/激活码门禁（需配 Supabase） |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | 你自己的 Supabase 项目，启用云端功能时必填（服务端专用，勿放进 NEXT_PUBLIC） |
| `ACCOUNT_GATE_SECRET` | 账号门禁签名密钥，启用账号系统时设为随机长字符串 |
| `VERIFY_ADMIN_KEY` | 成年审核/激活码管理后台密钥 |
| `APP_MARKET_ADMIN_KEY` | 应用市场审核后台密钥（不填回退用 `VERIFY_ADMIN_KEY`） |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 便签墙实时刷新用（anon key 本身可公开） |
| `NEXT_PUBLIC_IMAGE_GEN_PROXY_URL` | 通用生图代理地址，需自己部署代理服务 |
| `NEXT_PUBLIC_DEFAULT_NETEASE_API_BASE` | 网易云音乐 API 默认地址（NeteaseCloudMusicApi 兼容实例，请自行部署）。留空时在线音乐隐藏，用户也可在音乐 APP 设置里自填 |
| `NEXT_PUBLIC_NETEASE_REAL_IP` | 网易云 API 的 X-Real-IP 参数（海外部署解锁地区限制用） |
| `TRIPO_API_KEY` | 可选的服务端兜底，一般不用填——用户在世界搭建界面内自行填写 Tripo key |
| `IMGBB_API_KEY` | 可选的服务端兜底，一般不用填——用户在应用内生图/图床设置里自行填写 |
| `WEIXIN_PROXY` | 微信本地助手代理，见 `tools/weixin-local-assistant/README.md` |

## 启用自己的 Supabase（可选云端功能）

账号、激活码、成年审核、便签墙、游戏大厅、应用市场、黑市等云端功能需要你自己的 Supabase 项目。推荐在 Supabase SQL Editor 直接执行 `docs/supabase-all-in-one.sql` 一键建齐全部云端功能（幂等脚本，重复执行不会破坏已有数据；粘贴后先确认最后一行是「全部结束」标记再 Run，防止复制被截断）。也可按需执行下列单个脚本：

- `docs/account-supabase.sql`：账号、会话、激活码
- `docs/verify-supabase.sql`：成年审核与审核图片桶（部署说明见 `docs/verify-setup.md`）
- `docs/notewall-supabase.sql`：便签墙
- `docs/game-hall-supabase.sql`：游戏大厅
- `docs/custom-app-market-supabase.sql`：应用市场
- `docs/black-market-supabase.sql`：黑市
- `docs/online-play-supabase.sql`：多人联机（自定义APP/游戏的实时房间与云端共享，可选；不在一体脚本内，需单独执行）
- `docs/moderation-supabase.sql`：内容管理（举报/管理员/下架/封号，可选；执行后用 SQL 把自己的账号 role 设为 admin，即可在 设置 → 管理中心 处理举报）

然后关闭单机模式并填入服务端密钥：

```env
NEXT_PUBLIC_SELF_HOSTED_MODE=false
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ACCOUNT_GATE_SECRET=your-random-long-secret
# 可选：启用多人联机（Project Settings → API 的 anon public key）
SUPABASE_ANON_KEY=your-anon-key
```

不要把 `.env.local` 提交到 Git。

## 分支选择

本仓库长期保留两个设备兼容版本：

- `main`：正常设备版
- `test`：兼容设备版，部分设备全屏或显示异常时部署此分支

## 常用命令

```bash
npm run dev     # 本地开发（端口 3001）
npm run build   # 生产构建
npm run start   # 生产运行
npm run lint    # 代码检查
```

## License

本项目采用 GNU Affero General Public License v3.0 only（AGPL-3.0-only）开源。详见 [LICENSE](./LICENSE)。

## Credits

本仓库是 [xiaolongbao0709/ai-virtual-phone](https://github.com/xiaolongbao0709/ai-virtual-phone) 的 fork，
「本 fork 的改动」之外的全部功能均由原项目实现，版权归原作者所有。

原项目为独立实现，但部分产品设计和系统抽象受 SillyTavern 启发，包括预设、正则处理、世界书 / lorebook / WorldInfo 等概念。

- SillyTavern: https://github.com/SillyTavern/SillyTavern
- SillyTavern 使用 AGPL-3.0 许可证。

字体、贴纸素材、3D 模型等第三方资源的授权说明见 [NOTICE](./NOTICE)。

## 备注

`NEXT_PUBLIC_*` 变量会打包进浏览器代码、完全公开。不要把 Supabase `service_role`、后台管理密钥、第三方 API 私钥写进任何 `NEXT_PUBLIC_*` 变量。
