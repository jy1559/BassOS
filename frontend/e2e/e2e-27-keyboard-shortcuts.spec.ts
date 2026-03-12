import { expect, test } from "@playwright/test";
import { gotoSettings, openApp, resetRuntime } from "./helpers";

test("E2E-27 keyboard shortcuts remap persists and PiP shortcuts work", async ({ page, request }) => {
  await resetRuntime(request);
  const startedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  await request.post("/api/session/start", {
    data: {
      activity: "Etc",
      sub_activity: "Etc",
      start_at: startedAt,
    },
  });

  await openApp(page, 1366, 820);

  await gotoSettings(page);
  await page.locator("[data-testid='settings-toc-keyboard']").click();
  const keyboardSection = page.locator("[data-testid='settings-section-keyboard']");
  await expect(keyboardSection).toBeVisible();

  await page.locator("[data-testid='keyboard-shortcut-change-metronome_toggle']").click();
  await page.keyboard.press("KeyY");
  await expect(page.locator("[data-testid='keyboard-shortcut-row-metronome_toggle'] .settings-shortcut-binding")).toContainText("Y");

  await page.reload();
  await expect(page.locator(".app-root")).toBeVisible();

  await page.keyboard.press("Alt+2");
  const metronomeDockToggle = page.locator(".metronome-inline.embedded .metronome-toggle").first();
  await metronomeDockToggle.click();
  const metronomeAction = page.locator("[data-testid='studio-metronome-toggle']");
  await expect(metronomeAction).toBeVisible();

  await page.keyboard.press("KeyY");
  await expect(metronomeAction).toContainText(/정지|Stop/i);
  await page.keyboard.press("KeyY");
  await expect(metronomeAction).toContainText(/시작|Start/i);

  await page.keyboard.press("Alt+1");
  const pip = page.locator("[data-testid='global-session-pip']");
  await expect(pip).toBeVisible();
  await expect(page.locator("[data-testid='global-metronome-pip-inline']")).toBeVisible();

  await page.keyboard.press("KeyC");
  await expect(page.locator("[data-testid='global-metronome-pip-inline']")).toHaveCount(0);
  await page.keyboard.press("KeyC");
  await expect(page.locator("[data-testid='global-metronome-pip-inline']")).toBeVisible();

  await page.keyboard.press("KeyS");
  await expect(page.locator(".practice-page-shell.active")).toBeVisible();
  await expect(page.locator("[data-testid='global-session-pip']")).toHaveCount(0);
});
