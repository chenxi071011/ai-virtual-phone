import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { appNowISO } from "./app-clock";
import type { WalletAccountType, WalletCard, WalletPaymentInput, WalletPaymentResult, WalletState, WalletTransaction } from "./wallet-types";

const WALLET_STATE_KEY = "ai_phone_wallet_state_v1";
const LEGACY_DEFAULT_WALLET_CARD_ID = "wallet_default_balance_card";
const DEFAULT_WALLET_BANK_CARD_ID = "wallet_default_bank_card";
const DEFAULT_WALLET_BALANCE = 10000;

export const WALLET_BALANCE_ACCOUNT_ID = "wallet_balance_account";
export const WALLET_UPDATED_EVENT = "wallet-state-updated";

registerKvMigration(WALLET_STATE_KEY);

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function normalizeMoney(value: unknown): number {
  const amount = typeof value === "number" ? value : Number(String(value ?? "").replace(/[¥￥元,\s]/g, ""));
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.round(amount * 100) / 100);
}

function normalizeSignedMoney(value: unknown): number {
  const amount = typeof value === "number" ? value : Number(String(value ?? "").replace(/[¥￥元,\s]/g, ""));
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function generateWalletId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isBalanceAccountId(accountId: string | undefined): boolean {
  return !accountId || accountId === WALLET_BALANCE_ACCOUNT_ID || accountId === LEGACY_DEFAULT_WALLET_CARD_ID;
}

function getAccountType(accountId: string): WalletAccountType {
  return isBalanceAccountId(accountId) ? "balance" : "card";
}

function createDefaultWalletCard(now = appNowISO()): WalletCard {
  return {
    id: DEFAULT_WALLET_BANK_CARD_ID,
    title: "储蓄卡",
    bankLabel: "CHAT WALLET",
    maskedNumber: "**** **** **** 0214",
    cardStyle: "graphite",
    balance: 0,
    note: "系统自动创建的默认银行卡",
    accentLabel: "储蓄",
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeCard(value: unknown): WalletCard | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = cleanText(record.id, 120);
  const title = cleanText(record.title, 80);
  if (!id || !title) return null;
  const normalizedTitle = title === "备用余额卡" ? "储蓄卡" : title;
  const rawStyle = cleanText(record.cardStyle, 40);
  const cardStyle = rawStyle === "graphite" || rawStyle === "silver" ? rawStyle : "obsidian";
  const now = appNowISO();
  return {
    id,
    title: normalizedTitle,
    bankLabel: cleanText(record.bankLabel, 80) || "CHAT WALLET",
    maskedNumber: cleanText(record.maskedNumber, 40) || "**** **** **** 0000",
    cardStyle,
    balance: normalizeMoney(record.balance),
    note: cleanText(record.note, 240),
    accentLabel: cleanText(record.accentLabel, 24) || "储蓄",
    isDefault: record.isDefault === true,
    createdAt: cleanText(record.createdAt, 80) || now,
    updatedAt: cleanText(record.updatedAt, 80) || now,
  };
}

function normalizeTransaction(value: unknown): WalletTransaction | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = cleanText(record.id, 120);
  const rawCardId = cleanText(record.cardId, 120);
  const cardId = rawCardId === LEGACY_DEFAULT_WALLET_CARD_ID ? WALLET_BALANCE_ACCOUNT_ID : rawCardId;
  const title = cleanText(record.title, 120);
  const rawKind = cleanText(record.kind, 40);
  const kind = rawKind === "payment" || rawKind === "adjustment" || rawKind === "transfer_out" || rawKind === "refund"
    ? rawKind
    : "transfer_in";
  if (!id || !cardId || !title) return null;
  const rawAccountType = cleanText(record.accountType, 40);
  return {
    id,
    cardId,
    accountType: rawAccountType === "card" || rawAccountType === "balance" ? rawAccountType : getAccountType(cardId),
    title,
    amount: normalizeSignedMoney(record.amount),
    kind,
    category: cleanText(record.category, 80) || "余额",
    createdAt: cleanText(record.createdAt, 80) || appNowISO(),
    detail: cleanText(record.detail, 400),
    balanceAfter: normalizeMoney(record.balanceAfter),
    relatedOrderId: cleanText(record.relatedOrderId, 120) || undefined,
  };
}

function normalizeWalletState(state: WalletState): WalletState {
  const now = appNowISO();
  const cards = state.cards.length > 0 ? state.cards : [createDefaultWalletCard(now)];
  const defaultCardId = cards.some(card => card.id === state.defaultCardId) ? state.defaultCardId : cards[0].id;
  return {
    balance: normalizeMoney(state.balance),
    cards: cards.map(card => ({
      ...card,
      isDefault: card.id === defaultCardId,
      balance: normalizeMoney(card.balance),
    })),
    transactions: state.transactions.slice(0, 300),
    defaultCardId,
    updatedAt: state.updatedAt || now,
  };
}

export function createDefaultWalletState(): WalletState {
  const now = appNowISO();
  const card = createDefaultWalletCard(now);
  return {
    balance: DEFAULT_WALLET_BALANCE,
    cards: [card],
    transactions: [{
      id: "wallet_initial_balance",
      cardId: WALLET_BALANCE_ACCOUNT_ID,
      accountType: "balance",
      title: "初始余额",
      amount: DEFAULT_WALLET_BALANCE,
      kind: "transfer_in",
      category: "初始化",
      createdAt: now,
      detail: "系统自动创建余额账户",
      balanceAfter: DEFAULT_WALLET_BALANCE,
    }],
    defaultCardId: card.id,
    updatedAt: now,
  };
}

function migrateLegacyParsedState(parsed: Record<string, unknown>): WalletState {
  const now = appNowISO();
  const rawCards = Array.isArray(parsed.cards)
    ? parsed.cards.map(normalizeCard).filter((card): card is WalletCard => Boolean(card))
    : [];
  const legacyBalanceCard = rawCards.find(card => card.id === LEGACY_DEFAULT_WALLET_CARD_ID || card.title === "默认余额卡");
  const explicitBalance = normalizeMoney(parsed.balance);
  const balance = typeof parsed.balance === "number" || typeof parsed.balance === "string"
    ? explicitBalance
    : normalizeMoney(legacyBalanceCard?.balance ?? 0);
  const cards = rawCards.filter(card => card.id !== LEGACY_DEFAULT_WALLET_CARD_ID && card.title !== "默认余额卡");
  const normalizedCards = cards.length > 0 ? cards : [createDefaultWalletCard(now)];
  const transactions = Array.isArray(parsed.transactions)
    ? parsed.transactions.map(normalizeTransaction).filter((transaction): transaction is WalletTransaction => Boolean(transaction))
    : [];
  const defaultCardId = cleanText(parsed.defaultCardId, 120);
  return normalizeWalletState({
    balance,
    cards: normalizedCards,
    transactions,
    defaultCardId: normalizedCards.some(card => card.id === defaultCardId) ? defaultCardId : normalizedCards[0].id,
    updatedAt: cleanText(parsed.updatedAt, 80) || now,
  });
}

export function loadWalletState(): WalletState {
  if (typeof window === "undefined") return createDefaultWalletState();
  try {
    const raw = kvGet(WALLET_STATE_KEY);
    if (!raw) {
      const next = createDefaultWalletState();
      saveWalletState(next);
      return next;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next = migrateLegacyParsedState(parsed);
    if (!("balance" in parsed) || next.cards.length === 0) saveWalletState(next);
    return next;
  } catch {
    const next = createDefaultWalletState();
    saveWalletState(next);
    return next;
  }
}

export function saveWalletState(state: WalletState): WalletState {
  const next = normalizeWalletState({ ...state, updatedAt: appNowISO() });
  kvSet(WALLET_STATE_KEY, JSON.stringify(next));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(WALLET_UPDATED_EVENT, { detail: next }));
  }
  return next;
}

