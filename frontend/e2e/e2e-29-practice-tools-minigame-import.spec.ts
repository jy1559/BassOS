import { expect, test, type Page } from "@playwright/test";
import { openApp, resetRuntime } from "./helpers";

async function openToolsView(page: Page, label: RegExp): Promise<void> {
  const toolsGroup = page
    .locator(".nav-subgroup", { has: page.locator(".nav-group-title", { hasText: /연습 도구|Practice Tools/i }) })
    .first();
  if (!(await toolsGroup.getAttribute("class"))?.includes("open")) {
    await toolsGroup.locator(".nav-group-toggle").click();
  }
  await toolsGroup.getByRole("button", { name: label }).click();
}

test("E2E-29 practice tools keeps minigame, theory, and popup settings aligned", async ({ page, request }) => {
  await resetRuntime(request);
  await request.post("/api/minigame/records", {
    data: {
      game: "FBH",
      mode: "CHALLENGE",
      difficulty: "NORMAL",
      score: 321,
      accuracy: 97.5,
      seed: "2026-03-01",
      duration_sec: 120,
      share_text: "FBH|CHALLENGE|NORMAL|SCORE=321|SEED=2026-03-01",
      detail_json: { hits: 32, attempts: 33, judge: "PC_RANGE" },
    },
  });

  await openApp(page, 1366, 768);
  await openToolsView(page, /미니게임|Mini Game/i);
  await expect(page.locator("[data-testid='mg-game-hub']")).toBeVisible();

  await page.locator("[data-testid='mg-enter-game-FBH']").click();
  await expect(page.locator("[data-testid='mg-page']")).toBeVisible();
  await expect(page.locator("[data-testid='mg-lb-item-1']")).toContainText("321");

  await page.setViewportSize({ width: 1366, height: 480 });
  await page.getByRole("button", { name: /연습 도구 설정|Practice Tool Settings/i }).click();
  const modal = page.locator(".practice-tools-modal-card");
  await expect(modal).toBeVisible();
  const modalBefore = await modal.boundingBox();
  const modalHead = page.locator(".practice-tools-modal-head");
  const headBefore = await modalHead.boundingBox();
  if (!modalBefore || !headBefore) {
    throw new Error("Practice tools settings modal did not render with a measurable bounding box.");
  }
  await page.mouse.move(headBefore.x + 48, headBefore.y + 28);
  await page.mouse.down();
  await page.mouse.move(headBefore.x + 168, headBefore.y + 72, { steps: 10 });
  await page.mouse.up();
  const modalAfterDrag = await modal.boundingBox();
  expect(modalAfterDrag).not.toBeNull();
  expect(Math.abs((modalAfterDrag?.x ?? modalBefore.x) - modalBefore.x)).toBeGreaterThan(40);

  await expect(page.locator("[data-testid='mg-settings-page']")).toBeVisible();
  const modalBody = page.locator("[data-testid='practice-tools-modal-body']");
  const modalScrollState = await modalBody.evaluate((node) => {
    const style = window.getComputedStyle(node);
    return {
      overflowY: style.overflowY,
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
    };
  });
  expect(["auto", "scroll"]).toContain(modalScrollState.overflowY);
  expect(modalScrollState.scrollHeight).toBeGreaterThanOrEqual(modalScrollState.clientHeight);
  const modalViewport = page.viewportSize();
  const modalAfterOpen = await modal.boundingBox();
  expect(modalAfterOpen).not.toBeNull();
  expect((modalAfterOpen?.y ?? 0) + (modalAfterOpen?.height ?? 0)).toBeLessThanOrEqual((modalViewport?.height ?? 0) - 8);
  const scaleSpreadInput = page.locator("[data-testid='mg-theory-scale-spread-number']").first();
  await scaleSpreadInput.fill("180");
  await page.getByRole("button", { name: "설정 저장" }).click();
  await page.locator(".practice-tools-modal-head .ghost-btn").click();

  await page.setViewportSize({ width: 1366, height: 768 });
  await openToolsView(page, /이론·코드·스케일|Theory/i);
  await expect(page.locator("[data-testid='mg-theory-page']")).toBeVisible();
  const contentOverflow = await page.locator(".content").evaluate((node) => node.scrollHeight - node.clientHeight);
  expect(contentOverflow).toBeLessThanOrEqual(20);
  const theoryBoard = page.locator(".mg-theory-bottom canvas").first();
  const theoryStaff = page.locator(".mg-theory-staff").first();
  const boardBox = await theoryBoard.boundingBox();
  const staffBox = await theoryStaff.boundingBox();
  expect(boardBox).not.toBeNull();
  expect(staffBox).not.toBeNull();
  expect((boardBox?.height ?? 0)).toBeGreaterThanOrEqual(150);
  expect((boardBox?.height ?? 0)).toBeGreaterThan((staffBox?.height ?? 0));
  await page.getByRole("button", { name: "연습 도구 설정" }).first().click();
  await expect(page.locator("[data-testid='mg-settings-page']")).toBeVisible();
  await expect(page.locator("[data-testid='mg-theory-scale-spread-number']").first()).toHaveValue("180");
});
