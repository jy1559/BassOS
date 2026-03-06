import { expect, test } from "@playwright/test";
import { gotoCoreTab, openApp, resetRuntime } from "./helpers";

test("E2E-25 global session pip timer is visible and draggable", async ({ page, request }) => {
  await resetRuntime(request);
  await request.post("/api/session/start", { data: {} });

  await openApp(page, 1366, 768);
  await gotoCoreTab(page, "dashboard");

  const pip = page.locator("[data-testid='global-session-pip']");
  await expect(pip).toBeVisible();
  await expect(page.locator("[data-testid='global-session-pip-stop']")).toBeVisible();

  const beforeBox = await pip.boundingBox();
  expect(beforeBox).not.toBeNull();
  if (!beforeBox) throw new Error("global session pip bounding box missing");

  await page.mouse.move(beforeBox.x + 24, beforeBox.y + 24);
  await page.mouse.down();
  await page.mouse.move(beforeBox.x - 120, beforeBox.y - 100, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const moved = await pip.boundingBox();
      return moved?.x ?? beforeBox.x;
    })
    .toBeLessThan(beforeBox.x - 60);

  await page.locator("[data-testid='global-session-pip-stop']").click();
  await expect(page.locator("[data-testid='global-stop-save']")).toBeVisible();
});
