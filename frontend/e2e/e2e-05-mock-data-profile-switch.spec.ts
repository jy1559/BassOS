import { expect, test, type Page } from "@playwright/test";
import { gotoSettings, openApp, resetRuntime } from "./helpers";

async function unlockAdminTools(page: Page): Promise<void> {
  await page.locator("[data-testid='settings-toc-misc']").click();
  await page.locator("[data-testid='admin-tools-open-btn']").click();
  await expect(page.locator("[data-testid='admin-auth-modal']")).toBeVisible();
  await page.locator("[data-testid='admin-auth-input']").fill("q1w2e3r4!");
  await page.locator("[data-testid='admin-auth-submit']").click();
  await expect(page.locator("[data-testid='admin-overlay']")).toBeVisible();
}

test("E2E-05 모의데이터 샌드박스 전환 + 실데이터 복귀", async ({ page, request }) => {
  await resetRuntime(request);
  await openApp(page);
  await gotoSettings(page);
  await unlockAdminTools(page);

  const datasetSelect = page.locator("[data-testid='mock-dataset-select']");
  await expect(datasetSelect).toBeVisible();
  let options = datasetSelect.locator("option");
  let optionCount = await options.count();

  if (optionCount <= 1) {
    const datasetId = `e2e_snapshot_${Date.now()}`;
    const exportRes = await request.post("/api/admin/mock-data/export-current", {
      data: {
        dataset_id: datasetId,
        generate_sessions_60d: true,
        session_days: 60,
      },
    });
    const exportPayload = await exportRes.json();
    expect(exportPayload.ok).toBeTruthy();
    await page.reload();
    await gotoSettings(page);
    await unlockAdminTools(page);
    await expect(datasetSelect).toBeVisible();
    options = datasetSelect.locator("option");
    optionCount = await options.count();
  }

  expect(optionCount).toBeGreaterThan(1);

  const datasetValue = await options.nth(1).getAttribute("value");
  expect(datasetValue).toBeTruthy();
  await datasetSelect.selectOption(datasetValue || "");

  const activateResponsePromise = page.waitForResponse((res) => res.url().includes("/api/admin/mock-data/activate"));
  await page.locator("[data-testid='mock-activate-btn']").click();
  const activateRes = await activateResponsePromise;
  const activatePayload = await activateRes.json();
  expect(activatePayload.ok).toBeTruthy();
  expect(activatePayload.profile).toBe("mock");

  const marker = `MOCK_PROFILE_NOTE_${Date.now()}`;
  await request.post("/api/session/quick-log", {
    data: {
      activity: "Song",
      sub_activity: "SongPractice",
      tags: ["E2E", "MOCK"],
      notes: marker,
      start_at: "2026-02-10T09:00:00",
      end_at: "2026-02-10T09:10:00",
      duration_min: 10,
    },
  });
  const mockSessions = await (await request.get("/api/sessions?limit=1000")).json();
  expect(mockSessions.sessions.some((row: { notes?: string }) => String(row.notes || "").includes(marker))).toBeTruthy();

  await request.post("/api/onboarding/complete", {
    data: {
      nickname: "E2E Player",
      weekly_goal_sessions: 3,
      theme: "studio",
      language: "ko",
      audio_enabled: false,
    },
  });
  await page.reload();
  await gotoSettings(page);
  await unlockAdminTools(page);
  await expect(datasetSelect).toBeVisible();

  const deactivateResponsePromise = page.waitForResponse((res) => res.url().includes("/api/admin/mock-data/deactivate"));
  await expect(page.locator("[data-testid='mock-deactivate-btn']")).toBeEnabled();
  await page.locator("[data-testid='mock-deactivate-btn']").click();
  const deactivateRes = await deactivateResponsePromise;
  const deactivatePayload = await deactivateRes.json();
  expect(deactivatePayload.ok).toBeTruthy();
  expect(deactivatePayload.profile).toBe("real");

  const status = await (await request.get("/api/admin/mock-data/status")).json();
  expect(status.profile).toBe("real");
  expect(status.dataset_id).toBeNull();

  const realSessions = await (await request.get("/api/sessions?limit=1000")).json();
  expect(realSessions.sessions.some((row: { notes?: string }) => String(row.notes || "").includes(marker))).toBeFalsy();
});
