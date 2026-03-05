import { expect, type Page, type APIRequestContext } from "@playwright/test";

export async function resetRuntime(request: APIRequestContext): Promise<void> {
  await request.post("/api/onboarding/complete", {
    data: {
      nickname: "E2E Player",
      weekly_goal_sessions: 3,
      theme: "studio",
      language: "ko",
      audio_enabled: false,
    },
  });
  await request.post("/api/session/discard", { data: {} });
  await request.post("/api/admin/reset-progress", { data: {} });
}

export async function resetRuntimeFull(request: APIRequestContext): Promise<void> {
  await request.post("/api/admin/reset-all", { data: {} });
  await request.post("/api/onboarding/complete", {
    data: {
      nickname: "E2E Player",
      weekly_goal_sessions: 3,
      theme: "studio",
      language: "ko",
      audio_enabled: false,
    },
  });
  await request.post("/api/session/discard", { data: {} });
}

export async function gotoCoreTab(page: Page, tab: "dashboard" | "practice" | "gallery"): Promise<void> {
  const indexMap = { dashboard: 0, practice: 1, gallery: 2 } as const;
  const target = page.locator(".nav-btn-priority").nth(indexMap[tab]);
  await target.click();
}

export async function gotoRecordTab(page: Page, tab: "sessions" | "review" | "xp"): Promise<void> {
  const labelMap: Record<typeof tab, RegExp> = {
    sessions: /세션|Sessions?/i,
    review: /돌아보기|Review/i,
    xp: /XP|기록/i,
  };
  const recordsGroup = page
    .locator(".nav-subgroup", { has: page.locator(".nav-group-title", { hasText: /기록|Records/i }) })
    .first();
  if (!(await recordsGroup.getAttribute("class"))?.includes("open")) {
    await recordsGroup.locator(".nav-group-toggle").click();
  }
  await recordsGroup.locator(".nav-btn").filter({ hasText: labelMap[tab] }).first().click();
}
export async function gotoChallengeTab(page: Page, tab: "quests" | "achievements"): Promise<void> {
  const labelMap: Record<typeof tab, RegExp> = {
    quests: /퀘스트|Quests?/i,
    achievements: /업적|Achievements?/i,
  };
  const challengeGroup = page
    .locator(".nav-subgroup", { has: page.locator(".nav-group-title", { hasText: /도전|Challenges?/i }) })
    .first();
  if (!(await challengeGroup.getAttribute("class"))?.includes("open")) {
    await challengeGroup.locator(".nav-group-toggle").click();
  }
  await challengeGroup.locator(".nav-btn").filter({ hasText: labelMap[tab] }).first().click();
}
export async function gotoSettings(page: Page): Promise<void> {
  await page.locator("[data-testid='sidebar-settings-btn'], [data-testid='topbar-settings-btn'], .topbar-settings-btn").first().click();
}

export async function openApp(page: Page, width = 1280, height = 840): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await expect(page.locator(".app-root")).toBeVisible();
}

