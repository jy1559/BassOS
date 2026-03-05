export type Lang = "ko" | "en";

type Dict = Record<string, { ko: string; en: string }>;

const dict: Dict = {
  dashboard: { ko: "대시보드", en: "Dashboard" },
  achievements: { ko: "업적", en: "Achievements" },
  songs: { ko: "곡 라이브러리", en: "Song Library" },
  media: { ko: "미디어", en: "Media" },
  settings: { ko: "설정", en: "Settings" },
  sessions: { ko: "세션 기록", en: "Sessions" },
  xpPage: { ko: "마이 XP", en: "My XP" },
  questsPage: { ko: "퀘스트", en: "Quests" },
  startSession: { ko: "세션 시작", en: "Start Session" },
  stopSession: { ko: "세션 종료", en: "Stop Session" },
  quickLog: { ko: "빠른 기록 (10분)", en: "Quick Log (10m)" },
  save: { ko: "저장", en: "Save" },
  cancel: { ko: "취소", en: "Cancel" },
  level: { ko: "레벨", en: "Level" },
  rank: { ko: "랭크", en: "Rank" },
  totalXp: { ko: "총 XP", en: "Total XP" },
  recentXp: { ko: "최근 획득", en: "Recent XP" },
  quests: { ko: "퀘스트", en: "Quests" },
  claim: { ko: "수령", en: "Claim" },
  onboardingTitle: { ko: "3분 시작 설정", en: "3-Min Setup" },
  complete: { ko: "완료", en: "Complete" },
  nextUnlock: { ko: "다음 해금", en: "Next Unlock" },
  noData: { ko: "데이터가 없습니다.", en: "No data yet." }
};

export function t(lang: Lang, key: string): string {
  const item = dict[key];
  if (!item) return key;
  return item[lang];
}
