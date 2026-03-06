import { expect, test } from "@playwright/test";
import { gotoCoreTab, openApp, resetRuntime } from "./helpers";

test("E2E-03 세션 종료 저장 + 코치 메시지 + Next Win 갱신", async ({ page, request }) => {
  await resetRuntime(request);
  await request.post("/api/session/start", {
    data: { activity: "Song", sub_activity: "SongPractice" },
  });

  await openApp(page);
  await gotoCoreTab(page, "dashboard");
  await page.locator("[data-testid='dashboard-stop-session']").click();

  const stopResponsePromise = page.waitForResponse(
    (res) => res.url().includes("/api/session/stop") && res.request().method() === "POST"
  );
  const startRaw = await page.locator("[data-testid='dashboard-stop-start-at']").inputValue();
  const startDate = new Date(startRaw);
  if (!Number.isNaN(startDate.getTime())) {
    const endDate = new Date(startDate.getTime() + 12 * 60 * 1000);
    const yyyy = endDate.getFullYear();
    const mm = String(endDate.getMonth() + 1).padStart(2, "0");
    const dd = String(endDate.getDate()).padStart(2, "0");
    const hh = String(endDate.getHours()).padStart(2, "0");
    const mi = String(endDate.getMinutes()).padStart(2, "0");
    await page.locator("[data-testid='dashboard-stop-end-at']").fill(`${yyyy}-${mm}-${dd}T${hh}:${mi}`);
  }
  await page.locator("[data-testid='dashboard-stop-save']").click();
  const stopRes = await stopResponsePromise;
  const payload = await stopRes.json();

  expect(payload.ok).toBeTruthy();
  expect(typeof payload.coach_message).toBe("string");
  expect(payload.coach_message.length).toBeGreaterThan(0);
  expect(typeof payload.next_win_hint).toBe("string");

  const nextWinCard = page.locator("[data-testid='dashboard-next-win']");
  await expect(nextWinCard).toBeVisible();
  await expect(nextWinCard).toContainText("XP");
  if (payload.next_win_hint) {
    await expect(nextWinCard).toContainText(payload.next_win_hint.slice(0, 6));
  }
});
