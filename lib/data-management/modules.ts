import type { DataModuleDefinition, DataModuleId } from "./types";

// localStorage keys owned by other modules. The catch-all "cache" module
// (includeAll) excludes these so it never double-counts them in stats/backups
// and — critically — never deletes the migration flags. Those flags live in
// volatile localStorage while the real data lives in IndexedDB; deleting a flag
// while the DB still has data would shadow real data with empty caches on reload.
const RESERVED_LOCAL_STORAGE_KEYS = [
  "ai_phone_idb_migrated_v1",
  "ai_phone_settings_idb_migrated_v1",
];

// ⚠️ CONTRACT: this list is the single source of truth for BOTH the data
// backup/import/clear system (data-management/backup.ts, idb.ts) AND the
// character "local data library" tool (local-data-fs.ts). Any change to WHERE
// data is stored (a new kv key, a moved key, a new IndexedDB store) MUST be
// mirrored here in the same change — otherwise that data silently disappears
// from backups and from the tool even though it is still physically in storage.
export const DATA_MODULES: DataModuleDefinition[] = [
  {
    id: "chat",
    label: "聊天数据",
    description: "会话、消息、联系人、聊天设置和待回复状态",
    variant: "action",
    critical: true,
    sources: [
      { type: "indexeddb", dbName: "AiPhoneChatDB", label: "聊天记录" },
      { type: "indexeddb", dbName: "AiPhoneMediaCacheDB", label: "聊天与工具媒体缓存" },
      {
        type: "kv",
        label: "聊天设置与待处理状态",
        keys: ["ai_phone_chat_settings_v1", "ai_phone_followup_schedules_v1", "ai_phone_timed_wake_schedules_v1"],
        prefixes: ["chat-generating:", "pending_reply_", "ai_phone_chat_offline_turns:", "chat-offline-mode:"],
      },
      {
        type: "localStorage",
        label: "聊天迁移标记",
        keys: ["ai_phone_idb_migrated_v1"],
      },
    ],
  },
  {
    id: "settings",
    label: "设置与规则",
    description: "API、语音、绑定、预设、世界书、正则和工具配置",
    variant: "teal",
    critical: true,
    sources: [
      { type: "indexeddb", dbName: "AiPhoneSettingsDB", label: "设置数据库" },
      {
        type: "kv",
        label: "设置与规则键值",
        keys: [
          "ai_phone_api_configs_v1",
          "ai_phone_voice_configs_v1",
          "ai_phone_image_generation_settings_v1",
          "ai_phone_bindings_v1",
          "ai_phone_follow_up_config_v1",
          "ai_phone_chat_send_config_v1",
          "ai_phone_user_identities_v1",
          "ai_phone_char_settings_v1",
          "ai_phone_rest_tools_v1",
          "ai_phone_rest_tool_packages_v1",
          "ai_phone_composite_tools_v1",
          "ai_phone_composite_tool_packages_v1",
          "ai_phone_mcp_servers_v1",
          "ai_phone_internal_capabilities_v1",
          "weixin_bots_v1",
          "weixin_keepalive_v1",
          "weixin_cloud_sync_config_v1",
        ],
      },
      {
        type: "localStorage",
        label: "设置迁移标记",
        keys: ["ai_phone_settings_idb_migrated_v1"],
      },
    ],
  },
  {
    id: "characters",
    label: "角色卡与素材",
    description: "角色卡，以及角色卡编辑器里使用的身份/背景素材",
    variant: "success",
    critical: true,
    sources: [
      {
        type: "kv",
        label: "角色卡与角色素材",
        keys: [
          "ai_phone_characters_v1",
          "ai_phone_bg_items_v1",
        ],
      },
    ],
  },
  {
    id: "desktop",
    label: "桌面与主题",
    description: "桌面布局、小组件、主题、图标、自定义 CSS 和社交展示资料",
    variant: "success",
    critical: true,
    sources: [
      { type: "indexeddb", dbName: "AiPhoneMascotDB", label: "桌宠聊天" },
      { type: "indexeddb", dbName: "ai_phone_theme_db_v1", label: "主题素材库" },
      {
        type: "kv",
        label: "桌面与主题配置",
        keys: [
          "ai_phone_icon_layout_v1",
          "ai_phone_icon_layout_v2",
          "ai_phone_canvas_pan_v2",
          "ai_phone_widgets_v1",
          "ai_phone_diy_templates_v1",
          "ai_phone_theme_profile_v1",
          "css-schemes-v1",
          "chat-app-custom-css",
          "music-custom-css",
          "calendar-custom-css",
          "moments_cover_asset_v1",
          "moments_cover_asset_id",
          "moments_signature",
          "ai_phone_sticker_packs_v1",
          "ai_phone_sticker_assign_v1",
        ],
      },
    ],
  },
  {
    id: "memory",
    label: "记忆",
    description: "长期记忆、核心记忆、事件计数与摘要时间戳",
    variant: "warning",
    critical: true,
    sources: [
      { type: "indexeddb", dbName: "ai_phone_memory_db_v1", label: "记忆数据库" },
      {
        type: "kv",
        label: "记忆配置与计数",
        keys: ["ai_phone_memory_config_v1"],
        prefixes: [
          "ai_phone_mem_evt_count_",
          "ai_phone_mem_last_sum_",
          "ai_phone_mem_core_count_",
          "ai_phone_mem_last_core_sum_",
          "note_wall_events_",
          "ai_phone_interview_magazine_events_",
          "ai_phone_cocreate_events_",
        ],
      },
      {
        type: "localStorage",
        label: "便签墙本地设置",
        keys: [
          "ai_phone_note_wall_timer_settings_v1",
          "ai_phone_note_wall_local_user_v1",
        ],
      },
    ],
  },
  {
    id: "social",
    label: "社交内容",
    description: "朋友圈、小红书、好友申请和社交互动状态",
    variant: "action",
    sources: [
      // Moments posts & comments live in their own DB (per-record rows).
      { type: "indexeddb", dbName: "AiPhoneMomentsDB", label: "朋友圈记录" },
      {
        type: "kv",
        label: "社交状态与小红书",
        keys: [
          "ai_phone_moments_ai_schedule_v1",
          "ai_phone_moments_pending_reactions_v1",
          "ai_phone_moments_config_v1",
          "ai_phone_moments_last_seen_v1",
          "ai_phone_character_worlds_v1",
          "ai_phone_character_world_layout_v1",
          "ai_phone_xiaohongshu_state_v1",
          "ai_phone_friend_requests_v1",
        ],
        prefixes: ["checkphone:xiaohongshu:readThreads", "xiaohongshu_events_", "ai_phone_xiaohongshu_events_"],
      },
    ],
  },
  {
    id: "apps",
    label: "内容应用",
    description: "日历、日记、购物、余额、阅读、音乐、经期记录与应用偏好",
    variant: "teal",
    large: true,
    sources: [
      { type: "indexeddb", dbName: "reading-db", label: "阅读书架与章节" },
      { type: "indexeddb", dbName: "reading-raw-files", label: "阅读原始文件" },
      { type: "indexeddb", dbName: "reading-appearance-assets", label: "阅读外观素材" },
      { type: "indexeddb", dbName: "ai_phone_music_db_v1", label: "本地音乐" },
      {
        type: "kv",
        label: "内容应用配置与缓存",
        keys: [
          "ai_phone_calendar_plans_v1",
          "ai_phone_calendar_config_v1",
          "ai_phone_diary_entries_v1",
          "ai_phone_diary_entry_timer_settings_v1",
          "ai_phone_diary_entry_font_asset_v1",
          "ai_phone_diary_entry_font_scale_v1",
          "ai_phone_shopping_state_v1",
          "ai_phone_wallet_state_v1",
          "ai_phone_reading_interaction_config_v1",
          "ai_phone_reading_appearance_v1",
          "ai_phone_menstrual_config_v1",
          "ai_phone_menstrual_records_v1",
          "ai_phone_menstrual_period_care_triggers_v1",
          "ai_phone_music_api_v1",
          "ai_phone_netease_cookie_v1",
          "ai_phone_music_queue_v1",
          "ai_phone_track_playlist_map_v1",
          "music_api_config_v1",
          "netease_cookie_v1",
          "music_queue_v1",
          "music_track_playlist_map_v1",
          "music-playlists-cache",
          "music-recommend-daily",
          "music-recommend-fm",
          "music-recommend-playlists",
          "music-recommend-hot-search",
          "music-recommend-toplists",
          "music-user-recent",
          "reading-import-diagnostic-v1",
          "reading_import_diag_v1",
        ],
        prefixes: ["music-search-cache:", "music-playlist-tracks-", "music-playlist-detail-"],
      },
    ],
  },
  {
    id: "resource_hub",
    label: "资源集市",
    description: "摊主钥匙（自己发布资源的所有权凭证）、昵称头像与集市设置",
    variant: "teal",
    sources: [
      {
        type: "kv",
        label: "摊主身份与集市设置",
        keys: [
          // 钥匙丢了就再也管不了自己发过的资源，必须跟着备份走
          "ai_phone_resource_hub_identity_v1",
          "ai_phone_resource_hub_my_uploads_v1",
          "ai_phone_resource_hub_profile_v1",
          "ai_phone_resource_hub_upload_cfg_v1",
          "ai_phone_resource_hub_source_v1",
          "ai_phone_resource_hub_flowers_sent_v1",
          "ai_phone_resource_hub_notice_v2",
        ],
      },
    ],
  },
  {
    id: "creative",
    label: "创作与玩法",
    description: "故事、漫卷、地图、住宅、黑市、查手机快照与世界构建素材",
    variant: "success",
    large: true,
    sources: [
      { type: "indexeddb", dbName: "AiPhoneStoryDB", label: "故事" },
      { type: "indexeddb", dbName: "AiPhoneVnDB", label: "漫卷" },
      { type: "indexeddb", dbName: "AiPhoneMapDB", label: "地图冒险" },
      { type: "indexeddb", dbName: "AiPhoneDwellingDB", label: "住宅" },
      { type: "indexeddb", dbName: "AiPhoneCheckPhoneDB", label: "查手机快照" },
      { type: "indexeddb", dbName: "world-builder-scenes", label: "世界构建场景" },
      { type: "indexeddb", dbName: "world-builder-models", label: "世界构建模型" },
      {
        type: "kv",
        label: "创作玩法配置",
        keys: [
          "ai_phone_vn_scenes_v1",
          "ai_phone_vn_sprites_v1",
          "map_adventure_interaction_config_v1",
          "map_dm_prompts",
          "map_dm_token_config",
          "map_adventure_summary_config",
          "ai_phone_interview_magazine_issues_v1",
          "ai_phone_interview_magazine_drafts_v1",
          "ai_phone_interview_magazine_host_prompt_v1",
          "ai_phone_interview_magazine_memory_prompt_v1",
          "ai_phone_cocreate_session_v1",
          "ai_phone_cocreate_library_v1",
          "wb-settings",
          "wb-tripo-api-key",
          "checkphone-settings",
          "ai_phone_game_state_v1",
          "ai_phone_game_hall_drafts_v1",
          "ai_phone_black_market_state_v1",
          "ai_phone_black_market_user_id_v1",
          "ai_phone_black_market_scene_sessions_v1",
          "ai_phone_black_market_studio_drafts_v1",
        ],
        prefixes: ["map_world_theme_", "map_adventure_summary_", "ai_phone_black_market_theater_events_"],
      },
    ],
  },
  {
    id: "cache",
    label: "缓存与临时",
    description: "浏览器遗留键、临时状态和未归类的小型缓存",
    variant: "warning",
    sources: [
      { type: "localStorage", label: "浏览器遗留缓存", includeAll: true, excludeKeys: RESERVED_LOCAL_STORAGE_KEYS },
    ],
  },
];

export function getDataModule(id: DataModuleId): DataModuleDefinition | undefined {
  return DATA_MODULES.find((module) => module.id === id);
}

export function getLightModuleIds(): DataModuleId[] {
  return DATA_MODULES.filter((module) => !module.large).map((module) => module.id);
}
