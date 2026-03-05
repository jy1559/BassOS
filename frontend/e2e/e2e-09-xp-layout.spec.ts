import { expect, test, type Page } from "@playwright/test";
import { openApp, resetRuntime } from "./helpers";

async function gotoXpTab(page: Page): Promise<void> {
  const recordsGroup = page
    .locator(".nav-subgroup", { has: page.locator(".nav-group-title", { hasText: /기록|Records/ }) })
    .first();
  const classes = (await recordsGroup.getAttribute("class")) ?? "";
  if (!classes.includes("open")) {
    await recordsGroup.locator(".nav-group-toggle").click();
  }
  await recordsGroup.locator(".nav-btn").filter({ hasText: /XP기록|XP Log|XP/i }).first().click();
}

test("E2E-09 XP layout compact + mixed performance + heatmap reshape", async ({ page, request }) => {
  await resetRuntime(request);
  await openApp(page, 1366, 768);
  await gotoXpTab(page);

  const xpPage = page.locator(".xp-story-page");
  await expect(xpPage).toBeVisible();

  const mainContent = page.locator("main.content.content-xp");
  const hasNoVerticalOverflow = await mainContent.evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
  expect(hasNoVerticalOverflow).toBeTruthy();

  await expect(page.locator("[data-testid='xp-period-scope-all']")).toHaveClass(/active-mini/);

  const performanceCard = page.locator(".xp-story-performance-card");
  await expect(performanceCard).toContainText(/주간 XP|Weekly XP/);
  await expect(performanceCard).toContainText(/월간 XP|Monthly XP/);

  const heatmapCard = page.locator(".xp-story-bottom-card").filter({ has: page.locator("h2", { hasText: /연습 잔디|Practice Grass/ }) }).first();
  await heatmapCard.locator(".ghost-btn").filter({ hasText: /전체|All/ }).click();
  const firstYearRow = heatmapCard.locator(".xp-story-heatmap-all-year-row").first();
  await expect(firstYearRow).toBeVisible();
  const weekCellCount = await firstYearRow.locator(".xp-story-heat-cell").count();
  expect(weekCellCount).toBeGreaterThan(12);

  await heatmapCard.locator(".ghost-btn").filter({ hasText: /1년|1y/ }).click();
  const hasNoHorizontalOverflow = await heatmapCard
    .locator(".xp-story-heatmap-week-shell")
    .evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(hasNoHorizontalOverflow).toBeTruthy();
});
