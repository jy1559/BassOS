import { expect, test } from "@playwright/test";
import { gotoCoreTab, openApp, resetRuntime } from "./helpers";

test("E2E-25 global session pip timer is visible and corner can change", async ({ page, request }) => {
  await resetRuntime(request);
  await request.post("/api/session/start", { data: {} });

  await openApp(page, 1366, 768);
  await gotoCoreTab(page, "dashboard");

  const pip = page.locator("[data-testid='global-session-pip']");
  await expect(pip).toBeVisible();
  await expect(page.locator("[data-testid='global-session-pip-stop']")).toBeVisible();

  const beforeClass = await pip.getAttribute("class");
  await pip.getByRole("button", { name: /위치|Corner/i }).click();
  await expect
    .poll(async () => await pip.getAttribute("class"))
    .not.toBe(beforeClass);

  await page.locator("[data-testid='global-session-pip-stop']").click();
  await expect(page.locator("[data-testid='global-stop-save']")).toBeVisible();
});
