import { previewMessagesForApi, sendLLMRequest } from "./chat-engine";
import { appNowISO } from "./app-clock";
import { loadApiConfigs, loadBindingConfig } from "./settings-storage";
import type { CheckPhoneShoppingProduct, CheckPhoneShoppingTone } from "./checkphone-config";
import type { ApiConfig } from "./settings-types";
import type { ShoppingCatalog, ShoppingCategory, ShoppingRefreshResult, ShoppingSearchResponse } from "./shopping-types";
import type { LLMMessage } from "./llm-prompt-assembler";

export const SHOPPING_RECOMMENDATION_CATEGORIES: Array<Pick<ShoppingCategory, "id" | "title" | "subtitle">> = [
  { id: "digital", title: "数码好物", subtitle: "小设备、桌面装备、智能配件" },
  { id: "home", title: "生活家居", subtitle: "收纳、香氛、餐厨与居家质感" },
  { id: "style", title: "穿搭配饰", subtitle: "服饰、包袋、鞋履和日常搭配" },
  { id: "beauty", title: "美妆个护", subtitle: "护肤、彩妆、身体护理和仪容工具" },
  { id: "food", title: "食品饮品", subtitle: "零食、咖啡、茶饮和轻食补给" },
  { id: "hobby", title: "文具兴趣", subtitle: "纸品、手作、阅读、运动和旅行小物" },
];

export const DEFAULT_SHOPPING_REFRESH_PROMPT = [
  "<shopping_refresh_instruction>",
  "你正在为一个独立购物 App 生成首页分类推荐商品流。",
  "",
  "要求：",
  "- 只生成可以浏览和购买的首页推荐商品，不要生成最近浏览、收藏、购物车或订单。",
  "- 不要写角色、人设、记忆、剧情或旁白。",
  "- 必须按以下 6 个分类推荐，每个分类 5 到 7 条商品：",
  ...SHOPPING_RECOMMENDATION_CATEGORIES.map(category => `  - ${category.title}：${category.subtitle}`),
  "- 商品名称、店铺、价格、说明和详情都要具体，像真实可购买的商品。",
  "- [详情] 写商品本身的材质、规格、用途、质感、适用场景，不要写推荐理由或系统解释。",
  "- [图标] 用单个直观、美观、和商品强相关的 emoji 或符号。",
  "",
  "输出格式：",
  "#推荐1",
  "[分类]数码好物",
  "[名称]商品名称",
  "[店铺]店铺名称",
  "[价格]价格",
  "[说明]列表短说明",
  "[详情]商品详情文本",
  "[图标]商品图标",
  "",
  "#推荐2",
  "[分类]数码好物",
  "[名称]商品名称",
  "[店铺]店铺名称",
  "[价格]价格",
  "[说明]列表短说明",
  "[详情]商品详情文本",
  "[图标]商品图标",
  "",
  "规则：",
  "- 每条商品都必须有 [分类]，且分类名只能使用上面 6 个分类名。",
  "- 每个分类连续输出 5 到 7 条商品，所有商品使用连续编号，例如 #推荐1、#推荐2、#推荐3。",
  "- 不要输出 #最近浏览、#收藏、#购物车、#订单；这些由用户交互产生。",
  "- 示例字段值都是占位说明，实际输出必须替换成真实商品内容。",
  "- 只输出上述块格式内容，不要输出 Markdown、解释、代码块或 JSON。",
  "</shopping_refresh_instruction>",
].join("\n");

