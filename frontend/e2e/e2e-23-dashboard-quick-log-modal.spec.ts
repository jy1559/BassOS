import { expect, test } from "@playwright/test";
import { gotoCoreTab, openApp, resetRuntime } from "./helpers";

test("E2E-23 dashboard quick log modal supports esc/backdrop/enter and none mapping", async ({ page, request }) => {
  await resetRuntime(request);
  await openApp(page, 1366, 768);
  await gotoCoreTab(page, "dashboard");

  const quickOpen = page.locator("[data-testid='dashboard-quick-log-open']");
  const modal = page.locator("[data-testid='dashboard-quick-log-modal']");
  const backdrop = page.locator("[data-testid='dashboard-quick-log-backdrop']");

  const beforeRows = await request.get("/api/sessions?limit=200");
  const beforeSessions = (await beforeRows.json()).sessions as Array<Record<string, unknown>>;
  const beforeCount = beforeSessions.length;

  await quickOpen.click();
  await expect(modal).toBeVisible();
  await expect(page.locator("[data-testid='dashboard-quick-log-duration-10']")).toHaveClass(/active-mini/);
  await expect(page.locator("[data-testid='dashboard-quick-log-target']")).toHaveValue("none");
  await expect(page.locator("[data-testid='dashboard-quick-log-detail']")).toHaveValue("none");

  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  const afterEscRows = await request.get("/api/sessions?limit=200");
  const afterEscSessions = (await afterEscRows.json()).sessions as Array<Record<string, unknown>>;
  expect(afterEscSessions.length).toBe(beforeCount);

  await quickOpen.click();
  await expect(modal).toBeVisible();
  await backdrop.click({ position: { x: 4, y: 4 } });
  await expect(modal).toBeHidden();

  await quickOpen.click();
  await expect(modal).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(modal).toBeHidden();

  await expect
    .poll(async () => {
      const response = await request.get("/api/sessions?limit=200");
      const rows = (await response.json()).sessions as Array<Record<string, unknown>>;
      return rows.length;
    })
    .toBe(beforeCount + 1);

  const latestRows = await request.get("/api/sessions?limit=1");
  const latest = ((await latestRows.json()).sessions as Array<Record<string, unknown>>)[0];
  expect(latest.activity).toBe("Etc");
  expect(latest.sub_activity).toBe("Etc");
});
