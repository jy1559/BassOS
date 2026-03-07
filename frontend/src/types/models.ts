export type SessionStopInput = {
  activity: string;
  sub_activity?: string;
  song_library_id?: string;
  drill_id?: string;
  tags: string[];
  evidence_type?: "file" | "url";
  evidence_url?: string;
  evidence_path?: string;
  notes?: string;
  is_backfill?: boolean;
  start_at?: string;
  end_at?: string;
  is_quick_log?: boolean;
  duration_min?: number;
  song_speed?: Record<string, unknown>;
  drill_bpm?: Record<string, unknown>;
  feelings?: string[];
};

export type ChainSavedSegment = {
  event_id: string;
  activity: string;
  sub_activity?: string;
  song_library_id?: string;
  drill_id?: string;
  title?: string;
  duration_min: number;
  xp: number;
};

export type SessionChainSummary = {
  saved_count: number;
  total_duration_min: number;
  total_xp: number;
  segments: ChainSavedSegment[];
  lines: Array<{
    key: string;
    label: string;
    activity: string;
    sub_activity?: string;
    song_library_id?: string;
    drill_id?: string;
    duration_min: number;
    xp: number;
  }>;
};

export type LevelUpCopy = {
  line: string;
  tier_up: boolean;
  before_tier: string;
  after_tier: string;
  tier_color: string;
  badge_before: string;
  badge_after: string;
};

export type SessionGamification = {
  session_bucket?: string;
  streak_days?: number;
  streak_weeks?: number;
  is_first_session_of_week?: boolean;
  is_long_session?: boolean;
  long_session_probability?: number;
  long_session_roll?: number;
  long_session_threshold_min?: number;
  session_message?: string;
  level_message?: string;
  tier_up?: boolean;
  before_tier?: string;
  after_tier?: string;
  tier_color?: string;
  badge_before?: string;
  badge_after?: string;
};

export type SessionStopResult = {
  event: Record<string, string>;
  xp_breakdown: {
    base_xp: number;
    bonus_xp: number;
    bonus_breakdown: Record<string, number>;
    total_xp: number;
  };
  auto_granted: string[];
  auto_granted_names?: string[];
  level_up?: boolean;
  before_level?: number;
  after_level?: number;
  coach_message?: string;
  coach_reason_tags?: string[];
  next_win_hint?: string;
  gamification?: SessionGamification;
  event_saved?: boolean;
  under_min_skipped_current?: boolean;
  current_duration_min?: number;
  session_chain?: SessionChainSummary;
};

export type SessionFinalizeInput = {
  include_saved_event_ids: string[];
  include_current: boolean;
  current_stop_payload?: SessionStopInput;
};

export type SessionFinalizeResult = SessionStopResult & {
  kept_sessions: ChainSavedSegment[];
  removed_sessions: ChainSavedSegment[];
  summary: SessionChainSummary;
  current_saved: boolean;
  current_skipped_under_min: boolean;
};

export type HudSummary = {
  total_xp: number;
  level: number;
  level_title?: string;
  rank: string;
  progress_pct: number;
  xp_to_next: number;
  current_level_xp: number;
  today_xp: number;
  week_xp: number;
  active_session: {
    session_id?: string;
    start_at?: string;
    activity?: string;
    sub_activity?: string;
    song_library_id?: string;
    drill_id?: string;
    title?: string;
    notes?: string;
    chain_saved_segments?: ChainSavedSegment[];
    chain_saved_count?: number;
    chain_under_min_count?: number;
    chain_count?: number;
  };
  unlocked_count: number;
  badge?: { id: string; name: string; style: string; asset?: string; tier_step?: string };
  next_unlock?: {
    unlock_id: string;
    name: string;
    type: string;
    level_required: number;
    description: string;
  };
};

export type Quest = {
  quest_id: string;
  title: string;
  emoji?: string;
  description: string;
  status: string;
  xp_reward: number;
  start_date: string;
  due_date: string;
  period_class: "short" | "mid" | "long";
  difficulty: "low" | "mid" | "high";
  priority: "low" | "normal" | "urgent";
  auto_generated: boolean;
  resolved_at?: string;
  genre_tags: string[];
  linked_song_ids: string[];
  linked_drill_ids: string[];
  rule_type: string;
  progress: number;
  target: number;
  claimable: boolean;
  source: string;
};

