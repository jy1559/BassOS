import { useEffect, useMemo, useState } from "react";
import {
  createAdminAchievementMaster,
  deleteAdminAchievementMaster,
  exportAchievementPack,
  getAchievementRuleOptions,
  getAdminAchievementsMaster,
  putBasicSettings,
  resetCuratedAchievements,
  updateAdminAchievementMaster,
  uploadAchievementIcon,
} from "../../api";
import type { Lang } from "../../i18n";
import type { AchievementRuleOptions, AdminAchievementMasterItem, Settings } from "../../types/models";

type Props = {
  lang: Lang;
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  setMessage: (message: string) => void;
  onRefresh: () => Promise<void>;
};

type KindFilter = "all" | "tiered" | "single";
type CardKind = "tiered" | "single" | "hidden";
type EditorMode = "none" | "row" | "bulk";
type RowEditMode = "full" | "tier-lite";

type RuleLogic = "all" | "any";

type RuleConditionNode = {
  id: string;
  type: "condition";
  field: string;
  op: string;
  value: string;
  manualValueInput?: boolean;
};

type RuleGroupNode = {
  id: string;
  type: "group";
  logic: RuleLogic;
  children: RuleTreeNode[];
};

type RuleTreeNode = RuleConditionNode | RuleGroupNode;

type RuleBuilderState = {
  rule_event_type: string;
  rule_tags_any: string;
  rule_tags_all: string;
  rule_field: string;
  rule_min_duration: string;
  rule_min_sessions: string;
  rule_min_sessions_per_month: string;
  rule_goal_type: string;
  rule_condition_tree: RuleGroupNode;
  rule_filter_raw: string;
};

type FormState = RuleBuilderState & {
  achievement_id: string;
  group_id: string;
  name: string;
  tier: string;
  tier_name: string;
  category: string;
  rarity: string;
  xp_reward: string;
  target: string;
  display_order: string;
  rule_type: string;
  description: string;
  evidence_hint: string;
  hint: string;
  is_hidden: boolean;
  auto_grant: boolean;
  ui_badge_style: string;
  icon_path: string;
  icon_url: string;
};

type BulkState = RuleBuilderState & {
  groupId: string;
  category: string;
  rarity: string;
  rule_type: string;
  is_hidden: boolean;
  auto_grant: boolean;
  icon_path: string;
  icon_url: string;
  tiers: Array<{
    achievement_id: string;
    tier: string;
    tier_name: string;
    name: string;
    target: string;
    xp_reward: string;
    icon_path: string;
    icon_url: string;
  }>;
};

type StyleKey =
  | "tier_bronze"
  | "tier_silver"
  | "tier_gold"
  | "tier_platinum"
  | "tier_diamond"
  | "tier_master"
  | "single_event"
  | "single_hidden";

type StyleForm = Record<StyleKey, { border: string; fill: string }>;

type GroupEntry = {
  groupId: string;
  rows: AdminAchievementMasterItem[];
  kind: CardKind;
  hiddenGroup: boolean;
  displayOrder: number;
};

const DEFAULT_STYLE_FORM: StyleForm = {
  tier_bronze: { border: "#b88746", fill: "#f8f1e7" },
  tier_silver: { border: "#8ca0ad", fill: "#eff4f7" },
  tier_gold: { border: "#d6aa2d", fill: "#fcf6e7" },
  tier_platinum: { border: "#58a4be", fill: "#e8f7fa" },
  tier_diamond: { border: "#6f72ff", fill: "#f0f0ff" },
  tier_master: { border: "#ff9640", fill: "#fff1e2" },
  single_event: { border: "#4f8b92", fill: "#ebf6f8" },
  single_hidden: { border: "#59606a", fill: "#f0f2f5" },
};

const STYLE_LABEL: Record<StyleKey, string> = {
  tier_bronze: "Bronze",
  tier_silver: "Silver",
  tier_gold: "Gold",
  tier_platinum: "Platinum",
  tier_diamond: "Diamond",
  tier_master: "Master",
  single_event: "Event",
  single_hidden: "Hidden",
};

const FALLBACK_RULE_OPTIONS: AchievementRuleOptions = {
  rule_types: [
    "count_events",
    "sum_duration",
    "sum_xp",
    "level_reach",
    "distinct_count",
    "streak_weekly",
    "streak_monthly",
    "manual",
  ],
  event_types: ["SESSION", "LONG_GOAL_CLEAR", "ACHIEVEMENT_CLAIM", "GALLERY_UPLOAD", "ADMIN_ADJUST"],
  tags: [
    "CORE",
    "FUNK",
    "SLAP",
    "THEORY",
    "SONG_PRACTICE",
    "BAND",
    "PERFORMANCE",
    "COMMUNITY",
    "RECORDING_AUDIO",
    "RECORDING_VIDEO",
    "AB_COMPARE",
    "METRO_24",
    "METRO_ONEBAR",
    "CLEAN_MUTE",
    "EAR_COPY",
    "박자",
    "포지션",
    "지구력",
    "스피드",
    "클린",
    "다이내믹",
    "리딩",
    "핑거",
    "피크",
    "고스트",
    "레가토",
    "크로매틱",
    "스케일",
    "코드톤",
    "인터벌",
    "진행",
    "8분음표",
    "16분음표",
    "트리플렛",
    "싱코페이션",
    "그루브",
    "워킹",
    "컴핑",
  ],
  fields: ["song_library_id", "drill_id", "quest_id", "achievement_id", "event_type", "activity", "source"],
  condition_fields: [
    "event_type",
    "activity",
    "sub_activity",
    "duration_min",
    "xp",
    "source",
    "song.genre",
    "song.status",
    "song.artist",
    "drill.area",
    "drill.tags",
  ],
  condition_ops: ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "in", "not_in", "exists", "not_exists"],
  feature_values: {},
  rule_type_meta: {},
  field_meta: {},
  operator_meta: {},
  field_groups: [],
  value_suggestions: {},
  builder_examples: [],
  example_rules: [],
};

const TAG_LABEL_KO: Record<string, string> = {
  SONG: "곡",
  DRILL: "드릴",
  ETC: "기타",
  CORE: "기본기",
  FUNK: "펑크",
  FUNKJAZZ: "펑크/재즈",
  SLAP: "슬랩",
  THEORY: "이론",
  SONG_COPY: "카피",
  SONG_LEARN: "곡 학습",
  SONG_PRACTICE: "곡 연습",
  SONG_DISCOVERY: "곡 탐색",
  BAND: "합주",
  PERFORMANCE: "공연",
  COMMUNITY: "커뮤니티",
  GEAR: "장비",
  METRO_24: "메트로놈 2&4",
  METRO_ONEBAR: "한 마디 한 클릭",
  CLEAN_MUTE: "클린 뮤트",
  EAR_COPY: "귀카피",
  RECORDING_AUDIO: "오디오 녹음",
  RECORDING_VIDEO: "영상 녹음",
  AB_COMPARE: "A/B 비교",
  QUEST_CLAIM: "퀘스트 보상 수령",
  "박자": "박자",
  "포지션": "포지션",
  "지구력": "지구력",
  "스피드": "스피드",
  "클린": "클린",
  "다이내믹": "다이내믹",
  "리딩": "리딩",
  "핑거": "핑거",
  "피크": "피크",
  "고스트": "고스트",
  "레가토": "레가토",
  "크로매틱": "크로매틱",
  "스케일": "스케일",
  "코드톤": "코드톤",
  "인터벌": "인터벌",
  "진행": "진행",
  "8분음표": "8분음표",
  "16분음표": "16분음표",
  "트리플렛": "트리플렛",
  "싱코페이션": "싱코페이션",
  "그루브": "그루브",
  "워킹": "워킹",
  "컴핑": "컴핑",
};

const TAG_GROUPS: Array<{ nameKo: string; nameEn: string; tags: string[] }> = [
  {
    nameKo: "활동",
    nameEn: "Activity",
    tags: ["SONG", "DRILL", "ETC", "SONG_COPY", "SONG_LEARN", "SONG_PRACTICE", "SONG_DISCOVERY"],
  },
  {
    nameKo: "연습 유형",
    nameEn: "Practice Type",
    tags: ["CORE", "FUNK", "FUNKJAZZ", "SLAP", "THEORY"],
  },
  {
    nameKo: "밴드/퍼포먼스",
    nameEn: "Band/Performance",
    tags: ["BAND", "PERFORMANCE", "COMMUNITY", "GEAR"],
  },
  {
    nameKo: "체크 태그",
    nameEn: "Checklist",
    tags: ["METRO_24", "METRO_ONEBAR", "CLEAN_MUTE", "EAR_COPY", "RECORDING_AUDIO", "RECORDING_VIDEO", "AB_COMPARE"],
  },
  {
    nameKo: "드릴 포커스",
    nameEn: "Drill Focus",
    tags: ["박자", "포지션", "지구력", "스피드", "클린", "다이내믹", "리딩"],
  },
  {
    nameKo: "드릴 주법",
    nameEn: "Drill Technique",
    tags: ["핑거", "피크", "슬랩", "고스트", "레가토"],
  },
  {
    nameKo: "드릴 음형",
    nameEn: "Drill Shape",
    tags: ["크로매틱", "스케일", "코드톤", "인터벌", "진행"],
  },
  {
    nameKo: "드릴 리듬",
    nameEn: "Drill Rhythm",
    tags: ["8분음표", "16분음표", "트리플렛", "싱코페이션"],
  },
  {
    nameKo: "드릴 라인 타입",
    nameEn: "Drill Line Type",
    tags: ["그루브", "워킹", "컴핑"],
  },
];

const LEGACY_HIDDEN_TAGS = new Set([
  "CORE",
  "FUNK",
  "FUNKJAZZ",
  "SLAP",
  "THEORY",
  "METRO_24",
  "METRO_ONEBAR",
  "CLEAN_MUTE",
  "EAR_COPY",
  "AB_COMPARE",
]);

const RULE_BUILDER_KEYS = [
  "event_type",
  "tags_any",
  "tags_all",
  "field",
  "condition_tree",
  "min_duration",
  "min_sessions",
  "min_sessions_per_month",
] as const;

type RuleUiSpec = {
  showEventType: boolean;
  showField: boolean;
  showGoalType: boolean;
  showMinDuration: boolean;
  showMinSessions: boolean;
  showMinSessionsPerMonth: boolean;
  showTags: boolean;
  showConditionTree: boolean;
  supportsAdvanced: boolean;
  defaultEventType: string;
  noteKo: string;
  noteEn: string;
};

const DEFAULT_RULE_UI_SPEC: RuleUiSpec = {
  showEventType: true,
  showField: false,
  showGoalType: false,
  showMinDuration: false,
  showMinSessions: false,
  showMinSessionsPerMonth: false,
  showTags: true,
  showConditionTree: true,
  supportsAdvanced: true,
  defaultEventType: "",
  noteKo: "이 규칙 타입은 이벤트 필터를 기반으로 진행도를 계산합니다.",
  noteEn: "This rule type computes progress from filtered events.",
};

const RULE_UI_SPEC_OVERRIDES: Record<string, Partial<RuleUiSpec>> = {
  manual: {
    showEventType: false,
    showField: false,
    showGoalType: false,
    showMinDuration: false,
    showMinSessions: false,
    showMinSessionsPerMonth: false,
    showTags: false,
    showConditionTree: false,
    supportsAdvanced: false,
    defaultEventType: "",
    noteKo: "수동 업적입니다. 이벤트 조건을 사용하지 않고 운영자가 직접 달성 처리합니다.",
    noteEn: "Manual achievement. Event filters are not used.",
  },
  level_reach: {
    showEventType: false,
    showField: false,
    showGoalType: false,
    showMinDuration: false,
    showMinSessions: false,
    showMinSessionsPerMonth: false,
    showTags: false,
    showConditionTree: false,
    supportsAdvanced: false,
    defaultEventType: "",
    noteKo: "레벨 도달형입니다. 총 누적 XP로 레벨을 계산하며 이벤트 필터는 사용하지 않습니다.",
    noteEn: "Level reach uses total XP level and ignores event filters.",
  },
  count_events: {
    showEventType: true,
    showMinDuration: true,
    defaultEventType: "SESSION",
    noteKo: "조건을 만족한 이벤트 개수를 셉니다.",
    noteEn: "Counts events matching the filter.",
  },
  sum_duration: {
    showEventType: true,
    showMinDuration: true,
    defaultEventType: "SESSION",
    noteKo: "조건을 만족한 이벤트의 duration_min 합계를 누적합니다.",
    noteEn: "Sums duration_min of matching events.",
  },
  sum_xp: {
    showEventType: true,
    defaultEventType: "",
    noteKo: "조건을 만족한 이벤트의 XP 합계를 누적합니다.",
    noteEn: "Sums XP of matching events.",
  },
  distinct_count: {
    showEventType: true,
    showField: true,
    defaultEventType: "SESSION",
    noteKo: "선택한 field의 서로 다른 값 개수를 셉니다.",
    noteEn: "Counts distinct values of the selected field.",
  },
  streak_weekly: {
    showEventType: false,
    showMinSessions: true,
    defaultEventType: "SESSION",
    noteKo: "주간 연속 달성입니다. 주마다 최소 세션 수(min_sessions)를 만족한 연속 주 수를 계산합니다.",
    noteEn: "Weekly streak by min_sessions per week.",
  },
  streak_monthly: {
    showEventType: false,
    showMinSessionsPerMonth: true,
    defaultEventType: "SESSION",
    noteKo: "월간 연속 달성입니다. 월마다 최소 세션 수(min_sessions_per_month)를 만족한 연속 월 수를 계산합니다.",
    noteEn: "Monthly streak by min_sessions_per_month.",
  },
};

function getRuleUiSpec(ruleType: string): RuleUiSpec {
  const key = String(ruleType || "").trim().toLowerCase();
  return { ...DEFAULT_RULE_UI_SPEC, ...(RULE_UI_SPEC_OVERRIDES[key] || {}) };
}

function createConditionNode(field = "", op = "eq"): RuleConditionNode {
  return { id: `cond-${Date.now()}-${Math.random()}`, type: "condition", field, op, value: "" };
}

function createGroupNode(logic: RuleLogic = "all", children: RuleTreeNode[] = []): RuleGroupNode {
  return { id: `group-${Date.now()}-${Math.random()}`, type: "group", logic, children };
}

const EMPTY_FORM: FormState = {
  achievement_id: "",
  group_id: "",
  name: "",
  tier: "1",
  tier_name: "Bronze",
  category: "커스텀",
  rarity: "rare",
  xp_reward: "100",
  target: "1",
  display_order: "1",
  rule_type: "manual",
  description: "",
  evidence_hint: "",
  hint: "",
  is_hidden: false,
  auto_grant: false,
  ui_badge_style: "custom",
  icon_path: "",
  icon_url: "",
  rule_event_type: "",
  rule_tags_any: "",
  rule_tags_all: "",
  rule_field: "",
  rule_min_duration: "",
  rule_min_sessions: "",
  rule_min_sessions_per_month: "",
  rule_goal_type: "",
  rule_condition_tree: createGroupNode("all", []),
  rule_filter_raw: "{}",
};

function toSortedUnique(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
}