export const DEFAULT_SHOPPING_SEARCH_PROMPT = [
  "<shopping_search_instruction>",
  "你正在为一个独立购物 App 的搜索词“{{query}}”生成搜索结果商品流。",
  "",
  "要求：",
  "- 只生成与搜索词“{{query}}”高度相关、可以浏览和购买的商品。",
  "- 不要生成首页分类推荐、最近浏览、收藏、购物车或订单。",
  "- 不要写角色、人设、记忆、剧情或旁白。",
  "- 商品要覆盖不同价位、不同风格和不同使用场景，但都必须围绕搜索词。",
  "- 商品名称、店铺、价格、说明和详情都要具体，像真实可购买的商品。",
  "- [详情] 写商品本身的材质、规格、用途、质感、适用场景，不要写推荐理由或系统解释。",
  "- [图标] 用单个直观、美观、和商品强相关的 emoji 或符号。",
  "",
  "输出格式：",
  "#搜索结果1",
  "[名称]商品名称",
  "[店铺]店铺名称",
  "[价格]价格",
  "[说明]列表短说明",
  "[详情]商品详情文本",
  "[图标]商品图标",
  "",
  "#搜索结果2",
  "[名称]商品名称",
  "[店铺]店铺名称",
  "[价格]价格",
  "[说明]列表短说明",
  "[详情]商品详情文本",
  "[图标]商品图标",
  "",
  "规则：",
  "- 生成 12 到 18 条搜索结果。",
  "- 所有商品使用连续编号，例如 #搜索结果1、#搜索结果2、#搜索结果3。",
  "- 不要输出 #推荐、#最近浏览、#收藏、#购物车、#订单；这些由其他功能或用户交互产生。",
  "- 示例字段值都是占位说明，实际输出必须替换成真实商品内容。",
  "- 只输出上述块格式内容，不要输出 Markdown、解释、代码块或 JSON。",
  "</shopping_search_instruction>",
].join("\n");

type ParsedRecommendationBlock = {
  order: number;
  fields: Record<string, string>;
};

