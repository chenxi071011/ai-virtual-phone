import { loadShoppingState, saveShoppingState } from "./shopping-storage";
import { appNow } from "./app-clock";
import type { ShoppingOrder, ShoppingShippingEvent, ShoppingState } from "./shopping-types";

export type ShoppingPaymentStatus =
  | "paid_by_user"
  | "payment_requested"
  | "paid_by_character"
  | "payment_declined"
  | "payment_canceled";

export type ShoppingPaymentRequestItem = {
  title: string;
  detail: string;
  priceLabel: string;
  quantityLabel: string;
};

type PaymentRequestOrderItem = Pick<ShoppingOrder["items"][number], "title" | "subtitle" | "detail" | "priceLabel" | "quantityLabel">;

const DEFAULT_DELIVERY_MIN_MINUTES = 60;
const DEFAULT_DELIVERY_MAX_MINUTES = 180;

function cleanPaymentSegment(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\]\r\n]/g, " ")
    .replace(/[;/]/g, " ")
    .trim();
}

function cleanPaymentItemsText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\]\r\n]/g, " ")
    .trim();
}

function parseShoppingQuantity(label?: string): number {
  const match = String(label ?? "").match(/\d+/);
  if (!match) return 1;
  const quantity = Number(match[0]);
  return Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1;
}

function formatShoppingDateTime(date: Date): string {
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeDeliveryMinutes(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(10080, Math.max(1, Math.round(value)));
}

function normalizeDeliverySettings(settings: Pick<ShoppingState["settings"], "deliveryMinMinutes" | "deliveryMaxMinutes">) {
  const min = normalizeDeliveryMinutes(settings.deliveryMinMinutes, DEFAULT_DELIVERY_MIN_MINUTES);
  const max = normalizeDeliveryMinutes(settings.deliveryMaxMinutes, DEFAULT_DELIVERY_MAX_MINUTES);
  return {
    deliveryMinMinutes: Math.min(min, max),
    deliveryMaxMinutes: Math.max(min, max),
  };
}

function getStableShoppingHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function pickShoppingDurationMinutes(orderId: string, minMinutes: number, maxMinutes: number): number {
  const range = Math.max(0, maxMinutes - minMinutes);
  if (range === 0) return minMinutes;
  return minMinutes + (getStableShoppingHash(`${orderId}:delivery`) % (range + 1));
}

function addShoppingMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function buildShoppingShippingTimeline(
  orderId: string,
  orderedAt: Date,
  settings: ShoppingState["settings"],
): ShoppingShippingEvent[] {
  const deliverySettings = normalizeDeliverySettings(settings);
  const totalMinutes = pickShoppingDurationMinutes(
    orderId,
    deliverySettings.deliveryMinMinutes,
    deliverySettings.deliveryMaxMinutes,
  );
  const shippedOffset = Math.max(1, Math.floor(totalMinutes * 0.18));
  const deliveringOffset = Math.max(shippedOffset, Math.floor(totalMinutes * 0.55));
  const timeline = [
    { status: "ordered" as const, label: "已下单", date: orderedAt },
    { status: "shipped" as const, label: "已发货", date: addShoppingMinutes(orderedAt, Math.min(shippedOffset, totalMinutes)) },
    { status: "delivering" as const, label: "配送中", date: addShoppingMinutes(orderedAt, Math.min(deliveringOffset, totalMinutes)) },
    { status: "delivered" as const, label: "已到货", date: addShoppingMinutes(orderedAt, totalMinutes) },
  ];
  return timeline.map(event => ({
    status: event.status,
    label: event.label,
    timeLabel: formatShoppingDateTime(event.date),
    timestamp: event.date.toISOString(),
  }));
}

export function createShoppingPaymentRequestId(): string {
  return `pay_req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function buildShoppingPaymentRequestItems(items: PaymentRequestOrderItem[]): ShoppingPaymentRequestItem[] {
  return items.map(item => ({
    title: cleanPaymentSegment(item.title) || "商品",
    detail: cleanPaymentSegment(item.detail || item.subtitle || item.title) || "商品详情",
    priceLabel: cleanPaymentSegment(item.priceLabel) || "¥0",
    quantityLabel: `x${parseShoppingQuantity(item.quantityLabel)}`,
  }));
}

export function formatShoppingPaymentRequestItems(items: ShoppingPaymentRequestItem[]): string {
  return items
    .map(item => [
      cleanPaymentSegment(item.title) || "商品",
      cleanPaymentSegment(item.detail) || "商品详情",
      cleanPaymentSegment(item.priceLabel) || "¥0",
      cleanPaymentSegment(item.quantityLabel) || "x1",
    ].join("/"))
    .join("; ");
}

export function formatShoppingPaymentAmountForHistory(amount: unknown, fallback?: string): string {
  const numeric = typeof amount === "number" ? amount : Number(amount);
  if (Number.isFinite(numeric)) return numeric.toFixed(2);
  return cleanPaymentSegment(fallback) || "0.00";
}

export function formatShoppingPaymentRequestHistory(input: {
  amount?: number;
  amountLabel?: string;
  items?: ShoppingPaymentRequestItem[];
  itemsText?: string;
}): string {
  const amount = formatShoppingPaymentAmountForHistory(input.amount, input.amountLabel);
  const itemsText = input.items && input.items.length > 0
    ? formatShoppingPaymentRequestItems(input.items)
    : cleanPaymentItemsText(input.itemsText) || "商品";
  return `[代付请求:${amount}:${itemsText}]`;
}

export function settleShoppingPaymentRequest(input: {
  orderId?: string;
  requestId?: string;
  accepted: boolean;
  payerCharacterId?: string;
  payerCharacterName?: string;
}): ShoppingOrder | null {
  if (!input.orderId && !input.requestId) return null;
  const state = loadShoppingState();
  let updatedOrder: ShoppingOrder | null = null;
  const now = appNow();
  const nextOrders = state.orders.map(order => {
    const matches = (input.orderId && order.id === input.orderId)
      || (input.requestId && order.paymentRequestId === input.requestId);
    if (!matches) return order;

    if (input.accepted) {
      const paidOrder: ShoppingOrder = {
        ...order,
        statusLabel: "待发货",
        paymentStatus: "paid_by_character",
        payerCharacterId: input.payerCharacterId || order.payerCharacterId,
        payerCharacterName: input.payerCharacterName || order.payerCharacterName,
        paymentCardLabel: input.payerCharacterName ? `${input.payerCharacterName}代付` : "TA代付",
        paidAt: now.toISOString(),
        characterPaidAt: now.toISOString(),
        shippingTimeline: buildShoppingShippingTimeline(order.id, now, state.settings),
      };
      updatedOrder = paidOrder;
      return paidOrder;
    }

    const declinedOrder: ShoppingOrder = {
      ...order,
      statusLabel: "已拒绝代付",
      paymentStatus: "payment_declined",
      paymentDeclinedAt: now.toISOString(),
    };
    updatedOrder = declinedOrder;
    return declinedOrder;
  });

  if (!updatedOrder) return null;
  saveShoppingState({ ...state, orders: nextOrders });
  return updatedOrder;
}
