import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { appNowISO } from "./app-clock";
// lib/css-scheme-storage.ts
// CSS 方案存储 — 保存/加载/删除用户的 CSS 方案

const STORAGE_KEY = "css-schemes-v1";
registerKvMigration(STORAGE_KEY);

export type CSSScheme = {
  id: string;
  name: string;
  css: string;
  target: string; // "global" | "chat_app" | "chat_session" | "story" | "music" | "calendar"
  createdAt: string;
};

function loadAll(): CSSScheme[] {
  try {
    return JSON.parse(kvGet(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveAll(schemes: CSSScheme[]) {
  kvSet(STORAGE_KEY, JSON.stringify(schemes));
}

/** Get all schemes for a given CSS target */
export function getSchemes(target: string): CSSScheme[] {
  return loadAll().filter(s => s.target === target);
}

/** Save current CSS as a named scheme */
export function saveScheme(target: string, name: string, css: string): CSSScheme {
  const all = loadAll();
  const scheme: CSSScheme = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    css,
    target,
    createdAt: appNowISO(),
  };
  all.push(scheme);
  saveAll(all);
  return scheme;
}

/** Delete a scheme by id */
export function deleteScheme(id: string) {
  saveAll(loadAll().filter(s => s.id !== id));
}

/** Rename a scheme */
export function renameScheme(id: string, name: string) {
  const all = loadAll();
  const s = all.find(x => x.id === id);
  if (s) s.name = name;
  saveAll(all);
}
