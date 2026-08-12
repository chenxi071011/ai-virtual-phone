import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { appNowISO } from "./app-clock";
import type { ShoppingCategory, ShoppingSearchResult, ShoppingShippingEvent, ShoppingState } from "./shopping-types";
import { DEFAULT_SHOPPING_REFRESH_PROMPT, DEFAULT_SHOPPING_SEARCH_PROMPT, SHOPPING_RECOMMENDATION_CATEGORIES } from "./shopping-engine";

const SHOPPING_STATE_KEY = "ai_phone_shopping_state_v1";
export const SHOPPING_STATE_UPDATED_EVENT = "shopping-state-updated";
const DEFAULT_DELIVERY_MIN_MINUTES = 60;
const DEFAULT_DELIVERY_MAX_MINUTES = 180;

registerKvMigration(SHOPPING_STATE_KEY);

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function normalizeArray<T>(value: unknown, guard: (item: unknown) => T | null): T[] {
  return Array.isArray(value) ? value.map(guard).filter((item): item is T => Boolean(item)) : [];
}

function normalizeRefreshPrompt(value: unknown): string {
  const prompt = cleanText(value, 12000);
  if (!prompt) return DEFAULT_SHOPPING_REFRESH_PROMPT;
  if (prompt.includes("#最近浏览1") || prompt.includes("生成 8 到 12 条最近浏览")) {
    return DEFAULT_SHOPPING_REFRESH_PROMPT;
  }
  return prompt;
}

function normalizeSearchPrompt(value: unknown): string {
  return cleanText(value, 12000) || DEFAULT_SHOPPING_SEARCH_PROMPT;
}

function normalizeDeliveryMinutes(value: unknown, fallback: number): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return Math.min(10080, Math.max(1, Math.round(amount)));
}

function normalizeProduct(value: unknown): ShoppingState["catalog"]["recommendations"][number] | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = cleanText(record.id, 180);
  const title = cleanText(record.title, 200);
  const merchantLabel = cleanText(record.merchantLabel, 120);
  const priceLabel = cleanText(record.priceLabel, 80);
  const previewIcon = cleanText(record.previewIcon, 8);
  const rawTone = record.tone;
  const tone = rawTone === "mist" || rawTone === "blush" || rawTone === "graphite" ? rawTone : "ivory";
  if (!id || !title || !merchantLabel || !priceLabel || !previewIcon) return null;
  const subtitle = cleanText(record.subtitle, 400);
  const detail = cleanText(record.detail, 1200);
  return {
    id,
    title,
    merchantLabel,
    priceLabel,
    tagLabel: cleanText(record.tagLabel, 80) || "商品",
    subtitle: subtitle || detail || title,
    detail: detail || subtitle || title,
    previewIcon,
    tone,
  };
}

function normalizeCategory(value: unknown): ShoppingCategory | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const title = cleanText(record.title, 80);
  const template = SHOPPING_RECOMMENDATION_CATEGORIES.find(category => category.title === title);
  const items = normalizeArray(record.items, normalizeProduct).slice(0, 12);
  if (!title || items.length === 0) return null;
  return {
    id: cleanText(record.id, 80) || template?.id || title,
    title,
    subtitle: cleanText(record.subtitle, 160) || template?.subtitle || "",
    items,
  };
}

function normalizeCartItem(value: unknown): ShoppingState["cartItems"][number] | null {
  const product = normalizeProduct(value);
  if (!product || !value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    ...product,
    tagLabel: product.tagLabel || "购物车",
    quantityLabel: cleanText(record.quantityLabel, 40) || "x 1",
  };
}

function normalizeShippingEvent(value: unknown): ShoppingShippingEvent | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const status = cleanText(record.status, 40);
  if (status !== "ordered" && status !== "shipped" && status !== "delivering" && status !== "delivered") return null;
  const timestamp = cleanText(record.timestamp, 80);
  const time = new Date(timestamp);
  if (!timestamp || Number.isNaN(time.getTime())) return null;
  return {
    status,
    label: cleanText(record.label, 80) || "物流更新",
    timeLabel: cleanText(record.timeLabel, 80) || time.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
    timestamp,
  };
}

