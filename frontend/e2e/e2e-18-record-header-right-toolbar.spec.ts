import { expect, test } from "@playwright/test";
import { gotoRecordTab, openApp, resetRuntime } from "./helpers";

async function assertDesktopRightToolbar(page: import("@playwright/test").Page): Promise<void> {
  const header = page.locator(".record-tab-header").first();
  const main = header.locator(".record-tab-header-main");
  const toolbar = header.locator(".record-tab-header-toolbar");
  await expect(main).toBeVisible();
  await expect(toolbar).toBeVisible();
  const mainBox = await main.boundingBox();
  const toolbarBox = await toolbar.boundingBox();
  expect(mainBox).toBeTruthy();
  expect(toolbarBox).toBeTruthy();
  if (mainBox && toolbarBox) {
    expect(toolbarBox.x).toBeGreaterThan(mainBox.x);
  }
}

async function assertMobileWrap(page: import("@playwright/test").Page): Promise<void> {
  const header = page.locator(".record-tab-header").first();
  const main = header.locator(".record-tab-header-main");
  const toolbar = header.locator(".record-tab-header-toolbar");
  await expect(main).toBeVisible();
  await expect(toolbar).toBeVisible();
  const mainBox = await main.boundingBox();
  const toolbarBox = await toolbar.boundingBox();
  expect(mainBox).toBeTruthy();
  expect(toolbarBox).toBeTruthy();
  if (mainBox && toolbarBox) {
    expect(toolbarBox.y).toBeGreaterThanOrEqual(mainBox.y);
  }
}

test("E2E-18 record tabs header uses right toolbar with responsive wrap", async ({ page, request }) => {
  await resetRuntime(request);
  await openApp(page, 1366, 768);

  await gotoRecordTab(page, "review");
  await assertDesktopRightToolbar(page);

  await gotoRecordTab(page, "xp");
  await assertDesktopRightToolbar(page);

  await gotoRecordTab(page, "sessions");
  await assertDesktopRightToolbar(page);

  await page.setViewportSize({ width: 1024, height: 768 });
  await gotoRecordTab(page, "review");
  await assertMobileWrap(page);
});