function resolveShoppingApiConfig(): ApiConfig | null {
  const configs = loadApiConfigs();
  const binding = loadBindingConfig();
  if (binding.globalDefaults.apiConfigId) {
    return configs.find(config => config.id === binding.globalDefaults.apiConfigId) ?? null;
  }
  return configs[0] ?? null;
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function deriveTone(index: number): CheckPhoneShoppingTone {
  const tones: CheckPhoneShoppingTone[] = ["ivory", "mist", "blush", "graphite"];
  return tones[index % tones.length];
}

function stripJsonWrapperNoise(text: string): string {
  return text
    .replace(/^\s*```(?:json|text|markdown)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function parseTaggedFields(source: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let activeKey = "";
  const lines = source.replace(/\r/g, "").split("\n");

  for (const line of lines) {
    const match = line.match(/^\s*\[([^\]]+)\]\s*(.*)$/);
    if (match) {
      activeKey = match[1].trim();
      fields[activeKey] = match[2].trim();
      continue;
    }
    if (activeKey && line.trim()) {
      fields[activeKey] = `${fields[activeKey]}\n${line.trim()}`.trim();
    }
  }

  return fields;
}

function extractProductBlocks(rawOutput: string, labels: string[]): ParsedRecommendationBlock[] {
  const source = stripJsonWrapperNoise(rawOutput);
  const labelPattern = labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const matches = [...source.matchAll(new RegExp(`^#\\s*(?:${labelPattern})(\\d+)\\s*$`, "gm"))];
  const allHeadings = [...source.matchAll(/^#\s*\S.*$/gm)];
  return matches.map((current, index) => {
    const start = (current.index ?? 0) + current[0].length;
    const next = allHeadings.find((match) => (match.index ?? 0) > (current.index ?? 0));
    const end = next?.index ?? source.length;
    return {
      order: Number(current[1]) || index + 1,
      fields: parseTaggedFields(source.slice(start, end).trim()),
    };
  });
}

function resolveCategory(value: string): Pick<ShoppingCategory, "id" | "title" | "subtitle"> {
  const normalized = cleanText(value, 80);
  return (
    SHOPPING_RECOMMENDATION_CATEGORIES.find(category => category.title === normalized) ??
    SHOPPING_RECOMMENDATION_CATEGORIES[0]
  );
}

function parseProduct(block: ParsedRecommendationBlock, index: number): { category: Pick<ShoppingCategory, "id" | "title" | "subtitle">; product: CheckPhoneShoppingProduct | null } {
  const fields = block.fields;
  const category = resolveCategory(fields["分类"]);
  const title = cleanText(fields["名称"], 200);
  const merchantLabel = cleanText(fields["店铺"], 120);
  const priceLabel = cleanText(fields["价格"], 80);
  const subtitle = cleanText(fields["说明"] || fields["详情"] || fields["名称"], 400);
  const detail = cleanText(fields["详情"] || subtitle, 1200);
  const previewIcon = cleanText(fields["图标"], 8);

  if (!title || !merchantLabel || !priceLabel || !subtitle || !detail || !previewIcon) {
    return { category, product: null };
  }

  const signature = `${category.title}|${title}|${merchantLabel}|${priceLabel}|${previewIcon}`;
  return {
    category,
    product: {
      id: `rec_${hashString(signature)}`,
      title,
      merchantLabel,
      priceLabel,
      tagLabel: category.title,
      subtitle,
      detail,
      previewIcon,
      tone: deriveTone(index),
    },
  };
}

function parseSearchProduct(block: ParsedRecommendationBlock, query: string, index: number): CheckPhoneShoppingProduct | null {
  const fields = block.fields;
  const title = cleanText(fields["名称"], 200);
  const merchantLabel = cleanText(fields["店铺"], 120);
  const priceLabel = cleanText(fields["价格"], 80);
  const subtitle = cleanText(fields["说明"] || fields["详情"] || fields["名称"], 400);
  const detail = cleanText(fields["详情"] || subtitle, 1200);
  const previewIcon = cleanText(fields["图标"], 8);
  const tagLabel = cleanText(fields["分类"], 80) || `搜索：${query}`;

  if (!title || !merchantLabel || !priceLabel || !subtitle || !detail || !previewIcon) {
    return null;
  }

  const signature = `${query}|${title}|${merchantLabel}|${priceLabel}|${previewIcon}`;
  return {
    id: `search_${hashString(signature)}`,
    title,
    merchantLabel,
    priceLabel,
    tagLabel,
    subtitle,
    detail,
    previewIcon,
    tone: deriveTone(index),
  };
}

function parseShoppingCatalog(rawOutput: string): ShoppingCatalog | null {
  const grouped = new Map<string, ShoppingCategory>();
  for (const category of SHOPPING_RECOMMENDATION_CATEGORIES) {
    grouped.set(category.id, { ...category, items: [] });
  }

  const products = extractProductBlocks(rawOutput, ["推荐"])
    .sort((a, b) => a.order - b.order)
    .map(parseProduct)
    .filter((entry): entry is { category: Pick<ShoppingCategory, "id" | "title" | "subtitle">; product: CheckPhoneShoppingProduct } => Boolean(entry.product));

  for (const { category, product } of products) {
    const group = grouped.get(category.id) ?? { ...category, items: [] };
    if (!group.items.some(item => item.id === product.id)) {
      group.items.push(product);
    }
    grouped.set(category.id, group);
  }

  const categories = SHOPPING_RECOMMENDATION_CATEGORIES
    .map(category => grouped.get(category.id))
    .filter((category): category is ShoppingCategory => Boolean(category && category.items.length > 0));

  const recommendations = categories.flatMap(category => category.items);
  return recommendations.length > 0 ? { categories, recommendations } : null;
}

function parseShoppingSearchResult(rawOutput: string, query: string): CheckPhoneShoppingProduct[] {
  const seen = new Set<string>();
  const results: CheckPhoneShoppingProduct[] = [];
  const products = extractProductBlocks(rawOutput, ["搜索结果", "推荐"])
    .sort((a, b) => a.order - b.order)
    .map((block, index) => parseSearchProduct(block, query, index))
    .filter((item): item is CheckPhoneShoppingProduct => Boolean(item));

  for (const product of products) {
    if (seen.has(product.id)) continue;
    seen.add(product.id);
    results.push(product);
  }

  return results;
}

function applySearchPromptTemplate(prompt: string, query: string): string {
  const template = prompt || DEFAULT_SHOPPING_SEARCH_PROMPT;
  const filled = template
    .replaceAll("{{query}}", query)
    .replaceAll("{{搜索词}}", query)
    .replaceAll("{{keyword}}", query);
  return filled.includes(query)
    ? filled
    : `${filled}\n\n当前搜索词：${query}`;
}

export async function generateShoppingCatalog(refreshPrompt: string): Promise<ShoppingRefreshResult> {
  const apiConfig = resolveShoppingApiConfig();
  if (!apiConfig) {
    return { catalog: null, error: "未找到可用的 API 配置", rawOutput: "" };
  }

  try {
    const rawOutput = await sendLLMRequest(
      apiConfig,
      null,
      [{ role: "user", content: refreshPrompt || DEFAULT_SHOPPING_REFRESH_PROMPT }],
      [],
      { characterName: "购物App" },
      { skipOutputRegex: true, appId: "shopping" },
    );

    if (!rawOutput.trim()) {
      return { catalog: null, error: "LLM 返回为空", rawOutput };
    }

    const catalog = parseShoppingCatalog(rawOutput);
    if (!catalog) {
      return { catalog: null, error: "未找到有效的分类推荐商品块", rawOutput };
    }

    return { catalog, rawOutput };
  } catch (error) {
    return {
      catalog: null,
      error: error instanceof Error ? error.message : "生成失败",
      rawOutput: "",
    };
  }
}

export async function generateShoppingSearchResults(query: string, searchPrompt: string): Promise<ShoppingSearchResponse> {
  const normalizedQuery = cleanText(query, 80);
  if (!normalizedQuery) {
    return { result: null, error: "请输入搜索词", rawOutput: "" };
  }

  const apiConfig = resolveShoppingApiConfig();
  if (!apiConfig) {
    return { result: null, error: "未找到可用的 API 配置", rawOutput: "" };
  }

  try {
    const rawOutput = await sendLLMRequest(
      apiConfig,
      null,
      [{ role: "user", content: applySearchPromptTemplate(searchPrompt, normalizedQuery) }],
      [],
      { characterName: "购物App" },
      { skipOutputRegex: true, appId: "shopping_search" },
    );

    if (!rawOutput.trim()) {
      return { result: null, error: "LLM 返回为空", rawOutput };
    }

    const items = parseShoppingSearchResult(rawOutput, normalizedQuery);
    if (items.length === 0) {
      return { result: null, error: "未找到有效的搜索结果商品块", rawOutput };
    }

    return {
      result: {
        query: normalizedQuery,
        items,
        generatedAt: appNowISO(),
      },
      rawOutput,
    };
  } catch (error) {
    return {
      result: null,
      error: error instanceof Error ? error.message : "搜索失败",
      rawOutput: "",
    };
  }
}

export async function previewShoppingPromptPayload(
  mode: "catalog" | "search",
  params?: { query?: string; refreshPrompt?: string; searchPrompt?: string },
): Promise<{ messages: LLMMessage[]; characterName: string; model: string; presetName: string }> {
  const apiConfig = resolveShoppingApiConfig();
  if (!apiConfig) throw new Error("未找到可用的 API 配置");
  const prompt = mode === "search"
    ? applySearchPromptTemplate(params?.searchPrompt || DEFAULT_SHOPPING_SEARCH_PROMPT, params?.query?.trim() || "礼物")
    : (params?.refreshPrompt || DEFAULT_SHOPPING_REFRESH_PROMPT);
  const messages = [{ role: "user" as const, content: prompt, _debugMeta: { marker: mode === "search" ? "shopping_search" : "shopping_catalog" } }];
  return {
    messages: previewMessagesForApi(apiConfig, null, messages),
    characterName: mode === "search" ? "购物搜索" : "购物App",
    model: apiConfig.defaultModel,
    presetName: "(无预设)",
  };
}