function normalizeOrder(value: unknown): ShoppingState["orders"][number] | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = cleanText(record.id, 180);
  const statusLabel = cleanText(record.statusLabel, 80);
  const timeLabel = cleanText(record.timeLabel, 80);
  const totalLabel = cleanText(record.totalLabel, 80);
  const merchantLabel = cleanText(record.merchantLabel, 120);
  const summary = cleanText(record.summary, 400);
  const items = normalizeArray(record.items, normalizeCartItem);
  const rawPaymentStatus = cleanText(record.paymentStatus, 80);
  const paymentStatus = rawPaymentStatus === "paid_by_user"
    || rawPaymentStatus === "payment_requested"
    || rawPaymentStatus === "paid_by_character"
    || rawPaymentStatus === "payment_declined"
    || rawPaymentStatus === "payment_canceled"
    ? rawPaymentStatus
    : undefined;
  if (!id || !statusLabel || !timeLabel || !totalLabel || !merchantLabel || !summary || items.length === 0) {
    return null;
  }
  return {
    id,
    statusLabel,
    timeLabel,
    totalLabel,
    merchantLabel,
    summary,
    note: cleanText(record.note, 800) || summary,
    items,
    shippingTimeline: normalizeArray(record.shippingTimeline, normalizeShippingEvent).slice(0, 8),
    paymentCardId: cleanText(record.paymentCardId, 120) || undefined,
    paymentCardLabel: cleanText(record.paymentCardLabel, 120) || undefined,
    paymentTransactionId: cleanText(record.paymentTransactionId, 120) || undefined,
    paidAt: cleanText(record.paidAt, 80) || undefined,
    paymentStatus,
    paymentRequestId: cleanText(record.paymentRequestId, 120) || undefined,
    payerCharacterId: cleanText(record.payerCharacterId, 120) || undefined,
    payerCharacterName: cleanText(record.payerCharacterName, 120) || undefined,
    paymentRequestedAt: cleanText(record.paymentRequestedAt, 80) || undefined,
    paymentDeclinedAt: cleanText(record.paymentDeclinedAt, 80) || undefined,
    characterPaidAt: cleanText(record.characterPaidAt, 80) || undefined,
  };
}

function normalizeSearchResult(value: unknown): ShoppingSearchResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const query = cleanText(record.query, 80);
  const items = normalizeArray(record.items, normalizeProduct).slice(0, 30);
  if (!query || items.length === 0) return undefined;
  return {
    query,
    items,
    generatedAt: typeof record.generatedAt === "string" ? record.generatedAt : appNowISO(),
  };
}

export function createDefaultShoppingState(): ShoppingState {
  return {
    catalog: {
      categories: [],
      recommendations: [],
    },
    savedItems: [],
    cartItems: [],
    orders: [],
    settings: {
      refreshPrompt: DEFAULT_SHOPPING_REFRESH_PROMPT,
      searchPrompt: DEFAULT_SHOPPING_SEARCH_PROMPT,
      deliveryMinMinutes: DEFAULT_DELIVERY_MIN_MINUTES,
      deliveryMaxMinutes: DEFAULT_DELIVERY_MAX_MINUTES,
    },
    updatedAt: appNowISO(),
  };
}

export function loadShoppingState(): ShoppingState {
  if (typeof window === "undefined") return createDefaultShoppingState();
  try {
    const raw = kvGet(SHOPPING_STATE_KEY);
    if (!raw) return createDefaultShoppingState();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const catalogRaw = parsed.catalog && typeof parsed.catalog === "object"
      ? parsed.catalog as Record<string, unknown>
      : {};
    const settingsRaw = parsed.settings && typeof parsed.settings === "object"
      ? parsed.settings as Record<string, unknown>
      : {};
    const categories = normalizeArray(catalogRaw.categories, normalizeCategory);
    const legacyRecommendations = normalizeArray(catalogRaw.recommendations, normalizeProduct).slice(0, 60);
    const recommendations = categories.length > 0
      ? categories.flatMap(category => category.items)
      : legacyRecommendations;
    const deliveryMinMinutes = normalizeDeliveryMinutes(settingsRaw.deliveryMinMinutes, DEFAULT_DELIVERY_MIN_MINUTES);
    const deliveryMaxMinutes = normalizeDeliveryMinutes(settingsRaw.deliveryMaxMinutes, DEFAULT_DELIVERY_MAX_MINUTES);
    return {
      catalog: {
        categories: categories.length > 0
          ? categories
          : legacyRecommendations.length > 0
            ? [{
              id: "featured",
              title: "精选推荐",
              subtitle: "历史首页推荐",
              items: legacyRecommendations,
            }]
            : [],
        recommendations,
      },
      searchResult: normalizeSearchResult(parsed.searchResult),
      savedItems: normalizeArray(parsed.savedItems, normalizeProduct).slice(0, 80),
      cartItems: normalizeArray(parsed.cartItems, normalizeCartItem).slice(0, 80),
      orders: normalizeArray(parsed.orders, normalizeOrder).slice(0, 80),
      settings: {
        refreshPrompt: normalizeRefreshPrompt(settingsRaw.refreshPrompt),
        searchPrompt: normalizeSearchPrompt(settingsRaw.searchPrompt),
        deliveryMinMinutes: Math.min(deliveryMinMinutes, deliveryMaxMinutes),
        deliveryMaxMinutes: Math.max(deliveryMinMinutes, deliveryMaxMinutes),
      },
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : undefined,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : appNowISO(),
    };
  } catch {
    return createDefaultShoppingState();
  }
}

export function saveShoppingState(state: ShoppingState): ShoppingState {
  const next = { ...state, updatedAt: appNowISO() };
  kvSet(SHOPPING_STATE_KEY, JSON.stringify(next));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SHOPPING_STATE_UPDATED_EVENT));
  }
  return next;
}
