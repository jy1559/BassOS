import { expect, test } from "@playwright/test";
import { gotoRecordTab, openApp, resetRuntime } from "./helpers";

test("E2E-31 minigame runs feed XP activity and review distribution", async ({ page, request }) => {
  await resetRuntime(request);

  await request.post("/api/minigame/records", {
    data: {
      game: "FBH",
      mode: "PRACTICE",
      difficulty: "EASY",
      score: 0,
      accuracy: 40,
      seed: "2026-03-01",
      duration_sec: 60,
      share_text: "FBH|PRACTICE|EASY|ATT=10|SEED=2026-03-01",
      detail_json: { attempts: 10, hits: 4, wrong: 6 },
    },
  });
  await request.post("/api/minigame/records", {
    data: {
      game: "RC",
      mode: "CHALLENGE",
      difficulty: "NORMAL",
      score: 18,
      accuracy: 91,
      seed: "2026-03-01",
      duration_sec: 95,
      share_text: "RC|CHALLENGE|NORMAL|SCORE=18|SEED=2026-03-01",
      detail_json: { perfect: 4, good: 1, miss: 0, note_accuracy: 100, timing_accuracy: 91, stray_inputs: 0 },
    },
  });
  await request.post("/api/minigame/records", {
    data: {
      game: "LM",
      mode: "PRACTICE",
      difficulty: "HARD",
      score: 9,
      accuracy: 71.4,
      seed: "2026-03-01",
      duration_sec: 58,
      share_text: "LM|PRACTICE|HARD|CORRECT=5|SEED=2026-03-01",
      detail_json: { attempts: 7, correct: 5, wrong: 2 },
    },
  });

  await openApp(page, 1366, 768);

  await gotoRecordTab(page, "xp");
  await expect(page.getByRole("heading", { name: /활동별 XP|XP by Activity/i })).toBeVisible();
  await expect(page.locator(".activity-row").filter({ hasText: /미니게임|Minigame/i })).toBeVisible();

  await gotoRecordTab(page, "review");
  const minigameSection = page.locator("[data-testid='review-toggle-minigame']");
  await expect(minigameSection).toBeVisible();
  await minigameSection.locator("summary").click();
  await expect(page.locator("[data-testid='review-minigame-filter-all']")).toBeVisible();
  await expect(page.locator("[data-testid='review-minigame-card-FBH']")).toContainText("Fretboard Hunt");
  await expect(page.locator("[data-testid='review-minigame-card-RC']")).toContainText("Rhythm Copy");
  await expect(page.locator("[data-testid='review-minigame-card-LM']")).toContainText("Line Mapper");
  await page.locator("[data-testid='review-minigame-filter-challenge']").click();
  await expect(page.locator("[data-testid='review-minigame-card-RC']")).toContainText(/평균|Avg/);
});
