import type { Lang } from "../i18n";

export type TutorialTabId =
  | "dashboard"
  | "practice"
  | "tools"
  | "sessions"
  | "review"
  | "xp"
  | "quests"
  | "achievements"
  | "recommend"
  | "songs"
  | "drills"
  | "gallery"
  | "settings";

export type TutorialStep = {
  id: string;
  tab: TutorialTabId;
  anchor?: string;
  title: Record<Lang, string>;
  body: Record<Lang, string>;
};

export type TutorialCampaign = {
  id: string;
  label: Record<Lang, string>;
  kind: "core" | "deep";
  rewardEligible: boolean;
  steps: TutorialStep[];
};
