type AchievementIconLike = {
  achievement_id?: string;
  group_id?: string;
  category?: string;
  icon_url?: string;
  icon_path?: string;
  icon_emoji?: string;
};

type IconVisual = {
  imageSrc: string;
  emoji: string;
};

export const DEFAULT_ACHIEVEMENT_EMOJI_BY_GROUP: Record<string, string> = {
  ACH_TIER_SESSION_ROUTINE: "🗓️",
  ACH_TIER_DEEP_FOCUS: "🎯",
  ACH_TIER_LONG_FOCUS: "🎯",
  ACH_TIER_DURATION_SUM: "⏱️",
  ACH_TIER_XP_STACK: "⚡",
  ACH_TIER_LEVEL_CLIMB: "📈",
  ACH_TIER_SONG_PRACTICE: "🎵",
  ACH_TIER_REPERTOIRE_DISTINCT: "📚",
  ACH_TIER_DRILL_DISTINCT: "🎸",
  ACH_TIER_CORE_WEEKLY: "🗓️",
  ACH_TIER_MONTHLY_PACE: "🗓️",
  ACH_TIER_SLAP_MASTERY: "🖐️",
  ACH_TIER_THEORY_EAR: "📘",
  ACH_TIER_ARCHIVE_RECORD: "🎙️",
  ACH_TIER_VIDEO_REVIEW: "🎥",
  ACH_TIER_BAND_FLOW: "🎤",
  ACH_TIER_COMMUNITY: "🤝",
  ACH_ONE_FIRST_SESSION: "🚀",
  ACH_ONE_FIRST_FOCUS_30: "🎯",
  ACH_ONE_FIRST_AUDIO_LOG: "🎙️",
  ACH_ONE_FIRST_VIDEO_REVIEW: "🎥",
  ACH_ONE_FIRST_BAND_STAGE: "🎤",
  ACH_ONE_FIRST_COMMUNITY: "🤝",
  ACH_ONE_WEEK_KEEPER_2W: "🔥",
  ACH_ONE_MONTH_KEEPER_2M: "🔥",
  ACH_ONE_STYLE_SWITCHER: "🎨",
  ACH_ONE_STAGE_DEBUT: "🎤",
  ACH_HID_QUIET_ENGINE: "🔇",
  ACH_HID_DOUBLE_ARCHIVE: "🎥",
  ACH_HID_IRON_STREAK: "🔥",
  ACH_HID_NIGHT_OWL: "🎯",
  ACH_HID_REPERTOIRE_MASTER: "📚",
  ACH_TIER_QUEST_CLAIM: "🧭",
  ACH_ONE_QUEST_HIGH_FIRST: "🧭",
  ACH_HID_QUEST_GENRE_TRIO: "🧭",
  ACH_MG_FBH_FIRST_PLAY: "🎯",
  ACH_MG_RC_FIRST_PLAY: "🥁",
  ACH_MG_LM_FIRST_PLAY: "🧭",
  ACH_MG_CHALLENGE_COUNT: "🎮",
  ACH_MG_FBH_SCORE_20: "🎯",
  ACH_MG_RC_ACCURACY_90: "🥁",
  ACH_MG_LM_SCORE_12: "🧭",
  ACH_MG_PLAY_ALL_THREE: "🧩",
  ACH_MG_HARD_PLUS_10: "🔥",
};

const DEFAULT_ACHIEVEMENT_EMOJI_BY_CATEGORY: Record<string, string> = {
  "곡": "🎵",
  "기록": "🎙️",
  "드릴": "🎸",
  "루틴": "🗓️",
  "무대": "🎤",
  "성장": "📈",
  "수동": "🎨",
  "일회성": "🚀",
  "집중": "🎯",
  "미니게임": "🎮",
  "커뮤니티": "🤝",
  "퀘스트": "🧭",
  "테크닉": "🖐️",
  "학습": "📘",
  "히든": "🕶️",
};

function normalizeEmoji(value: string | undefined): string {
  return String(value || "").trim();
}

export function achievementEmojiFallback(item: AchievementIconLike): string {
  const groupId = String(item.group_id || item.achievement_id || "").trim();
  if (groupId && DEFAULT_ACHIEVEMENT_EMOJI_BY_GROUP[groupId]) {
    return DEFAULT_ACHIEVEMENT_EMOJI_BY_GROUP[groupId];
  }
  const category = String(item.category || "").trim();
  if (category && DEFAULT_ACHIEVEMENT_EMOJI_BY_CATEGORY[category]) {
    return DEFAULT_ACHIEVEMENT_EMOJI_BY_CATEGORY[category];
  }
  return "🏆";
}

export function resolveAchievementIconVisual(item: AchievementIconLike): IconVisual {
  const iconUrl = String(item.icon_url || "").trim();
  if (iconUrl) {
    return { imageSrc: iconUrl, emoji: "" };
  }
  const iconPath = String(item.icon_path || "").trim();
  if (iconPath) {
    return { imageSrc: `/media/${iconPath}`, emoji: "" };
  }
  const iconEmoji = normalizeEmoji(item.icon_emoji);
  if (iconEmoji) {
    return { imageSrc: "", emoji: iconEmoji };
  }
  return { imageSrc: "", emoji: achievementEmojiFallback(item) };
}
