import { expect, test } from "@playwright/test";
import { gotoCoreTab, openApp, resetRuntime } from "./helpers";

test("E2E-28 journal template apply, manual search, and threaded comments", async ({ page, request }) => {
  page.on("dialog", async (dialog) => {
    await dialog.accept();
  });

  await resetRuntime(request);
  await openApp(page, 1440, 900);
  await gotoCoreTab(page, "gallery");

  const headerName = `E2E 헤더 ${Date.now()}`;
  const templateName = `E2E 템플릿 ${Date.now()}`;
  const firstTitle = `E2E template post ${Date.now()}`;
  const secondTitle = `E2E plain post ${Date.now()}`;

  await page.locator(".journal-actions").getByRole("button", { name: /말머리|Headers/i }).click();
  const headerManager = page.getByTestId("journal-header-manager");
  await expect(headerManager).toBeVisible();
  await headerManager.getByRole("button", { name: /말머리 추가|Add Header/i }).click();
  const headerRow = headerManager.locator(".journal-manager-row").last();
  await headerRow.locator("input").first().fill(headerName);
  await headerManager.getByRole("button", { name: /^저장$|^Save$/i }).click();
  await expect(page.getByTestId("journal-header-manager")).toHaveCount(0);

  await page.locator(".journal-actions").getByRole("button", { name: /템플릿|Templates/i }).click();
  const templateManager = page.getByTestId("journal-template-manager");
  await expect(templateManager).toBeVisible();
  await templateManager.getByRole("button", { name: /템플릿 추가|Add Template/i }).click();
  const templateCard = templateManager.locator(".journal-template-manager-card").last();
  await templateCard.locator(".journal-manager-row").first().locator("input").first().fill(templateName);
  await templateCard.locator("select").nth(0).selectOption({ label: headerName });
  await templateCard.locator("textarea").fill("## E2E 템플릿\n- 기본 문장");
  await templateManager.getByRole("button", { name: /^저장$|^Save$/i }).click();
  await expect(page.getByTestId("journal-template-manager")).toHaveCount(0);

  await page.getByRole("button", { name: /글쓰기|Write/i }).click();
  let composer = page.getByTestId("journal-composer-modal");
  await expect(composer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(composer).toHaveCount(0);

  await page.getByRole("button", { name: /글쓰기|Write/i }).click();
  composer = page.getByTestId("journal-composer-modal");
  await expect(composer).toBeVisible();
  await composer.getByLabel(/템플릿|Template/i).selectOption({ label: templateName });
  const textarea = composer.locator(".journal-editor-textarea");
  await expect(textarea).toHaveValue(/E2E 템플릿/);
  await composer.getByRole("button", { name: /미리보기|Preview/i }).click();
  await expect(composer.locator(".journal-editor-preview")).toContainText("E2E 템플릿");
  await composer.getByRole("button", { name: /작성|Write/i }).click();
  await textarea.click();
  await textarea.press("End");
  await textarea.type("\n/next");
  await expect(composer.locator(".journal-slash-menu")).toBeVisible();
  await composer.locator(".journal-slash-item", { hasText: /next-action/i }).click();
  await expect(textarea).toHaveValue(/## 다음 액션/);
  await composer.getByLabel(/제목|Title/i).fill(firstTitle);
  await composer.locator(".journal-link-input-row input").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await composer.locator(".journal-link-input-row").getByRole("button", { name: /추가|Add/i }).click();
  await composer.getByRole("button", { name: /게시글 등록|Publish/i }).click();
  await expect(page.locator(".journal-board-row", { hasText: firstTitle }).first()).toBeVisible();

  await page.getByRole("button", { name: /글쓰기|Write/i }).click();
  await expect(composer).toBeVisible();
  await composer.getByLabel(/제목|Title/i).fill(secondTitle);
  await composer.locator(".journal-editor-textarea").fill("검색 버튼을 눌러야 보드가 바뀝니다.");
  await composer.getByRole("button", { name: /게시글 등록|Publish/i }).click();
  await expect(page.locator(".journal-board-row", { hasText: secondTitle }).first()).toBeVisible();

  const rowsBeforeSearch = await page.locator(".journal-board-row").count();
  await page.getByLabel(/검색어|Search/i).fill(firstTitle);
  await page.waitForTimeout(250);
  await expect(page.locator(".journal-board-row")).toHaveCount(rowsBeforeSearch);
  await page.getByRole("button", { name: /^검색$|^Search$/i }).click();
  await expect(page.locator(".journal-board-row")).toHaveCount(1);
  await expect(page.locator(".journal-board-row", { hasText: firstTitle })).toBeVisible();
  await expect(page.locator(".journal-board-row", { hasText: secondTitle })).toHaveCount(0);

  await page.getByRole("button", { name: /초기화|Reset/i }).click();
  await expect(page.locator(".journal-board-row", { hasText: secondTitle }).first()).toBeVisible();

  await page.locator(".journal-board-row", { hasText: firstTitle }).first().click();
  const detail = page.getByTestId("journal-detail-overlay");
  await expect(detail).toBeVisible();
  await expect(detail.locator(".journal-badge", { hasText: headerName })).toBeVisible();
  await expect(detail).toContainText("E2E 템플릿");
  await expect(detail.locator("iframe.journal-youtube-frame")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);

  await page.locator(".journal-board-row", { hasText: firstTitle }).first().click();
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: /수정|Edit/i }).click();
  await expect(detail).toHaveCount(0);
  composer = page.getByTestId("journal-composer-modal");
  await expect(composer).toBeVisible();
  await expect(composer.getByLabel(/제목|Title/i)).toHaveValue(firstTitle);
  await page.keyboard.press("Escape");
  await expect(composer).toHaveCount(0);

  await page.locator(".journal-board-row", { hasText: firstTitle }).first().click();
  await expect(detail).toBeVisible();

  await detail.locator(".journal-comment-write-box textarea").fill("상위 댓글");
  await detail.getByRole("button", { name: /댓글 등록|Post Comment/i }).click();
  const rootComment = detail.locator(".journal-comment-row", { hasText: "상위 댓글" }).first();
  await expect(rootComment).toBeVisible();
  await rootComment.getByRole("button", { name: /답글|Reply/i }).click();
  await detail.locator(".journal-comment-write-box textarea").fill("답글 내용");
  await detail.getByRole("button", { name: /댓글 등록|Post Comment/i }).click();
  await expect(detail.locator(".journal-comment-row", { hasText: "답글 내용" }).first()).toBeVisible();

  await rootComment.getByRole("button", { name: /삭제|Delete/i }).click();
  await expect(detail).toContainText(/삭제된 댓글입니다.|Deleted comment\./);
  await expect(detail.locator(".journal-comment-row", { hasText: "답글 내용" }).first()).toBeVisible();
});
