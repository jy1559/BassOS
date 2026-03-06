import { expect, test } from "@playwright/test";
import { gotoCoreTab, openApp, resetRuntime } from "./helpers";

async function ensureStopEditorVisible(page: import("@playwright/test").Page, prefix: "dashboard" | "studio"): Promise<void> {
  const startAtInput = page.locator(`[data-testid='${prefix}-stop-start-at']`);
  if (await startAtInput.isVisible()) return;
  const setTimeBtn = page.getByRole("button", { name: /시간 지정|Set Time/i }).first();
  if (await setTimeBtn.isVisible()) {
    await setTimeBtn.click();
  }
  await expect(startAtInput).toBeVisible();
}

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
  await ensureStopEditorVisible(page, "studio");
  const startRaw = await page.locator("[data-testid='studio-stop-start-at']").inputValue();
  const startDate = new Date(startRaw);
  if (!Number.isNaN(startDate.getTime())) {
    const endDate = new Date(startDate.getTime() + 12 * 60 * 1000);
    const yyyy = endDate.getFullYear();
    const mm = String(endDate.getMonth() + 1).padStart(2, "0");
    const dd = String(endDate.getDate()).padStart(2, "0");
    const hh = String(endDate.getHours()).padStart(2, "0");
    const mi = String(endDate.getMinutes()).padStart(2, "0");
    await page.locator("[data-testid='studio-stop-end-at']").fill(`${yyyy}-${mm}-${dd}T${hh}:${mi}`);
  }
  await page.locator("[data-testid='studio-stop-save']").click();
  const stopRes = await stopResponsePromise;
  const payload = await stopRes.json();

  expect(payload.ok).toBeTruthy();
  expect(payload.event?.event_type).toBe("SESSION");
  await expect(page.locator(".practice-studio-page")).toBeVisible();
});