function mergeRuleOptions(raw: Partial<AchievementRuleOptions> | null | undefined): AchievementRuleOptions {
  const rawFeatureValues = raw?.feature_values || {};
  const featureValues: Record<string, string[]> = {};
  Object.keys(rawFeatureValues).forEach((key) => {
    featureValues[key] = toSortedUnique(rawFeatureValues[key] || []);
  });
  const rawValueSuggestions = raw?.value_suggestions || {};
  const valueSuggestions: Record<string, string[]> = {};
  Object.keys(rawValueSuggestions).forEach((key) => {
    valueSuggestions[key] = toSortedUnique(rawValueSuggestions[key] || []);
  });
  return {
    rule_types: toSortedUnique([...(FALLBACK_RULE_OPTIONS.rule_types || []), ...((raw?.rule_types || []) as string[])]),
    event_types: toSortedUnique([...(FALLBACK_RULE_OPTIONS.event_types || []), ...((raw?.event_types || []) as string[])]),
    tags: toSortedUnique([...(FALLBACK_RULE_OPTIONS.tags || []), ...((raw?.tags || []) as string[])]),
    fields: toSortedUnique([...(FALLBACK_RULE_OPTIONS.fields || []), ...((raw?.fields || []) as string[])]),
    condition_fields: toSortedUnique([
      ...(FALLBACK_RULE_OPTIONS.condition_fields || []),
      ...((raw?.condition_fields || []) as string[]),
    ]),
    condition_ops: toSortedUnique([...(FALLBACK_RULE_OPTIONS.condition_ops || []), ...((raw?.condition_ops || []) as string[])]),
    feature_values: featureValues,
    rule_type_meta: raw?.rule_type_meta || {},
    field_meta: raw?.field_meta || {},
    operator_meta: raw?.operator_meta || {},
    field_groups: Array.isArray(raw?.field_groups) ? raw.field_groups : [],
    value_suggestions: Object.keys(valueSuggestions).length ? valueSuggestions : featureValues,
    builder_examples: Array.isArray(raw?.builder_examples) ? raw.builder_examples : [],
    example_rules: Array.isArray(raw?.example_rules) ? raw.example_rules : [],
  };
}

function asBool(value: string): boolean {
  const token = String(value || "").trim().toLowerCase();
  return token === "1" || token === "true" || token === "yes" || token === "on";
}

function toCsvTokenList(raw: string): string[] {
  return Array.from(
    new Set(
      String(raw || "")
        .split(/[,\n;]/g)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function toggleCsvToken(raw: string, token: string): string {
  const key = String(token || "").trim().toUpperCase();
  if (!key) return raw;
  const current = new Set(toCsvTokenList(raw).map((item) => item.toUpperCase()));
  if (current.has(key)) current.delete(key);
  else current.add(key);
  return Array.from(current).join(", ");
}

function filterByQuery(options: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((item) => item.toLowerCase().includes(q));
}

function normalizeTagToken(value: string): string {
  return String(value || "").trim().toUpperCase();
}

function toTagLabel(tag: string, lang: Lang): string {
  const token = normalizeTagToken(tag);
  if (!token) return "";
  if (lang !== "ko") return token;
  if (token.startsWith("QUEST_PERIOD_")) return `퀘스트 기간 (${token.replace("QUEST_PERIOD_", "")})`;
  if (token.startsWith("QUEST_DIFF_")) return `퀘스트 난이도 (${token.replace("QUEST_DIFF_", "")})`;
  if (token.startsWith("QUEST_GENRE_")) return `퀘스트 장르 (${token.replace("QUEST_GENRE_", "")})`;
  const ko = TAG_LABEL_KO[token];
  if (!ko) return token;
  return ko === token ? ko : `${ko} (${token})`;
}

function filterTagTokens(options: string[], query: string): string[] {
  const all = Array.from(
    new Set(
      options
        .map((item) => normalizeTagToken(item))
        .filter((item) => item && !LEGACY_HIDDEN_TAGS.has(item))
    )
  ).sort((a, b) => a.localeCompare(b));
  const q = query.trim().toLowerCase();
  if (!q) return all;
  return all.filter((tag) => {
    const ko = TAG_LABEL_KO[tag] || "";
    return tag.toLowerCase().includes(q) || ko.toLowerCase().includes(q);
  });
}

function groupTagTokens(tags: string[], lang: Lang): Array<{ name: string; tags: string[] }> {
  const pool = new Set(tags.map((item) => normalizeTagToken(item)).filter(Boolean));
  const used = new Set<string>();
  const groups: Array<{ name: string; tags: string[] }> = [];

  TAG_GROUPS.forEach((group) => {
    const picked = group.tags.map((tag) => normalizeTagToken(tag)).filter((tag) => pool.has(tag));
    if (picked.length) {
      groups.push({ name: lang === "ko" ? group.nameKo : group.nameEn, tags: picked });
      picked.forEach((tag) => used.add(tag));
    }
  });

  const questTags = Array.from(pool).filter((tag) => tag.startsWith("QUEST_") && !used.has(tag)).sort((a, b) => a.localeCompare(b));
  if (questTags.length) {
    groups.push({ name: lang === "ko" ? "퀘스트" : "Quest", tags: questTags });
    questTags.forEach((tag) => used.add(tag));
  }

  const rest = Array.from(pool).filter((tag) => !used.has(tag)).sort((a, b) => a.localeCompare(b));
  if (rest.length) {
    groups.push({ name: lang === "ko" ? "기타" : "Other", tags: rest });
  }
  return groups;
}

function parseRuleFilter(raw: string): Record<string, unknown> {
  try {
    const decoded = JSON.parse(raw || "{}");
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return {};
    return decoded as Record<string, unknown>;
  } catch {
    return {};
  }
}

function stringifyRuleFilter(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2);
}

function parseConditionValueForPayload(op: string, value: string): unknown {
  const token = String(value || "").trim();
  if (op === "exists" || op === "not_exists") return "";
  if (op === "in" || op === "not_in") {
    const items = token
      .split(/[,\n;]/g)
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length <= 1 ? token : items;
  }
  if (token.toLowerCase() === "true") return true;
  if (token.toLowerCase() === "false") return false;
  const numeric = Number(token);
  if (token && !Number.isNaN(numeric) && ["gt", "gte", "lt", "lte"].includes(op)) return numeric;
  return token;
}

function normalizeConditionTreeNode(raw: unknown): RuleTreeNode | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const node = raw as Record<string, unknown>;
  const type = String(node.type || "").toLowerCase();
  if (type === "group") {
    const logic = String(node.logic || "all").toLowerCase() === "any" ? "any" : "all";
    const childrenRaw = Array.isArray(node.children) ? node.children : [];
    const children = childrenRaw
      .map((child) => normalizeConditionTreeNode(child))
      .filter((item): item is RuleTreeNode => Boolean(item));
    return createGroupNode(logic, children);
  }
  if (type === "condition") {
    const op = String(node.op || "eq");
    const rawValue = node.value;
    const valueText = Array.isArray(rawValue) ? rawValue.map((part) => String(part)).join(", ") : String(rawValue ?? "");
    return {
      ...createConditionNode(String(node.field || ""), op),
      value: valueText,
    };
  }
  return null;
}

function serializeConditionTree(node: RuleTreeNode): Record<string, unknown> {
  if (node.type === "condition") {
    return {
      type: "condition",
      field: node.field.trim(),
      op: node.op.trim() || "eq",
      value: parseConditionValueForPayload(node.op.trim() || "eq", node.value),
    };
  }
  return {
    type: "group",
    logic: node.logic,
    children: node.children.map((child) => serializeConditionTree(child)),
  };
}

function hasValidConditions(node: RuleTreeNode): boolean {
  if (node.type === "condition") {
    const op = node.op.trim().toLowerCase();
    if (!node.field.trim()) return false;
    if (op === "exists" || op === "not_exists") return true;
    return Boolean(node.value.trim());
  }
  return node.children.some((child) => hasValidConditions(child));
}

function pruneConditionTree(node: RuleTreeNode): RuleTreeNode | null {
  if (node.type === "condition") {
    return hasValidConditions(node) ? node : null;
  }
  const children = node.children.map((child) => pruneConditionTree(child)).filter((item): item is RuleTreeNode => Boolean(item));
  if (!children.length) return null;
  return { ...node, children };
}

function builderFieldsFromRuleFilter(ruleFilter: Record<string, unknown>): RuleBuilderState {
  const tagsAny = Array.isArray(ruleFilter.tags_any) ? ruleFilter.tags_any.map((item) => String(item)).join(", ") : "";
  const tagsAll = Array.isArray(ruleFilter.tags_all) ? ruleFilter.tags_all.map((item) => String(item)).join(", ") : "";
  let conditionTree = createGroupNode("all", []);
  if (ruleFilter.condition_tree && typeof ruleFilter.condition_tree === "object") {
    const parsed = normalizeConditionTreeNode(ruleFilter.condition_tree);
    if (parsed && parsed.type === "group") conditionTree = parsed;
  }
  return {
    rule_event_type: String(ruleFilter.event_type || ""),
    rule_tags_any: tagsAny,
    rule_tags_all: tagsAll,
    rule_field: String(ruleFilter.field || ""),
    rule_goal_type: "",
    rule_condition_tree: conditionTree,
    rule_min_duration: ruleFilter.min_duration === undefined ? "" : String(ruleFilter.min_duration),
    rule_min_sessions: ruleFilter.min_sessions === undefined ? "" : String(ruleFilter.min_sessions),
    rule_min_sessions_per_month: ruleFilter.min_sessions_per_month === undefined ? "" : String(ruleFilter.min_sessions_per_month),
    rule_filter_raw: stringifyRuleFilter(ruleFilter),
  };
}

function buildRuleFilterFromBuilder(builder: RuleBuilderState): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (builder.rule_event_type.trim()) payload.event_type = builder.rule_event_type.trim();
  if (builder.rule_tags_any.trim()) payload.tags_any = toCsvTokenList(builder.rule_tags_any);
  if (builder.rule_tags_all.trim()) payload.tags_all = toCsvTokenList(builder.rule_tags_all);
  if (builder.rule_field.trim()) payload.field = builder.rule_field.trim();
  const normalizedTree = pruneConditionTree(builder.rule_condition_tree);
  if (normalizedTree && normalizedTree.type === "group" && normalizedTree.children.length > 0) {
    payload.condition_tree = serializeConditionTree(normalizedTree);
  }
  if (builder.rule_min_duration.trim()) payload.min_duration = Number(builder.rule_min_duration) || 0;
  if (builder.rule_min_sessions.trim()) payload.min_sessions = Number(builder.rule_min_sessions) || 0;
  if (builder.rule_min_sessions_per_month.trim()) payload.min_sessions_per_month = Number(builder.rule_min_sessions_per_month) || 0;
  return payload;
}

function composeRuleFilterFromBuilder(builder: RuleBuilderState): Record<string, unknown> {
  const raw = parseRuleFilter(builder.rule_filter_raw);
  const next: Record<string, unknown> = { ...raw };
  RULE_BUILDER_KEYS.forEach((key) => {
    delete next[key];
  });
  return { ...next, ...buildRuleFilterFromBuilder(builder) };
}

function composeRuleFilter(form: FormState): Record<string, unknown> {
  return composeRuleFilterFromBuilder(form);
}

function composeBulkRuleFilter(bulk: BulkState): Record<string, unknown> {
  return composeRuleFilterFromBuilder(bulk);
}

function applyRuleFilterToForm(form: FormState, ruleFilter: Record<string, unknown>): FormState {
  return { ...form, ...builderFieldsFromRuleFilter(ruleFilter) };
}

function applyRuleFilterToBulk(bulk: BulkState, ruleFilter: Record<string, unknown>): BulkState {
  return { ...bulk, ...builderFieldsFromRuleFilter(ruleFilter) };
}

function applyRuleTypeSpecToBuilder<T extends RuleBuilderState>(state: T, nextRuleType: string): T {
  const spec = getRuleUiSpec(nextRuleType);
  const next: T = { ...state };
  if (spec.showEventType) {
    if (!next.rule_event_type.trim() && spec.defaultEventType) next.rule_event_type = spec.defaultEventType;
  } else {
    next.rule_event_type = "";
  }
  if (!spec.showField) next.rule_field = "";
  if (!spec.showGoalType) next.rule_goal_type = "";
  if (!spec.showMinDuration) next.rule_min_duration = "";
  if (!spec.showMinSessions) next.rule_min_sessions = "";
  if (!spec.showMinSessionsPerMonth) next.rule_min_sessions_per_month = "";
  if (!spec.showTags) {
    next.rule_tags_any = "";
    next.rule_tags_all = "";
  }
  if (!spec.showConditionTree) {
    next.rule_condition_tree = createGroupNode("all", []);
  }
  return next;
}

function canonicalTierName(tier: number): string {
  if (tier >= 6) return "Master";
  if (tier === 5) return "Diamond";
  if (tier === 4) return "Platinum";
  if (tier === 3) return "Gold";
  if (tier === 2) return "Silver";
  return "Bronze";
}

function tierStyleKey(tier: number): StyleKey {
  if (tier >= 6) return "tier_master";
  if (tier === 5) return "tier_diamond";
  if (tier === 4) return "tier_platinum";
  if (tier === 3) return "tier_gold";
  if (tier === 2) return "tier_silver";
  return "tier_bronze";
}

function cardKindOf(item: AdminAchievementMasterItem, groupSize: number): CardKind {
  if (asBool(String(item.is_hidden || "false"))) return "hidden";
  if (groupSize <= 1 || String(item.rule_type || "").toLowerCase() === "manual") return "single";
  return "tiered";
}

function formFromItem(item: AdminAchievementMasterItem): FormState {
  const rule = parseRuleFilter(String(item.rule_filter || "{}"));
  return applyRuleFilterToForm(
    {
      achievement_id: String(item.achievement_id || ""),
      group_id: String(item.group_id || ""),
      name: String(item.name || ""),
      tier: String(item.tier || "1"),
      tier_name: String(item.tier_name || "Bronze"),
      category: String(item.category || "커스텀"),
      rarity: String(item.rarity || "rare"),
      xp_reward: String(item.xp_reward || "100"),
      target: String(item.target || "1"),
      display_order: String(item.display_order || "1"),
      rule_type: String(item.rule_type || "manual"),
      description: String(item.description || ""),
      evidence_hint: String(item.evidence_hint || ""),
      hint: String(item.hint || ""),
      is_hidden: asBool(String(item.is_hidden || "false")),
      auto_grant: asBool(String(item.auto_grant || "false")),
      ui_badge_style: String(item.ui_badge_style || "custom"),
      icon_path: String(item.icon_path || ""),
      icon_url: String(item.icon_url || ""),
      rule_event_type: "",
      rule_tags_any: "",
      rule_tags_all: "",
      rule_field: "",
      rule_min_duration: "",
      rule_min_sessions: "",
      rule_min_sessions_per_month: "",
      rule_goal_type: "",
      rule_condition_tree: createGroupNode("all", []),
      rule_filter_raw: "{}",
    },
    rule
  );
}

function mergeStyleForm(settings: Settings): StyleForm {
  const raw = settings.ui?.achievement_card_styles || {};
  const out: StyleForm = { ...DEFAULT_STYLE_FORM };
  (Object.keys(out) as StyleKey[]).forEach((key) => {
    out[key] = {
      border: String(raw[key]?.border || out[key].border),
      fill: String(raw[key]?.fill || out[key].fill),
    };
  });
  return out;
}

function cardPalette(kind: CardKind, tier: number, styles: StyleForm): { border: string; fill: string } {
  if (kind === "hidden") return styles.single_hidden;
  if (kind === "single") return styles.single_event;
  return styles[tierStyleKey(tier)];
}