export type Achievement = {
  achievement_id: string;
  group_id: string;
  name: string;
  description: string;
  hint: string;
  category: string;
  tier: number;
  tier_name: string;
  target: number;
  display_order?: number;
  progress: number;
  unlocked: boolean;
  claimed: boolean;
  claimed_at?: string;
  hidden: boolean;
  auto_grant: boolean;
  xp_reward: number;
  effective_xp_reward?: number;
  ui_badge_style: string;
  rule_type: string;
  evidence_hint: string;
  icon_path: string;
  icon_url: string;
};

export type AdminAchievementMasterItem = {
  achievement_id: string;
  group_id: string;
  name: string;
  tier: string;
  tier_name: string;
  category: string;
  rarity: string;
  rule_type: string;
  rule_filter: string;
  target: string;
  display_order: string;
  xp_reward: string;
  description: string;
  evidence_hint: string;
  is_hidden: string;
  hint: string;
  auto_grant: string;
  ui_badge_style: string;
  icon_path: string;
  icon_url: string;
  _progress: number;
  _target: number;
  _unlocked: boolean;
  _claimed: boolean;
  _hidden_locked: boolean;
  _effective_xp_reward: number;
  _rule_summary_ko?: string;
  _rule_steps_ko?: string[];
  [key: string]: unknown;
};

export type AchievementRuleOptions = {
  rule_types: string[];
  event_types: string[];
  tags: string[];
  fields: string[];
  condition_fields: string[];
  condition_ops: string[];
  feature_values: Record<string, string[]>;
  rule_type_meta?: Record<
    string,
    {
      title: string;
      target_unit: string;
      description: string;
    }
  >;
  field_meta?: Record<
    string,
    {
      label: string;
      description: string;
      type: string;
      examples: string[];
    }
  >;
  operator_meta?: Record<
    string,
    {
      label: string;
      description: string;
    }
  >;
  field_groups?: Array<{ group: string; fields: string[] }>;
  value_suggestions?: Record<string, string[]>;
  builder_examples?: Array<{
    title: string;
    rule_type: string;
    target: number;
    rule_filter: Record<string, unknown>;
    description: string;
  }>;
  example_rules: Array<{
    title: string;
    rule_type: string;
    target: number;
    rule_filter: Record<string, unknown>;
    description: string;
  }>;
};

export type SessionItem = {
  event_id: string;
  created_at: string;
  start_at: string;
  end_at: string;
  duration_min: number;
  activity: string;
  sub_activity?: string;
  xp: number;
  title: string;
  notes: string;
  song_library_id: string;
  song_title?: string;
  song_genre?: string;
  drill_id: string;
  drill_name?: string;
  tags: string[];
  evidence_type: string;
  evidence_path: string;
  evidence_url: string;
  xp_breakdown: Record<string, unknown>;
  is_backfill: boolean;
  song_speed?: Record<string, unknown>;
  drill_bpm?: Record<string, unknown>;
  feelings?: string[];
};

export type SessionUpdateInput = Partial<SessionStopInput> & {
  start_at?: string;
  end_at?: string;
  activity?: string;
  sub_activity?: string;
  tags?: string[];
  notes?: string;
};

export type StatsOverview = {
  summary: {
    sessions_count: number;
    total_duration_min: number;
    avg_duration_min: number;
    session_xp: number;
    total_xp: number;
  };
  daily: Array<{ key: string; xp: number; session_count: number; duration_min: number }>;
  weekly: Array<{ key: string; xp: number; session_count: number; duration_min: number }>;
  monthly: Array<{ key: string; xp: number; session_count: number; duration_min: number }>;
  activity: Array<{ key: string; xp: number; session_count: number; duration_min: number }>;
  level_timeline: Array<{ key: string; level: number; xp_total: number }>;
  engagement: {
    revisit_7d_rate: number;
    active_days_30d: number;
    weekly_goal_hit_rate: number;
  };
  quest_breakdown: {
    by_period: Array<{ key: string; claimed: number; xp: number }>;
    by_difficulty: Array<{ key: string; claimed: number; xp: number }>;
    by_priority: Array<{ key: string; claimed: number; xp: number }>;
    by_genre: Array<{ key: string; claimed: number; xp: number }>;
    claimed_total: number;
    claimed_xp_total: number;
  };
};

export type XPRangeKey = "7d" | "30d" | "90d" | "all";
export type XPGranularityKey = "day" | "week" | "month";

