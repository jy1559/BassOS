import { expect, test } from "@playwright/test";
import { gotoRecordTab, openApp, resetRuntime } from "./helpers";

test("E2E-04 세션 삭제 시 XP/HUD/통계 역반영", async ({ page, request }) => {
  await resetRuntime(request);
  const noteKey = `E2E_DELETE_${Date.now()}`;
  const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 20 * 60 * 1000);

  await request.post("/api/session/quick-log", {
    data: {
      activity: "Song",
      sub_activity: "SongPractice",
      tags: ["E2E", "DELETE"],
      notes: noteKey,
      start_at: start.toISOString().slice(0, 19),
      end_at: end.toISOString().slice(0, 19),
      duration_min: 20,
    },
  });

  const beforeHud = await (await request.get("/api/hud/summary")).json();
  const beforeStats = await (await request.get("/api/stats/overview")).json();

  await openApp(page);
  await gotoRecordTab(page, "sessions");

  const row = page.locator("tbody tr", { hasText: noteKey }).first();
  await expect(row).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  const deleteResponsePromise = page.waitForResponse(
    (res) => res.url().includes("/api/sessions/") && res.request().method() === "DELETE"
  );
  await row.locator("button.danger-border").first().click();
  await deleteResponsePromise;

  await expect(page.locator("tbody tr", { hasText: noteKey })).toHaveCount(0);

  const afterHud = await (await request.get("/api/hud/summary")).json();
  const afterStats = await (await request.get("/api/stats/overview")).json();

  expect(afterHud.summary.total_xp).toBeLessThan(beforeHud.summary.total_xp);
  expect(afterStats.stats.summary.sessions_count).toBeLessThan(beforeStats.stats.summary.sessions_count);
});
