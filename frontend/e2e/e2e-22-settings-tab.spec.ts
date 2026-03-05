import { expect, test } from "@playwright/test";
import { gotoSettings, openApp, resetRuntime } from "./helpers";

test("E2E-22 settings search + toc navigation", async ({ page, request }) => {
  await resetRuntime(request);
  await openApp(page);
  await gotoSettings(page);

  const search = page.locator("[data-testid='settings-search-input']");
  await expect(search).toBeVisible();
  await search.fill("backup");

  const tocItem = page.locator("[data-testid='settings-toc-dataBackup']");
  await tocItem.click();
  await expect(tocItem).toHaveClass(/active/);
  await expect(page.locator("[data-testid='settings-section-dataBackup']")).toBeVisible();
});

test("E2E-22 settings locked theme should be preview-only", async ({ page, request }) => {
  await resetRuntime(request);
  await openApp(page);
  await gotoSettings(page);

  const lockedTheme = page.locator("[data-testid='theme-card-midnight']");
  await expect(lockedTheme).toBeVisible();
  await expect(lockedTheme).toBeDisabled();
  await expect(lockedTheme).toHaveClass(/locked/);

  const activeTheme = page.locator(".settings-theme-card.active");
  await expect(activeTheme).not.toHaveAttribute("data-testid", "theme-card-midnight");
});

test("E2E-22 settings admin overlay and backup restore flow", async ({ page, request }) => {
  await resetRuntime(request);
  await request.post("/api/system/pre-exit", { data: {} });

  await openApp(page);
  await gotoSettings(page);

  const overlayOpen = page.locator("[data-testid='admin-overlay-open-btn']");
  await expect(overlayOpen).toBeVisible();
  await overlayOpen.click();
  await expect(page.locator("[data-testid='admin-overlay']")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-testid='admin-overlay']")).toBeHidden();

  const restoreButtons = page.locator("[data-testid='backup-restore-btn']");
  if (!(await restoreButtons.first().isVisible())) {
    await page.locator("[data-testid='settings-section-toggle-dataBackup']").click();
  }
  await expect(restoreButtons.first()).toBeVisible();

  page.on("dialog", async (dialog) => {
    if (dialog.message().toUpperCase().includes("RESTORE")) {
      await dialog.accept("RESTORE");
      return;
    }
    await dialog.accept();
  });

  const restoreResponse = page.waitForResponse((res) => res.url().includes("/api/backup/restore"));
  await restoreButtons.first().click();
  const response = await restoreResponse;
  const payload = await response.json();
  expect(payload.ok).toBeTruthy();
});
