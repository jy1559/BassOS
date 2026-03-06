import { expect, test, type APIRequestContext } from "@playwright/test";
import { gotoCoreTab, openApp, resetRuntime } from "./helpers";

async function pickTargetSession(request: APIRequestContext): Promise<{
  payload: Record<string, string>;
  expectedActivity: "Song" | "Drill";
}> {
  const catalogsRes = await request.get("/api/catalogs");
  const catalogs = await catalogsRes.json();

  const firstSong = (catalogs.song_library as Array<Record<string, string>>).find((item) => String(item.library_id || "").trim());
  if (firstSong?.library_id) {
    return {
      payload: {
        activity: "Song",
        sub_activity: "SongPractice",
        song_library_id: firstSong.library_id,
      },
      expectedActivity: "Song",
    };
  }

  const drillPool = [
    ...(catalogs.drills as Array<Record<string, string>>),
    ...(catalogs.drill_library as Array<Record<string, string>>),
  ];
  const firstDrill = drillPool.find((item) => String(item.drill_id || "").trim());
  expect(firstDrill?.drill_id).toBeTruthy();
  return {
    payload: {
      activity: "Drill",
      sub_activity: "Core",
      drill_id: String(firstDrill?.drill_id || ""),
    },
    expectedActivity: "Drill",
  };
}

test("E2E-24 practice start panel is collapsed when active session has target", async ({ page, request }) => {
  await resetRuntime(request);
  const target = await pickTargetSession(request);

  await request.post("/api/session/start", {
    data: target.payload,
  });

  await openApp(page, 1366, 768);
  await gotoCoreTab(page, "practice");
  await expect(page.locator("[data-testid='practice-start-collapsed']")).toBeVisible();
});

test("E2E-24 practice start panel is collapsed when active session has no target", async ({ page, request }) => {
  await resetRuntime(request);
  await request.post("/api/session/start", { data: {} });

  await openApp(page, 1366, 768);
  await gotoCoreTab(page, "practice");
  await expect(page.locator("[data-testid='practice-start-collapsed']")).toBeVisible();
});

test("E2E-24 stop modal defaults to None when session started without target", async ({ page, request }) => {
  await resetRuntime(request);
  await request.post("/api/session/start", { data: {} });

  await openApp(page, 1366, 768);
  await gotoCoreTab(page, "dashboard");
  await page.locator("[data-testid='dashboard-stop-session']").click();
  await page.locator("[data-testid='dashboard-stop-detail-toggle']").click();
  await expect(page.locator("[data-testid='dashboard-stop-activity']")).toHaveValue("None");
});

test("E2E-24 stop modal keeps target activity default when session started with target", async ({ page, request }) => {
  await resetRuntime(request);
  const target = await pickTargetSession(request);

  await request.post("/api/session/start", {
    data: target.payload,
  });

  await openApp(page, 1366, 768);
  await gotoCoreTab(page, "dashboard");
  await page.locator("[data-testid='dashboard-stop-session']").click();
  await page.locator("[data-testid='dashboard-stop-detail-toggle']").click();
  await expect(page.locator("[data-testid='dashboard-stop-activity']")).toHaveValue(target.expectedActivity);
});