export type RecordScope = "all" | "period" | "recent";
export type RecordPeriodUnit = "week" | "month" | "year";
export type RecordRecentDays = 7 | 30 | 90;

export type RecordPeriodState = {
  scope: RecordScope;
  periodUnit: RecordPeriodUnit;
  recentDays: RecordRecentDays;
  anchorDate: string;
};

export type RecordPeriodWindow = {
  scope: RecordScope;
  periodUnit?: RecordPeriodUnit;
  recentDays?: RecordRecentDays;
  anchorKey: string;
  startKey: string | null;
  endKey: string | null;
  prevStartKey?: string | null;
  prevEndKey?: string | null;
  label: string;
};

export type PlayerXPStory = {
  summary_by_range: Record<
    XPRangeKey,
    {
      xp_total: number;
      prev_xp_total: number;
      delta_pct: number;
      avg_xp_per_day: number;
      best_xp_day: { key: string; xp: number };
      total_duration_min: number;
      start_key?: string;
      end_key?: string;
      prev_start_key?: string | null;
      prev_end_key?: string | null;
    }
  >;
  goals: {
    weekly: {
      auto: number;
      manual?: number | null;
      effective: number;
      current_xp: number;
      progress_pct: number;
      period_start_key?: string;
      period_end_key?: string;
      prev_period_start_key?: string;
      prev_period_end_key?: string;
      prev_xp?: number;
      prev_progress_pct?: number;
      min: 800;
      max: 6000;
    };
    monthly: {
      auto: number;
      manual?: number | null;
      effective: number;
      current_xp: number;
      progress_pct: number;
      period_start_key?: string;
      period_end_key?: string;
      prev_period_start_key?: string;
      prev_period_end_key?: string;
      prev_xp?: number;
      prev_progress_pct?: number;
      min: 3200;
      max: 24000;
    };
  };
  charts: {
    xp: Record<XPRangeKey, Record<XPGranularityKey, Array<{ key: string; xp: number; is_today?: boolean }>>>;
    level_progress: Record<XPRangeKey, Array<{ key: string; level: number; progress_pct: number; value: number }>>;
  };
  streaks: { current_days: number; longest_days: number; longest_weeks: number };
  heatmap: {
    shape: "14x3";
    cells: Array<{ key: string; minutes: number; xp?: number; intensity: 0 | 1 | 2 | 3 | 4 }>;
    history?: Array<{ key: string; minutes: number; xp?: number }>;
  };
  highlights: {
    best_practice_day: { key: string; duration_min: number };
    longest_streak_days: number;
    longest_streak_weeks: number;
  };
  unlock_preview: {
    next?: { level_required: number; name: string; type: string; description: string; progress_pct: number } | null;
    upcoming: Array<{ level_required: number; name: string; type: string; description: string; progress_pct: number }>;
  };
};

export type PlayerXP = {
  hud: HudSummary;
  badge: { id: string; name: string; style: string; asset?: string };
  level_title: string;
  upcoming_unlocks: Array<{ level_required: number; name: string; type: string; description: string }>;
  cheer: string;
  stats: StatsOverview;
  xp_sources: Record<XPRangeKey, Array<{ key: string; xp: number }>>;
  xp_by_activity: Record<XPRangeKey, Array<{ key: string; xp: number }>>;
  xp_timeline: Record<XPRangeKey, Array<{ key: string; xp: number }>>;
  story: PlayerXPStory;
};

export type PlayerXPWindow = {
  window: {
    scope: RecordScope;
    period_unit?: RecordPeriodUnit;
    recent_days?: RecordRecentDays;
    anchor_key: string;
    start_key: string;
    end_key: string;
    prev_start_key?: string | null;
    prev_end_key?: string | null;
    label: string;
  };
  summary: {
    xp_total: number;
    prev_xp_total: number;
    delta_pct: number;
    avg_xp_per_day: number;
    best_xp_day: { key: string; xp: number };
    total_duration_min: number;
  };
  charts: {
    day: Array<{ key: string; xp: number; is_today?: boolean }>;
    week: Array<{ key: string; xp: number }>;
    month: Array<{ key: string; xp: number }>;
  };
  level_progress: Array<{ key: string; level: number; progress_pct: number; value: number }>;
  xp_by_activity: Array<{ key: string; xp: number }>;
  xp_sources: Array<{ key: string; xp: number }>;
};

