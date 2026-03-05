import { expect, test } from "@playwright/test";
import { gotoCoreTab, openApp, resetRuntime } from "./helpers";

test("E2E-08 Practice Studio session stop/save works in-place", async ({ page, request }) => {
  await resetRuntime(request);
  await request.post("/api/session/start", {
    data: { activity: "Song", sub_activity: "SongPractice", title: "studio stop test" },
  });

  await openApp(page);
  await gotoCoreTab(page, "practice");

  const stopResponsePromise = page.waitForResponse(
    (res) => res.url().includes("/api/session/stop") && res.request().method() === "POST"
  );
  await page.locator("[data-testid='studio-stop-session']").click();
  await page.locator("[data-testid='studio-stop-save']").click();
  const stopRes = await stopResponsePromise;
  const payload = await stopRes.json();

  expect(payload.ok).toBeTruthy();
  expect(payload.event?.event_type).toBe("SESSION");
  await expect(page.locator(".practice-studio-page")).toBeVisible();
});

