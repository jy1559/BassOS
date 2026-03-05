import { expect, test } from "@playwright/test";
import { gotoRecordTab, openApp, resetRuntime } from "./helpers";

async function assertToolbar(page: import("@playwright/test").Page, prefix: string): Promise<void> {
  const allBtn = page.locator(`[data-testid='${prefix}-scope-all']`);
  await expect(allBtn).toHaveClass(/active-mini/);

  await page.locator(`[data-testid='${prefix}-scope-period']`).click();
  await expect(page.locator(`[data-testid='${prefix}-unit-week']`)).toBeVisible();
  await expect(page.locator(`[data-testid='${prefix}-unit-month']`)).toBeVisible();
  await expect(page.locator(`[data-testid='${prefix}-unit-year']`)).toBeVisible();
  await expect(page.locator(`[data-testid='${prefix}-prev']`)).toBeVisible();
  await expect(page.locator(`[data-testid='${prefix}-next']`)).toBeVisible();
  await expect(page.locator(`[data-testid='${prefix}-calendar']`)).toBeVisible();

  await page.locator(`[data-testid='${prefix}-scope-recent']`).click();
  await expect(page.locator(`[data-testid='${prefix}-recent-7']`)).toBeVisible();
  await expect(page.locator(`[data-testid='${prefix}-recent-30']`)).toBeVisible();
  await expect(page.locator(`[data-testid='${prefix}-recent-90']`)).toBeVisible();
}

test("E2E-15 record period toolbar unified across 3 tabs", async ({ page, request }) => {
  await resetRuntime(request);
  await openApp(page, 1366, 768);

  await gotoRecordTab(page, "review");
  await assertToolbar(page, "review-period");

  await gotoRecordTab(page, "xp");
  await assertToolbar(page, "xp-period");

  await gotoRecordTab(page, "sessions");
  await assertToolbar(page, "sessions-period");
});
