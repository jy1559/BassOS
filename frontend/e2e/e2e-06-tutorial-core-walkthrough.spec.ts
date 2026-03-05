import { expect, test } from "@playwright/test";
import { gotoSettings, openApp, resetRuntimeFull } from "./helpers";

test("E2E-06 튜토리얼 코어 가이드 워크스루 + 이어하기", async ({ page, request }) => {
  await resetRuntimeFull(request);
  await openApp(page, 1280, 840);

  const banner = page.locator("[data-testid='tutorial-banner']");
  await expect(banner).toBeVisible();
  await banner.locator("button").filter({ hasText: /가이드 시작|Start Guide/ }).click();

  const overlay = page.locator("[data-testid='tutorial-overlay']");
  const nextBtn = overlay.locator("button").filter({ hasText: /다음|Next/ });
  const laterBtn = overlay.locator("button").filter({ hasText: /나중에|Later/ });

  await expect(overlay).toBeVisible();
  await expect(page.locator("[data-testid='tutorial-dashboard-hud']")).toBeVisible();

  for (let i = 0; i < 5; i += 1) {
    await nextBtn.click();
  }
  await expect(page.locator("[data-testid='tutorial-practice-stepper']")).toBeVisible();

  await laterBtn.click();
  await expect(overlay).toBeHidden();

  await gotoSettings(page);
  await page.locator("[data-testid='tutorial-resume-btn']").click();
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText(/6\/11/);
});
