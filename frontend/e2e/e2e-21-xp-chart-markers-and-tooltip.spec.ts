import { expect, test } from "@playwright/test";
import { gotoRecordTab, openApp, resetRuntime } from "./helpers";

function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

test("E2E-21 XP chart markers and tooltip", async ({ page, request }) => {
  await resetRuntime(request);

  const today = new Date();
  const year = today.getFullYear();
  const seedCandidates = [
    new Date(year, 0, 1),
    new Date(year, 0, 15),
    new Date(year, 1, 1),
    new Date(year, 1, 15),
    new Date(year, today.getMonth(), 1),
    new Date(year, today.getMonth(), Math.max(1, Math.min(5, today.getDate()))),
  ].filter((date) => date.getTime() <= today.getTime());
  const uniqueSeedDays = Array.from(new Set(seedCandidates.map((date) => toYmd(date))));

  for (const day of uniqueSeedDays) {
    await request.post("/api/session/quick-log", {
      data: {
        activity: "Song",
        sub_activity: "SongPractice",
        tags: ["E2E", "XP", "MARKER"],
        notes: `E2E_XP_MARKER_${day}`,
        start_at: `${day}T10:00:00`,
        end_at: `${day}T10:20:00`,
        duration_min: 20,
      },
    });
  }

  await openApp(page, 1366, 768);
  await gotoRecordTab(page, "xp");

  const chartCard = page.locator(".xp-story-chart-main");
  await expect(chartCard).toBeVisible();

  await chartCard.locator(".ghost-btn").filter({ hasText: /Daily|일간/i }).click();
  await expect(chartCard.locator(".xp-story-today-label")).toHaveCount(0);
  await expect(
    chartCard.locator(".xp-story-bar-marker-label").filter({ hasText: /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/ }).first()
  ).toBeVisible();

  const firstDayBar = chartCard.locator(".xp-story-bar-item").first();
  await expect(firstDayBar).toBeVisible();
  await firstDayBar.hover();
  const tooltip = firstDayBar.locator(".xp-story-bar-tip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(/일 데이터|days in range/i);
  await expect(tooltip).toContainText(/구간 총 XP|Range total/i);
  await expect(tooltip).toContainText(/해당 일자 XP|XP on date|해당 구간 XP|XP in period/i);

  await chartCard.locator(".ghost-btn").filter({ hasText: /Weekly|주간/i }).click();
  await expect(
    chartCard.locator(".xp-story-bar-marker-label").filter({ hasText: /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/ }).first()
  ).toBeVisible();

  await chartCard.locator(".ghost-btn").filter({ hasText: /Monthly|월간/i }).click();
  await expect(chartCard.locator(".xp-story-bar-marker-label").filter({ hasText: /20\d{2}/ }).first()).toBeVisible();
});