export type GalleryItem = {
  event_id: string;
  event_type: string;
  created_at: string;
  title: string;
  notes: string;
  evidence_type: string;
  evidence_path: string;
  evidence_url: string;
  song_library_id: string;
  drill_id: string;
  song_title?: string;
  drill_name?: string;
  tags?: string[];
  source?: string;
  meta?: Record<string, unknown>;
};

export type RecordAttachment = {
  attachment_id: string;
  post_id: string;
  media_type: "image" | "video" | "audio";
  path: string;
  url: string;
  preview_url?: string;
  title?: string;
  notes?: string;
  sort_order: number;
  created_at: string;
};

export type RecordComment = {
  comment_id: string;
  post_id: string;
  parent_comment_id: string;
  created_at: string;
  updated_at: string;
  body: string;
  deleted: boolean;
  depth: number;
  source?: string;
};

export type RecordPost = {
  post_id: string;
  created_at: string;
  updated_at: string;
  title: string;
  body: string;
  post_type: string;
  header_id: string;
  header_label: string;
  header_color?: string;
  template_id: string;
  template_name?: string;
  meta: {
    practice_date?: string;
    duration_min?: number | null;
    bpm?: string;
    focus?: string;
    today_win?: string;
    issue?: string;
    next_action?: string;
    recording_kind?: string;
    [key: string]: unknown;
  };
  tags: string[];
  linked_song_ids: string[];
  linked_song_titles?: string[];
  linked_drill_ids: string[];
  linked_drill_titles?: string[];
  free_targets: string[];
  source_context: string;
  attachments: RecordAttachment[];
  comment_count: number;
  latest_comment_at?: string;
  legacy_event_id?: string;
  source?: string;
};

export type JournalTagPreset = {
  id: string;
  label: string;
  category: string;
  active: boolean;
  order: number;
};

export type JournalHeaderPreset = {
  id: string;
  label: string;
  color: string;
  active: boolean;
  order: number;
};

export type JournalTemplatePreset = {
  id: string;
  name: string;
  description: string;
  header_id: string;
  default_tags: string[];
  default_source_context: "practice" | "review" | "performance" | "archive";
  body_markdown: string;
  active: boolean;
  order: number;
};

export type AchievementRecent = {
  achievement_id: string;
  name: string;
  created_at: string;
  xp: string;
};

export type TutorialState = {
  campaign_id: string;
  completed: boolean;
  reward_claimed: boolean;
  banner_seen: boolean;
  resume_step_index: number;
  total_steps: number;
  guide_finisher_unlocked: boolean;
};

export type TutorialProgressResponse = {
  campaign_id: string;
  resume_step_index: number;
  started_at?: string;
};

export type TutorialCompleteResponse = {
  campaign_id: string;
  completed: boolean;
  reward_granted: boolean;
  xp_granted: number;
  title_unlocked: string;
  guide_finisher_unlocked: boolean;
};

export type DashboardLayoutItem = {
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
};

export type GenreGroup = {
  name: string;
  values: string[];
};

export type ShortcutBinding = {
  code: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
};

export type ShortcutActionId =
  | "tab_dashboard"
  | "tab_practice"
  | "tab_gallery"
  | "tab_songs"
  | "tab_drills"
  | "tab_recommend"
  | "tab_review"
  | "tab_xp"
  | "tab_sessions"
  | "tab_quests"
  | "tab_achievements"
  | "tab_tools"
  | "tab_settings"
  | "video_toggle"
  | "video_restart"
  | "video_fullscreen"
  | "video_pin_save"
  | "video_pin_jump"
  | "video_pin_clear"
  | "score_zoom"
  | "score_prev"
  | "score_next"
  | "metronome_toggle"
  | "pip_video_toggle"
  | "pip_collapse_toggle"
  | "pip_open_studio"
  | "pip_stop_session"
  | "popup_primary"
  | "popup_close"
  | "popup_destructive"
  | "popup_alternate";

export type KeyboardShortcutSettings = {
  bindings: Record<ShortcutActionId, ShortcutBinding | null>;
};

