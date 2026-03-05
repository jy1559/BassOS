import { expect, test } from "@playwright/test";
import { gotoCoreTab, openApp, resetRuntime } from "./helpers";

async function selectAnyTarget(page: import("@playwright/test").Page): Promise<void> {
  await expect
    .poll(async () => {
      return await page.evaluate(() => {
        const selects = Array.from(document.querySelectorAll("select"));
        for (const select of selects) {
          const option = Array.from(select.options).find((row) => String(row.value || "").trim() !== "");
          if (!option) continue;
          select.value = option.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
        return false;
      });
    })
    .toBeTruthy();
}

test("E2E-17 practice session elapsed text + control layout", async ({ page, request }) => {
  await resetRuntime(request);
  await openApp(page, 1366, 768);
  await gotoCoreTab(page, "practice");

  const startBtn = page.locator("[data-testid='practice-start-target']");
  if ((await startBtn.count()) === 0) {
    const stepNext = page.locator(".practice-step-card .primary-btn").first();
    if (await stepNext.count()) await stepNext.click();
  }
  await selectAnyTarget(page);
  await startBtn.click();

  const elapsed = page.locator("[data-testid='studio-session-elapsed']");
  const stopBtn = page.locator("[data-testid='studio-stop-session']");
  await expect(elapsed).toBeVisible();
  await expect(stopBtn).toBeVisible();

  const elapsedText = (await elapsed.textContent()) || "";
  expect(elapsedText.toLowerCase()).not.toContain("active");
  expect(elapsedText.toLowerCase()).not.toContain("session_id");

  const elapsedBox = await elapsed.boundingBox();
  const stopBox = await stopBtn.boundingBox();
  expect(elapsedBox).toBeTruthy();
  expect(stopBox).toBeTruthy();
  if (elapsedBox && stopBox) {
    expect(elapsedBox.x).toBeLessThan(stopBox.x);
  }
});
