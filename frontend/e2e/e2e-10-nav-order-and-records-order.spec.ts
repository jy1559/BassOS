import { expect, test, type Page } from "@playwright/test";
import { openApp, resetRuntime } from "./helpers";

async function openRecordsGroup(page: Page): Promise<void> {
  const recordsGroup = page
    .locator(".nav-subgroup", { has: page.locator(".nav-group-title", { hasText: /기록|Records/i }) })
    .first();
  const classes = (await recordsGroup.getAttribute("class")) ?? "";
  if (!classes.includes("open")) {
    await recordsGroup.locator(".nav-group-toggle").click();
  }
}

test("E2E-10 sidebar group order and records tab order", async ({ page, request }) => {
  await resetRuntime(request);
  await openApp(page, 1366, 768);

  const titles = (await page.locator(".nav-subgroup .nav-group-title").allTextContents()).map((item) => item.trim());
  expect(titles.length).toBeGreaterThanOrEqual(4);
  expect(titles[0]).toMatch(/도전|Challenges?/i);
  expect(titles[1]).toMatch(/라이브러리|Library/i);
  expect(titles[2]).toMatch(/연습 도구|Practice Tools/i);
  expect(titles[3]).toMatch(/기록|Records/i);

  await openRecordsGroup(page);

  const recordsButtons = page
    .locator(".nav-subgroup", { has: page.locator(".nav-group-title", { hasText: /기록|Records/i }) })
    .first()
    .locator(".nav-btn");
  const tabTexts = (await recordsButtons.allTextContents()).map((item) => item.trim());
  expect(tabTexts.length).toBeGreaterThanOrEqual(3);
  expect(tabTexts[0]).toMatch(/돌아보기|Review/i);
  expect(tabTexts[1]).toMatch(/XP/i);
  expect(tabTexts[2]).toMatch(/세션|Sessions?/i);
});