export type Settings = {
  ui: {
    default_theme: string;
    language: "ko" | "en";
    animation_intensity: "adaptive" | "low" | "high";
    enable_confetti?: boolean;
    practice_video_pip_mode?: "mini" | "none";
    practice_video_tab_switch_playback?: "continue" | "pause" | "pip_only";
    notify_level_up?: boolean;
    notify_achievement_unlock?: boolean;
    notify_quest_complete?: boolean;
    fx_level_up_overlay?: boolean;
    fx_achievement_unlock?: boolean;
    fx_quest_complete?: boolean;
    fx_session_complete_normal?: boolean;
    fx_session_complete_quick?: boolean;
    fx_claim_achievement?: boolean;
    fx_claim_quest?: boolean;
    levelup_sound?: string;
    dashboard_glass_cards?: boolean;
    dashboard_version?: "legacy" | "focus";
    session_timer_pip_corner?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
    song_genres?: string[];
    song_genre_groups?: GenreGroup[];
    song_genre_aliases?: Record<string, string>;
    achievement_card_styles?: Record<
      string,
      {
        border?: string;
        fill?: string;
      }
    >;
    dashboard_layout_legacy?: Record<string, DashboardLayoutItem>;
    dashboard_layout_focus?: Record<string, DashboardLayoutItem>;
    keyboard_shortcuts?: KeyboardShortcutSettings;
  };
  audio: {
    enabled: boolean;
    master_volume: number;
    levelup_sound?: string;
  };
  profile: {
    nickname: string;
    weekly_goal_sessions: number;
    weekly_goal_minutes?: number;
    monthly_goal_minutes?: number;
    xp_goal_weekly?: number;
    xp_goal_monthly?: number;
    onboarded: boolean;
    guide_finisher_unlocked?: boolean;
    tutorial_state?: {
      campaign_id?: string;
      banner_seen_campaigns?: string[];
      completed_campaigns?: string[];
      reward_claimed_campaigns?: string[];
      resume_campaign_id?: string;
      resume_step_index?: number;
      last_started_at?: string;
      last_completed_at?: string;
    };
    featured_gallery_event_id?: string;
    song_shortcuts?: string[];
    dashboard_photo_anchor?: "center" | "top" | "bottom" | "left" | "right";
    dashboard_photo_items?: Array<{
      id: string;
      title: string;
      path: string;
      created_at: string;
    }>;
    dashboard_featured_photo_id?: string;
    journal_tag_catalog?: JournalTagPreset[];
    journal_header_catalog?: JournalHeaderPreset[];
    journal_template_catalog?: JournalTemplatePreset[];
    quest_settings?: {
      period_days?: {
        short?: number;
        mid?: number;
        long?: number;
      };
      auto_enabled_by_period?: {
        short?: boolean;
        mid?: boolean;
        long?: boolean;
      };
      auto_target_minutes_by_period?: {
        short?: number;
        mid?: number;
        long?: number;
      };
      auto_priority_by_period?: {
        short?: "low" | "normal" | "urgent";
        mid?: "low" | "normal" | "urgent";
        long?: "low" | "normal" | "urgent";
      };
      auto_difficulty_by_period?: {
        short?: "low" | "mid" | "high";
        mid?: "low" | "mid" | "high";
        long?: "low" | "mid" | "high";
      };
      ui_style?: {
        period_border?: {
          short?: string;
          mid?: string;
          long?: string;
        };
        period_fill?: {
          short?: string;
          mid?: string;
          long?: string;
        };
        priority_border?: {
          urgent?: string;
          normal?: string;
          low?: string;
        };
        difficulty_fill?: {
          low?: string;
          mid?: string;
          high?: string;
        };
      };
    };
  };
  backup?: {
    enabled?: boolean;
    max_files?: number;
    min_hours_between?: number;
  };
  performance?: {
    target_dashboard_ms?: number;
  };
  admin?: {
    gate_enabled?: boolean;
    pin_hash?: string;
  };
  [key: string]: unknown;
};

export type MockDatasetInfo = {
  id: string;
  name: string;
  description: string;
  updated_at: string;
  file_count: number;
};

export type MockDataStatus = {
  active: boolean;
  profile: "real" | "mock";
  dataset_id: string | null;
  active_data_path?: string;
  real_data_path?: string;
  datasets_root?: string;
};

export type BackupInfo = {
  name: string;
  size: number;
  mtime: number;
};

export type MockDatasetExportResult = {
  dataset_id: string;
  dataset_path: string;
  data_path: string;
  file_count: number;
  copied_csv_count: number;
  generated_sessions: number;
};

export type AchievementPackExportResult = {
  dataset_id: string;
  dataset_path: string;
  data_path: string;
  media_path: string;
  achievement_count: number;
  icon_file_count: number;
};