function mapTree(node: RuleTreeNode, mapper: (node: RuleTreeNode) => RuleTreeNode): RuleTreeNode {
  const mapped =
    node.type === "group"
      ? {
          ...node,
          children: node.children.map((child) => mapTree(child, mapper)),
        }
      : node;
  return mapper(mapped);
}

function addTreeChild(root: RuleGroupNode, groupId: string, child: RuleTreeNode): RuleGroupNode {
  return mapTree(root, (node) => {
    if (node.type === "group" && node.id === groupId) {
      return { ...node, children: [...node.children, child] };
    }
    return node;
  }) as RuleGroupNode;
}

function updateTreeCondition(root: RuleGroupNode, nodeId: string, patch: Partial<RuleConditionNode>): RuleGroupNode {
  return mapTree(root, (node) => {
    if (node.type === "condition" && node.id === nodeId) {
      return { ...node, ...patch };
    }
    return node;
  }) as RuleGroupNode;
}

function updateTreeGroupLogic(root: RuleGroupNode, nodeId: string, logic: RuleLogic): RuleGroupNode {
  return mapTree(root, (node) => {
    if (node.type === "group" && node.id === nodeId) {
      return { ...node, logic };
    }
    return node;
  }) as RuleGroupNode;
}

function removeTreeNode(root: RuleGroupNode, nodeId: string): RuleGroupNode {
  const walk = (node: RuleTreeNode): RuleTreeNode | null => {
    if (node.id === nodeId) return null;
    if (node.type === "group") {
      const children = node.children.map((child) => walk(child)).filter((child): child is RuleTreeNode => Boolean(child));
      return { ...node, children };
    }
    return node;
  };
  const next = walk(root);
  if (!next || next.type !== "group") return root;
  return next;
}

function findTreeNode(root: RuleTreeNode, nodeId: string): RuleTreeNode | null {
  if (root.id === nodeId) return root;
  if (root.type === "group") {
    for (const child of root.children) {
      const found = findTreeNode(child, nodeId);
      if (found) return found;
    }
  }
  return null;
}

async function readClipboardImage(): Promise<File | null> {
  if (!navigator.clipboard || typeof navigator.clipboard.read !== "function") return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith("image/"));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      return new File([blob], `achievement_clip_${Date.now()}.png`, { type: imageType });
    }
  } catch {
    return null;
  }
  return null;
}

