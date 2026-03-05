import { expect, test } from "@playwright/test";
import { openApp, resetRuntimeFull } from "./helpers";

test("E2E-07 튜토리얼 완주 + 1회 보상 검증", async ({ page, request }) => {
  await resetRuntimeFull(request);
  const beforeHud = await request.get("/api/hud/summary");
  const beforeXp = (await beforeHud.json()).summary.total_xp as number;

  await openApp(page, 1280, 840);
  await page.locator("[data-testid='tutorial-help-btn']").click();

  const overlay = page.locator("[data-testid='tutorial-overlay']");
  const nextBtn = overlay.locator("button").filter({ hasText: /다음|Next/ });
  const finishBtn = overlay.locator("button").filter({ hasText: /완료|Finish/ });
  await expect(overlay).toBeVisible();

  for (let i = 0; i < 10; i += 1) {
    await nextBtn.click();
  }
  await finishBtn.click();
  await expect(overlay).toBeHidden();

  await expect(page.locator(".tutorial-title-chip")).toBeVisible();

  const afterHud = await request.get("/api/hud/summary");
  const afterXp = (await afterHud.json()).summary.total_xp as number;
  expect(afterXp - beforeXp).toBe(60);

  const secondComplete = await request.post("/api/tutorial/complete", { data: { campaign_id: "core_v1" } });
  const secondPayload = await secondComplete.json();
  expect(secondPayload.reward_granted).toBeFalsy();
  expect(secondPayload.xp_granted).toBe(0);
});
