import { expect, test } from "@playwright/test";
import { gotoRecordTab, openApp, resetRuntime } from "./helpers";

const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];

test("E2E-09 XP layout keeps cards visible and year heatmap fills width", async ({ page, request }) => {
  await resetRuntime(request);

  for (const viewport of VIEWPORTS) {
    await openApp(page, viewport.width, viewport.height);
    await gotoRecordTab(page, "xp");

    const xpPage = page.locator(".xp-story-page");
    await expect(xpPage).toBeVisible();

    const performanceCard = page.locator(".xp-story-performance-card");
    await expect(performanceCard).toContainText(/Weekly XP|주간 XP/i);
    await expect(performanceCard).toContainText(/Monthly XP|월간 XP/i);
    await expect(performanceCard.locator(".ghost-btn").filter({ hasText: /Edit Goals|목표 수정/i }).first()).toBeVisible();

    const heatmapCard = page
      .locator(".xp-story-bottom-card")
      .filter({ has: page.locator("h2", { hasText: /Practice Grass|연습 잔디/i }) })
      .first();
    await heatmapCard.locator(".ghost-btn").filter({ hasText: /1y|1년/i }).click();

    const yearGrid = heatmapCard.locator(".xp-story-heatmap-year-grid");
    await expect(yearGrid).toBeVisible();
    await expect(heatmapCard.locator(".xp-story-heatmap-year-row")).toHaveCount(12);

    const firstRowCellCount = await heatmapCard.locator(".xp-story-heatmap-year-row").first().locator(".xp-story-heat-cell").count();
    expect(firstRowCellCount).toBe(31);

    const hasNoHorizontalOverflow = await yearGrid.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(hasNoHorizontalOverflow).toBeTruthy();
  }
});