export function formatWalletAmount(amount: number): string {
  const safeAmount = normalizeMoney(amount);
  return `¥${safeAmount.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function getWalletBalance(state: WalletState): number {
  return normalizeMoney(state.balance);
}

export function getWalletTotalBalance(state: WalletState): number {
  return normalizeMoney(state.balance) + state.cards.reduce((sum, card) => sum + normalizeMoney(card.balance), 0);
}

export function createWalletCard(input?: Partial<Pick<WalletCard, "title" | "bankLabel" | "maskedNumber" | "cardStyle" | "balance" | "note" | "accentLabel">>): WalletState {
  const current = loadWalletState();
  const now = appNowISO();
  const card: WalletCard = {
    id: generateWalletId("wallet_card"),
    title: cleanText(input?.title, 80) || "储蓄卡",
    bankLabel: cleanText(input?.bankLabel, 80) || "CHAT WALLET",
    maskedNumber: cleanText(input?.maskedNumber, 40) || `**** **** **** ${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`,
    cardStyle: input?.cardStyle === "graphite" || input?.cardStyle === "silver" ? input.cardStyle : "obsidian",
    balance: normalizeMoney(input?.balance),
    note: cleanText(input?.note, 240),
    accentLabel: cleanText(input?.accentLabel, 24) || "储蓄",
    isDefault: current.cards.length === 0,
    createdAt: now,
    updatedAt: now,
  };
  return saveWalletState({
    ...current,
    cards: [card, ...current.cards],
    defaultCardId: current.cards.length === 0 ? card.id : current.defaultCardId,
  });
}

export function deleteWalletCard(cardId: string): { ok: boolean; state: WalletState; error?: string } {
  const current = loadWalletState();
  if (current.cards.length <= 1) {
    return { ok: false, state: current, error: "至少需要保留一张银行卡。" };
  }
  const nextCards = current.cards.filter(card => card.id !== cardId);
  if (nextCards.length === current.cards.length) return { ok: false, state: current, error: "未找到这张卡。" };
  const defaultCardId = current.defaultCardId === cardId ? nextCards[0].id : current.defaultCardId;
  const next = saveWalletState({
    ...current,
    cards: nextCards,
    defaultCardId,
    transactions: current.transactions.filter(transaction => transaction.cardId !== cardId),
  });
  return { ok: true, state: next };
}

export function setDefaultWalletCard(cardId: string): WalletState {
  const current = loadWalletState();
  if (!current.cards.some(card => card.id === cardId)) return current;
  return saveWalletState({ ...current, defaultCardId: cardId });
}

function createTransaction(input: {
  accountId: string;
  accountType: WalletAccountType;
  title: string;
  amount: number;
  kind: WalletTransaction["kind"];
  category: string;
  detail: string;
  balanceAfter: number;
  relatedOrderId?: string;
}): WalletTransaction {
  return {
    id: generateWalletId("wallet_tx"),
    cardId: input.accountId,
    accountType: input.accountType,
    title: cleanText(input.title, 120),
    amount: normalizeSignedMoney(input.amount),
    kind: input.kind,
    category: cleanText(input.category, 80),
    createdAt: appNowISO(),
    detail: cleanText(input.detail, 400),
    balanceAfter: normalizeMoney(input.balanceAfter),
    relatedOrderId: cleanText(input.relatedOrderId, 120) || undefined,
  };
}

export function transferCardToWalletBalance(cardId: string, amount: number): { ok: boolean; state: WalletState; transactions?: WalletTransaction[]; error?: string } {
  const current = loadWalletState();
  const transferAmount = normalizeMoney(amount);
  if (transferAmount <= 0) return { ok: false, state: current, error: "转入金额需要大于 0。" };
  const card = current.cards.find(item => item.id === cardId);
  if (!card) return { ok: false, state: current, error: "未找到这张银行卡。" };
  if (normalizeMoney(card.balance) < transferAmount) {
    return { ok: false, state: current, error: "该银行卡余额不足，无法转入余额。" };
  }
  const now = appNowISO();
  const balanceAfter = normalizeMoney(current.balance + transferAmount);
  const cardBalanceAfter = normalizeMoney(card.balance - transferAmount);
  const balanceTransaction = createTransaction({
    accountId: WALLET_BALANCE_ACCOUNT_ID,
    accountType: "balance",
    title: "银行卡转入余额",
    amount: transferAmount,
    kind: "transfer_in",
    category: "转入",
    detail: `${card.title} 转入余额 ${formatWalletAmount(transferAmount)}`,
    balanceAfter,
  });
  const cardTransaction = createTransaction({
    accountId: card.id,
    accountType: "card",
    title: "转入余额",
    amount: -transferAmount,
    kind: "transfer_out",
    category: "转入余额",
    detail: `转入余额 ${formatWalletAmount(transferAmount)}`,
    balanceAfter: cardBalanceAfter,
  });
  const next = saveWalletState({
    ...current,
    balance: balanceAfter,
    cards: current.cards.map(item => item.id === card.id ? { ...item, balance: cardBalanceAfter, updatedAt: now } : item),
    transactions: [balanceTransaction, cardTransaction, ...current.transactions],
  });
  return { ok: true, state: next, transactions: [balanceTransaction, cardTransaction] };
}

export function transferWalletBalanceToCard(cardId: string, amount: number): { ok: boolean; state: WalletState; transactions?: WalletTransaction[]; error?: string } {
  const current = loadWalletState();
  const transferAmount = normalizeMoney(amount);
  if (transferAmount <= 0) return { ok: false, state: current, error: "提现金额需要大于 0。" };
  const card = current.cards.find(item => item.id === cardId);
  if (!card) return { ok: false, state: current, error: "未找到这张银行卡。" };
  if (normalizeMoney(current.balance) < transferAmount) {
    return { ok: false, state: current, error: "余额不足，无法提现。" };
  }
  const now = appNowISO();
  const balanceAfter = normalizeMoney(current.balance - transferAmount);
  const cardBalanceAfter = normalizeMoney(card.balance + transferAmount);
  const balanceTransaction = createTransaction({
    accountId: WALLET_BALANCE_ACCOUNT_ID,
    accountType: "balance",
    title: "提现到银行卡",
    amount: -transferAmount,
    kind: "transfer_out",
    category: "提现",
    detail: `提现到 ${card.title} ${formatWalletAmount(transferAmount)}`,
    balanceAfter,
  });
  const cardTransaction = createTransaction({
    accountId: card.id,
    accountType: "card",
    title: "余额提现到账",
    amount: transferAmount,
    kind: "transfer_in",
    category: "提现",
    detail: `余额提现到账 ${formatWalletAmount(transferAmount)}`,
    balanceAfter: cardBalanceAfter,
  });
  const next = saveWalletState({
    ...current,
    balance: balanceAfter,
    cards: current.cards.map(item => item.id === card.id ? { ...item, balance: cardBalanceAfter, updatedAt: now } : item),
    transactions: [balanceTransaction, cardTransaction, ...current.transactions],
  });
  return { ok: true, state: next, transactions: [balanceTransaction, cardTransaction] };
}

export function adjustWalletCardAccount(
  cardId: string,
  amount: number,
  direction: "in" | "out",
): { ok: boolean; state: WalletState; transaction?: WalletTransaction; error?: string } {
  const current = loadWalletState();
  const transferAmount = normalizeMoney(amount);
  if (transferAmount <= 0) return { ok: false, state: current, error: "金额需要大于 0。" };
  const card = current.cards.find(item => item.id === cardId);
  if (!card) return { ok: false, state: current, error: "未找到这张银行卡。" };
  const signedAmount = direction === "in" ? transferAmount : -transferAmount;
  const balanceAfter = normalizeMoney(card.balance + signedAmount);
  if (direction === "out" && normalizeMoney(card.balance) < transferAmount) {
    return { ok: false, state: current, error: "该银行卡余额不足，无法转出账户。" };
  }
  const now = appNowISO();
  const transaction = createTransaction({
    accountId: card.id,
    accountType: "card",
    title: direction === "in" ? "转入账户" : "转出账户",
    amount: signedAmount,
    kind: direction === "in" ? "transfer_in" : "transfer_out",
    category: "银行卡账户",
    detail: `${card.title} ${direction === "in" ? "转入账户" : "转出账户"} ${formatWalletAmount(transferAmount)}`,
    balanceAfter,
  });
  const next = saveWalletState({
    ...current,
    cards: current.cards.map(item => item.id === card.id ? { ...item, balance: balanceAfter, updatedAt: now } : item),
    transactions: [transaction, ...current.transactions],
  });
  return { ok: true, state: next, transaction };
}

export function creditWalletBalance(amount: number, title: string, detail: string, category = "余额"): WalletPaymentResult {
  const current = loadWalletState();
  const creditAmount = normalizeMoney(amount);
  if (creditAmount <= 0) return { ok: false, state: current, error: "入账金额无效。" };
  const balanceAfter = normalizeMoney(current.balance + creditAmount);
  const transaction = createTransaction({
    accountId: WALLET_BALANCE_ACCOUNT_ID,
    accountType: "balance",
    title: title || "余额入账",
    amount: creditAmount,
    kind: "transfer_in",
    category,
    detail,
    balanceAfter,
  });
  const next = saveWalletState({
    ...current,
    balance: balanceAfter,
    transactions: [transaction, ...current.transactions],
  });
  return { ok: true, state: next, transaction };
}

export function payWithWalletAccount(input: WalletPaymentInput): WalletPaymentResult {
  const current = loadWalletState();
  const paymentAmount = normalizeMoney(input.amount);
  if (paymentAmount <= 0) return { ok: false, state: current, error: "付款金额无效。" };
  const accountId = input.accountId || input.cardId || WALLET_BALANCE_ACCOUNT_ID;
  const now = appNowISO();

  if (isBalanceAccountId(accountId)) {
    if (normalizeMoney(current.balance) < paymentAmount) {
      return { ok: false, state: current, error: "余额不足，无法完成付款。" };
    }
    const balanceAfter = normalizeMoney(current.balance - paymentAmount);
    const transaction = createTransaction({
      accountId: WALLET_BALANCE_ACCOUNT_ID,
      accountType: "balance",
      title: cleanText(input.title, 120) || "余额付款",
      amount: -paymentAmount,
      kind: "payment",
      category: cleanText(input.category, 80) || "付款",
      detail: cleanText(input.detail, 400) || "余额付款",
      balanceAfter,
      relatedOrderId: input.relatedOrderId,
    });
    const next = saveWalletState({
      ...current,
      balance: balanceAfter,
      transactions: [transaction, ...current.transactions],
    });
    return { ok: true, state: next, transaction };
  }

  const card = current.cards.find(item => item.id === accountId);
  if (!card) return { ok: false, state: current, error: "未找到付款银行卡。" };
  if (normalizeMoney(card.balance) < paymentAmount) {
    return { ok: false, state: current, error: "该银行卡余额不足，无法完成付款。" };
  }
  const balanceAfter = normalizeMoney(card.balance - paymentAmount);
  const transaction = createTransaction({
    accountId: card.id,
    accountType: "card",
    title: cleanText(input.title, 120) || "银行卡付款",
    amount: -paymentAmount,
    kind: "payment",
    category: cleanText(input.category, 80) || "付款",
    detail: cleanText(input.detail, 400) || "银行卡付款",
    balanceAfter,
    relatedOrderId: input.relatedOrderId,
  });
  const next = saveWalletState({
    ...current,
    cards: current.cards.map(item => item.id === card.id ? { ...item, balance: balanceAfter, updatedAt: now } : item),
    transactions: [transaction, ...current.transactions],
  });
  return { ok: true, state: next, transaction };
}

export function payWithWalletBalance(input: Omit<WalletPaymentInput, "accountId" | "cardId">): WalletPaymentResult {
  return payWithWalletAccount({ ...input, accountId: WALLET_BALANCE_ACCOUNT_ID });
}

export function payWithWalletCard(input: WalletPaymentInput): WalletPaymentResult {
  return payWithWalletAccount({ ...input, accountId: input.cardId || input.accountId });
}
