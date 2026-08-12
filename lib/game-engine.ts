import { loadCharacters } from "./character-storage";
import { appNow } from "./app-clock";
import type { Character } from "./character-types";
import { ChatEngineError, sendLLMRequest } from "./chat-engine";
import { buildCalendarScheduleMarker } from "./calendar-storage";
import { getWeekStartIso } from "./calendar-utils";
import { assemblePromptPayload, type LLMMessage } from "./llm-prompt-assembler";
import { formatCoreMemories, formatLongTermMemories } from "./memory-injector";
import { loadMemoryConfig } from "./memory-storage";
import { retrieveCoreMemoriesForPrompt, retrieveMemoriesForPrompt } from "./memory-service";
import { prepareShortTermContext } from "./short-term-assembler";
import {
  loadApiConfigs,
  loadBindingConfig,
  loadPresets,
  loadRegexes,
  loadWorldBooks,
  resolveBinding,
  resolveUserIdentity,
} from "./settings-storage";
import type { ApiConfig, PresetConfig, RegexConfig, WorldBookConfig } from "./settings-types";
import type { GameRolePackage, GameRolePackageMode } from "./game-types";

const GAME_BINDING_APP_ID = "game";
const GAME_PROMPT_APP_ID = "game";
const GAME_PROMPT_TAGS = ["game"];

type GameConfigs = {
  character?: Character;
  apiConfig: ApiConfig;
  preset: PresetConfig | null;
  regexes: RegexConfig[];
  worldBooks: WorldBookConfig[];
};

function estimateTokensFromMessages(messages: LLMMessage[]): number {
  const text = messages.map(message => {
    if (typeof message.content === "string") return message.content;
    return message.content.map(part => part.type === "text" ? part.text : "[image]").join("\n");
  }).join("\n\n");
  return Math.ceil(text.length / 3);
}

function resolveGameConfigs(characterId?: string): GameConfigs {
  const character = characterId ? loadCharacters().find(item => item.id === characterId) : undefined;
  if (characterId && !character) throw new ChatEngineError(`Character not found: ${characterId}`);

  const bindings = loadBindingConfig();
  const activeSlot = resolveBinding(bindings, characterId, GAME_BINDING_APP_ID);
  if (!activeSlot.apiConfigId) {
    throw new ChatEngineError(character
      ? `No API Configuration bound for ${character.name}. Please go to Settings -> 绑定管理 -> 游戏 to assign one.`
      : "No API Configuration bound for game.");
  }

  const apiConfig = loadApiConfigs().find(config => config.id === activeSlot.apiConfigId);
  if (!apiConfig) throw new ChatEngineError(character ? `API Configuration not found for ${character.name}.` : "API Configuration not found for game.");

  const presets = loadPresets();
  let preset = activeSlot.presetId ? presets.find(item => item.id === activeSlot.presetId) || null : null;
  if (!preset) preset = presets.find(item => item.builtIn) ?? null;

  const allRegexes = loadRegexes();
  const regexes = (activeSlot.regexIds || [])
    .map(id => allRegexes.find(regex => regex.id === id))
    .filter(Boolean) as RegexConfig[];

  const allWorldBooks = loadWorldBooks();
  const worldBooks = (activeSlot.worldBookIds || [])
    .map(id => allWorldBooks.find(worldBook => worldBook.id === id))
    .filter(Boolean) as WorldBookConfig[];

  return { character, apiConfig, preset, regexes, worldBooks };
}

export async function buildGameRolePackage(input: {
  characterId: string;
  slotId?: string;
  mode: GameRolePackageMode;
  activationContext?: string;
}): Promise<GameRolePackage> {
  const configs = resolveGameConfigs(input.characterId);
  if (!configs.character) throw new ChatEngineError(`Character not found: ${input.characterId}`);

  const userIdentity = resolveUserIdentity(input.characterId, GAME_BINDING_APP_ID);
  const userName = userIdentity?.name || "用户";
  const memConfig = loadMemoryConfig();

  const shortTerm = input.mode === "full"
    ? prepareShortTermContext(input.characterId, GAME_PROMPT_APP_ID, { userName, history: [] })
    : null;
  const activationContext = input.activationContext?.trim()
    || shortTerm?.wbActivationContext
    || configs.character.persona
    || configs.character.name;

  const [memories, coreMemories] = await Promise.all([
    retrieveMemoriesForPrompt(input.characterId, activationContext, memConfig).catch(() => null),
    retrieveCoreMemoriesForPrompt(input.characterId, memConfig).catch(() => null),
  ]);

  const messages = assemblePromptPayload({
    character: configs.character,
    history: shortTerm?.truncatedHistory ?? [],
    preset: configs.preset,
    worldBooks: configs.worldBooks,
    regexes: configs.regexes,
    userIdentity,
    appId: GAME_PROMPT_APP_ID,
    appTags: GAME_PROMPT_TAGS,
    scheduleSummary: input.mode === "full"
      ? buildCalendarScheduleMarker("character", input.characterId, getWeekStartIso(appNow()))
      : "",
    coreMemories: coreMemories ? formatCoreMemories(coreMemories) : "",
    longTermMemories: memories ? formatLongTermMemories(memories) : "",
    worldBookActivationContext: activationContext,
    recentBlocks: shortTerm?.recentBlocks ?? [],
    unifiedRecentItems: shortTerm?.unifiedRecentItems ?? [],
  });

  return {
    characterId: input.characterId,
    characterName: configs.character.name,
    slotId: input.slotId,
    mode: input.mode,
    messages,
    tokenEstimate: estimateTokensFromMessages(messages),
  };
}

export async function callGameLLM(input: {
  messages: LLMMessage[];
  characterId?: string;
}): Promise<{ content: string; model: string; presetName: string }> {
  const configs = resolveGameConfigs(input.characterId);
  const characterName = configs.character?.name || "游戏";
  const userName = input.characterId
    ? resolveUserIdentity(input.characterId, GAME_BINDING_APP_ID)?.name || "用户"
    : "用户";
  const content = await sendLLMRequest(configs.apiConfig, configs.preset, input.messages, configs.regexes, {
    characterName,
    userName,
  }, {
    appId: GAME_PROMPT_APP_ID,
    appTags: GAME_PROMPT_TAGS,
  });
  return {
    content,
    model: configs.apiConfig.defaultModel,
    presetName: configs.preset?.name || "默认预设",
  };
}
