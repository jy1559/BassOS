import { expect, test } from "@playwright/test";
import { gotoChallengeTab, openApp, resetRuntime } from "./helpers";

test("E2E-30 achievements show friendly copy and emoji fallback icons", async ({ page, request }) => {
  await resetRuntime(request);
  await openApp(page, 1366, 768);
  await gotoChallengeTab(page, "achievements");

  await expect(page.locator(".achievement-list-page")).toBeVisible();
  await expect(page.locator(".achievement-gallery-grid").first()).toBeVisible();

  const pageText = await page.locator(".achievement-list-page").textContent();
  expect(pageText || "").not.toContain("이벤트:");
  expect(pageText || "").not.toContain("고유 필드:");

  const emojiFallbacks = page.locator(".achievement-tile-icon.fallback.emoji");
  expect(await emojiFallbacks.count()).toBeGreaterThan(0);
  await expect(emojiFallbacks.first()).toBeVisible();
});
