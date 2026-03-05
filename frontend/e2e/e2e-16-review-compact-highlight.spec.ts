import { expect, test } from "@playwright/test";
import { gotoRecordTab, openApp, resetRuntime } from "./helpers";

test("E2E-16 review compact highlight and no TODO card", async ({ page, request }) => {
  await resetRuntime(request);
  await openApp(page, 1366, 768);
  await gotoRecordTab(page, "review");

  await expect(page.locator("[data-testid='review-highlights']")).toBeVisible();
  await expect(page.locator("h2").filter({ hasText: /TODO Completion|TODO 완료율/i })).toHaveCount(0);

  const mainContent = page.locator("main.content.content-record-review");
  const hasNoVerticalOverflow = await mainContent.evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
  expect(hasNoVerticalOverflow).toBeTruthy();
});