export function AchievementAdminPanel({ lang, settings, onSettingsChange, setMessage, onRefresh }: Props) {
  const [items, setItems] = useState<AdminAchievementMasterItem[]>([]);
  const [ruleOptions, setRuleOptions] = useState<AchievementRuleOptions>(FALLBACK_RULE_OPTIONS);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [editorMode, setEditorMode] = useState<EditorMode>("none");
  const [editingId, setEditingId] = useState("");
  const [rowEditMode, setRowEditMode] = useState<RowEditMode>("full");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busySave, setBusySave] = useState(false);
  const [bulk, setBulk] = useState<BulkState | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [dragGroupId, setDragGroupId] = useState("");
  const [orderBusy, setOrderBusy] = useState(false);
  const [styleForm, setStyleForm] = useState<StyleForm>(() => mergeStyleForm(settings));
  const [styleBusy, setStyleBusy] = useState(false);
  const [exportDatasetId, setExportDatasetId] = useState(`ach_pack_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`);
  const [exportName, setExportName] = useState("");
  const [exportDescription, setExportDescription] = useState("");
  const [topPanelsOpen, setTopPanelsOpen] = useState(false);
  const [ruleEventSearch, setRuleEventSearch] = useState("");
  const [ruleFieldSearch, setRuleFieldSearch] = useState("");
  const [ruleGoalTypeSearch, setRuleGoalTypeSearch] = useState("");
  const [ruleTagsAnySearch, setRuleTagsAnySearch] = useState("");
  const [ruleTagsAllSearch, setRuleTagsAllSearch] = useState("");
  const [conditionFieldSearch, setConditionFieldSearch] = useState("");
  const [selectedTreeNodeId, setSelectedTreeNodeId] = useState("");
  const [selectedBulkTreeNodeId, setSelectedBulkTreeNodeId] = useState("");
  const [advancedJsonOpen, setAdvancedJsonOpen] = useState(false);
  const [bulkAdvancedOpen, setBulkAdvancedOpen] = useState(false);
  const [ruleBuilderAdvancedOpen, setRuleBuilderAdvancedOpen] = useState(false);
  const [bulkRuleBuilderAdvancedOpen, setBulkRuleBuilderAdvancedOpen] = useState(false);

  useEffect(() => {
    setStyleForm(mergeStyleForm(settings));
  }, [settings]);

  useEffect(() => {
    if (!selectedTreeNodeId) return;
    const found = findTreeNode(form.rule_condition_tree, selectedTreeNodeId);
    if (!found) setSelectedTreeNodeId(form.rule_condition_tree.id);
  }, [form.rule_condition_tree, selectedTreeNodeId]);

  useEffect(() => {
    if (!bulk || !selectedBulkTreeNodeId) return;
    const found = findTreeNode(bulk.rule_condition_tree, selectedBulkTreeNodeId);
    if (!found) setSelectedBulkTreeNodeId(bulk.rule_condition_tree.id);
  }, [bulk, selectedBulkTreeNodeId]);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await getAdminAchievementsMaster();
      setItems(rows);
      const options = await getAchievementRuleOptions();
      setRuleOptions(mergeRuleOptions(options));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load achievements master.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, AdminAchievementMasterItem[]>();
    items.forEach((item) => {
      const key = String(item.group_id || item.achievement_id || "");
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    });
    for (const [, rows] of map) {
      rows.sort((a, b) => Number(a.tier || 0) - Number(b.tier || 0));
    }
    return map;
  }, [items]);

  const groups = useMemo(() => {
    const rows: GroupEntry[] = [];
    for (const [groupId, entries] of grouped.entries()) {
      if (!entries.length) continue;
      const kind = cardKindOf(entries[0], entries.length);
      const hiddenGroup = kind === "hidden";
      const order = Math.min(...entries.map((entry) => Number(entry.display_order || 0) || 0));
      rows.push({
        groupId,
        rows: entries,
        kind,
        hiddenGroup,
        displayOrder: Number.isFinite(order) ? order : 0,
      });
    }
    rows.sort((a, b) => {
      const aSection = a.kind === "tiered" ? 0 : 1;
      const bSection = b.kind === "tiered" ? 0 : 1;
      if (aSection !== bSection) return aSection - bSection;
      if (aSection === 1 && a.hiddenGroup !== b.hiddenGroup) return a.hiddenGroup ? 1 : -1;
      if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
      return a.groupId.localeCompare(b.groupId);
    });
    return rows;
  }, [grouped]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups.filter((group) => {
      if (kindFilter === "tiered" && group.kind !== "tiered") return false;
      if (kindFilter === "single" && group.kind === "tiered") return false;
      if (!q) return true;
      return group.rows.some((item) => {
        const text = `${item.achievement_id} ${item.group_id} ${item.name} ${item.category} ${item.rule_type}`.toLowerCase();
        return text.includes(q);
      });
    });
  }, [groups, query, kindFilter]);

  const tieredGroups = useMemo(() => filteredGroups.filter((group) => group.kind === "tiered"), [filteredGroups]);
  const singleGroups = useMemo(() => filteredGroups.filter((group) => group.kind !== "tiered"), [filteredGroups]);
  const selectedTagsAny = useMemo(() => toCsvTokenList(form.rule_tags_any).map((item) => normalizeTagToken(item)), [form.rule_tags_any]);
  const selectedTagsAll = useMemo(() => toCsvTokenList(form.rule_tags_all).map((item) => normalizeTagToken(item)), [form.rule_tags_all]);
  const selectedBulkTagsAny = useMemo(
    () => toCsvTokenList(bulk?.rule_tags_any || "").map((item) => normalizeTagToken(item)),
    [bulk?.rule_tags_any]
  );
  const selectedBulkTagsAll = useMemo(
    () => toCsvTokenList(bulk?.rule_tags_all || "").map((item) => normalizeTagToken(item)),
    [bulk?.rule_tags_all]
  );
  const filteredEventTypes = useMemo(() => filterByQuery(ruleOptions.event_types, ruleEventSearch), [ruleOptions.event_types, ruleEventSearch]);
  const filteredFields = useMemo(() => filterByQuery(ruleOptions.fields, ruleFieldSearch), [ruleOptions.fields, ruleFieldSearch]);
  const filteredGoalTypes = useMemo(() => [] as string[], []);
  const filteredTagsAny = useMemo(() => filterTagTokens(ruleOptions.tags, ruleTagsAnySearch), [ruleOptions.tags, ruleTagsAnySearch]);
  const filteredTagsAll = useMemo(() => filterTagTokens(ruleOptions.tags, ruleTagsAllSearch), [ruleOptions.tags, ruleTagsAllSearch]);
  const groupedTagsAny = useMemo(() => groupTagTokens(filteredTagsAny, lang), [filteredTagsAny, lang]);
  const groupedTagsAll = useMemo(() => groupTagTokens(filteredTagsAll, lang), [filteredTagsAll, lang]);
  const filteredConditionFields = useMemo(
    () => filterByQuery(ruleOptions.condition_fields, conditionFieldSearch),
    [ruleOptions.condition_fields, conditionFieldSearch]
  );
  const activeTreeNodeId = selectedTreeNodeId || form.rule_condition_tree.id;
  const selectedTreeNode = useMemo(
    () => findTreeNode(form.rule_condition_tree, activeTreeNodeId),
    [form.rule_condition_tree, activeTreeNodeId]
  );
  const selectedConditionField =
    selectedTreeNode && selectedTreeNode.type === "condition" ? selectedTreeNode.field : "";
  const selectedConditionOp = selectedTreeNode && selectedTreeNode.type === "condition" ? selectedTreeNode.op : "";
  const selectedFieldMeta = ruleOptions.field_meta?.[selectedConditionField];
  const selectedOpMeta = ruleOptions.operator_meta?.[selectedConditionOp];
  const selectedValueCandidates = selectedConditionField
    ? ruleOptions.value_suggestions?.[selectedConditionField] || ruleOptions.feature_values[selectedConditionField] || []
    : [];
  const activeBulkTreeNodeId = selectedBulkTreeNodeId || bulk?.rule_condition_tree.id || "";
  const selectedBulkTreeNode =
    bulk && activeBulkTreeNodeId ? findTreeNode(bulk.rule_condition_tree, activeBulkTreeNodeId) : null;
  const selectedBulkConditionField = selectedBulkTreeNode && selectedBulkTreeNode.type === "condition" ? selectedBulkTreeNode.field : "";
  const selectedBulkConditionOp = selectedBulkTreeNode && selectedBulkTreeNode.type === "condition" ? selectedBulkTreeNode.op : "";
  const selectedBulkFieldMeta = ruleOptions.field_meta?.[selectedBulkConditionField];
  const selectedBulkOpMeta = ruleOptions.operator_meta?.[selectedBulkConditionOp];
  const selectedBulkValueCandidates = selectedBulkConditionField
    ? ruleOptions.value_suggestions?.[selectedBulkConditionField] || ruleOptions.feature_values[selectedBulkConditionField] || []
    : [];
  const allRuleTemplates = useMemo(
    () => [...(ruleOptions.builder_examples || []), ...(ruleOptions.example_rules || [])],
    [ruleOptions.builder_examples, ruleOptions.example_rules]
  );
  const rowRuleSpec = useMemo(() => getRuleUiSpec(form.rule_type), [form.rule_type]);
  const bulkRuleSpec = useMemo(() => getRuleUiSpec(bulk?.rule_type || ""), [bulk?.rule_type]);
  const liveRulePreview = useMemo(() => composeRuleFilter(form), [form]);
  const liveBulkRulePreview = useMemo(() => (bulk ? composeBulkRuleFilter(bulk) : {}), [bulk]);
  const editingItem = useMemo(
    () => items.find((it) => String(it.achievement_id || "") === String(editingId || "")) || null,
    [items, editingId]
  );
  const rowRuleGuideLines = useMemo(() => {
    const unit = ruleOptions.rule_type_meta?.[form.rule_type]?.target_unit || "";
    const lines: string[] = [];
    lines.push(
      lang === "ko"
        ? `target: 목표 ${unit ? `(${unit})` : ""}를 입력합니다. 진행도가 target 이상이면 달성됩니다.`
        : `target: Set the goal value${unit ? ` (${unit})` : ""}.`
    );
    if (rowRuleSpec.showEventType) {
      lines.push(lang === "ko" ? "event_type: 어떤 이벤트를 집계할지 선택합니다. (예: SESSION)" : "event_type: Event source to count.");
    }
    if (rowRuleSpec.showField) {
      lines.push(
        lang === "ko"
          ? "field: distinct_count에서 '서로 다른 값'을 셀 기준 필드입니다."
          : "field: Distinct key used by distinct_count."
      );
    }
    if (rowRuleSpec.showMinDuration) {
      lines.push(
        lang === "ko"
          ? "min_duration: 이 분(min) 이상인 이벤트만 포함합니다."
          : "min_duration: Include events with duration >= this value."
      );
    }
    if (rowRuleSpec.showMinSessions) {
      lines.push(
        lang === "ko"
          ? "min_sessions: streak_weekly에서 '주간 최소 세션 수'입니다."
          : "min_sessions: Weekly minimum sessions for streak_weekly."
      );
    }
    if (rowRuleSpec.showMinSessionsPerMonth) {
      lines.push(
        lang === "ko"
          ? "min_sessions_per_month: streak_monthly에서 '월간 최소 세션 수'입니다."
          : "min_sessions_per_month: Monthly minimum sessions for streak_monthly."
      );
    }
    if (rowRuleSpec.supportsAdvanced) {
      lines.push(
        lang === "ko"
          ? "tags_any/tags_all/조건 트리: 선택 고급 필터입니다. 필요한 경우만 열어서 쓰세요."
          : "tags/condition tree are optional advanced filters."
      );
    }
    return lines;
  }, [form.rule_type, lang, rowRuleSpec, ruleOptions.rule_type_meta]);
  const bulkRuleGuideLines = useMemo(() => {
    const unit = ruleOptions.rule_type_meta?.[bulk?.rule_type || ""]?.target_unit || "";
    const lines: string[] = [];
    lines.push(
      lang === "ko"
        ? `이 규칙은 그룹 전체 티어에 공통 적용됩니다. target ${unit ? `(${unit})` : ""}만 티어별로 다르게 설정하세요.`
        : `Rule applies to all tiers in the group. Keep rule shared, change target per tier.`
    );
    if (bulkRuleSpec.showEventType) lines.push(lang === "ko" ? "event_type를 고르면 집계 대상 이벤트가 고정됩니다." : "event_type sets the event source.");
    if (bulkRuleSpec.showField) lines.push(lang === "ko" ? "field는 distinct_count에서 필수입니다." : "field is required for distinct_count.");
    if (bulkRuleSpec.supportsAdvanced) lines.push(lang === "ko" ? "태그/조건 트리는 선택 고급 필터입니다." : "Tags/tree are optional advanced filters.");
    return lines;
  }, [bulk?.rule_type, bulkRuleSpec, lang, ruleOptions.rule_type_meta]);

  const resetRuleSearch = () => {
    setRuleEventSearch("");
    setRuleFieldSearch("");
    setRuleGoalTypeSearch("");
    setRuleTagsAnySearch("");
    setRuleTagsAllSearch("");
    setConditionFieldSearch("");
  };

  const onRowRuleTypeChange = (nextRuleType: string) => {
    setForm((prev) => applyRuleTypeSpecToBuilder({ ...prev, rule_type: nextRuleType }, nextRuleType));
  };

  const onBulkRuleTypeChange = (nextRuleType: string) => {
    setBulk((prev) => (prev ? applyRuleTypeSpecToBuilder({ ...prev, rule_type: nextRuleType }, nextRuleType) : prev));
  };

  const allowedOpsForField = (field: string): string[] => {
    const type = String(ruleOptions.field_meta?.[field]?.type || "").toLowerCase();
    const byType: Record<string, string[]> = {
      number: ["eq", "ne", "gt", "gte", "lt", "lte", "in", "not_in", "exists", "not_exists"],
      integer: ["eq", "ne", "gt", "gte", "lt", "lte", "in", "not_in", "exists", "not_exists"],
      enum: ["eq", "ne", "in", "not_in", "contains", "exists", "not_exists"],
      array: ["contains", "in", "not_in", "exists", "not_exists", "eq", "ne"],
      bool: ["eq", "ne", "exists", "not_exists"],
      boolean: ["eq", "ne", "exists", "not_exists"],
      text: ["eq", "ne", "contains", "in", "not_in", "exists", "not_exists"],
      string: ["eq", "ne", "contains", "in", "not_in", "exists", "not_exists"],
    };
    const preferred = byType[type] || byType.text;
    const filtered = preferred.filter((op) => ruleOptions.condition_ops.includes(op));
    return filtered.length ? filtered : ruleOptions.condition_ops;
  };

  const addConditionToGroup = (groupId: string) => {
    const firstField = filteredConditionFields[0] || ruleOptions.condition_fields[0] || "";
    const firstOp = ruleOptions.condition_ops[0] || "eq";
    setForm((prev) => ({
      ...prev,
      rule_condition_tree: addTreeChild(prev.rule_condition_tree, groupId, createConditionNode(firstField, firstOp)),
    }));
  };

  const addGroupToGroup = (groupId: string, logic: RuleLogic = "all") => {
    setForm((prev) => ({
      ...prev,
      rule_condition_tree: addTreeChild(prev.rule_condition_tree, groupId, createGroupNode(logic, [])),
    }));
  };

  const updateConditionNode = (id: string, patch: Partial<RuleConditionNode>) => {
    setForm((prev) => ({
      ...prev,
      rule_condition_tree: updateTreeCondition(prev.rule_condition_tree, id, patch),
    }));
  };

  const updateGroupLogic = (id: string, logic: RuleLogic) => {
    setForm((prev) => ({
      ...prev,
      rule_condition_tree: updateTreeGroupLogic(prev.rule_condition_tree, id, logic),
    }));
  };

  const removeNode = (id: string) => {
    if (id === form.rule_condition_tree.id) return;
    setForm((prev) => ({
      ...prev,
      rule_condition_tree: removeTreeNode(prev.rule_condition_tree, id),
    }));
    setSelectedTreeNodeId((prev) => (prev === id ? form.rule_condition_tree.id : prev));
  };

  const addBulkConditionToGroup = (groupId: string) => {
    const firstField = filteredConditionFields[0] || ruleOptions.condition_fields[0] || "";
    const firstOp = ruleOptions.condition_ops[0] || "eq";
    setBulk((prev) =>
      prev
        ? {
            ...prev,
            rule_condition_tree: addTreeChild(prev.rule_condition_tree, groupId, createConditionNode(firstField, firstOp)),
          }
        : prev
    );
  };

  const addBulkGroupToGroup = (groupId: string, logic: RuleLogic = "all") => {
    setBulk((prev) =>
      prev
        ? {
            ...prev,
            rule_condition_tree: addTreeChild(prev.rule_condition_tree, groupId, createGroupNode(logic, [])),
          }
        : prev
    );
  };

  const updateBulkConditionNode = (id: string, patch: Partial<RuleConditionNode>) => {
    setBulk((prev) =>
      prev
        ? {
            ...prev,
            rule_condition_tree: updateTreeCondition(prev.rule_condition_tree, id, patch),
          }
        : prev
    );
  };

  const updateBulkGroupLogic = (id: string, logic: RuleLogic) => {
    setBulk((prev) =>
      prev
        ? {
            ...prev,
            rule_condition_tree: updateTreeGroupLogic(prev.rule_condition_tree, id, logic),
          }
        : prev
    );
  };

  const removeBulkNode = (id: string) => {
    if (!bulk || id === bulk.rule_condition_tree.id) return;
    setBulk((prev) =>
      prev
        ? {
            ...prev,
            rule_condition_tree: removeTreeNode(prev.rule_condition_tree, id),
          }
        : prev
    );
    setSelectedBulkTreeNodeId((prev) => (prev === id ? bulk.rule_condition_tree.id : prev));
  };

  const applyExampleRule = (item: { rule_type: string; target: number; rule_filter: Record<string, unknown> }) => {
    const normalized = applyRuleFilterToForm(EMPTY_FORM, item.rule_filter);
    setForm((prev) => ({
      ...prev,
      rule_type: item.rule_type,
      target: String(item.target),
      rule_event_type: normalized.rule_event_type,
      rule_tags_any: normalized.rule_tags_any,
      rule_tags_all: normalized.rule_tags_all,
      rule_field: normalized.rule_field,
      rule_min_duration: normalized.rule_min_duration,
      rule_min_sessions: normalized.rule_min_sessions,
      rule_min_sessions_per_month: normalized.rule_min_sessions_per_month,
      rule_goal_type: normalized.rule_goal_type,
      rule_condition_tree: normalized.rule_condition_tree,
      rule_filter_raw: stringifyRuleFilter(item.rule_filter),
    }));
    setSelectedTreeNodeId(normalized.rule_condition_tree.id);
    setRuleBuilderAdvancedOpen(true);
  };

  const openCreate = () => {
    const maxOrder = Math.max(...items.map((item) => Number(item.display_order || 0) || 0), 0) + 1;
    const nextForm = { ...EMPTY_FORM, rule_condition_tree: createGroupNode("all", []), display_order: String(maxOrder), tier_name: "Bronze" };
    setEditingId("");
    setRowEditMode("full");
    setForm(nextForm);
    setBulk(null);
    setEditorMode("row");
    setSelectedTreeNodeId(nextForm.rule_condition_tree.id);
    setSelectedBulkTreeNodeId("");
    setAdvancedJsonOpen(false);
    setBulkAdvancedOpen(false);
    setRuleBuilderAdvancedOpen(false);
    setBulkRuleBuilderAdvancedOpen(false);
    setTopPanelsOpen(false);
    resetRuleSearch();
  };

  const openEdit = (item: AdminAchievementMasterItem, mode: RowEditMode = "full") => {
    setEditingId(String(item.achievement_id || ""));
    setRowEditMode(mode);
    setBulk(null);
    setEditorMode("row");
    setAdvancedJsonOpen(false);
    setBulkAdvancedOpen(false);
    setRuleBuilderAdvancedOpen(false);
    setBulkRuleBuilderAdvancedOpen(false);
    setTopPanelsOpen(false);
    const parsed = formFromItem(item);
    setSelectedTreeNodeId(parsed.rule_condition_tree.id);
    setForm(parsed);
    resetRuleSearch();
  };

  const openBulkEdit = (groupId: string, rows: AdminAchievementMasterItem[]) => {
    const ordered = [...rows].sort((a, b) => Number(a.tier || 0) - Number(b.tier || 0));
    const head = ordered[0];
    const base: BulkState = {
      groupId,
      category: String(head?.category || ""),
      rarity: String(head?.rarity || ""),
      rule_type: String(head?.rule_type || ""),
      is_hidden: asBool(String(head?.is_hidden || "false")),
      auto_grant: asBool(String(head?.auto_grant || "false")),
      icon_path: String(head?.icon_path || ""),
      icon_url: String(head?.icon_url || ""),
      rule_event_type: "",
      rule_tags_any: "",
      rule_tags_all: "",
      rule_field: "",
      rule_min_duration: "",
      rule_min_sessions: "",
      rule_min_sessions_per_month: "",
      rule_goal_type: "",
      rule_condition_tree: createGroupNode("all", []),
      rule_filter_raw: "{}",
      tiers: ordered.map((row) => ({
        achievement_id: String(row.achievement_id || ""),
        tier: String(row.tier || "1"),
        tier_name: String(row.tier_name || canonicalTierName(Number(row.tier || 1))),
        name: String(row.name || ""),
        target: String(row.target || "1"),
        xp_reward: String(row.xp_reward || "0"),
        icon_path: String(row.icon_path || ""),
        icon_url: String(row.icon_url || ""),
      })),
    };
    const nextBulk = applyRuleFilterToBulk(base, parseRuleFilter(String(head?.rule_filter || "{}")));
    setBulk(nextBulk);
    setSelectedBulkTreeNodeId(nextBulk.rule_condition_tree.id);
    setRowEditMode("full");
    setEditorMode("bulk");
    setBulkAdvancedOpen(false);
    setRuleBuilderAdvancedOpen(false);
    setBulkRuleBuilderAdvancedOpen(false);
    setTopPanelsOpen(false);
    resetRuleSearch();
  };

  const syncRawFromBuilder = () => {
    const nextRule = composeRuleFilter(form);
    setForm((prev) => ({ ...prev, rule_filter_raw: stringifyRuleFilter(nextRule) }));
  };

  const syncBuilderFromRaw = () => {
    const parsed = parseRuleFilter(form.rule_filter_raw);
    setForm((prev) => {
      const next = applyRuleFilterToForm(prev, parsed);
      setSelectedTreeNodeId(next.rule_condition_tree.id);
      return next;
    });
  };

  const syncBulkRawFromBuilder = () => {
    if (!bulk) return;
    const nextRule = composeBulkRuleFilter(bulk);
    setBulk((prev) => (prev ? { ...prev, rule_filter_raw: stringifyRuleFilter(nextRule) } : prev));
  };

  const syncBulkBuilderFromRaw = () => {
    if (!bulk) return;
    const parsed = parseRuleFilter(bulk.rule_filter_raw);
    setBulk((prev) => {
      if (!prev) return prev;
      const next = applyRuleFilterToBulk(prev, parsed);
      setSelectedBulkTreeNodeId(next.rule_condition_tree.id);
      return next;
    });
  };

  const save = async () => {
    const achId = form.achievement_id.trim();
    if (!editingId && !achId) {
      setMessage(lang === "ko" ? "achievement_id를 입력하세요." : "achievement_id is required.");
      return;
    }
    const isTierLiteEdit = rowEditMode === "tier-lite" && Boolean(editingId);
    const payload: Record<string, unknown> = {
      achievement_id: achId,
      name: form.name.trim(),
      tier: Number(form.tier || 1),
      tier_name: form.tier_name.trim() || canonicalTierName(Number(form.tier || 1)),
      xp_reward: Number(form.xp_reward || 0),
      target: Number(form.target || 1),
      description: form.description,
      evidence_hint: form.evidence_hint,
      hint: form.hint,
      icon_path: form.icon_path.trim(),
      icon_url: form.icon_url.trim(),
    };
    if (!isTierLiteEdit) {
      payload.group_id = form.group_id.trim() || achId;
      payload.category = form.category.trim();
      payload.rarity = form.rarity.trim();
      payload.display_order = Number(form.display_order || 1);
      payload.rule_type = form.rule_type.trim();
      payload.rule_filter = composeRuleFilter(form);
      payload.is_hidden = form.is_hidden;
      payload.auto_grant = form.auto_grant;
      payload.ui_badge_style = form.ui_badge_style.trim();
    }

    setBusySave(true);
    try {
      if (editingId) await updateAdminAchievementMaster(editingId, payload);
      else await createAdminAchievementMaster(payload);
      await load();
      await onRefresh();
      setEditorMode("none");
      setRowEditMode("full");
      setMessage(lang === "ko" ? "업적 저장 완료" : "Achievement saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setBusySave(false);
    }
  };

  const saveBulk = async () => {
    if (!bulk) return;
    const parsedRule = composeBulkRuleFilter(bulk);
    const commonIconPath = bulk.icon_path.trim();
    const commonIconUrl = bulk.icon_url.trim();
    setBulkBusy(true);
    try {
      for (const row of bulk.tiers) {
        const resolvedIconPath = row.icon_path.trim() || commonIconPath;
        const resolvedIconUrl = row.icon_url.trim() || commonIconUrl;
        await updateAdminAchievementMaster(row.achievement_id, {
          group_id: bulk.groupId,
          category: bulk.category,
          rarity: bulk.rarity,
          rule_type: bulk.rule_type,
          rule_filter: parsedRule,
          is_hidden: bulk.is_hidden,
          auto_grant: bulk.auto_grant,
          name: row.name,
          target: Number(row.target || 1),
          xp_reward: Number(row.xp_reward || 0),
          tier: Number(row.tier || 1),
          tier_name: row.tier_name || canonicalTierName(Number(row.tier || 1)),
          ui_badge_style: tierStyleKey(Number(row.tier || 1)).replace("tier_", ""),
          icon_path: resolvedIconPath,
          icon_url: resolvedIconUrl,
        });
      }
      await load();
      await onRefresh();
      setEditorMode("none");
      setBulk(null);
      setRowEditMode("full");
      setMessage(lang === "ko" ? "티어 그룹 일괄 수정 완료" : "Tier group updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bulk save failed.");
    } finally {
      setBulkBusy(false);
    }
  };

  const applyBulkTierPreset = () => {
    if (!bulk) return;
    setBulk({
      ...bulk,
      tiers: bulk.tiers.map((row) => {
        const tier = Number(row.tier || 1);
        return { ...row, tier_name: canonicalTierName(tier) };
      }),
    });
  };

  const uploadIconFile = async (file: File | null) => {
    if (!file) return;
    const uploaded = await uploadAchievementIcon(file);
    setForm((prev) => ({ ...prev, icon_path: uploaded.path, icon_url: prev.icon_url || uploaded.url }));
  };

  const pasteIcon = async () => {
    const clipped = await readClipboardImage();
    if (!clipped) {
      setMessage(lang === "ko" ? "클립보드 이미지가 없습니다." : "No image in clipboard.");
      return;
    }
    await uploadIconFile(clipped);
  };

  const deleteRow = async (achievementId: string) => {
    if (!window.confirm(lang === "ko" ? "이 업적을 삭제할까요?" : "Delete this achievement?")) return;
    await deleteAdminAchievementMaster(achievementId, "row");
    await load();
    await onRefresh();
    setMessage(lang === "ko" ? "업적을 삭제했습니다." : "Achievement deleted.");
  };

  const deleteGroup = async (achievementId: string) => {
    if (!window.confirm(lang === "ko" ? "이 그룹 전체를 삭제할까요?" : "Delete this group?")) return;
    await deleteAdminAchievementMaster(achievementId, "group");
    await load();
    await onRefresh();
    closeEditor();
    setMessage(lang === "ko" ? "그룹을 삭제했습니다." : "Group deleted.");
  };

  const exportPack = async () => {
    if (!exportDatasetId.trim()) {
      setMessage(lang === "ko" ? "dataset_id를 입력하세요." : "dataset_id is required.");
      return;
    }
    const result = await exportAchievementPack({
      dataset_id: exportDatasetId.trim(),
      name: exportName.trim(),
      description: exportDescription.trim(),
    });
    setMessage(
      lang === "ko"
        ? `업적 팩 저장 완료: ${result.dataset_id} (아이콘 ${result.icon_file_count}개)`
        : `Achievement pack exported: ${result.dataset_id} (${result.icon_file_count} icons)`
    );
  };

  const resetCurated = async () => {
    if (!window.confirm(lang === "ko" ? "기본 업적 세트로 덮어쓸까요?" : "Reset to curated achievement set?")) return;
    const result = await resetCuratedAchievements();
    await load();
    await onRefresh();
    closeEditor();
    setMessage(lang === "ko" ? `기본세트 재적용 완료 (${result.count})` : `Curated set restored (${result.count})`);
  };

  const persistGroupOrder = async (groupIds: string[]) => {
    if (!groupIds.length) return;
    setOrderBusy(true);
    try {
      for (let idx = 0; idx < groupIds.length; idx += 1) {
        const groupId = groupIds[idx];
        const rows = grouped.get(groupId) || [];
        for (const row of rows) {
          await updateAdminAchievementMaster(String(row.achievement_id || ""), { display_order: idx + 1 });
        }
      }
      await load();
      await onRefresh();
      setMessage(lang === "ko" ? "업적 위치 저장 완료" : "Achievement order updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Order update failed.");
    } finally {
      setOrderBusy(false);
    }
  };

  const moveGroup = async (groupId: string, direction: -1 | 1) => {
    const order = groups.map((item) => item.groupId);
    const idx = order.indexOf(groupId);
    if (idx < 0) return;
    const target = idx + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[idx], next[target]] = [next[target], next[idx]];
    await persistGroupOrder(next);
  };

  const onDropGroup = async (targetId: string) => {
    const sourceId = dragGroupId;
    setDragGroupId("");
    if (!sourceId || sourceId === targetId) return;
    const order = groups.map((item) => item.groupId);
    const from = order.indexOf(sourceId);
    const to = order.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...order];
    const [picked] = next.splice(from, 1);
    next.splice(to, 0, picked);
    await persistGroupOrder(next);
  };

  const saveStyleTheme = async () => {
    setStyleBusy(true);
    try {
      const updated = await putBasicSettings({
        ui: {
          ...settings.ui,
          achievement_card_styles: styleForm,
        },
      });
      onSettingsChange(updated);
      setMessage(lang === "ko" ? "업적 카드 스타일 저장 완료" : "Achievement card styles saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save styles.");
    } finally {
      setStyleBusy(false);
    }
  };

  const iconPreview = form.icon_url || (form.icon_path ? `/media/${form.icon_path}` : "");

  const closeEditor = () => {
    setEditorMode("none");
    setRowEditMode("full");
    setBulk(null);
    setEditingId("");
    setSelectedBulkTreeNodeId("");
    setRuleBuilderAdvancedOpen(false);
    setBulkRuleBuilderAdvancedOpen(false);
  };

  const renderTreeNode = (node: RuleTreeNode, depth = 0): JSX.Element => {
    const selected = node.id === activeTreeNodeId;
    if (node.type === "group") {
      return (
        <div
          key={node.id}
          className={`achievement-tree-group ${selected ? "selected" : ""}`}
          style={{ marginLeft: depth * 10 }}
          onClick={() => setSelectedTreeNodeId(node.id)}
        >
          <div className="row achievement-tree-group-head">
            <strong>{depth === 0 ? (lang === "ko" ? "루트 그룹" : "Root Group") : lang === "ko" ? "조건 그룹" : "Condition Group"}</strong>
            <div className="row">
              <select value={node.logic} onChange={(event) => updateGroupLogic(node.id, event.target.value === "any" ? "any" : "all")}>
                <option value="all">{lang === "ko" ? "모두 만족 (AND)" : "ALL (AND)"}</option>
                <option value="any">{lang === "ko" ? "하나 이상 (OR)" : "ANY (OR)"}</option>
              </select>
              <button type="button" className="ghost-btn compact-add-btn" onClick={() => addConditionToGroup(node.id)}>
                {lang === "ko" ? "+ 조건" : "+ Condition"}
              </button>
              <button type="button" className="ghost-btn compact-add-btn" onClick={() => addGroupToGroup(node.id, "all")}>
                {lang === "ko" ? "+ 그룹" : "+ Group"}
              </button>
              {depth > 0 ? (
                <button type="button" className="ghost-btn compact-add-btn danger-border" onClick={() => removeNode(node.id)}>
                  {lang === "ko" ? "삭제" : "Delete"}
                </button>
              ) : null}
            </div>
          </div>
          <div className="achievement-tree-children">
            {node.children.length === 0 ? (
              <small className="muted">{lang === "ko" ? "아직 조건이 없습니다. +조건 또는 +그룹으로 시작하세요." : "No child conditions yet."}</small>
            ) : (
              node.children.map((child) => renderTreeNode(child, depth + 1))
            )}
          </div>
        </div>
      );
    }

    const valueCandidates = ruleOptions.value_suggestions?.[node.field] || ruleOptions.feature_values[node.field] || [];
    const needsNoValue = node.op === "exists" || node.op === "not_exists";
    const useSelect = !node.manualValueInput && valueCandidates.length > 0 && !needsNoValue;
    return (
      <div
        key={node.id}
        className={`achievement-condition-row ${selected ? "selected" : ""}`}
        style={{ marginLeft: depth * 10 }}
        onClick={() => setSelectedTreeNodeId(node.id)}
      >
        <strong>C</strong>
        <select
          value={node.field}
          onChange={(event) => {
            const nextField = event.target.value;
            const ops = allowedOpsForField(nextField);
            updateConditionNode(node.id, { field: nextField, op: ops.includes(node.op) ? node.op : ops[0] || "eq", value: "" });
          }}
        >
          <option value="">{lang === "ko" ? "(필드 선택)" : "(field)"}</option>
          {filteredConditionFields.map((field) => {
            const label = ruleOptions.field_meta?.[field]?.label;
            return (
              <option key={`${node.id}-f-${field}`} value={field}>
                {label ? `${label} (${field})` : field}
              </option>
            );
          })}
        </select>
        <select value={node.op} onChange={(event) => updateConditionNode(node.id, { op: event.target.value, value: node.value })}>
          {allowedOpsForField(node.field).map((op) => (
            <option key={`${node.id}-op-${op}`} value={op}>
              {ruleOptions.operator_meta?.[op]?.label || op}
            </option>
          ))}
        </select>
        {needsNoValue ? (
          <input value="" disabled placeholder={lang === "ko" ? "값 불필요" : "No value needed"} />
        ) : useSelect ? (
          <select value={node.value} onChange={(event) => updateConditionNode(node.id, { value: event.target.value })}>
            <option value="">{lang === "ko" ? "(값 선택)" : "(value)"}</option>
            {valueCandidates.map((value) => (
              <option key={`${node.id}-v-${value}`} value={value}>
                {value}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={node.value}
            onChange={(event) => updateConditionNode(node.id, { value: event.target.value })}
            placeholder={lang === "ko" ? "값 입력 (쉼표로 다중값 가능)" : "Value (comma for multiple values)"}
          />
        )}
        <div className="row">
          {!needsNoValue && valueCandidates.length > 0 ? (
            <button
              type="button"
              className="ghost-btn compact-add-btn"
              onClick={() => updateConditionNode(node.id, { manualValueInput: !node.manualValueInput })}
            >
              {node.manualValueInput ? (lang === "ko" ? "목록값" : "Pick List") : lang === "ko" ? "직접입력" : "Type"}
            </button>
          ) : null}
          <button type="button" className="ghost-btn compact-add-btn danger-border" onClick={() => removeNode(node.id)}>
            {lang === "ko" ? "삭제" : "Delete"}
          </button>
        </div>
      </div>
    );
  };

  const renderBulkTreeNode = (node: RuleTreeNode, depth = 0): JSX.Element => {
    const selected = node.id === activeBulkTreeNodeId;
    if (node.type === "group") {
      return (
        <div
          key={node.id}
          className={`achievement-tree-group ${selected ? "selected" : ""}`}
          style={{ marginLeft: depth * 10 }}
          onClick={() => setSelectedBulkTreeNodeId(node.id)}
        >
          <div className="row achievement-tree-group-head">
            <strong>{depth === 0 ? (lang === "ko" ? "루트 그룹" : "Root Group") : lang === "ko" ? "조건 그룹" : "Condition Group"}</strong>
            <div className="row">
              <select value={node.logic} onChange={(event) => updateBulkGroupLogic(node.id, event.target.value === "any" ? "any" : "all")}>
                <option value="all">{lang === "ko" ? "모두 만족 (AND)" : "ALL (AND)"}</option>
                <option value="any">{lang === "ko" ? "하나 이상 (OR)" : "ANY (OR)"}</option>
              </select>
              <button type="button" className="ghost-btn compact-add-btn" onClick={() => addBulkConditionToGroup(node.id)}>
                {lang === "ko" ? "+ 조건" : "+ Condition"}
              </button>
              <button type="button" className="ghost-btn compact-add-btn" onClick={() => addBulkGroupToGroup(node.id, "all")}>
                {lang === "ko" ? "+ 그룹" : "+ Group"}
              </button>
              {depth > 0 ? (
                <button type="button" className="ghost-btn compact-add-btn danger-border" onClick={() => removeBulkNode(node.id)}>
                  {lang === "ko" ? "삭제" : "Delete"}
                </button>
              ) : null}
            </div>
          </div>
          <div className="achievement-tree-children">
            {node.children.length === 0 ? (
              <small className="muted">{lang === "ko" ? "아직 조건이 없습니다. +조건 또는 +그룹으로 시작하세요." : "No child conditions yet."}</small>
            ) : (
              node.children.map((child) => renderBulkTreeNode(child, depth + 1))
            )}
          </div>
        </div>
      );
    }

    const valueCandidates = ruleOptions.value_suggestions?.[node.field] || ruleOptions.feature_values[node.field] || [];
    const needsNoValue = node.op === "exists" || node.op === "not_exists";
    const useSelect = !node.manualValueInput && valueCandidates.length > 0 && !needsNoValue;
    return (
      <div
        key={node.id}
        className={`achievement-condition-row ${selected ? "selected" : ""}`}
        style={{ marginLeft: depth * 10 }}
        onClick={() => setSelectedBulkTreeNodeId(node.id)}
      >
        <strong>C</strong>
        <select
          value={node.field}
          onChange={(event) => {
            const nextField = event.target.value;
            const ops = allowedOpsForField(nextField);
            updateBulkConditionNode(node.id, { field: nextField, op: ops.includes(node.op) ? node.op : ops[0] || "eq", value: "" });
          }}
        >
          <option value="">{lang === "ko" ? "(필드 선택)" : "(field)"}</option>
          {filteredConditionFields.map((field) => {
            const label = ruleOptions.field_meta?.[field]?.label;
            return (
              <option key={`${node.id}-bf-${field}`} value={field}>
                {label ? `${label} (${field})` : field}
              </option>
            );
          })}
        </select>
        <select value={node.op} onChange={(event) => updateBulkConditionNode(node.id, { op: event.target.value, value: node.value })}>
          {allowedOpsForField(node.field).map((op) => (
            <option key={`${node.id}-bop-${op}`} value={op}>
              {ruleOptions.operator_meta?.[op]?.label || op}
            </option>
          ))}
        </select>
        {needsNoValue ? (
          <input value="" disabled placeholder={lang === "ko" ? "값 불필요" : "No value needed"} />
        ) : useSelect ? (
          <select value={node.value} onChange={(event) => updateBulkConditionNode(node.id, { value: event.target.value })}>
            <option value="">{lang === "ko" ? "(값 선택)" : "(value)"}</option>
            {valueCandidates.map((value) => (
              <option key={`${node.id}-bv-${value}`} value={value}>
                {value}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={node.value}
            onChange={(event) => updateBulkConditionNode(node.id, { value: event.target.value })}
            placeholder={lang === "ko" ? "값 입력 (쉼표로 다중값 가능)" : "Value (comma for multiple values)"}
          />
        )}
        <div className="row">
          {!needsNoValue && valueCandidates.length > 0 ? (
            <button
              type="button"
              className="ghost-btn compact-add-btn"
              onClick={() => updateBulkConditionNode(node.id, { manualValueInput: !node.manualValueInput })}
            >
              {node.manualValueInput ? (lang === "ko" ? "목록값" : "Pick List") : lang === "ko" ? "직접입력" : "Type"}
            </button>
          ) : null}
          <button type="button" className="ghost-btn compact-add-btn danger-border" onClick={() => removeBulkNode(node.id)}>
            {lang === "ko" ? "삭제" : "Delete"}
          </button>
        </div>
      </div>
    );
  };

  const renderGroupGrid = (sectionTitle: string, sectionRows: GroupEntry[]) => (
    <section className="achievement-admin-group-section">
      <div className="row">
        <h3>{sectionTitle}</h3>
        <small className="muted">{sectionRows.length}</small>
      </div>
      <div className="achievement-admin-grid">
        {sectionRows.map((group) => {
          const firstTier = Number(group.rows[0]?.tier || 1);
          const palette = cardPalette(group.kind, firstTier, styleForm);
          return (
            <article
              key={group.groupId}
              draggable
              onDragStart={() => setDragGroupId(group.groupId)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => void onDropGroup(group.groupId)}
              className={`achievement-admin-group-card ${dragGroupId === group.groupId ? "dragging" : ""}`}
              style={{ borderColor: palette.border, background: `linear-gradient(160deg, ${palette.fill}, #ffffff)` }}
            >
              <div className="achievement-admin-group-head">
                <div>
                  <strong>{group.groupId}</strong>
                  <small className="muted">
                    {group.kind === "tiered" ? "Tiered" : group.kind === "hidden" ? "Single · Hidden" : "Single · Event"}
                  </small>
                </div>
                <small className="muted">#{group.displayOrder || 0}</small>
              </div>

              <div className="achievement-admin-rows-mini">
                {group.rows.map((row) => (
                  <div key={row.achievement_id} className="achievement-admin-row-mini">
                    <div>
                      <strong>
                        {group.kind === "tiered" ? `${canonicalTierName(Number(row.tier || 1))} ` : ""}
                        {row.name}
                      </strong>
                      <small className="muted">
                        {row.achievement_id} · {row._progress}/{row._target}
                      </small>
                    </div>
                    <button className="ghost-btn compact-add-btn" onClick={() => openEdit(row, group.kind === "tiered" ? "tier-lite" : "full")}>
                      {lang === "ko" ? "수정" : "Edit"}
                    </button>
                  </div>
                ))}
              </div>

              <div className="achievement-admin-group-actions">
                <button
                  className="ghost-btn compact-add-btn"
                  disabled={orderBusy}
                  onClick={() => void moveGroup(group.groupId, -1)}
                  title={lang === "ko" ? "위로 이동" : "Move up"}
                >
                  ↑
                </button>
                <button
                  className="ghost-btn compact-add-btn"
                  disabled={orderBusy}
                  onClick={() => void moveGroup(group.groupId, 1)}
                  title={lang === "ko" ? "아래로 이동" : "Move down"}
                >
                  ↓
                </button>
                {group.kind === "tiered" ? (
                  <button className="ghost-btn compact-add-btn" onClick={() => openBulkEdit(group.groupId, group.rows)}>
                    {lang === "ko" ? "티어 일괄 수정" : "Bulk Tier Edit"}
                  </button>
                ) : null}
                <button className="ghost-btn compact-add-btn danger-border" onClick={() => void deleteGroup(group.rows[0].achievement_id)}>
                  {lang === "ko" ? "그룹 삭제" : "Delete Group"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );

  const isTierLiteEdit = rowEditMode === "tier-lite" && Boolean(editingId);

  return (
    <div className="achievement-admin-shell">
      <section className="achievement-admin-toolbar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={lang === "ko" ? "업적 검색 (ID/이름/카테고리)" : "Search by id/name/category"}
        />
        <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as KindFilter)}>
          <option value="all">{lang === "ko" ? "전체" : "All"}</option>
          <option value="tiered">{lang === "ko" ? "티어형" : "Tiered"}</option>
          <option value="single">{lang === "ko" ? "일회성(히든 포함)" : "Single (incl. hidden)"}</option>
        </select>
        <button className="ghost-btn compact-add-btn" onClick={openCreate}>
          {lang === "ko" ? "업적 생성" : "Create"}
        </button>
        <button className="ghost-btn compact-add-btn" onClick={() => void load()} disabled={loading}>
          {lang === "ko" ? "새로고침" : "Refresh"}
        </button>
        <button className="ghost-btn compact-add-btn" onClick={() => setTopPanelsOpen((prev) => !prev)}>
          {topPanelsOpen ? (lang === "ko" ? "상단 도구 접기" : "Hide Tools") : lang === "ko" ? "상단 도구 펼치기" : "Show Tools"}
        </button>
      </section>

      {editorMode === "none" ? (
        topPanelsOpen ? (
          <section className="achievement-admin-top-panels">
            <div className="achievement-admin-export-grid">
              <label>
                dataset_id
                <input value={exportDatasetId} onChange={(event) => setExportDatasetId(event.target.value)} />
              </label>
              <label>
                {lang === "ko" ? "이름" : "Name"}
                <input value={exportName} onChange={(event) => setExportName(event.target.value)} />
              </label>
              <label>
                {lang === "ko" ? "설명" : "Description"}
                <input value={exportDescription} onChange={(event) => setExportDescription(event.target.value)} />
              </label>
              <div className="row">
                <button className="ghost-btn compact-add-btn" onClick={() => void exportPack()}>
                  {lang === "ko" ? "업적 팩 Export" : "Export Pack"}
                </button>
                <button className="ghost-btn compact-add-btn danger-border" onClick={() => void resetCurated()}>
                  {lang === "ko" ? "기본세트 재적용" : "Reset Curated"}
                </button>
              </div>
            </div>

            <div className="achievement-style-editor">
              <div className="row">
                <strong>{lang === "ko" ? "카드 테두리/채우기 색상" : "Card Border/Fill Styles"}</strong>
                <button className="ghost-btn compact-add-btn" onClick={() => void saveStyleTheme()} disabled={styleBusy}>
                  {lang === "ko" ? "색상 저장" : "Save Styles"}
                </button>
              </div>
              <div className="achievement-style-grid">
                {(Object.keys(styleForm) as StyleKey[]).map((key) => (
                  <div key={key} className="achievement-style-row">
                    <small>{STYLE_LABEL[key]}</small>
                    <label>
                      Border
                      <input
                        type="color"
                        value={styleForm[key].border}
                        onChange={(event) => setStyleForm((prev) => ({ ...prev, [key]: { ...prev[key], border: event.target.value } }))}
                      />
                    </label>
                    <label>
                      Fill
                      <input
                        type="color"
                        value={styleForm[key].fill}
                        onChange={(event) => setStyleForm((prev) => ({ ...prev, [key]: { ...prev[key], fill: event.target.value } }))}
                      />
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : (
          <section className="achievement-admin-top-panels-collapsed">
            <small className="muted">
              {lang === "ko"
                ? "상단 도구가 접혀 있습니다. [상단 도구 펼치기]를 누르면 업적 팩/색상 설정을 수정할 수 있습니다."
                : "Top tools are collapsed. Use [Show Tools] to edit export/style settings."}
            </small>
          </section>
        )
      ) : (
        <section className="achievement-admin-top-panels-collapsed">
          <div className="row">
            <small className="muted">
              {lang === "ko" ? "편집 중에는 목록/상단 도구를 접어 편집 영역을 크게 표시합니다." : "While editing, list/tools are collapsed for larger editor space."}
            </small>
            <button className="ghost-btn compact-add-btn" onClick={closeEditor}>
              {lang === "ko" ? "편집 종료" : "Exit Edit"}
            </button>
          </div>
        </section>
      )}

      <section className={`achievement-admin-layout ${editorMode !== "none" ? "editor-open" : ""}`}>
        <div className={`achievement-admin-grid-wrap ${editorMode !== "none" ? "collapsed" : ""}`}>
          {loading ? <small className="muted">{lang === "ko" ? "로딩 중..." : "Loading..."}</small> : null}
          {renderGroupGrid(lang === "ko" ? "티어형" : "Tiered", tieredGroups)}
          {renderGroupGrid(lang === "ko" ? "일회성 (히든 포함)" : "One-off (with hidden)", singleGroups)}
        </div>

        {editorMode !== "none" ? <aside className="achievement-admin-editor focus-mode">

          {editorMode === "row" ? (
            <div className="achievement-editor-form">
              <div className="row">
                <h3>
                  {editingId
                    ? isTierLiteEdit
                      ? lang === "ko"
                        ? "티어 행 수정 (규칙 잠금)"
                        : "Tier Row Edit (Rule Locked)"
                      : lang === "ko"
                      ? "업적 수정"
                      : "Edit Achievement"
                    : lang === "ko"
                    ? "업적 생성"
                    : "Create Achievement"}
                </h3>
                <div className="row">
                  {editingId ? (
                    <button className="ghost-btn compact-add-btn danger-border" onClick={() => void deleteRow(editingId)}>
                      {lang === "ko" ? "행 삭제" : "Delete Row"}
                    </button>
                  ) : null}
                  <button className="ghost-btn compact-add-btn" onClick={closeEditor}>
                    {lang === "ko" ? "닫기" : "Close"}
                  </button>
                </div>
              </div>

              <div className="achievement-editor-grid">
                <label>
                  achievement_id
                  <input
                    value={form.achievement_id}
                    disabled={Boolean(editingId)}
                    onChange={(event) => setForm((prev) => ({ ...prev, achievement_id: event.target.value }))}
                  />
                </label>
                {!isTierLiteEdit ? (
                  <label>
                    group_id
                    <input value={form.group_id} onChange={(event) => setForm((prev) => ({ ...prev, group_id: event.target.value }))} />
                  </label>
                ) : null}
                <label>
                  {lang === "ko" ? "이름" : "Name"}
                  <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
                </label>
                <label>
                  tier
                  <input
                    value={form.tier}
                    disabled={isTierLiteEdit}
                    onChange={(event) => setForm((prev) => ({ ...prev, tier: event.target.value }))}
                  />
                </label>
                <label>
                  tier_name
                  <input value={form.tier_name} onChange={(event) => setForm((prev) => ({ ...prev, tier_name: event.target.value }))} />
                </label>
                {!isTierLiteEdit ? (
                  <label>
                    category
                    <input value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))} />
                  </label>
                ) : null}
                {!isTierLiteEdit ? (
                  <label>
                    rarity
                    <input value={form.rarity} onChange={(event) => setForm((prev) => ({ ...prev, rarity: event.target.value }))} />
                  </label>
                ) : null}
                <label>
                  xp_reward
                  <input value={form.xp_reward} onChange={(event) => setForm((prev) => ({ ...prev, xp_reward: event.target.value }))} />
                </label>
                <label>
                  target
                  <input value={form.target} onChange={(event) => setForm((prev) => ({ ...prev, target: event.target.value }))} />
                </label>
                {!isTierLiteEdit ? (
                  <label>
                    display_order
                    <input
                      value={form.display_order}
                      onChange={(event) => setForm((prev) => ({ ...prev, display_order: event.target.value }))}
                    />
                  </label>
                ) : null}
                {!isTierLiteEdit ? (
                  <label>
                    {lang === "ko" ? "진행 계산 방식(rule_type)" : "Progress Type (rule_type)"}
                    <select value={form.rule_type} onChange={(event) => onRowRuleTypeChange(event.target.value)}>
                      {ruleOptions.rule_types.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <small className="muted">{ruleOptions.rule_type_meta?.[form.rule_type]?.description || ""}</small>
                  </label>
                ) : null}
                {!isTierLiteEdit ? (
                  <label>
                    ui_badge_style
                    <input
                      value={form.ui_badge_style}
                      onChange={(event) => setForm((prev) => ({ ...prev, ui_badge_style: event.target.value }))}
                    />
                  </label>
                ) : null}
              </div>

              <div className="achievement-editor-grid single-col">
                <label>
                  description
                  <textarea value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
                </label>
                <label>
                  evidence_hint
                  <input
                    value={form.evidence_hint}
                    onChange={(event) => setForm((prev) => ({ ...prev, evidence_hint: event.target.value }))}
                  />
                </label>
                <label>
                  hint
                  <input value={form.hint} onChange={(event) => setForm((prev) => ({ ...prev, hint: event.target.value }))} />
                </label>
              </div>

              {!isTierLiteEdit ? (
                <div className="row">
                  <label className="inline">
                    <input
                      type="checkbox"
                      checked={form.is_hidden}
                      onChange={(event) => setForm((prev) => ({ ...prev, is_hidden: event.target.checked }))}
                    />
                    is_hidden
                  </label>
                  <label className="inline">
                    <input
                      type="checkbox"
                      checked={form.auto_grant}
                      onChange={(event) => setForm((prev) => ({ ...prev, auto_grant: event.target.checked }))}
                    />
                    auto_grant
                  </label>
                </div>
              ) : null}

              <div className="achievement-editor-media">
                {iconPreview ? <img src={iconPreview} alt="icon preview" className="achievement-admin-preview-lg" /> : null}
                <label>
                  icon_url
                  <input value={form.icon_url} onChange={(event) => setForm((prev) => ({ ...prev, icon_url: event.target.value }))} />
                </label>
                <label>
                  icon_path
                  <input value={form.icon_path} onChange={(event) => setForm((prev) => ({ ...prev, icon_path: event.target.value }))} />
                </label>
                <div className="row">
                  <label className="ghost-btn compact-add-btn">
                    {lang === "ko" ? "아이콘 파일" : "Upload Icon"}
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        if (file) void uploadIconFile(file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <button className="ghost-btn compact-add-btn" onClick={() => void pasteIcon()}>
                    {lang === "ko" ? "클립보드 붙여넣기" : "Paste Clipboard"}
                  </button>
                </div>
              </div>

              {!isTierLiteEdit ? (
                <>
              <h4>{lang === "ko" ? "규칙 빌더 V2" : "Rule Builder V2"}</h4>
              <small className="muted">
                {lang === "ko"
                  ? "먼저 핵심 필드만 입력하고, 태그/조건 트리는 [선택 고급 필터]에서 필요할 때만 여세요."
                  : "Fill core fields first, and open optional advanced filters only when needed."}
              </small>
              <div className="achievement-help-card">
                <strong>{lang === "ko" ? "현재 진행 방식 설명" : "Current Rule Guide"}</strong>
                <small className="muted">{lang === "ko" ? rowRuleSpec.noteKo : rowRuleSpec.noteEn}</small>
                {rowRuleGuideLines.map((line, index) => (
                  <small className="muted" key={`row-guide-${index}`}>
                    {line}
                  </small>
                ))}
              </div>
              {allRuleTemplates.length > 0 ? (
                <div className="achievement-rule-examples">
                  <strong>{lang === "ko" ? "빠른 시작 템플릿" : "Quick Templates"}</strong>
                  <div className="achievement-rule-example-list">
                    {allRuleTemplates.map((item, index) => (
                      <button
                        key={`example-${index}`}
                        type="button"
                        className="ghost-btn compact-add-btn"
                        onClick={() => applyExampleRule(item)}
                        title={item.description}
                      >
                        {item.title}
                      </button>
                    ))}
                  </div>
                  <small className="muted">
                    {lang === "ko"
                      ? "템플릿을 누르면 rule_type/target/필터가 한 번에 적용됩니다."
                      : "Clicking a template applies rule_type/target/filters together."}
                  </small>
                </div>
              ) : null}
              {rowRuleSpec.showEventType ||
              rowRuleSpec.showField ||
              rowRuleSpec.showGoalType ||
              rowRuleSpec.showMinDuration ||
              rowRuleSpec.showMinSessions ||
              rowRuleSpec.showMinSessionsPerMonth ? (
                <div className="achievement-editor-grid">
                  {rowRuleSpec.showEventType ? (
                    <>
                      <label>
                        {lang === "ko" ? "event_type 검색" : "Search event_type"}
                        <input
                          value={ruleEventSearch}
                          onChange={(event) => setRuleEventSearch(event.target.value)}
                          placeholder={lang === "ko" ? "예: SESSION" : "e.g. SESSION"}
                        />
                      </label>
                      <label>
                        event_type
                        <select
                          value={form.rule_event_type}
                          onChange={(event) => setForm((prev) => ({ ...prev, rule_event_type: event.target.value }))}
                        >
                          <option value="">{lang === "ko" ? "(선택 안 함)" : "(none)"}</option>
                          {filteredEventTypes.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <small className="muted">{lang === "ko" ? "집계할 이벤트 종류" : "Event source for aggregation"}</small>
                      </label>
                    </>
                  ) : null}
                  {rowRuleSpec.showField ? (
                    <>
                      <label>
                        {lang === "ko" ? "field 검색" : "Search field"}
                        <input
                          value={ruleFieldSearch}
                          onChange={(event) => setRuleFieldSearch(event.target.value)}
                          placeholder={lang === "ko" ? "예: song_library_id" : "e.g. song_library_id"}
                        />
                      </label>
                      <label>
                        field
                        <select value={form.rule_field} onChange={(event) => setForm((prev) => ({ ...prev, rule_field: event.target.value }))}>
                          <option value="">{lang === "ko" ? "(선택 안 함)" : "(none)"}</option>
                          {filteredFields.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <small className="muted">
                          {form.rule_field
                            ? ruleOptions.field_meta?.[form.rule_field]?.description || (lang === "ko" ? "distinct 기준 필드" : "Distinct field key")
                            : lang === "ko"
                            ? "distinct_count에서 서로 다른 값을 셀 기준"
                            : "Key for distinct_count"}
                        </small>
                      </label>
                    </>
                  ) : null}
                  {rowRuleSpec.showMinDuration ? (
                    <label>
                      min_duration
                      <input
                        type="number"
                        min={0}
                        value={form.rule_min_duration}
                        onChange={(event) => setForm((prev) => ({ ...prev, rule_min_duration: event.target.value }))}
                      />
                      <small className="muted">{lang === "ko" ? "이 값(분) 이상인 이벤트만 포함" : "Minimum duration filter (minutes)"}</small>
                    </label>
                  ) : null}
                  {rowRuleSpec.showMinSessions ? (
                    <label>
                      min_sessions
                      <input
                        type="number"
                        min={0}
                        value={form.rule_min_sessions}
                        onChange={(event) => setForm((prev) => ({ ...prev, rule_min_sessions: event.target.value }))}
                      />
                      <small className="muted">{lang === "ko" ? "주간 최소 세션 수" : "Weekly minimum sessions"}</small>
                    </label>
                  ) : null}
                  {rowRuleSpec.showMinSessionsPerMonth ? (
                    <label>
                      min_sessions_per_month
                      <input
                        type="number"
                        min={0}
                        value={form.rule_min_sessions_per_month}
                        onChange={(event) => setForm((prev) => ({ ...prev, rule_min_sessions_per_month: event.target.value }))}
                      />
                      <small className="muted">{lang === "ko" ? "월간 최소 세션 수" : "Monthly minimum sessions"}</small>
                    </label>
                  ) : null}
                  {rowRuleSpec.showGoalType ? (
                    <>
                      <label>
                        {lang === "ko" ? "goal_type 검색" : "Search goal_type"}
                        <input value={ruleGoalTypeSearch} onChange={(event) => setRuleGoalTypeSearch(event.target.value)} />
                      </label>
                      <label>
                        goal_type
                        <select value={form.rule_goal_type} onChange={(event) => setForm((prev) => ({ ...prev, rule_goal_type: event.target.value }))}>
                          <option value="">{lang === "ko" ? "(선택 안 함)" : "(none)"}</option>
                          {filteredGoalTypes.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <small className="muted">{lang === "ko" ? "장기 목표 클리어 종류" : "Long-goal clear category"}</small>
                      </label>
                    </>
                  ) : null}
                </div>
              ) : (
                <small className="muted">
                  {lang === "ko"
                    ? "이 진행 방식은 이벤트 필터 입력이 필요하지 않습니다."
                    : "This progress type does not require event filter fields."}
                </small>
              )}

              {rowRuleSpec.supportsAdvanced ? (
                <details
                  className="achievement-advanced-json"
                  open={ruleBuilderAdvancedOpen}
                  onToggle={(event) => setRuleBuilderAdvancedOpen(event.currentTarget.open)}
                >
                  <summary>{lang === "ko" ? "선택 고급 필터 (태그/조건 트리)" : "Optional Advanced Filters (tags/tree)"}</summary>
                  {rowRuleSpec.showTags ? (
                    <>
                    <small className="muted">
                      {lang === "ko"
                        ? "tags_any: 하나라도 포함되면 통과, tags_all: 모두 포함되어야 통과"
                        : "tags_any: at least one tag matches, tags_all: all tags must match."}
                    </small>
                    <div className="achievement-rule-tags-block">
                      <div className="achievement-rule-tags-panel">
                        <div className="row">
                          <strong>tags_any</strong>
                          <button
                            type="button"
                            className="ghost-btn compact-add-btn"
                            onClick={() => setForm((prev) => ({ ...prev, rule_tags_any: "" }))}
                          >
                            {lang === "ko" ? "초기화" : "Clear"}
                          </button>
                        </div>
                        <input
                          value={ruleTagsAnySearch}
                          onChange={(event) => setRuleTagsAnySearch(event.target.value)}
                          placeholder={lang === "ko" ? "태그 검색" : "Search tags"}
                        />
                        <div className="achievement-tag-group-list">
                          {groupedTagsAny.map((group) => (
                            <section key={`any-group-${group.name}`} className="achievement-tag-group-block">
                              <h5 className="achievement-tag-group-title">{group.name}</h5>
                              <div className="achievement-rule-chip-wrap">
                                {group.tags.map((tag) => (
                                  <button
                                    key={`any-${tag}`}
                                    type="button"
                                    className={`ghost-btn compact-add-btn ${selectedTagsAny.includes(tag) ? "active-mini" : ""}`}
                                    onClick={() => setForm((prev) => ({ ...prev, rule_tags_any: toggleCsvToken(prev.rule_tags_any, tag) }))}
                                  >
                                    {toTagLabel(tag, lang)}
                                  </button>
                                ))}
                              </div>
                            </section>
                          ))}
                        </div>
                        <small className="muted">
                          {selectedTagsAny.length
                            ? selectedTagsAny.map((tag) => toTagLabel(tag, lang)).join(", ")
                            : lang === "ko"
                            ? "선택된 태그 없음"
                            : "No tags selected"}
                        </small>
                      </div>

                      <div className="achievement-rule-tags-panel">
                        <div className="row">
                          <strong>tags_all</strong>
                          <button
                            type="button"
                            className="ghost-btn compact-add-btn"
                            onClick={() => setForm((prev) => ({ ...prev, rule_tags_all: "" }))}
                          >
                            {lang === "ko" ? "초기화" : "Clear"}
                          </button>
                        </div>
                        <input
                          value={ruleTagsAllSearch}
                          onChange={(event) => setRuleTagsAllSearch(event.target.value)}
                          placeholder={lang === "ko" ? "태그 검색" : "Search tags"}
                        />
                        <div className="achievement-tag-group-list">
                          {groupedTagsAll.map((group) => (
                            <section key={`all-group-${group.name}`} className="achievement-tag-group-block">
                              <h5 className="achievement-tag-group-title">{group.name}</h5>
                              <div className="achievement-rule-chip-wrap">
                                {group.tags.map((tag) => (
                                  <button
                                    key={`all-${tag}`}
                                    type="button"
                                    className={`ghost-btn compact-add-btn ${selectedTagsAll.includes(tag) ? "active-mini" : ""}`}
                                    onClick={() => setForm((prev) => ({ ...prev, rule_tags_all: toggleCsvToken(prev.rule_tags_all, tag) }))}
                                  >
                                    {toTagLabel(tag, lang)}
                                  </button>
                                ))}
                              </div>
                            </section>
                          ))}
                        </div>
                        <small className="muted">
                          {selectedTagsAll.length
                            ? selectedTagsAll.map((tag) => toTagLabel(tag, lang)).join(", ")
                            : lang === "ko"
                            ? "선택된 태그 없음"
                            : "No tags selected"}
                        </small>
                      </div>
                    </div>
                    </>
                  ) : null}

                  {rowRuleSpec.showConditionTree ? (
                    <>
                    <small className="muted">
                      {lang === "ko"
                        ? "조건 트리는 고급 필터입니다. 필요할 때만 추가하세요. 비워두면 트리 조건은 적용되지 않습니다."
                        : "Condition tree is optional. If empty, tree-based filtering is not applied."}
                    </small>
                    <div className="achievement-rule-builder-shell">
                      <div className="achievement-rule-builder-main">
                        <div className="achievement-rule-conditions">
                          <div className="row">
                            <strong>{lang === "ko" ? "조건 트리 빌더" : "Condition Tree Builder"}</strong>
                            <label>
                              {lang === "ko" ? "필드 검색" : "Field Search"}
                              <input
                                value={conditionFieldSearch}
                                onChange={(event) => setConditionFieldSearch(event.target.value)}
                                placeholder={lang === "ko" ? "예: song.genre, event.hour_local" : "e.g. song.genre, event.hour_local"}
                              />
                            </label>
                          </div>
                          {renderTreeNode(form.rule_condition_tree)}
                        </div>
                      </div>
                      <aside className="achievement-rule-help">
                        <strong>{lang === "ko" ? "도움말 패널" : "Help Panel"}</strong>
                        <small className="muted">
                          {lang === "ko"
                            ? "필드/연산자 설명과 현재 규칙 요약을 확인하세요."
                            : "Review field/operator help and current rule summary."}
                        </small>
                        <div className="achievement-help-card">
                          <strong>{lang === "ko" ? "선택 필드" : "Selected Field"}</strong>
                          <small className="muted">
                            {selectedConditionField
                              ? `${selectedFieldMeta?.label || selectedConditionField} (${selectedConditionField})`
                              : lang === "ko"
                              ? "조건 노드를 선택하세요."
                              : "Select a condition node."}
                          </small>
                          {selectedConditionField ? <small className="muted">{selectedFieldMeta?.description || ""}</small> : null}
                        </div>
                        <div className="achievement-help-card">
                          <strong>{lang === "ko" ? "선택 연산자" : "Selected Operator"}</strong>
                          <small className="muted">
                            {selectedConditionOp ? ruleOptions.operator_meta?.[selectedConditionOp]?.label || selectedConditionOp : "-"}
                          </small>
                          {selectedConditionOp ? <small className="muted">{selectedOpMeta?.description || ""}</small> : null}
                        </div>
                        <div className="achievement-help-card">
                          <strong>{lang === "ko" ? "추천 값" : "Suggested Values"}</strong>
                          <small className="muted">
                            {selectedValueCandidates.length ? selectedValueCandidates.slice(0, 12).join(", ") : lang === "ko" ? "없음" : "none"}
                          </small>
                        </div>
                        <div className="achievement-help-card">
                          <strong>{lang === "ko" ? "현재 규칙 요약" : "Current Rule Summary"}</strong>
                          <small className="muted">{JSON.stringify(liveRulePreview)}</small>
                          {editingId ? (
                            <>
                              <small className="muted">{String(items.find((it) => String(it.achievement_id) === editingId)?._rule_summary_ko || "")}</small>
                              {(items.find((it) => String(it.achievement_id) === editingId)?._rule_steps_ko as string[] | undefined)?.map(
                                (line, index) => (
                                  <small className="muted" key={`rule-step-${index}`}>
                                    {line}
                                  </small>
                                )
                              )}
                            </>
                          ) : null}
                        </div>
                      </aside>
                    </div>
                    </>
                  ) : null}
                </details>
              ) : null}
              <details className="achievement-advanced-json" open={advancedJsonOpen} onToggle={(event) => setAdvancedJsonOpen(event.currentTarget.open)}>
                <summary>{lang === "ko" ? "고급(JSON) 편집" : "Advanced JSON"}</summary>
                <div className="row">
                  <button className="ghost-btn compact-add-btn" onClick={syncRawFromBuilder}>
                    {lang === "ko" ? "빌더 -> JSON" : "Builder -> JSON"}
                  </button>
                  <button className="ghost-btn compact-add-btn" onClick={syncBuilderFromRaw}>
                    {lang === "ko" ? "JSON -> 빌더" : "JSON -> Builder"}
                  </button>
                </div>
                <label>
                  rule_filter (JSON)
                  <textarea
                    value={form.rule_filter_raw}
                    onChange={(event) => setForm((prev) => ({ ...prev, rule_filter_raw: event.target.value }))}
                    rows={8}
                  />
                </label>
              </details>
                </>
              ) : (
                <div className="achievement-rule-locked-note">
                  <strong>{lang === "ko" ? "이 티어 행은 규칙 편집이 잠겨 있습니다." : "Rule editing is locked for this tier row."}</strong>
                  <small className="muted">
                    {lang === "ko"
                      ? "규칙(진행 계산 방식, 이벤트/조건 트리)은 [티어 일괄 수정]에서만 변경됩니다. 여기서는 이름/설명/수치/아이콘만 수정하세요."
                      : "Rule type and condition tree are editable only in Bulk Tier Edit. Edit text/targets/icons here."}
                  </small>
                  {editingItem?._rule_summary_ko ? <small className="muted">{String(editingItem._rule_summary_ko)}</small> : null}
                </div>
              )}
              <div className="row">
                <button className="primary-btn" onClick={() => void save()} disabled={busySave}>
                  {busySave ? (lang === "ko" ? "저장 중..." : "Saving...") : lang === "ko" ? "저장" : "Save"}
                </button>
              </div>
            </div>
          ) : null}

          {editorMode === "bulk" && bulk ? (
            <div className="achievement-editor-form">
              <div className="row">
                <h3>{lang === "ko" ? `티어 그룹 일괄 수정 (${bulk.groupId})` : `Bulk Tier Edit (${bulk.groupId})`}</h3>
                <button className="ghost-btn compact-add-btn" onClick={closeEditor}>
                  {lang === "ko" ? "닫기" : "Close"}
                </button>
              </div>

              <small className="muted">
                {lang === "ko"
                  ? "티어형은 여기서 규칙을 공통 관리합니다. 개별 티어 행 수정에서는 규칙이 잠깁니다."
                  : "Tier rules are managed here in bulk. Per-row tier edits keep rules locked."}
              </small>

              <div className="achievement-editor-grid">
                <label>
                  group_id
                  <input value={bulk.groupId} onChange={(event) => setBulk((prev) => (prev ? { ...prev, groupId: event.target.value } : prev))} />
                </label>
                <label>
                  category
                  <input value={bulk.category} onChange={(event) => setBulk((prev) => (prev ? { ...prev, category: event.target.value } : prev))} />
                </label>
                <label>
                  rarity
                  <input value={bulk.rarity} onChange={(event) => setBulk((prev) => (prev ? { ...prev, rarity: event.target.value } : prev))} />
                </label>
                <label>
                  {lang === "ko" ? "진행 계산 방식(rule_type)" : "Progress Type (rule_type)"}
                  <select value={bulk.rule_type} onChange={(event) => onBulkRuleTypeChange(event.target.value)}>
                    {ruleOptions.rule_types.map((option) => (
                      <option key={`bulk-${option}`} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <small className="muted">{ruleOptions.rule_type_meta?.[bulk.rule_type]?.description || ""}</small>
                </label>
                <label>
                  icon_url
                  <input value={bulk.icon_url} onChange={(event) => setBulk((prev) => (prev ? { ...prev, icon_url: event.target.value } : prev))} />
                </label>
                <label>
                  icon_path
                  <input value={bulk.icon_path} onChange={(event) => setBulk((prev) => (prev ? { ...prev, icon_path: event.target.value } : prev))} />
                </label>
              </div>
              <small className="muted">
                {lang === "ko"
                  ? "공통 아이콘을 넣으면 개별 티어에 아이콘이 비어있는 경우 자동으로 공통 아이콘이 적용됩니다."
                  : "Common icon is used as fallback when a tier row has no individual icon."}
              </small>

              <div className="row">
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={bulk.is_hidden}
                    onChange={(event) => setBulk((prev) => (prev ? { ...prev, is_hidden: event.target.checked } : prev))}
                  />
                  is_hidden
                </label>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={bulk.auto_grant}
                    onChange={(event) => setBulk((prev) => (prev ? { ...prev, auto_grant: event.target.checked } : prev))}
                  />
                  auto_grant
                </label>
              </div>

              <div className="row">
                <button className="ghost-btn compact-add-btn" onClick={applyBulkTierPreset}>
                  {lang === "ko" ? "티어명 자동 채우기" : "Apply Tier Names"}
                </button>
              </div>

              <div className="achievement-admin-tier-table">
                <div className="achievement-admin-tier-head">
                  <small>#</small>
                  <small>{lang === "ko" ? "티어명" : "Tier Name"}</small>
                  <small>{lang === "ko" ? "표시 이름" : "Display Name"}</small>
                  <small>{lang === "ko" ? "목표값" : "Target"}</small>
                  <small>{lang === "ko" ? "보상 XP" : "XP"}</small>
                </div>
                {bulk.tiers.map((row, index) => (
                  <div key={row.achievement_id} className="achievement-admin-tier-row">
                    <strong>#{index + 1}</strong>
                    <input
                      value={row.tier_name}
                      onChange={(event) =>
                        setBulk((prev) =>
                          prev
                            ? {
                                ...prev,
                                tiers: prev.tiers.map((item, rowIndex) =>
                                  rowIndex === index ? { ...item, tier_name: event.target.value } : item
                                ),
                              }
                            : prev
                        )
                      }
                    />
                    <input
                      value={row.name}
                      onChange={(event) =>
                        setBulk((prev) =>
                          prev
                            ? {
                                ...prev,
                                tiers: prev.tiers.map((item, rowIndex) =>
                                  rowIndex === index ? { ...item, name: event.target.value } : item
                                ),
                              }
                            : prev
                        )
                      }
                    />
                    <input
                      value={row.target}
                      onChange={(event) =>
                        setBulk((prev) =>
                          prev
                            ? {
                                ...prev,
                                tiers: prev.tiers.map((item, rowIndex) =>
                                  rowIndex === index ? { ...item, target: event.target.value } : item
                                ),
                              }
                            : prev
                        )
                      }
                    />
                    <input
                      value={row.xp_reward}
                      onChange={(event) =>
                        setBulk((prev) =>
                          prev
                            ? {
                                ...prev,
                                tiers: prev.tiers.map((item, rowIndex) =>
                                  rowIndex === index ? { ...item, xp_reward: event.target.value } : item
                                ),
                              }
                            : prev
                        )
                      }
                    />
                  </div>
                ))}
              </div>

              <h4>{lang === "ko" ? "티어 공통 규칙 빌더" : "Tier Shared Rule Builder"}</h4>
              <div className="achievement-help-card">
                <strong>{lang === "ko" ? "현재 진행 방식 설명" : "Current Rule Guide"}</strong>
                <small className="muted">{lang === "ko" ? bulkRuleSpec.noteKo : bulkRuleSpec.noteEn}</small>
                {bulkRuleGuideLines.map((line, index) => (
                  <small className="muted" key={`bulk-guide-${index}`}>
                    {line}
                  </small>
                ))}
              </div>

              {bulkRuleSpec.showEventType ||
              bulkRuleSpec.showField ||
              bulkRuleSpec.showGoalType ||
              bulkRuleSpec.showMinDuration ||
              bulkRuleSpec.showMinSessions ||
              bulkRuleSpec.showMinSessionsPerMonth ? (
                <div className="achievement-editor-grid">
                  {bulkRuleSpec.showEventType ? (
                    <>
                      <label>
                        {lang === "ko" ? "event_type 검색" : "Search event_type"}
                        <input
                          value={ruleEventSearch}
                          onChange={(event) => setRuleEventSearch(event.target.value)}
                          placeholder={lang === "ko" ? "예: SESSION" : "e.g. SESSION"}
                        />
                      </label>
                      <label>
                        event_type
                        <select
                          value={bulk.rule_event_type}
                          onChange={(event) => setBulk((prev) => (prev ? { ...prev, rule_event_type: event.target.value } : prev))}
                        >
                          <option value="">{lang === "ko" ? "(선택 안 함)" : "(none)"}</option>
                          {filteredEventTypes.map((option) => (
                            <option key={`bulk-event-${option}`} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <small className="muted">{lang === "ko" ? "집계할 이벤트 종류" : "Event source for aggregation"}</small>
                      </label>
                    </>
                  ) : null}
                  {bulkRuleSpec.showField ? (
                    <>
                      <label>
                        {lang === "ko" ? "field 검색" : "Search field"}
                        <input
                          value={ruleFieldSearch}
                          onChange={(event) => setRuleFieldSearch(event.target.value)}
                          placeholder={lang === "ko" ? "예: song_library_id" : "e.g. song_library_id"}
                        />
                      </label>
                      <label>
                        field
                        <select value={bulk.rule_field} onChange={(event) => setBulk((prev) => (prev ? { ...prev, rule_field: event.target.value } : prev))}>
                          <option value="">{lang === "ko" ? "(선택 안 함)" : "(none)"}</option>
                          {filteredFields.map((option) => (
                            <option key={`bulk-field-${option}`} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <small className="muted">
                          {bulk.rule_field
                            ? ruleOptions.field_meta?.[bulk.rule_field]?.description || (lang === "ko" ? "distinct 기준 필드" : "Distinct field key")
                            : lang === "ko"
                            ? "distinct_count에서 서로 다른 값을 셀 기준"
                            : "Key for distinct_count"}
                        </small>
                      </label>
                    </>
                  ) : null}
                  {bulkRuleSpec.showMinDuration ? (
                    <label>
                      min_duration
                      <input
                        type="number"
                        min={0}
                        value={bulk.rule_min_duration}
                        onChange={(event) => setBulk((prev) => (prev ? { ...prev, rule_min_duration: event.target.value } : prev))}
                      />
                      <small className="muted">{lang === "ko" ? "이 값(분) 이상인 이벤트만 포함" : "Minimum duration filter (minutes)"}</small>
                    </label>
                  ) : null}
                  {bulkRuleSpec.showMinSessions ? (
                    <label>
                      min_sessions
                      <input
                        type="number"
                        min={0}
                        value={bulk.rule_min_sessions}
                        onChange={(event) => setBulk((prev) => (prev ? { ...prev, rule_min_sessions: event.target.value } : prev))}
                      />
                      <small className="muted">{lang === "ko" ? "주간 최소 세션 수" : "Weekly minimum sessions"}</small>
                    </label>
                  ) : null}
                  {bulkRuleSpec.showMinSessionsPerMonth ? (
                    <label>
                      min_sessions_per_month
                      <input
                        type="number"
                        min={0}
                        value={bulk.rule_min_sessions_per_month}
                        onChange={(event) => setBulk((prev) => (prev ? { ...prev, rule_min_sessions_per_month: event.target.value } : prev))}
                      />
                      <small className="muted">{lang === "ko" ? "월간 최소 세션 수" : "Monthly minimum sessions"}</small>
                    </label>
                  ) : null}
                  {bulkRuleSpec.showGoalType ? (
                    <>
                      <label>
                        {lang === "ko" ? "goal_type 검색" : "Search goal_type"}
                        <input value={ruleGoalTypeSearch} onChange={(event) => setRuleGoalTypeSearch(event.target.value)} />
                      </label>
                      <label>
                        goal_type
                        <select
                          value={bulk.rule_goal_type}
                          onChange={(event) => setBulk((prev) => (prev ? { ...prev, rule_goal_type: event.target.value } : prev))}
                        >
                          <option value="">{lang === "ko" ? "(선택 안 함)" : "(none)"}</option>
                          {filteredGoalTypes.map((option) => (
                            <option key={`bulk-goal-${option}`} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <small className="muted">{lang === "ko" ? "장기 목표 클리어 종류" : "Long-goal clear category"}</small>
                      </label>
                    </>
                  ) : null}
                </div>
              ) : (
                <small className="muted">
                  {lang === "ko"
                    ? "이 진행 방식은 이벤트 필터 입력이 필요하지 않습니다."
                    : "This progress type does not require event filter fields."}
                </small>
              )}

              {bulkRuleSpec.supportsAdvanced ? (
                <details
                  className="achievement-advanced-json"
                  open={bulkRuleBuilderAdvancedOpen}
                  onToggle={(event) => setBulkRuleBuilderAdvancedOpen(event.currentTarget.open)}
                >
                  <summary>{lang === "ko" ? "선택 고급 필터 (태그/조건 트리)" : "Optional Advanced Filters (tags/tree)"}</summary>
                  {bulkRuleSpec.showTags ? (
                    <>
                    <small className="muted">
                      {lang === "ko"
                        ? "tags_any: 하나라도 포함되면 통과, tags_all: 모두 포함되어야 통과"
                        : "tags_any: at least one tag matches, tags_all: all tags must match."}
                    </small>
                    <div className="achievement-rule-tags-block">
                      <div className="achievement-rule-tags-panel">
                        <div className="row">
                          <strong>tags_any</strong>
                          <button
                            type="button"
                            className="ghost-btn compact-add-btn"
                            onClick={() => setBulk((prev) => (prev ? { ...prev, rule_tags_any: "" } : prev))}
                          >
                            {lang === "ko" ? "초기화" : "Clear"}
                          </button>
                        </div>
                        <input
                          value={ruleTagsAnySearch}
                          onChange={(event) => setRuleTagsAnySearch(event.target.value)}
                          placeholder={lang === "ko" ? "태그 검색" : "Search tags"}
                        />
                        <div className="achievement-tag-group-list">
                          {groupedTagsAny.map((group) => (
                            <section key={`bulk-any-group-${group.name}`} className="achievement-tag-group-block">
                              <h5 className="achievement-tag-group-title">{group.name}</h5>
                              <div className="achievement-rule-chip-wrap">
                                {group.tags.map((tag) => (
                                  <button
                                    key={`bulk-any-${tag}`}
                                    type="button"
                                    className={`ghost-btn compact-add-btn ${selectedBulkTagsAny.includes(tag) ? "active-mini" : ""}`}
                                    onClick={() => setBulk((prev) => (prev ? { ...prev, rule_tags_any: toggleCsvToken(prev.rule_tags_any, tag) } : prev))}
                                  >
                                    {toTagLabel(tag, lang)}
                                  </button>
                                ))}
                              </div>
                            </section>
                          ))}
                        </div>
                        <small className="muted">
                          {selectedBulkTagsAny.length
                            ? selectedBulkTagsAny.map((tag) => toTagLabel(tag, lang)).join(", ")
                            : lang === "ko"
                            ? "선택된 태그 없음"
                            : "No tags selected"}
                        </small>
                      </div>

                      <div className="achievement-rule-tags-panel">
                        <div className="row">
                          <strong>tags_all</strong>
                          <button
                            type="button"
                            className="ghost-btn compact-add-btn"
                            onClick={() => setBulk((prev) => (prev ? { ...prev, rule_tags_all: "" } : prev))}
                          >
                            {lang === "ko" ? "초기화" : "Clear"}
                          </button>
                        </div>
                        <input
                          value={ruleTagsAllSearch}
                          onChange={(event) => setRuleTagsAllSearch(event.target.value)}
                          placeholder={lang === "ko" ? "태그 검색" : "Search tags"}
                        />
                        <div className="achievement-tag-group-list">
                          {groupedTagsAll.map((group) => (
                            <section key={`bulk-all-group-${group.name}`} className="achievement-tag-group-block">
                              <h5 className="achievement-tag-group-title">{group.name}</h5>
                              <div className="achievement-rule-chip-wrap">
                                {group.tags.map((tag) => (
                                  <button
                                    key={`bulk-all-${tag}`}
                                    type="button"
                                    className={`ghost-btn compact-add-btn ${selectedBulkTagsAll.includes(tag) ? "active-mini" : ""}`}
                                    onClick={() => setBulk((prev) => (prev ? { ...prev, rule_tags_all: toggleCsvToken(prev.rule_tags_all, tag) } : prev))}
                                  >
                                    {toTagLabel(tag, lang)}
                                  </button>
                                ))}
                              </div>
                            </section>
                          ))}
                        </div>
                        <small className="muted">
                          {selectedBulkTagsAll.length
                            ? selectedBulkTagsAll.map((tag) => toTagLabel(tag, lang)).join(", ")
                            : lang === "ko"
                            ? "선택된 태그 없음"
                            : "No tags selected"}
                        </small>
                      </div>
                    </div>
                    </>
                  ) : null}

                  {bulkRuleSpec.showConditionTree ? (
                    <>
                    <small className="muted">
                      {lang === "ko"
                        ? "조건 트리는 선택 고급 필터입니다. 필요할 때만 그룹/조건을 추가하세요."
                        : "Condition tree is optional advanced filtering."}
                    </small>
                    <div className="achievement-rule-builder-shell">
                      <div className="achievement-rule-builder-main">
                        <div className="achievement-rule-conditions">
                          <div className="row">
                            <strong>{lang === "ko" ? "조건 트리 빌더" : "Condition Tree Builder"}</strong>
                            <label>
                              {lang === "ko" ? "필드 검색" : "Field Search"}
                              <input
                                value={conditionFieldSearch}
                                onChange={(event) => setConditionFieldSearch(event.target.value)}
                                placeholder={lang === "ko" ? "예: song.genre, event.hour_local" : "e.g. song.genre, event.hour_local"}
                              />
                            </label>
                          </div>
                          {renderBulkTreeNode(bulk.rule_condition_tree)}
                        </div>
                      </div>
                      <aside className="achievement-rule-help">
                        <strong>{lang === "ko" ? "도움말 패널" : "Help Panel"}</strong>
                        <small className="muted">
                          {lang === "ko" ? "필드/연산자 설명과 현재 규칙 요약을 확인하세요." : "Review field/operator help and current rule summary."}
                        </small>
                        <div className="achievement-help-card">
                          <strong>{lang === "ko" ? "선택 필드" : "Selected Field"}</strong>
                          <small className="muted">
                            {selectedBulkConditionField
                              ? `${selectedBulkFieldMeta?.label || selectedBulkConditionField} (${selectedBulkConditionField})`
                              : lang === "ko"
                              ? "조건 노드를 선택하세요."
                              : "Select a condition node."}
                          </small>
                          {selectedBulkConditionField ? <small className="muted">{selectedBulkFieldMeta?.description || ""}</small> : null}
                        </div>
                        <div className="achievement-help-card">
                          <strong>{lang === "ko" ? "선택 연산자" : "Selected Operator"}</strong>
                          <small className="muted">
                            {selectedBulkConditionOp ? ruleOptions.operator_meta?.[selectedBulkConditionOp]?.label || selectedBulkConditionOp : "-"}
                          </small>
                          {selectedBulkConditionOp ? <small className="muted">{selectedBulkOpMeta?.description || ""}</small> : null}
                        </div>
                        <div className="achievement-help-card">
                          <strong>{lang === "ko" ? "추천 값" : "Suggested Values"}</strong>
                          <small className="muted">
                            {selectedBulkValueCandidates.length
                              ? selectedBulkValueCandidates.slice(0, 12).join(", ")
                              : lang === "ko"
                              ? "없음"
                              : "none"}
                          </small>
                        </div>
                        <div className="achievement-help-card">
                          <strong>{lang === "ko" ? "현재 규칙 요약" : "Current Rule Summary"}</strong>
                          <small className="muted">{JSON.stringify(liveBulkRulePreview)}</small>
                        </div>
                      </aside>
                    </div>
                    </>
                  ) : null}
                </details>
              ) : null}

              <details className="achievement-advanced-json" open={bulkAdvancedOpen} onToggle={(event) => setBulkAdvancedOpen(event.currentTarget.open)}>
                <summary>{lang === "ko" ? "고급(JSON) 편집" : "Advanced JSON"}</summary>
                <div className="row">
                  <button className="ghost-btn compact-add-btn" onClick={syncBulkRawFromBuilder}>
                    {lang === "ko" ? "빌더 -> JSON" : "Builder -> JSON"}
                  </button>
                  <button className="ghost-btn compact-add-btn" onClick={syncBulkBuilderFromRaw}>
                    {lang === "ko" ? "JSON -> 빌더" : "JSON -> Builder"}
                  </button>
                </div>
                <label>
                  rule_filter (JSON)
                  <textarea
                    value={bulk.rule_filter_raw}
                    onChange={(event) => setBulk((prev) => (prev ? { ...prev, rule_filter_raw: event.target.value } : prev))}
                    rows={8}
                  />
                </label>
              </details>

              <div className="row">
                <button className="primary-btn" onClick={() => void saveBulk()} disabled={bulkBusy}>
                  {bulkBusy ? (lang === "ko" ? "저장 중..." : "Saving...") : lang === "ko" ? "일괄 저장" : "Save Bulk"}
                </button>
              </div>
            </div>
          ) : null}
        </aside> : null}
      </section>
    </div>
  );
}

