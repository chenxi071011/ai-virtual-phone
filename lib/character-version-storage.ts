import type { Character } from "./character-types";
import { kvGet, kvSet, registerKvMigration } from "./kv-db";

const STORAGE_KEY = "ai_phone_character_versions_v1";
const MAX_VERSIONS_PER_CHARACTER = 30;
registerKvMigration(STORAGE_KEY);

export type CharacterVersionSource = "manual" | "mascot" | "restore" | "switch";

export type CharacterVersion = {
  id: string;
  characterId: string;
  version: number;
  label: string;
  createdAt: string;
  source: CharacterVersionSource;
  data: Character;
};

type CharacterVersionState = {
  currentVersion: number;
  versions: CharacterVersion[];
};

type CharacterVersionStore = Record<string, CharacterVersionState>;

function cloneCharacter(character: Character): Character {
  return JSON.parse(JSON.stringify(character)) as Character;
}

function loadStore(): CharacterVersionStore {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(kvGet(STORAGE_KEY) || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as CharacterVersionStore
      : {};
  } catch {
    return {};
  }
}

function saveStore(store: CharacterVersionStore): void {
  if (typeof window === "undefined") return;
  kvSet(STORAGE_KEY, JSON.stringify(store));
}

function normalizeState(state?: CharacterVersionState): CharacterVersionState {
  return {
    currentVersion: Math.max(1, Number(state?.currentVersion) || 1),
    versions: Array.isArray(state?.versions) ? state.versions : [],
  };
}

export function getCharacterCurrentVersion(characterId: string): number {
  return normalizeState(loadStore()[characterId]).currentVersion;
}

export function getCharacterNextVersion(characterId: string): number {
  const state = normalizeState(loadStore()[characterId]);
  return Math.max(state.currentVersion, ...state.versions.map(item => item.version)) + 1;
}

/**
 * 覆盖当前版本：删除当前编号的旧快照，并将修改后的角色推进到历史最高编号之后。
 */
export function overwriteCharacterVersion(characterId: string): number {
  const store = loadStore();
  const state = normalizeState(store[characterId]);
  const overwrittenVersion = state.currentVersion;
  const highestVersion = Math.max(overwrittenVersion, ...state.versions.map(item => item.version));

  state.versions = state.versions.filter(item => item.version !== overwrittenVersion);
  state.currentVersion = highestVersion + 1;
  store[characterId] = state;
  saveStore(store);
  return state.currentVersion;
}

export function loadCharacterVersions(characterId: string): CharacterVersion[] {
  return [...normalizeState(loadStore()[characterId]).versions]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 保存修改前的完整角色卡，并返回修改完成后的当前版本号。 */
export function backupCharacterVersion(
  character: Character,
  source: CharacterVersionSource,
  label?: string,
): number {
  const store = loadStore();
  const state = normalizeState(store[character.id]);
  const snapshotVersion = state.currentVersion;
  const snapshot: CharacterVersion = {
    id: `charver_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    characterId: character.id,
    version: snapshotVersion,
    label: label?.trim() || (source === "mascot"
      ? "小卷修改前自动备份"
      : source === "restore"
        ? "恢复版本前自动备份"
        : "修改前备份"),
    createdAt: new Date().toISOString(),
    source,
    data: cloneCharacter(character),
  };

  const highestVersion = Math.max(snapshotVersion, ...state.versions.map(item => item.version));
  state.currentVersion = highestVersion + 1;
  state.versions = [...state.versions.filter(item => item.version !== snapshotVersion), snapshot]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-MAX_VERSIONS_PER_CHARACTER);
  store[character.id] = state;
  saveStore(store);
  return state.currentVersion;
}

/** 切换版本不创建新编号；切走前同步当前编号快照，保证之后可以无损切回。 */
export function switchCharacterVersion(character: Character, target: CharacterVersion): number {
  const store = loadStore();
  const state = normalizeState(store[character.id]);
  const currentVersion = state.currentVersion;
  if (currentVersion === target.version) return currentVersion;

  const existingSnapshot = state.versions.find(item => item.version === currentVersion);
  const currentSnapshot: CharacterVersion = {
    id: existingSnapshot?.id || `charver_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    characterId: character.id,
    version: currentVersion,
    label: existingSnapshot?.label || "切换时保留",
    createdAt: existingSnapshot?.createdAt || new Date().toISOString(),
    source: existingSnapshot?.source || "switch",
    data: cloneCharacter(character),
  };

  state.versions = [...state.versions.filter(item => item.version !== currentVersion), currentSnapshot]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-MAX_VERSIONS_PER_CHARACTER);
  state.currentVersion = target.version;
  store[character.id] = state;
  saveStore(store);
  return state.currentVersion;
}

export function deleteCharacterVersion(characterId: string, versionId: string): void {
  const store = loadStore();
  const state = normalizeState(store[characterId]);
  state.versions = state.versions.filter(version => version.id !== versionId);
  store[characterId] = state;
  saveStore(store);
}

export function clearCharacterVersions(characterId: string): void {
  const store = loadStore();
  if (!(characterId in store)) return;
  delete store[characterId];
  saveStore(store);
}
