import { loadCharacters } from "./character-storage";
import { appNow, appNowISO } from "./app-clock";
import type { Character } from "./character-types";
import type { ChatMessage } from "./chat-storage";
import { buildCalendarScheduleMarker } from "./calendar-storage";
import { getWeekStartIso } from "./calendar-utils";
import { ChatEngineError, sendLLMRequest } from "./chat-engine";
import { assemblePromptPayload, type LLMMessage } from "./llm-prompt-assembler";
import { MacroEngine, postProcessTrim } from "./macro-engine";
import { loadMemoryConfig, incrementEventCounter } from "./memory-storage";
import { formatCoreMemories, formatLongTermMemories } from "./memory-injector";
import { retrieveCoreMemoriesForPrompt, retrieveMemoriesForPrompt } from "./memory-service";
import { maybeRunSummarization } from "./memory-summarizer";
import { prepareShortTermContext } from "./short-term-assembler";
import {
  appendBlackMarketSceneMessage,
  endBlackMarketSceneSession,
  getBlackMarketSceneSession,
  loadBlackMarketState,
  recordBlackMarketTheaterProjectionEvent,
} from "./black-market-storage";
import type { BlackMarketOwnedTheater, BlackMarketSceneMessage, BlackMarketSceneSession, BlackMarketTheaterTemplate } from "./black-market-types";
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
import { simpleLLMCall } from "./api-helpers";

type SceneConfigs = {
  character: Character;
  apiConfig: ApiConfig;
  preset: PresetConfig | null;
  regexes: RegexConfig[];
  worldBooks: WorldBookConfig[];
};

const BLACK_MARKET_BINDING_APP_ID = "shopping";
const BLACK_MARKET_PROMPT_APP_ID = "black_market_theater";
const BLACK_MARKET_PROMPT_TAGS = ["black_market_theater"];

export type BlackMarketSceneGenerationResult = {
  session: BlackMarketSceneSession;
  reply: string;
  promptMessages: LLMMessage[];
  model: string;
  presetName: string;
};

export type BlackMarketSceneSummaryResult = {
  session: BlackMarketSceneSession;
  summary: string;
};

