import { expect, test, type Page } from "@playwright/test";
import { openApp, resetRuntime } from "./helpers";

async function gotoToolsTab(page: Page): Promise<void> {
  const toolsGroup = page
    .locator(".nav-subgroup", { has: page.locator(".nav-group-title", { hasText: /연습 도구|Practice Tools/i }) })
    .first();
  if (!(await toolsGroup.getAttribute("class"))?.includes("open")) {
    await toolsGroup.locator(".nav-group-toggle").click();
  }
  await toolsGroup.locator(".nav-btn").first().click();
}

test("E2E-29 practice tools merges tab builder, minigame, theory, and popup settings", async ({ page, request }) => {
  await resetRuntime(request);
  await request.post("/api/minigame/records", {
    data: {
      game: "FBH",
      mode: "CHALLENGE",
      difficulty: "NORMAL",
      score: 321,
      accuracy: 97.5,
      seed: "2026-03-01",
      duration_sec: 120,
      share_text: "FBH|CHALLENGE|NORMAL|SCORE=321|SEED=2026-03-01",
      detail_json: { hits: 32, attempts: 33, judge: "PC_RANGE" },
    },
  });

  await openApp(page, 1366, 768);
  await gotoToolsTab(page);

  await expect(page.getByRole("tab", { name: /TAB 생성기|TAB Builder/i })).toBeVisible();
  await expect(page.locator("[data-testid='tutorial-tools-metronome']")).toBeVisible();

  await page.getByRole("tab", { name: /미니게임|Mini Game/i }).click();
  await expect(page.locator("[data-testid='mg-game-hub']")).toBeVisible();

  await page.locator("[data-testid='mg-enter-game-FBH']").click();
  await expect(page.locator("[data-testid='mg-page']")).toBeVisible();
  await expect(page.locator("[data-testid='mg-lb-item-1']")).toContainText("321");

  await page.getByRole("button", { name: /연습 도구 설정|Practice Tool Settings/i }).click();
  await expect(page.locator("[data-testid='mg-settings-page']")).toBeVisible();
  const scaleSpreadInput = page.locator("[data-testid='mg-theory-scale-spread-number']").first();
  await scaleSpreadInput.fill("180");
  await page.getByRole("button", { name: "설정 저장" }).click();
  await page.locator(".practice-tools-modal-head .ghost-btn").click();

  await page.getByRole("tab", { name: /이론·코드·스케일|Theory/i }).click();
  await expect(page.locator("[data-testid='mg-theory-page']")).toBeVisible();
  await page.getByRole("button", { name: "연습 도구 설정" }).first().click();
  await expect(page.locator("[data-testid='mg-settings-page']")).toBeVisible();
  await expect(page.locator("[data-testid='mg-theory-scale-spread-number']").first()).toHaveValue("180");
});
