import { expect, test } from "@playwright/test";
import { gotoCoreTab, openApp, resetRuntime } from "./helpers";

test("E2E-01 Dashboard 1000x700 반응형 + 세션 저장 모달 접근", async ({ page, request }) => {
  await resetRuntime(request);
  await request.post("/api/session/start", {
    data: { activity: "Song", sub_activity: "SongPractice" },
  });

  await openApp(page, 1000, 700);
  await gotoCoreTab(page, "dashboard");

  await expect(page.locator(".dashboard-grid")).toBeVisible();
  await expect(page.locator(".dashboard-grid .card").first()).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(hasHorizontalOverflow).toBeFalsy();

  await page.locator("[data-testid='dashboard-stop-session']").click();
  await expect(page.locator(".modal")).toBeVisible();
  await expect(page.locator(".modal .modal-actions")).toBeVisible();
});

