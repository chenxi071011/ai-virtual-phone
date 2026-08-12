"use client";
import { useState, useMemo, useEffect } from "react";
import { appNowISO } from "@/lib/app-clock";
import { ArrowLeft, ChevronDown, MoreHorizontal, Plus, Play, Trash2 } from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import {
  loadMapWorlds,
  getLatestSave,
  deleteMapWorld,
  generateWorldId,
  saveMapWorld,
  createInitialSave,
  saveGame,
  addAgentToSave,
  loadDMPrompts,
  saveDMPrompts,
  loadDMTokenConfig,
  saveDMTokenConfig,
  type DMTokenConfig,
  loadAdventureSummaryConfig,
  saveAdventureSummaryConfig,
  type AdventureSummaryConfig,
  hydrateMapStorage,
  loadAdventureInteractionConfig,
  saveAdventureInteractionConfig,
  DEFAULT_ADVENTURE_INTERACTION_CONFIG,
  type AdventureInteractionConfig,
} from "@/lib/map-storage";
import { generateWorldSkeleton, DEFAULT_WORLD_GEN_PROMPT, DEFAULT_DM_SCENE_PROMPT, DEFAULT_DM_RESOLVE_PROMPT, DEFAULT_DM_ENDING_PROMPT, DEFAULT_ADVENTURE_SUMMARY_PROMPT } from "@/lib/map-rpg-engine";
import { generateMap, type GeoJSONData } from "@/lib/map-engine";
import { loadApiConfigs, loadBindingConfig, resolveBinding } from "@/lib/settings-storage";
import type { MapWorld, GameSave } from "@/lib/map-types";
import { Toggle } from "@/components/ui/form";

type Props = {
  onClose: () => void;
  onStartGame: (world: MapWorld, save: GameSave) => void;
};

type Mode = "list" | "create" | "enter" | "prompts";
type DMPromptTab = "scene" | "resolve" | "worldGen" | "ending";
type PromptEditorKey = DMPromptTab | "summary" | "bilingual";

