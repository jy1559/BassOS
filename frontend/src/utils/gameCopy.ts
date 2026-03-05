import type { Lang } from "../i18n";

type ClaimKind = "quest" | "achievement";

const LEVEL_UP_LINES: Record<Lang, string[]> = {
  ko: [
    "좋아, 지금 흐름 완전 탔어.",
    "리듬 살아있다. 다음 레벨도 바로 간다.",
    "손에 불 붙었다. 계속 밀어붙이자.",
    "오늘 폼 미쳤다. 성장 속도 최고치.",
  ],
  en: [
    "Momentum locked. Keep it rolling.",
    "That groove is hot. Push the next level.",
    "Clean climb. You're on a streak.",
    "Power spike confirmed. Keep going.",
  ],
};

const SESSION_COMPLETE_LINES: Record<Lang, string[]> = {
  ko: [
    "좋아, 이번 판 클리어.",
    "리듬 좋다. 다음 세션 바로 가능.",
    "손 감각 살아있다. 지금 타이밍 최고.",
    "한 판 더 가면 오늘 기록 갱신 가능.",
    "타점 정확도 올라왔다. 계속 이어가자.",
  ],
  en: [
    "Run cleared. Nice work.",
    "Strong groove. Queue the next session.",
    "Your timing is getting tighter.",
    "One more run and you break today’s record.",
    "Solid execution. Keep the streak alive.",
  ],
};

const CLAIM_LINES: Record<ClaimKind, Record<Lang, string[]>> = {
  quest: {
    ko: ["퀘스트 보상 획득!", "보상 수령 완료. 다음 미션으로!", "퀘스트 정산 끝. 흐름 유지!"],
    en: ["Quest reward claimed!", "Reward secured. Next mission!", "Quest payout complete. Stay in rhythm!"],
  },
  achievement: {
    ko: ["업적 보상 획득!", "트로피 수령 완료!", "업적 정산 완료. 멋지다!"],
    en: ["Achievement reward claimed!", "Trophy claimed!", "Achievement payout complete. Nice!"],
  },
};

const FALLBACK_SESSION_COACH: Record<Lang, string> = {
  ko: "좋아, 템포 유지하면서 다음 구간으로 간다.",
  en: "Great pace. Keep the groove into the next run.",
};

function pickOne(list: string[]): string {
  if (!list.length) return "";
  return list[Math.floor(Math.random() * list.length)] || list[0];
}

export function pickLevelUpLine(lang: Lang): string {
  return pickOne(LEVEL_UP_LINES[lang]);
}

export function pickSessionCompleteLine(lang: Lang): string {
  return pickOne(SESSION_COMPLETE_LINES[lang]);
}

export function pickClaimLine(lang: Lang, kind: ClaimKind): string {
  return pickOne(CLAIM_LINES[kind][lang]);
}

export function pickSessionCoachLine(lang: Lang, apiFallback?: string): string {
  return apiFallback || pickSessionCompleteLine(lang) || FALLBACK_SESSION_COACH[lang];
}
