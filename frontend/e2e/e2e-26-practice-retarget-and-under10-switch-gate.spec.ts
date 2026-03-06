import { expect, test } from "@playwright/test";
import { gotoCoreTab, openApp, resetRuntime } from "./helpers";

function toLocalIso(date: Date): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
}

test("E2E-26 None session retargets and under-10 switch opens custom gate", async ({ page, request }) => {
  await resetRuntime(request);
  const underTenStartAt = toLocalIso(new Date(Date.now() - 3 * 60 * 1000));
  await request.post("/api/session/start", {
    data: {
      activity: "Etc",
      sub_activity: "Etc",
      start_at: underTenStartAt,
    },
  });

  const beforeSummary = await request.get("/api/hud/summary");
  const beforeJson = await beforeSummary.json();
  const sessionId = String(beforeJson.summary.active_session.session_id || "");
  expect(sessionId).not.toBe("");

  await openApp(page, 1366, 768);
  await gotoCoreTab(page, "practice");
  const collapsedStart = page.locator("[data-testid='practice-start-collapsed']");
  if (await collapsedStart.isVisible()) {
    await page.getByRole("button", { name: /열기|expand/i }).first().click();
  }

  const songSelect = page.locator("label:has-text('곡 검색') select");
  const songIds = await songSelect
    .locator("option")
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value).filter((value) => Boolean(value)));
  expect(songIds.length).toBeGreaterThan(0);
  const firstSongId = String(songIds[0]);

  await songSelect.selectOption(firstSongId);
  await expect
    .poll(async () => {
      const res = await request.get("/api/hud/summary");
      const json = await res.json();
      const active = json.summary.active_session || {};
      return `${active.session_id}|${active.song_library_id}|${active.drill_id || ""}`;
    })
    .toBe(`${sessionId}|${firstSongId}|`);

  if (songIds.length > 1) {
    const secondSongId = String(songIds[1]);
    await songSelect.selectOption(secondSongId);
  } else {
    const reopenStart = page.getByRole("button", { name: /열기|expand/i }).first();
    if (await reopenStart.isVisible()) {
      await reopenStart.click();
    }
    await page.getByRole("button", { name: /드릴 연습|drill practice/i }).click();
    const drillSelect = page.locator("label:has-text('드릴 검색') select");
    const drillIds = await drillSelect
      .locator("option")
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value).filter((value) => Boolean(value)));
    expect(drillIds.length).toBeGreaterThan(0);
    await drillSelect.selectOption(String(drillIds[0]));
  }
  await expect(page.locator("[data-testid='studio-switch-under10-discard']")).toBeVisible();
  await page.locator("[data-testid='studio-switch-under10-close']").click();

  await expect
    .poll(async () => {
      const res = await request.get("/api/hud/summary");
      const json = await res.json();
      const active = json.summary.active_session || {};
      return `${active.session_id}|${active.song_library_id}`;
    })
    .toBe(`${sessionId}|${firstSongId}`);
});
