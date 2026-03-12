import { expect, test, type Page } from "@playwright/test";
import { gotoSettings, openApp, resetRuntime } from "./helpers";

async function queueDialogs(page: Page, steps: Array<{ action: "accept" | "dismiss"; promptText?: string }>) {
  const remaining = [...steps];
  page.on("dialog", async (dialog) => {
    const next = remaining.shift();
    if (!next) {
      await dialog.dismiss();
      return;
    }
    if (next.action === "dismiss") {
      await dialog.dismiss();
      return;
    }
    await dialog.accept(next.promptText);
  });
}

test("E2E-22 settings search + toc navigation", async ({ page, request }) => {
  await resetRuntime(request);
  await openApp(page);
  await gotoSettings(page);

  const search = page.locator("[data-testid='settings-search-input']");
  await expect(search).toBeVisible();
  await expect(page.locator("[data-testid='settings-home-profile-card']")).toBeVisible();
  await expect(page.locator("[data-testid='settings-home-theme-card']")).toBeVisible();
  await expect(page.locator("[data-testid='settings-section-basic']")).toBeVisible();
  await search.fill("backup");

  const tocItem = page.locator("[data-testid='settings-toc-dataBackup']");
  await tocItem.click();
  await expect(tocItem).toHaveClass(/active/);
  await expect(page.locator("[data-testid='settings-section-dataBackup']")).toBeVisible();
  await expect(page.locator("[data-testid='settings-section-basic']")).toHaveCount(0);
  await expect(page.locator("[data-testid='settings-toc-developer']")).toHaveCount(0);
  await expect(page.locator("[data-testid='settings-toc-mock']")).toHaveCount(0);
  await expect(page.locator("[data-testid='settings-toc-misc']")).toHaveCount(0);
  await expect(page.locator("option[value='en']")).toHaveCount(0);
  await expect(page.locator("[data-testid='reset-tools-open-btn']")).toBeVisible();
  await expect(page.locator("[data-testid='admin-tools-open-btn']")).toBeVisible();
});

test("E2E-22 settings locked theme should be preview-only", async ({ page, request }) => {
  await resetRuntime(request);
  await openApp(page);
  await gotoSettings(page);
  await page.locator("[data-testid='settings-toc-appearance']").click();

  const lockedTheme = page.locator("[data-testid='theme-card-midnight']");
  await expect(lockedTheme).toBeVisible();
  await expect(lockedTheme).toBeDisabled();
  await expect(lockedTheme).toHaveClass(/locked/);

  const activeTheme = page.locator(".settings-theme-card.active");
  await expect(activeTheme).not.toHaveAttribute("data-testid", "theme-card-midnight");
});

test("E2E-22 settings reset flow requires multi-step confirmation", async ({ page, request }) => {
  await resetRuntime(request);
  await openApp(page);
  await gotoSettings(page);

  const resetOpen = page.locator("[data-testid='reset-tools-open-btn']");
  await expect(resetOpen).toBeVisible();
  await resetOpen.click();
  await expect(page.locator("[data-testid='settings-reset-modal']")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-testid='settings-reset-modal']")).toBeHidden();

  await resetOpen.click();
  await expect(page.locator("[data-testid='settings-reset-modal']")).toBeVisible();

  await queueDialogs(page, [
    { action: "accept" },
    { action: "accept" },
    { action: "accept", promptText: "진행도 초기화" },
  ]);

  const resetResponse = page.waitForResponse((res) => res.url().includes("/api/admin/reset-progress"));
  await page.locator("[data-testid='reset-progress-btn']").click();
  const response = await resetResponse;
  const payload = await response.json();
  expect(payload.ok).toBeTruthy();
});

test("E2E-22 settings admin auth and backup restore flow", async ({ page, request }) => {
  await resetRuntime(request);
  await request.post("/api/system/pre-exit", { data: {} });

  await openApp(page);
  await gotoSettings(page);

  const overlayOpen = page.locator("[data-testid='admin-tools-open-btn']");
  await expect(overlayOpen).toBeVisible();
  await overlayOpen.click();
  await expect(page.locator("[data-testid='admin-auth-modal']")).toBeVisible();
  await page.locator("[data-testid='admin-auth-input']").fill("wrong-password");
  await page.locator("[data-testid='admin-auth-submit']").click();
  await expect(page.locator(".settings-inline-error")).toContainText("비밀번호");
  await page.locator("[data-testid='admin-auth-input']").fill("q1w2e3r4!");
  await page.locator("[data-testid='admin-auth-submit']").click();
  await expect(page.locator("[data-testid='admin-overlay']")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-testid='admin-overlay']")).toBeHidden();

  await page.locator("[data-testid='settings-toc-dataBackup']").click();
  const restoreButtons = page.locator("[data-testid='backup-restore-btn']");
  await expect(restoreButtons.first()).toBeVisible();

  await queueDialogs(page, [
    { action: "accept" },
    { action: "accept", promptText: "RESTORE" },
  ]);

  const restoreResponse = page.waitForResponse((res) => res.url().includes("/api/backup/restore"));
  await restoreButtons.first().click();
  const response = await restoreResponse;
  const payload = await response.json();
  expect(payload.ok).toBeTruthy();
});
