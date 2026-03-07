import { expect, test } from "@playwright/test";
import { gotoCoreTab, openApp, resetRuntime } from "./helpers";

test("E2E-20 journal tag catalog management + free tags merge", async ({ page, request }) => {
  await resetRuntime(request);
  await openApp(page, 1366, 860);
  await gotoCoreTab(page, "gallery");

  const postTitle = `E2E tag catalog post ${Date.now()}`;
  const tagName = `e2e_tag_${Date.now()}`;

  await page.getByRole("button", { name: /글쓰기|Write/i }).click();
  const composer = page.getByTestId("journal-composer-modal");
  await expect(composer).toBeVisible();

  await composer.getByRole("button", { name: /태그 관리|Tags/i }).click();
  const manager = page.getByTestId("journal-tag-manager");
  await expect(manager).toBeVisible();

  await manager.getByRole("button", { name: /태그 추가|Add Tag/i }).click();
  const lastRow = manager.locator(".journal-manager-row").last();
  await lastRow.locator("input").nth(0).fill(tagName);
  await lastRow.locator("input").nth(1).fill("E2E");
  await manager.getByRole("button", { name: /^저장$|^Save$/i }).click();

  await expect(page.getByTestId("journal-tag-manager")).toHaveCount(0);
  await expect(composer).toBeVisible();

  const createdChip = composer.locator(".journal-select-tag", { hasText: tagName });
  await expect(createdChip).toBeVisible();
  await createdChip.click();

  await composer.getByLabel(/자유 태그|Free Tags/i).fill("alpha, beta");
  await composer.getByLabel(/제목|Title/i).fill(postTitle);
  await composer.getByRole("button", { name: /게시글 등록|Publish/i }).click();

  const row = page.locator(".journal-board-row", { hasText: postTitle }).first();
  await expect(row).toBeVisible();
  await row.click();

  const detail = page.getByTestId("journal-detail-overlay");
  await expect(detail).toBeVisible();
  await expect(detail.locator(".journal-badge", { hasText: tagName })).toBeVisible();
  await expect(detail.locator(".journal-badge", { hasText: "alpha" })).toBeVisible();
  await expect(detail.locator(".journal-badge", { hasText: "beta" })).toBeVisible();
  await detail.getByRole("button", { name: /닫기|Close/i }).click();

  await page.getByRole("button", { name: /글쓰기|Write/i }).click();
  await expect(composer).toBeVisible();
  await composer.getByRole("button", { name: /태그 관리|Tags/i }).click();
  await expect(manager).toBeVisible();

  const deleteRow = manager.locator(".journal-manager-row").last();
  await expect(deleteRow.locator("input").nth(0)).toHaveValue(tagName);
  await deleteRow.getByRole("button", { name: /삭제|Delete/i }).click();
  await manager.getByRole("button", { name: /^저장$|^Save$/i }).click();

  await expect(page.getByTestId("journal-tag-manager")).toHaveCount(0);
  await expect(composer.locator(".journal-select-tag", { hasText: tagName })).toHaveCount(0);
});
