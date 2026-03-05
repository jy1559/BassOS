import { expect, test, type Page } from "@playwright/test";
import { openApp, resetRuntime } from "./helpers";

async function openLibraryGroup(page: Page): Promise<void> {
  const libraryGroup = page
    .locator(".nav-subgroup", { has: page.locator(".nav-group-title", { hasText: /라이브러리|Library/i }) })
    .first();
  const classes = (await libraryGroup.getAttribute("class")) ?? "";
  if (!classes.includes("open")) {
    await libraryGroup.locator(".nav-group-toggle").click();
  }
}

async function openLibrarySongs(page: Page): Promise<void> {
  await openLibraryGroup(page);
  const libraryGroup = page
    .locator(".nav-subgroup", { has: page.locator(".nav-group-title", { hasText: /라이브러리|Library/i }) })
    .first();
  await libraryGroup.locator(".nav-btn").filter({ hasText: /곡|Songs/i }).first().click();
}

async function openLibraryRecommend(page: Page): Promise<void> {
  await openLibraryGroup(page);
  const libraryGroup = page
    .locator(".nav-subgroup", { has: page.locator(".nav-group-title", { hasText: /라이브러리|Library/i }) })
    .first();
  await libraryGroup.locator(".nav-btn").filter({ hasText: /추천곡|Recommend/i }).first().click();
}

test("E2E-13 song list columns and recommendation table hides ID column", async ({ page, request }) => {
  await resetRuntime(request);
  await openApp(page, 1366, 768);
  await openLibrarySongs(page);

  await page.locator(".song-round-btn").first().click();
  await page.locator(".song-toolbar-popover .ghost-btn").filter({ hasText: /리스트|List/i }).click();

  const songListTable = page.locator(".song-list-table");
  await expect(songListTable).toBeVisible();
  await expect(songListTable.locator("thead th")).toHaveCount(9);
  await expect(songListTable.locator("thead th").filter({ hasText: /노트|Notes/i })).toBeVisible();
  await expect(songListTable.locator("col.song-col-note")).toHaveCount(1);
  await expect(songListTable.locator("col.song-col-session")).toHaveCount(1);
  await expect(songListTable.locator("col.song-col-actions")).toHaveCount(1);

  await openLibraryRecommend(page);

  const recommendHeaders = page.locator(".recommend-table thead th");
  await expect(recommendHeaders.filter({ hasText: /^ID$/ })).toHaveCount(0);
});

