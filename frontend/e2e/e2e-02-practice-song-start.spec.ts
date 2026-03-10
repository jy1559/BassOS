import { expect, test } from "@playwright/test";
import { gotoCoreTab, openApp, resetRuntime } from "./helpers";

test("E2E-02 Practice Studio 곡 연습 시작 + 시작 패널 자동 접힘", async ({ page, request }) => {
  await resetRuntime(request);
  await openApp(page);
  await gotoCoreTab(page, "practice");

  await expect(page.locator(".practice-start-stepper")).toBeVisible();

  const nextStepButton = page.locator(".practice-step-card .primary-btn");
  if (await nextStepButton.count()) {
    await nextStepButton.first().click();
  }

  const quickSong = page.locator(".quick-pick-btn").first();
  if ((await page.locator(".quick-pick-btn").count()) > 0) {
    await quickSong.click();
  } else {
    const songSelect = page.locator("section.card").first().locator("select").first();
    const options = songSelect.locator("option");
    const optionCount = await options.count();
    if (optionCount > 1) {
      const firstValue = await options.nth(1).getAttribute("value");
      expect(firstValue).toBeTruthy();
      await songSelect.selectOption(firstValue || "");
    } else {
      await page.locator(".practice-start-stepper .ghost-btn").nth(1).click();
      const quickDrill = page.locator(".quick-pick-pill").first();
      if ((await page.locator(".quick-pick-pill").count()) > 0) {
        await quickDrill.click();
      } else {
        const drillSelect = page.locator("section.card").first().locator("select").first();
        const drillOptions = drillSelect.locator("option");
        const drillCount = await drillOptions.count();
        expect(drillCount).toBeGreaterThan(1);
        const firstDrill = await drillOptions.nth(1).getAttribute("value");
        expect(firstDrill).toBeTruthy();
        await drillSelect.selectOption(firstDrill || "");
      }
    }
  }

  const expandedStartButton = page.locator("[data-testid='practice-start-target']");
  if (await expandedStartButton.count()) {
    await expandedStartButton.click();
  } else {
    await page.locator("[data-testid='practice-start-collapsed'] .primary-btn").click();
  }
  await expect(page.locator("[data-testid='practice-start-collapsed']")).toBeVisible();
  await expect(page.locator(".studio-reference-main")).toBeVisible();

  await expect
    .poll(async () => {
      const hudRes = await request.get("/api/hud/summary");
      const hud = await hudRes.json();
      return hud.summary.active_session?.session_id || "";
    })
    .not.toBe("");
});