export default function MapLobby({ onClose, onStartGame }: Props) {
  const [mode, setMode] = useState<Mode>("list");
  const [worlds, setWorlds] = useState<MapWorld[]>([]);

  // Ensure hydration completes before reading worlds
  useEffect(() => {
    hydrateMapStorage().then(() => setWorlds(loadMapWorlds()));
  }, []);

  // Refresh worlds list when switching back to list mode (picks up background generation results)
  useEffect(() => {
    if (mode !== "list") return;
    const interval = setInterval(() => {
      const current = loadMapWorlds();
      // Only update if any world's status changed
      if (current.some((w, i) => w.status !== worlds[i]?.status || w.updatedAt !== worlds[i]?.updatedAt)) {
        setWorlds(current);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [mode, worlds]);
  const [description, setDescription] = useState("");
  const [tone, setTone] = useState("");
  const [regionCount, setRegionCount] = useState(6);
  const [mainQuestType, setMainQuestType] = useState("");
  const [npcCount, setNpcCount] = useState(12);
  const [difficulty, setDifficulty] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [genError, setGenError] = useState<{ reason: string; raw: string } | null>(null);

  // DM prompt editor state
  const [dmPrompts, setDmPrompts] = useState(() => {
    const saved = loadDMPrompts();
    return {
      scene: saved.scene || DEFAULT_DM_SCENE_PROMPT,
      resolve: saved.resolve || DEFAULT_DM_RESOLVE_PROMPT,
      worldGen: saved.worldGen || DEFAULT_WORLD_GEN_PROMPT,
      ending: saved.ending || DEFAULT_DM_ENDING_PROMPT,
    };
  });
  const [editingPromptTab, setEditingPromptTab] = useState<PromptEditorKey>("scene");
  const [expandedPromptTab, setExpandedPromptTab] = useState<PromptEditorKey | null>(null);
  const [dmTokenConfig, setDmTokenConfig] = useState<DMTokenConfig>(() => loadDMTokenConfig());
  const [summaryConfig, setSummaryConfig] = useState<AdventureSummaryConfig>(() => loadAdventureSummaryConfig());
  const [adventureConfig, setAdventureConfig] = useState<AdventureInteractionConfig>(() => loadAdventureInteractionConfig());

  // Character selection (used during world creation)
  const [selectedCharIds, setSelectedCharIds] = useState<string[]>([]);

  const characters = useMemo(() => loadCharacters(), []);
  const promptSections: Array<{ key: PromptEditorKey; label: string; helper: string; placeholder: string; value: string; onChange: (value: string) => void; minHeight?: number }> = [
    {
      key: "scene",
      label: "场景生成",
      helper: "场景生成 System Prompt — DM 根据此指令生成场景、NPC 对话和选项。输出格式必须包含: narration, npc_lines, situation, choices, journal, gained, lost, advance, move_to, world_events",
      placeholder: DEFAULT_DM_SCENE_PROMPT,
      value: dmPrompts.scene,
      onChange: value => setDmPrompts(prev => ({ ...prev, scene: value })),
    },
    {
      key: "resolve",
      label: "裁决",
      helper: "裁决 System Prompt — 收到所有角色宣言后，DM 根据此指令统一裁决结果。输出格式同场景生成，本轮声明会自动注入 User Prompt。",
      placeholder: DEFAULT_DM_RESOLVE_PROMPT,
      value: dmPrompts.resolve,
      onChange: value => setDmPrompts(prev => ({ ...prev, resolve: value })),
    },
    {
      key: "worldGen",
      label: "世界生成",
      helper: "世界生成 System Prompt — 用户描述世界观后，AI 根据此指令生成完整世界骨架。输出为 world + regions + main_quest + dm_dossier 的 JSON。",
      placeholder: DEFAULT_WORLD_GEN_PROMPT,
      value: dmPrompts.worldGen,
      onChange: value => setDmPrompts(prev => ({ ...prev, worldGen: value })),
    },
    {
      key: "ending",
      label: "结局",
      helper: "结局 System Prompt — 主线通关后，DM 根据此指令生成结局。输出 JSON: {paragraphs:[\"段落1\",...], closing:\"收束语\"}",
      placeholder: DEFAULT_DM_ENDING_PROMPT,
      value: dmPrompts.ending,
      onChange: value => setDmPrompts(prev => ({ ...prev, ending: value })),
    },
    {
      key: "summary",
      label: "总结提示词",
      helper: "冒险自动总结 Prompt — 达到自动总结间隔后，DM 根据此指令压缩近期日志，生成可长期保留的冒险摘要。",
      placeholder: DEFAULT_ADVENTURE_SUMMARY_PROMPT,
      value: summaryConfig.prompt || DEFAULT_ADVENTURE_SUMMARY_PROMPT,
      onChange: value => setSummaryConfig(prev => ({ ...prev, prompt: value })),
      minHeight: 180,
    },
    {
      key: "bilingual",
      label: "双语提示词",
      helper: "角色双语翻译 Prompt — 角色发言需要翻译时使用，只作用于角色发言的中文译文。",
      placeholder: DEFAULT_ADVENTURE_INTERACTION_CONFIG.bilingualTranslationPrompt,
      value: adventureConfig.bilingualTranslationPrompt,
      onChange: value => setAdventureConfig(prev => ({ ...prev, bilingualTranslationPrompt: value })),
      minHeight: 180,
    },
  ];

  const resetCurrentPrompt = () => {
    if (editingPromptTab === "summary") {
      setSummaryConfig(prev => ({ ...prev, prompt: DEFAULT_ADVENTURE_SUMMARY_PROMPT }));
      return;
    }
    if (editingPromptTab === "bilingual") {
      setAdventureConfig(prev => ({
        ...prev,
        bilingualTranslationPrompt: DEFAULT_ADVENTURE_INTERACTION_CONFIG.bilingualTranslationPrompt,
      }));
      return;
    }
    const defaults: Record<DMPromptTab, string> = {
      scene: DEFAULT_DM_SCENE_PROMPT,
      resolve: DEFAULT_DM_RESOLVE_PROMPT,
      worldGen: DEFAULT_WORLD_GEN_PROMPT,
      ending: DEFAULT_DM_ENDING_PROMPT,
    };
    setDmPrompts(prev => ({ ...prev, [editingPromptTab]: defaults[editingPromptTab] }));
  };

  // ── Create World (background generation) ──
  const handleCreate = async () => {
    if (!description.trim() || isGenerating) return;
    setIsGenerating(true);
    setError(null);

    const apiConfigs = loadApiConfigs();
    const bindings = loadBindingConfig();
    const firstChar = characters[0];
    const slot = firstChar ? resolveBinding(bindings, firstChar.id, "chat") : null;
    const apiConfig = (slot?.apiConfigId ? apiConfigs.find(c => c.id === slot.apiConfigId) : null) || apiConfigs.find(c => c.apiKey) || apiConfigs[0];
    if (!apiConfig?.apiKey) { setError("未找到有效的API配置，请先在设置中配置API"); return; }

    // 1. Create placeholder world immediately
    const now = appNowISO();
    const worldId = generateWorldId();
    const placeholder: MapWorld = {
      id: worldId,
      skeleton: { world: { name: description.slice(0, 20) + "...", lore: "" }, mapInput: { map_settings: { header: "", title: "" }, regions: [] }, richRegions: [], mainQuest: { id: "", title: "", type: "main", synopsis: "", triggerRegion: "", stages: [] }, sideQuests: [], npcs: [], encounterPool: [], partyStats: {} },
      renderedMap: { l1Nodes: [], l2Nodes: [], l3Nodes: [], rivers: [], regionBoundaries: [], mapSettings: { header: "", title: "" } } as unknown as import("@/lib/map-engine").MapGenerationOutput,
      createdAt: now,
      updatedAt: now,
      status: "generating",
    };
    saveMapWorld(placeholder);
    setWorlds(loadMapWorlds());
    setMode("list");
    setIsGenerating(false);

    // 2. Capture selected chars for save creation later
    const charIdsSnapshot = [...selectedCharIds];

    // 3. Generate in background
    try {
      const vars = {
        world_desc: description,
        tone: tone || "自由发挥",
        region_count: String(regionCount),
        main_quest_type: mainQuestType || "自由发挥",
        npc_count: String(npcCount),
        difficulty: difficulty || "适中",
      };
      const skeleton = await generateWorldSkeleton(description, [], apiConfig, vars);

      const resp = await fetch("/countries.geo.json");
      const geoData: GeoJSONData = await resp.json();
      const renderedMap = generateMap(skeleton.mapInput, geoData);

      // 4. Update world with real data (remove status = complete)
      const world: MapWorld = {
        id: worldId,
        skeleton,
        renderedMap,
        createdAt: now,
        updatedAt: appNowISO(),
      };
      saveMapWorld(world);

      // 5. Create initial save with selected characters
      const startNode = renderedMap.l1Nodes[0]?.id || "l1_0";
      let save = createInitialSave(world.id, startNode);
      for (const cid of charIdsSnapshot) {
        const ch = characters.find(c => c.id === cid);
        save = addAgentToSave(save, cid, ch?.personality || "");
      }
      const startRegionIdx = 0;
      const discovered: string[] = [startNode];
      renderedMap.l2Nodes.forEach((n, i) => { if (n.regionIdx === startRegionIdx) discovered.push(`l2_${i}`); });
      renderedMap.l3Nodes.forEach((n, i) => { if (n.regionIdx === startRegionIdx) discovered.push(`l3_${i}`); });
      renderedMap.l1Nodes.forEach((n) => { if (!discovered.includes(n.id)) discovered.push(n.id); });
      save.discoveredNodes = discovered;
      save.journal[0].locationName = renderedMap.l1Nodes[0]?.nameCn || "起点";
      saveGame(save);

      setWorlds(loadMapWorlds());
    } catch (e) {
      // Mark as failed + surface reason and raw LLM output in a dialog.
      const reason = e instanceof Error ? e.message : String(e);
      const raw = (e as { rawOutput?: string })?.rawOutput || "";
      const failed: MapWorld = { ...placeholder, status: "failed", statusMessage: reason, failureRaw: raw, updatedAt: appNowISO() };
      saveMapWorld(failed);
      setWorlds(loadMapWorlds());
      setGenError({ reason, raw });
    }
  };

  // ── Enter World (skip character selection, go straight in) ──
  const handleEnterWorld = (world: MapWorld) => {
    const save = getLatestSave(world.id) || createInitialSave(world.id, world.renderedMap.l1Nodes[0]?.id || "l1_0");
    onStartGame(world, save);
  };

  const toggleChar = (id: string) => {
    setSelectedCharIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const handleDelete = (id: string) => {
    deleteMapWorld(id);
    setWorlds(loadMapWorlds());
    setDeleteConfirmId(null);
  };

  const S: Record<string, React.CSSProperties> = {
    root: { position: "absolute", inset: 0, background: "#0a0a0f", display: "flex", flexDirection: "column", fontFamily: "'PingFang SC', system-ui, sans-serif", color: "#e0dcd5", overflow: "hidden" },
    header: {
      height: "var(--page-header-content-height, 42px)",
      marginTop: "var(--page-header-safe-top, 48px)",
      padding: "1px 20px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      flexShrink: 0,
    },
    btn: { width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer" },
    body: { flex: 1, overflow: "auto", padding: "0 20px 20px" },
    card: { padding: "14px 16px", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", marginBottom: 10 },
    label: { fontSize: "calc(12px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.4)", marginBottom: 6 },
    input: { width: "100%", minHeight: 100, padding: 12, borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#e0dcd5", fontSize: "calc(14px*var(--app-text-scale,1))", fontFamily: "inherit", lineHeight: 1.6, resize: "vertical" as const, outline: "none", boxSizing: "border-box" as const },
    primaryBtn: { width: "100%", padding: "14px 0", borderRadius: 10, border: "none", background: "rgba(200,160,100,0.2)", color: "#e8d0a0", fontSize: "calc(15px*var(--app-text-scale,1))", fontWeight: 500, letterSpacing: "0.1em", cursor: "pointer", fontFamily: "inherit" },
  };

  return (
    <div style={S.root}>
      <div style={S.header}>
        <button onClick={mode === "list" ? onClose : () => setMode("list")} style={S.btn}>
          <ArrowLeft size={20} />
        </button>
        <span style={{ fontSize: "calc(13px*var(--app-text-scale,1))", letterSpacing: "0.2em", color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
          {mode === "list" ? "MAP ADVENTURES" : mode === "create" ? "NEW WORLD" : "DM PROMPTS"}
        </span>
        {mode === "list" ? (
          <div style={{ display: "flex", gap: 2 }}>
            <button
              type="button"
              aria-label="冒险设置"
              onClick={() => { const s = loadDMPrompts(); setDmPrompts({ scene: s.scene || DEFAULT_DM_SCENE_PROMPT, resolve: s.resolve || DEFAULT_DM_RESOLVE_PROMPT, worldGen: s.worldGen || DEFAULT_WORLD_GEN_PROMPT, ending: s.ending || DEFAULT_DM_ENDING_PROMPT }); setMode("prompts"); }}
              style={S.btn}
            >
              <MoreHorizontal size={22} strokeWidth={1.7} />
            </button>
          </div>
        ) : <div style={{ width: 36 }} />}
      </div>

      <div style={mode === "list" ? { ...S.body, padding: "0 20px 96px" } : S.body}>
        {/* ── World List ── */}
        {mode === "list" && (
          worlds.length === 0 ? (
            <div style={{ textAlign: "center", padding: "80px 0", color: "rgba(255,255,255,0.2)" }}>
              <div style={{ fontSize: "calc(32px*var(--app-text-scale,1))", marginBottom: 12 }}>🗺</div>
              <div style={{ fontSize: "calc(13px*var(--app-text-scale,1))" }}>还没有冒险世界</div>
              <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", marginTop: 4 }}>点击右下角 + 创建一个</div>
            </div>
          ) : worlds.map(w => (
            <div key={w.id} style={{ ...S.card, opacity: w.status === "generating" ? 0.6 : 1 }}>
              <div style={{ fontSize: "calc(15px*var(--app-text-scale,1))", fontWeight: 600, marginBottom: 4 }}>
                {w.skeleton.world.name || "新世界"}
                {w.status === "generating" && <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,200,100,0.6)", marginLeft: 8, fontWeight: 400 }}>生成中...</span>}
                {w.status === "failed" && <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,100,80,0.7)", marginLeft: 8, fontWeight: 400 }}>生成失败</span>}
              </div>
              {w.status === "failed" && w.statusMessage && (
                <div style={{ fontSize: "calc(10px*var(--app-text-scale,1))", color: "rgba(255,100,80,0.5)", marginBottom: 6, lineHeight: 1.4 }}>{w.statusMessage.slice(0, 100)}</div>
              )}
              {!w.status && <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.35)", marginBottom: 10 }}>{w.skeleton.world.lore.slice(0, 60)}...</div>}
              <div style={{ display: "flex", gap: 8 }}>
                {!w.status && (
                  <button onClick={() => handleEnterWorld(w)} style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", color: "#e0dcd5", fontSize: "calc(12px*var(--app-text-scale,1))", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, fontFamily: "inherit" }}>
                    <Play size={12} /> 进入
                  </button>
                )}
                {w.status === "generating" && (
                  <div style={{ flex: 1, padding: "8px 0", textAlign: "center", fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,200,100,0.4)", fontFamily: "monospace", letterSpacing: "0.1em" }}>
                    世界正在生成中...
                  </div>
                )}
                {w.status === "failed" && (
                  <button onClick={() => setGenError({ reason: w.statusMessage || "生成失败", raw: w.failureRaw || "" })} style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "1px solid var(--c-adv-accent-dim)", background: "transparent", color: "var(--c-adv-accent)", fontSize: "calc(12px*var(--app-text-scale,1))", cursor: "pointer", fontFamily: "inherit" }}>
                    查看失败详情
                  </button>
                )}
                <button onClick={() => setDeleteConfirmId(w.id)} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(255,100,80,0.2)", background: "transparent", color: "rgba(255,100,80,0.6)", fontSize: "calc(12px*var(--app-text-scale,1))", cursor: "pointer" }}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))
        )}

        {/* ── Create World ── */}
        {mode === "create" && (<>
          <style>{`
            @keyframes tome-glow { 0%,100%{box-shadow:0 0 15px rgba(200,160,100,0.06),inset 0 0 30px rgba(200,160,100,0.02)} 50%{box-shadow:0 0 25px rgba(200,160,100,0.12),inset 0 0 40px rgba(200,160,100,0.04)} }
            @keyframes seal-press { 0%{transform:scale(1)} 50%{transform:scale(0.92)} 100%{transform:scale(1)} }
            @keyframes ritual-pulse { 0%,100%{box-shadow:0 0 20px rgba(200,160,100,0.1),0 0 40px rgba(200,160,100,0.05)} 50%{box-shadow:0 0 30px rgba(200,160,100,0.25),0 0 60px rgba(200,160,100,0.1)} }
            .tome-seal:active { animation: seal-press 0.2s ease; }
            .tome-ritual:not(:disabled):hover { animation: ritual-pulse 1.5s ease infinite; }
            .tome-slider { -webkit-appearance:none; appearance:none; height:4px; border-radius:2px; background:linear-gradient(90deg,rgba(200,160,100,0.3),rgba(200,160,100,0.08)); outline:none; }
            .tome-slider::-webkit-slider-thumb { -webkit-appearance:none; width:18px; height:18px; border-radius:50%; background:radial-gradient(circle at 40% 35%,#d4b87a,#8a6d3b); border:2px solid rgba(200,160,100,0.5); box-shadow:0 2px 8px rgba(0,0,0,0.4),inset 0 1px 2px rgba(255,255,255,0.2); cursor:pointer; }
          `}</style>
          <div style={{
            display: "flex", flexDirection: "column", gap: 0,
            background: "linear-gradient(180deg, rgba(20,16,10,0.6), rgba(15,12,8,0.8))",
            border: "1px solid rgba(200,160,100,0.1)",
            borderRadius: 14,
            padding: "18px 16px",
            animation: "tome-glow 4s ease infinite",
          }}>
            {/* ── Tome header ornament ── */}
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: "calc(9px*var(--app-text-scale,1))", letterSpacing: "0.4em", color: "rgba(200,160,100,0.3)", fontFamily: "monospace" }}>
                ── 世界创造之书 ──
              </div>
            </div>

            {/* ── World description ── */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(200,160,100,0.5)", marginBottom: 6, letterSpacing: "0.08em" }}>
                世界描述
              </div>
              <textarea value={description} onChange={e => setDescription(e.target.value)}
                placeholder="在此书写你所构想的世界...&#10;&#10;例如：吸血鬼的黑暗世界，人类在夹缝中求生，几大血族家族争夺王座..."
                style={{
                  width: "100%", minHeight: 90, padding: "12px 14px", borderRadius: 10,
                  border: "1px solid rgba(200,160,100,0.12)",
                  background: "rgba(0,0,0,0.3)",
                  color: "#d8cbb8", fontSize: "calc(13px*var(--app-text-scale,1))", fontFamily: "inherit", lineHeight: 1.7,
                  resize: "vertical", outline: "none", boxSizing: "border-box",
                }} />
            </div>

            {/* ── Divider ── */}
            <div style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(200,160,100,0.15), transparent)", margin: "2px 0 14px" }} />

            {/* ── Tag sections ── */}
            {([
              { label: "风格基调", value: tone, setter: setTone, tags: ["轻松", "黑暗", "恐怖", "浪漫", "史诗", "悬疑", "幽默", "治愈", "热血", "荒诞"] },
              { label: "主线类型", value: mainQuestType, setter: setMainQuestType, tags: ["拯救世界", "解开谜团", "寻找宝藏", "复仇之路", "生存逃脱", "王位之争", "阴谋揭露", "守护家园"] },
              { label: "难度", value: difficulty, setter: setDifficulty, tags: ["轻松冒险", "适中", "硬核生存", "地狱难度"] },
            ] as const).map(section => (
              <div key={section.label} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(200,160,100,0.5)", marginBottom: 7, letterSpacing: "0.08em" }}>
                  {section.label}
                </div>
                <div style={{
                  padding: "8px 10px", borderRadius: 7,
                  border: "1px solid rgba(200,160,100,0.08)",
                  background: "rgba(0,0,0,0.2)",
                }}>
                  <div style={{ display: "grid", gridTemplateColumns: `repeat(${section.tags.length <= 4 ? section.tags.length : section.tags.length <= 6 ? 3 : 4}, 1fr)`, gap: 5, marginBottom: 7 }}>
                    {section.tags.map(t => {
                      const active = section.value === t;
                      return (
                        <button key={t} className="tome-seal"
                          onClick={() => section.setter(active ? "" : t)}
                          style={{
                            padding: "6px 4px", borderRadius: 6,
                            border: `1px solid ${active ? "rgba(200,160,100,0.45)" : "rgba(200,160,100,0.1)"}`,
                            background: active
                              ? "linear-gradient(135deg, rgba(200,160,100,0.18), rgba(200,160,100,0.08))"
                              : "rgba(0,0,0,0.3)",
                            color: active ? "#e8d0a0" : "rgba(255,255,255,0.35)",
                            fontSize: "calc(11px*var(--app-text-scale,1))", cursor: "pointer", fontFamily: "inherit",
                            boxShadow: active ? "0 0 8px rgba(200,160,100,0.1), inset 0 1px 0 rgba(255,255,255,0.05)" : "none",
                            transition: "all 0.2s ease",
                            textAlign: "center",
                          }}>
                          {t}
                        </button>
                      );
                    })}
                  </div>
                  <input value={section.value} onChange={e => section.setter(e.target.value)}
                    placeholder="自定义..."
                    style={{
                      width: "100%", padding: "5px 0", borderRadius: 0,
                      border: "none", borderTop: "1px solid rgba(200,160,100,0.06)",
                      background: "transparent",
                      color: "#d8cbb8", fontSize: "calc(11px*var(--app-text-scale,1))", fontFamily: "inherit",
                      outline: "none", boxSizing: "border-box",
                    }} />
                </div>
              </div>
            ))}

            {/* ── Divider ── */}
            <div style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(200,160,100,0.15), transparent)", margin: "2px 0 14px" }} />

            {/* ── Sliders ── */}
            <div style={{ display: "flex", gap: 20, marginBottom: 18 }}>
              {([
                { label: "区域", value: regionCount, setter: setRegionCount, min: 3, max: 10 },
                { label: "NPC", value: npcCount, setter: setNpcCount, min: 5, max: 20 },
              ] as const).map(s => (
                <div key={s.label} style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(200,160,100,0.5)", letterSpacing: "0.08em" }}>{s.label}</span>
                    <span style={{ fontSize: "calc(13px*var(--app-text-scale,1))", color: "#e8d0a0", fontWeight: 600, fontFamily: "monospace" }}>{s.value}</span>
                  </div>
                  <input type="range" className="adv-slider"
                    min={s.min} max={s.max} value={s.value}
                    onChange={e => s.setter(Number(e.target.value))}
                    style={{ width: "100%" }} />
                </div>
              ))}
            </div>

            {/* ── Divider ── */}
            <div style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(200,160,100,0.15), transparent)", margin: "2px 0 14px" }} />

            {/* ── Character selection ── */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(200,160,100,0.5)", marginBottom: 7, letterSpacing: "0.08em" }}>
                同行角色（可不选）
              </div>
              {characters.length === 0 ? (
                <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.15)", textAlign: "center", padding: "12px 0" }}>
                  还没有角色，可以先创建
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
                  {characters.map(ch => {
                    const active = selectedCharIds.includes(ch.id);
                    return (
                      <button key={ch.id} className="tome-seal" onClick={() => toggleChar(ch.id)} style={{
                        padding: "8px 4px 6px", borderRadius: 8, fontFamily: "inherit",
                        border: `1px solid ${active ? "rgba(200,160,100,0.4)" : "rgba(200,160,100,0.08)"}`,
                        background: active ? "rgba(200,160,100,0.1)" : "rgba(0,0,0,0.2)",
                        cursor: "pointer", transition: "all 0.2s ease",
                        display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                      }}>
                        <div style={{ position: "relative" }}>
                          <div style={{
                            width: 36, height: 36, borderRadius: "50%",
                            background: ch.avatar ? `url(${ch.avatar}) center/cover` : "rgba(200,160,100,0.1)",
                            border: `2px solid ${active ? "rgba(200,160,100,0.5)" : "rgba(255,255,255,0.06)"}`,
                          }} />
                          {active && (
                            <div style={{
                              position: "absolute", bottom: -2, right: -2,
                              width: 14, height: 14, borderRadius: "50%",
                              background: "rgba(200,160,100,0.8)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: "calc(8px*var(--app-text-scale,1))", color: "#0a0a0f", fontWeight: 700,
                            }}>✓</div>
                          )}
                        </div>
                        <div style={{
                          fontSize: "calc(10px*var(--app-text-scale,1))", color: active ? "#e8d0a0" : "rgba(255,255,255,0.35)",
                          textAlign: "center", lineHeight: 1.2,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          width: "100%",
                        }}>
                          {ch.name}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Error ── */}
            {error && (
              <div style={{
                fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,100,80,0.8)", padding: "8px 12px",
                borderRadius: 8, background: "rgba(255,60,40,0.08)",
                border: "1px solid rgba(255,80,60,0.15)", marginBottom: 12,
              }}>
                {error}
              </div>
            )}

            {/* ── Create button (ritual activation) ── */}
            <button className="tome-ritual"
              onClick={handleCreate}
              disabled={!description.trim() || isGenerating}
              style={{
                width: "100%", padding: "15px 0", borderRadius: 10,
                border: isGenerating ? "1px solid rgba(255,255,255,0.05)" : "1px solid rgba(200,160,100,0.3)",
                background: isGenerating
                  ? "rgba(255,255,255,0.03)"
                  : "linear-gradient(135deg, rgba(200,160,100,0.2), rgba(180,140,80,0.1))",
                color: isGenerating ? "rgba(255,255,255,0.25)" : "#e8d0a0",
                fontSize: "calc(14px*var(--app-text-scale,1))", fontWeight: 600, letterSpacing: "0.2em",
                cursor: isGenerating ? "default" : "pointer",
                fontFamily: "inherit",
                transition: "all 0.3s ease",
              }}>
              {isGenerating ? "⏳ 世界生成中..." : selectedCharIds.length > 0 ? `✦ 携 ${selectedCharIds.length} 位同伴创造世界 ✦` : "✦ 独自创造世界 ✦"}
            </button>

            {/* ── Tome footer ornament ── */}
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <div style={{ fontSize: "calc(8px*var(--app-text-scale,1))", letterSpacing: "0.5em", color: "rgba(200,160,100,0.15)", fontFamily: "monospace" }}>
                ─ ✧ ─
              </div>
            </div>
          </div>
        </>)}

        {/* ── DM Prompt Editor ── */}
        {mode === "prompts" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ ...S.card, marginBottom: 0 }}>
              <div style={{ ...S.label }}>运行参数</div>

              <div style={{ padding: "2px 0 12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize: "calc(10px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.3)", marginBottom: 8, letterSpacing: "0.1em" }}>DM 上下文截断（Token）</div>
                <div style={{ display: "flex", gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: "calc(10px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.3)" }}>日志</span>
                      <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "#e8d0a0", fontFamily: "monospace" }}>{dmTokenConfig.journalTokenBudget}</span>
                    </div>
                    <input type="range" className="adv-slider" min={1000} max={100000} step={500}
                      value={dmTokenConfig.journalTokenBudget}
                      onChange={e => setDmTokenConfig(prev => ({ ...prev, journalTokenBudget: Number(e.target.value) }))}
                      style={{ width: "100%" }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: "calc(10px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.3)" }}>对话</span>
                      <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "#e8d0a0", fontFamily: "monospace" }}>{dmTokenConfig.dialogueTokenBudget}</span>
                    </div>
                    <input type="range" className="adv-slider" min={1000} max={100000} step={500}
                      value={dmTokenConfig.dialogueTokenBudget}
                      onChange={e => setDmTokenConfig(prev => ({ ...prev, dialogueTokenBudget: Number(e.target.value) }))}
                      style={{ width: "100%" }} />
                  </div>
                </div>
              </div>

              <div style={{ padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ ...S.label }}>冒险自动总结</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                  <span style={{ fontSize: "calc(10px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em" }}>自动总结并传入全局记忆间隔</span>
                  <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "#e8d0a0", fontFamily: "monospace" }}>
                    {summaryConfig.interval === 0 ? "关闭" : `每 ${summaryConfig.interval} 条`}
                  </span>
                </div>
                <input
                  type="range"
                  className="adv-slider"
                  min={0}
                  max={100}
                  step={5}
                  value={summaryConfig.interval}
                  onChange={e => setSummaryConfig(prev => ({ ...prev, interval: Number(e.target.value) }))}
                  style={{ width: "100%" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ fontSize: "calc(10px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.25)" }}>关闭</span>
                  <span style={{ fontSize: "calc(10px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.25)" }}>100 条</span>
                </div>
              </div>

              <div style={{ paddingTop: 12 }}>
                <div style={{ ...S.label }}>双语翻译</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: adventureConfig.bilingualTranslationEnabled ? 10 : 0 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "calc(10px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em" }}>角色双语翻译</div>
                    <div style={{ fontSize: "calc(10px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.3)", marginTop: 3 }}>只作用于角色发言，不影响 DM / NPC / 选项 / 日志</div>
                  </div>
                  <Toggle
                    checked={adventureConfig.bilingualTranslationEnabled}
                    onChange={(checked) => setAdventureConfig(prev => ({ ...prev, bilingualTranslationEnabled: checked }))}
                  />
                </div>
                {adventureConfig.bilingualTranslationEnabled && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "calc(10px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em" }}>折叠中文译文</div>
                      <div style={{ fontSize: "calc(10px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.3)", marginTop: 3 }}>关闭后默认展开中文</div>
                    </div>
                    <Toggle
                      checked={adventureConfig.collapseBilingualTranslation === true}
                      onChange={(checked) => setAdventureConfig(prev => ({ ...prev, collapseBilingualTranslation: checked }))}
                    />
                  </div>
                )}
              </div>
            </div>

            <div style={{ ...S.label, marginBottom: -4 }}>提示词</div>

            {/* Collapsible prompt editors */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {promptSections.map(section => {
                const isOpen = expandedPromptTab === section.key;
                return (
                  <div
                    key={section.key}
                    style={{
                      borderRadius: 10,
                      border: `1px solid ${isOpen ? "rgba(200,160,100,0.22)" : "rgba(255,255,255,0.08)"}`,
                      background: isOpen ? "rgba(200,160,100,0.06)" : "rgba(255,255,255,0.02)",
                      overflow: "hidden",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setEditingPromptTab(section.key);
                        setExpandedPromptTab(prev => prev === section.key ? null : section.key);
                      }}
                      aria-expanded={isOpen}
                      style={{
                        width: "100%",
                        minHeight: 44,
                        padding: "0 12px",
                        border: "none",
                        background: "transparent",
                        color: isOpen ? "#e8d0a0" : "rgba(255,255,255,0.72)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "calc(12px*var(--app-text-scale,1))" }}>
                        {section.label}
                      </span>
                      <ChevronDown
                        size={15}
                        strokeWidth={2}
                        style={{
                          flexShrink: 0,
                          color: isOpen ? "#e8d0a0" : "rgba(255,255,255,0.28)",
                          transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                          transition: "transform 180ms ease, color 180ms ease",
                        }}
                      />
                    </button>
                    {isOpen && (
                      <div style={{ padding: "0 10px 10px" }}>
                        <div style={{ fontSize: "calc(10px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.26)", lineHeight: 1.6, padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.025)", marginBottom: 8 }}>
                          {section.helper}
                        </div>
                        <textarea
                          value={section.value}
                          onChange={e => section.onChange(e.target.value)}
                          placeholder={section.placeholder}
                          style={{
                            ...S.input,
                            minHeight: section.minHeight ?? 220,
                            fontSize: "calc(12px*var(--app-text-scale,1))",
                            lineHeight: 1.5,
                            fontFamily: "monospace",
                          }}
                        />
                        <div style={{ fontSize: "calc(9px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.15)", textAlign: "center", marginTop: 6 }}>
                          当前显示的即为实际使用的提示词，可直接修改
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Save + Reset buttons */}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => {
                saveDMPrompts(dmPrompts);
                saveDMTokenConfig(dmTokenConfig);
                saveAdventureSummaryConfig(summaryConfig);
                saveAdventureInteractionConfig(adventureConfig);
                setMode("list");
              }} style={{ ...S.primaryBtn, flex: 1 }}>
                保存
              </button>
              <button onClick={resetCurrentPrompt} style={{
                flexShrink: 0, padding: "14px 20px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)",
                background: "transparent", color: "rgba(255,255,255,0.4)", fontSize: "calc(12px*var(--app-text-scale,1))",
                cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
              }}>
                重置当前提示词
              </button>
            </div>
          </div>
        )}

      </div>

      {mode === "list" && (
        <button
          type="button"
          aria-label="创建冒险世界"
          onClick={() => setMode("create")}
          style={{
            position: "absolute",
            right: 22,
            bottom: "calc(28px + env(safe-area-inset-bottom, 0px))",
            zIndex: 30,
            width: 56,
            height: 56,
            borderRadius: "50%",
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.1)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 16px 38px rgba(0,0,0,0.45)",
            backdropFilter: "blur(12px)",
            cursor: "pointer",
          }}
        >
          <Plus size={24} strokeWidth={1.6} />
        </button>
      )}

      {/* Delete confirm dialog */}
      {deleteConfirmId && (
        <div onClick={() => setDeleteConfirmId(null)} style={{ position: "absolute", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "rgba(15,12,18,0.98)", borderRadius: 12, border: "1px solid rgba(255,100,80,0.15)", padding: 20, maxWidth: 280, width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: "calc(14px*var(--app-text-scale,1))", fontWeight: 600, marginBottom: 8 }}>确认删除？</div>
            <div style={{ fontSize: "calc(12px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.4)", marginBottom: 16 }}>这个世界的所有数据和存档将被永久删除</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setDeleteConfirmId(null)} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(255,255,255,0.5)", fontSize: "calc(13px*var(--app-text-scale,1))", cursor: "pointer", fontFamily: "inherit" }}>
                取消
              </button>
              <button onClick={() => handleDelete(deleteConfirmId)} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: "rgba(255,80,60,0.2)", color: "rgba(255,100,80,0.9)", fontSize: "calc(13px*var(--app-text-scale,1))", cursor: "pointer", fontFamily: "inherit" }}>
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── World-gen failure dialog (reason + raw LLM output, adventure-styled) ── */}
      {genError && (
        <div className="modal-overlay" data-ui="modal" onClick={() => setGenError(null)}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 440, maxHeight: "78%", display: "flex", flexDirection: "column",
              background: "var(--c-adv-panel-bg)", border: "1px solid var(--c-adv-accent-dim)",
              borderRadius: 14, boxShadow: "0 16px 48px rgba(0,0,0,0.55)", overflow: "hidden",
            }}
          >
            <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid var(--c-adv-accent-dim)" }}>
              <div style={{ color: "var(--c-adv-accent)", fontSize: "calc(15px*var(--app-text-scale,1))", fontWeight: 600, letterSpacing: "0.04em" }}>⚠ 世界生成失败</div>
              <div style={{ color: "var(--c-adv-text-dim)", fontSize: "calc(12px*var(--app-text-scale,1))", marginTop: 6, lineHeight: 1.6 }}>{genError.reason}</div>
            </div>
            {genError.raw ? (
              <div style={{ padding: "12px 18px", overflowY: "auto", flex: 1, minHeight: 0 }}>
                <div style={{ color: "var(--c-adv-text-muted)", fontSize: "calc(10px*var(--app-text-scale,1))", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>AI 原始输出</div>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--c-adv-text)", fontSize: "calc(11px*var(--app-text-scale,1))", lineHeight: 1.65, fontFamily: '"Courier New", monospace', background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "10px 12px" }}>{genError.raw}</pre>
              </div>
            ) : (
              <div style={{ padding: "14px 18px", color: "var(--c-adv-text-muted)", fontSize: "calc(11px*var(--app-text-scale,1))", flex: 1 }}>（模型没有返回任何内容，可能是网络中断或请求超时）</div>
            )}
            <div style={{ display: "flex", gap: 10, padding: "12px 18px 16px", borderTop: "1px solid var(--c-adv-accent-dim)" }}>
              {genError.raw && (
                <button
                  type="button"
                  onClick={() => { navigator.clipboard?.writeText(genError.raw).catch(() => {}); }}
                  style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid var(--c-adv-accent-dim)", background: "transparent", color: "var(--c-adv-accent)", fontSize: "calc(12.5px*var(--app-text-scale,1))", cursor: "pointer", fontFamily: "inherit" }}
                >
                  复制原始输出
                </button>
              )}
              <button
                type="button"
                onClick={() => setGenError(null)}
                style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: "var(--c-adv-accent-dim)", color: "var(--c-adv-accent)", fontSize: "calc(12.5px*var(--app-text-scale,1))", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