function resolveSceneConfigs(characterId: string): SceneConfigs {
  const character = loadCharacters().find(item => item.id === characterId);
  if (!character) throw new ChatEngineError(`Character not found: ${characterId}`);

  const bindings = loadBindingConfig();
  const activeSlot = resolveBinding(bindings, characterId, BLACK_MARKET_BINDING_APP_ID);
  if (!activeSlot.apiConfigId) {
    throw new ChatEngineError(`No API Configuration bound for ${character.name}. Please go to Settings -> 绑定管理 -> 购物 to assign one.`);
  }

  const apiConfig = loadApiConfigs().find(config => config.id === activeSlot.apiConfigId);
  if (!apiConfig) throw new ChatEngineError(`API Configuration not found for ${character.name}.`);

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

export function expandBlackMarketMacros(text: string, characterName?: string, userName?: string): string {
  const engine = new MacroEngine(characterName || "角色", userName || "用户");
  return postProcessTrim(engine.expand(text || "")).trim();
}

function findOwnedTheater(localTheaterId: string): BlackMarketOwnedTheater | undefined {
  return loadBlackMarketState().ownedTheaters.find(item => item.localId === localTheaterId);
}

function toChatHistoryMessage(session: BlackMarketSceneSession, message: BlackMarketSceneMessage): ChatMessage {
  return {
    id: message.id,
    sessionId: session.id,
    role: message.role,
    content: message.content,
    status: "sent",
    createdAt: message.createdAt,
  };
}

function buildSceneDirective(template: BlackMarketTheaterTemplate, characterName: string, userName: string): string {
  const aiInstruction = expandBlackMarketMacros(template.aiInstruction, characterName, userName);
  const outputContract = expandBlackMarketMacros(template.outputContract, characterName, userName);
  return [
    "<scene_directive>",
    "【剧情指令】",
    aiInstruction,
    outputContract ? `\n【输出契约】\n${outputContract}` : "",
    "</scene_directive>",
  ].filter(Boolean).join("\n");
}

async function buildScenePromptMessages(session: BlackMarketSceneSession, template: BlackMarketTheaterTemplate): Promise<{
  messages: LLMMessage[];
  configs: SceneConfigs;
}> {
  const configs = resolveSceneConfigs(session.characterId);
  const userIdentity = resolveUserIdentity(session.characterId, BLACK_MARKET_BINDING_APP_ID);
  const userName = session.userName || userIdentity?.name || "用户";
  const history = session.messages.map(message => toChatHistoryMessage(session, message));
  const memConfig = loadMemoryConfig();
  const { recentBlocks, truncatedHistory, wbActivationContext, unifiedRecentItems } = prepareShortTermContext(session.characterId, BLACK_MARKET_PROMPT_APP_ID, {
    userName,
    history,
  });
  const [memories, coreMemories] = await Promise.all([
    retrieveMemoriesForPrompt(session.characterId, wbActivationContext, memConfig).catch(() => null),
    retrieveCoreMemoriesForPrompt(session.characterId, memConfig).catch(() => null),
  ]);

  const messages = assemblePromptPayload({
    character: configs.character,
    history: truncatedHistory,
    preset: configs.preset,
    worldBooks: configs.worldBooks,
    regexes: configs.regexes,
    userIdentity,
    appId: BLACK_MARKET_PROMPT_APP_ID,
    appTags: BLACK_MARKET_PROMPT_TAGS,
    scheduleSummary: buildCalendarScheduleMarker("character", session.characterId, getWeekStartIso(appNow())),
    coreMemories: coreMemories ? formatCoreMemories(coreMemories) : "",
    longTermMemories: memories ? formatLongTermMemories(memories) : "",
    worldBookActivationContext: wbActivationContext,
    recentBlocks,
    unifiedRecentItems,
  });

  messages.push({
    role: "system",
    content: buildSceneDirective(template, session.characterName, userName),
    _debugMeta: { marker: "blackMarketSceneDirective", depth: 0, order: Number.MAX_SAFE_INTEGER },
  });

  return { messages, configs };
}

export async function generateBlackMarketSceneReply(sessionId: string, userText: string): Promise<BlackMarketSceneGenerationResult> {
  const current = getBlackMarketSceneSession(sessionId);
  if (!current) throw new ChatEngineError("小剧场会话不存在。");
  if (current.status !== "active") throw new ChatEngineError("小剧场已经结束。");
  const owned = findOwnedTheater(current.localTheaterId);
  if (!owned) throw new ChatEngineError("暗柜中没有找到这份夜间档案。");

  let withUser = current;
  const lastMessage = current.messages[current.messages.length - 1];
  if (!(lastMessage?.role === "user" && lastMessage.content === userText)) {
    const appended = appendBlackMarketSceneMessage(sessionId, "user", userText);
    if (!appended) throw new ChatEngineError("无法写入玩家行动。");
    withUser = appended;
  }

  const { messages, configs } = await buildScenePromptMessages(withUser, owned.templateSnapshot);
  const userName = withUser.userName || resolveUserIdentity(withUser.characterId, BLACK_MARKET_BINDING_APP_ID)?.name || "用户";
  const reply = await sendLLMRequest(configs.apiConfig, configs.preset, messages, configs.regexes, {
    characterName: withUser.characterName,
    userName,
  }, {
    appId: BLACK_MARKET_PROMPT_APP_ID,
    appTags: BLACK_MARKET_PROMPT_TAGS,
  });

  const updated = appendBlackMarketSceneMessage(sessionId, "assistant", reply);
  if (!updated) throw new ChatEngineError("无法写入角色回复。");

  return {
    session: updated,
    reply,
    promptMessages: messages,
    model: configs.apiConfig.defaultModel,
    presetName: configs.preset?.name || "默认预设",
  };
}

function formatSceneTranscript(session: BlackMarketSceneSession): string {
  return session.messages.map(message => {
    const speaker = message.role === "assistant" ? session.characterName : session.userName;
    return `${speaker}: ${message.content}`;
  }).join("\n\n");
}

export async function summarizeAndRecordBlackMarketScene(sessionId: string): Promise<BlackMarketSceneSummaryResult> {
  const session = getBlackMarketSceneSession(sessionId);
  if (!session) throw new ChatEngineError("小剧场会话不存在。");
  const owned = findOwnedTheater(session.localTheaterId);
  if (!owned) throw new ChatEngineError("暗柜中没有找到这份夜间档案。");
  if (session.messages.length === 0) throw new ChatEngineError("小剧场还没有可总结的剧情。");

  const { apiConfig } = resolveSceneConfigs(session.characterId);
  const promptTemplate = expandBlackMarketMacros(
    owned.templateSnapshot.memorySummaryPrompt || "请把以下小剧场剧情整理为 1 条短期记忆，保留关键事实、角色态度变化和关系变化，不要写系统信息。",
    session.characterName,
    session.userName,
  );
  const prompt = [
    promptTemplate,
    "",
    `小剧场标题：${owned.templateSnapshot.title}`,
    `角色：${session.characterName}`,
    `用户：${session.userName}`,
    "",
    "剧情记录：",
    formatSceneTranscript(session),
    "",
    "请只输出短期记忆正文。",
  ].join("\n");

  const result = await simpleLLMCall(apiConfig, [{ role: "user", content: prompt }], {
    temperature: 0.3,
  });
  const summary = (result.content || "").trim();
  if (!summary) throw new ChatEngineError(result.error || "记忆总结为空。");

  const ended = endBlackMarketSceneSession(sessionId, summary);
  const finalSession = ended ?? session;
  const timestamp = finalSession.endedAt || appNowISO();
  recordBlackMarketTheaterProjectionEvent({
    sessionId,
    characterId: finalSession.characterId,
    characterName: finalSession.characterName,
    userName: finalSession.userName,
    theaterTitle: finalSession.title,
    summary,
    timestamp,
  });

  try {
    incrementEventCounter(finalSession.characterId);
    maybeRunSummarization(finalSession.characterId, finalSession.characterName)
      .catch(err => console.warn("[BlackMarketScene] Summarization check failed:", err));
  } catch (err) {
    console.warn("[BlackMarketScene] Memory counter failed:", err);
  }

  return {
    session: {
      ...finalSession,
      status: "ended",
      summary,
      summaryWrittenAt: timestamp,
    },
    summary,
  };
}
