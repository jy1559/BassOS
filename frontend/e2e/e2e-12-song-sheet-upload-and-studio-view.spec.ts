import { expect, test, type Page } from "@playwright/test";
import { gotoCoreTab, openApp, resetRuntime } from "./helpers";

async function openLibrarySongs(page: Page): Promise<void> {
  const libraryGroup = page
    .locator(".nav-subgroup", { has: page.locator(".nav-group-title", { hasText: /라이브러리|Library/i }) })
    .first();
  const classes = (await libraryGroup.getAttribute("class")) ?? "";
  if (!classes.includes("open")) {
    await libraryGroup.locator(".nav-group-toggle").click();
  }
  await libraryGroup.locator(".nav-btn").filter({ hasText: /곡|Songs/i }).first().click();
}

test("E2E-12 song sheet upload and studio score tabs + zoom", async ({ page, request }) => {
  await resetRuntime(request);
  await openApp(page, 1366, 768);
  await openLibrarySongs(page);

  await page.locator("[data-testid='tutorial-songs-add-btn']").click();
  const modal = page.locator("[data-testid='tutorial-songs-create-form']");
  await expect(modal).toBeVisible();

  await modal.locator("input").first().fill("E2E Score Song");

  const pdfBuffer = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF", "utf-8");
  await modal.locator("[data-testid='song-score-pdf-input']").setInputFiles({
    name: "score.pdf",
    mimeType: "application/pdf",
    buffer: pdfBuffer,
  });

  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2rL8sAAAAASUVORK5CYII=";
  const pngBuffer = Buffer.from(pngBase64, "base64");
  await modal.locator("[data-testid='song-score-image-input']").setInputFiles([
    { name: "sheet-1.png", mimeType: "image/png", buffer: pngBuffer },
    { name: "sheet-2.png", mimeType: "image/png", buffer: pngBuffer },
  ]);

  await page.evaluate((base64: string) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const blob = new Blob([bytes], { type: "image/png" });
    const clipboard = {
      read: async () => [
        {
          types: ["image/png"],
          getType: async () => blob,
        },
      ],
    };
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: clipboard,
    });
  }, pngBase64);
  await modal.locator("[data-testid='song-score-paste-btn']").click();

  await modal.locator(".modal-actions .primary-btn").click();
  await expect(modal).toBeHidden();

  await gotoCoreTab(page, "practice");
  const nextStepBtn = page.locator("button").filter({ hasText: /다음 단계|Next/i }).first();
  if (await nextStepBtn.isVisible()) {
    await nextStepBtn.click();
  }

  await expect
    .poll(async () => {
      return await page.evaluate((songTitle: string) => {
        const selects = Array.from(document.querySelectorAll("select"));
        for (const select of selects) {
          const option = Array.from(select.options).find((row) => (row.textContent || "").includes(songTitle));
          if (!option) continue;
          select.value = option.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
        return false;
      }, "E2E Score Song");
    })
    .toBeTruthy();

  const scoreTab = page.locator("[data-testid='studio-ref-tab-score']");
  if (await scoreTab.count()) {
    await expect(scoreTab).toBeVisible();
    await scoreTab.click();
  }

  await expect(page.locator("[data-testid='studio-score-pdf-frame']")).toBeVisible();
  await page.locator(".studio-score-tab-row .ghost-btn").filter({ hasText: /이미지|Images/i }).first().click();

  await expect
    .poll(async () => await page.locator(".studio-score-thumb").count())
    .toBeGreaterThanOrEqual(2);
  await expect(page.locator("[data-testid='studio-score-image-main']")).toBeVisible();

  const mainScoreImage = page.locator("[data-testid='studio-score-image-main']").first();
  await mainScoreImage.click();
  await expect(page.locator("[data-testid='studio-score-zoom-modal']")).toBeVisible();
  await page.locator("[data-testid='studio-score-zoom-modal'] .ghost-btn").filter({ hasText: /닫기|Close/i }).click();
  await expect(page.locator("[data-testid='studio-score-zoom-modal']")).toBeHidden();
});
