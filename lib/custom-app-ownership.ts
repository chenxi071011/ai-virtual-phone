import type { CustomAppMarketItem } from "./custom-app-market-types";
import type { InstalledCustomApp } from "./custom-app-types";

// 本机已装应用的归属归类：唯一实现，市场 UI 的"本地测试"分区和小坊的
// 版权护栏共用，保证两边永不漂移。
//
// 归属是"应用 × 当前账号"的关系而非应用属性（换账号登录、条目易主都会改变），
// 所以除资源集市外不落本地标记，每次拿服务端数据现场归类。
// 例外：从资源集市（GitHub 仓库）导入的应用在市场里没有任何对应条目，无从现场
// 判定，只能在安装时落一个 resourceHubPath 标记，直接归为 others。
// 归类结果：
//   mine       —— 自己的工作副本：纯本地创作，或与自己市场发布关联（含从市场装回自己的 APP）
//   local-only —— 纯本地创作，市场里没有对应条目
//   others     —— 别人发布、从市场安装的副本：不进本地测试，小坊拒绝读取/导出/修改
// 失败策略（拉不到市场数据怎么办）由调用方定：UI 宽容（创作区不能被离线锁死），
// 小坊严格（吐源码宁可等联网确认）。

export type InstalledAppOwnership = "mine" | "local-only" | "others";

export type MarketOwnershipData = {
  /** 当前账号名下的市场条目（mine=1） */
  myItems: CustomAppMarketItem[];
  /** 全量目录按 appId 索引（公开目录 + 自己名下，同 appId 取最新） */
  itemByAppId: Map<string, CustomAppMarketItem>;
};

export function buildMarketItemByAppId(...lists: CustomAppMarketItem[][]): Map<string, CustomAppMarketItem> {
  const map = new Map<string, CustomAppMarketItem>();
  for (const item of lists.flat()) {
    const existing = map.get(item.appId);
    if (!existing || new Date(item.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
      map.set(item.appId, item);
    }
  }
  return map;
}

/** 找到本机副本对应的自己发布的市场条目：显式标记（marketItemId/运行时 id）优先，
    包内稳定身份（manifest.id、名字）兜底——运行时 id 每次安装会变，兜底让老副本也能对上号。 */
export function linkedOwnMarketItem(app: InstalledCustomApp, myItems: CustomAppMarketItem[]): CustomAppMarketItem | null {
  const norm = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return myItems.find(item => item.id === app.marketItemId)
    ?? myItems.find(item => item.appId === app.id)
    ?? myItems.find(item => norm(item.manifest?.id) && norm(item.manifest?.id) === norm(app.manifest?.id))
    ?? myItems.find(item => norm(item.name) === norm(app.name))
    ?? null;
}

export function classifyInstalledApp(app: InstalledCustomApp, market: MarketOwnershipData): InstalledAppOwnership {
  // 资源集市导入的是别人的作品：本机能玩，但不进本地测试、不能再发布到应用广场
  if (app.resourceHubPath) return "others";
  const linked = linkedOwnMarketItem(app, market.myItems);
  if (app.marketItemId) {
    // 显式标记：指向自己的条目 → 工作副本；指向他人条目（或已失联）→ others
    return linked && linked.id === app.marketItemId ? "mine" : "others";
  }
  // 旧版安装没有 marketItemId 标记：市场安装的运行时 id 等于市场条目的 appId，按此判断来源
  const fromMarket = market.itemByAppId.get(app.id);
  if (fromMarket) {
    return linked && linked.id === fromMarket.id ? "mine" : "others";
  }
  return "local-only";
}
