import { expect, test } from "@playwright/test";
import { gotoCoreTab, openApp, resetRuntime } from "./helpers";

test("E2E-20 journal tag catalog management + free tags merge", async ({ page, request }) => {
  await resetRuntime(request);
  await openApp(page, 1366, 768);
  await gotoCoreTab(page, "gallery");
  const postTitle = `E2E tag catalog post ${Date.now()}`;

  await page.getByRole("button", { name: /글쓰기|Write/i }).click();
  await expect(page.locator("[data-testid='tutorial-journal-composer']")).toBeVisible();

  await page.getByRole("button", { name: /태그 관리|Manage Tags/i }).click();
  const manager = page.locator("[data-testid='journal-tag-manager']");
  await expect(manager).toBeVisible();

  const tagName = `e2e_tag_${Date.now()}`;
  await manager.getByLabel(/새 태그|New Tag/i).fill(tagName);
  await manager.getByLabel(/카테고리|Category/i).fill("E2E");
  await manager.getByRole("button", { name: /태그 추가|Add Tag/i }).click();
  await manager.getByRole("button", { name: /^저장$|^Save$/i }).click();

  const composer = page.locator("[data-testid='tutorial-journal-composer']");
  await expect(composer).toBeVisible();
  const showTagsBtn = composer.getByRole("button", { name: /태그 열기|Show Tags/i });
  if (await showTagsBtn.count()) {
    await showTagsBtn.first().click();
  }
  await composer.evaluate((root) => {
    const toggles = Array.from(root.querySelectorAll<HTMLButtonElement>(".journal-tag-category-toggle"));
    toggles.forEach((button) => {
      if (button.textContent?.includes("▸")) button.click();
    });
  });
  const createdChip = page.locator(".journal-select-tag", { hasText: tagName });
  await expect(createdChip).toBeVisible();
  await createdChip.click();

  await composer.locator(".journal-tag-catalog-box input").last().fill("alpha,beta");
  await composer.getByLabel(/제목|Title/i).fill(postTitle);
  await page.getByRole("button", { name: /게시글 등록|Publish/i }).click();

  await expect(page.getByText(postTitle).first()).toBeVisible();
  await expect(page.locator(".gallery-tags .achievement-chip", { hasText: tagName })).toBeVisible();
  await expect(page.locator(".gallery-tags .achievement-chip", { hasText: "alpha" }).first()).toBeVisible();
  await expect(page.locator(".gallery-tags .achievement-chip", { hasText: "beta" }).first()).toBeVisible();

  await page.getByRole("button", { name: /글쓰기|Write/i }).click();
  await page.getByRole("button", { name: /태그 관리|Manage Tags/i }).click();
  await expect(manager).toBeVisible();

  const deleted = await manager.evaluate((root, name) => {
    const rows = Array.from(root.querySelectorAll(".journal-tag-edit-row"));
    for (const row of rows) {
      const input = row.querySelector("input");
      if (!input) continue;
      if ((input as HTMLInputElement).value.trim() !== name) continue;
      const deleteBtn = row.querySelector("button");
      if (!deleteBtn) return false;
      (deleteBtn as HTMLButtonElement).click();
      return true;
    }
    return false;
  }, tagName);
  expect(deleted).toBeTruthy();
  await manager.getByRole("button", { name: /^저장$|^Save$/i }).click();

  await expect(page.locator(".journal-select-tag", { hasText: tagName })).toHaveCount(0);
});
