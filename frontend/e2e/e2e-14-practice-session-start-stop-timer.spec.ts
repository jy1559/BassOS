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

test("E2E-14 practice session start/stop timer + stop modal actions", async ({ page, request }) => {
  await resetRuntime(request);
  await openApp(page, 1366, 768);
  await gotoCoreTab(page, "practice");

  const startBtn = page.locator("[data-testid='practice-start-target']");
  if ((await startBtn.count()) === 0) {
    const stepNext = page.locator(".practice-step-card .primary-btn").first();
    if (await stepNext.count()) await stepNext.click();
  }
  await selectAnyTarget(page);
  await expect(startBtn).toBeVisible();
  await expect(startBtn).toContainText(/세션 시작|Start Session/i);
  await startBtn.click();

  const elapsed = page.locator("[data-testid='studio-session-elapsed']");
  await expect(elapsed).toBeVisible();
  const before = (await elapsed.textContent()) || "";
  await page.waitForTimeout(1200);
  const after = (await elapsed.textContent()) || "";
  expect(after).not.toEqual(before);

  await page.locator("[data-testid='studio-stop-session']").click();
  const modal = page.locator(".modal");
  await expect(modal).toContainText(/종료하시겠습니까|Finish session/i);
  await expect(page.locator("[data-testid='studio-stop-start-at']")).toBeVisible();
  await expect(page.locator("[data-testid='studio-stop-end-at']")).toBeVisible();
  const startRaw = await page.locator("[data-testid='studio-stop-start-at']").inputValue();
  const startDate = new Date(startRaw);
  if (!Number.isNaN(startDate.getTime())) {
    const endDate = new Date(startDate.getTime() + 12 * 60 * 1000);
    const yyyy = endDate.getFullYear();
    const mm = String(endDate.getMonth() + 1).padStart(2, "0");
    const dd = String(endDate.getDate()).padStart(2, "0");
    const hh = String(endDate.getHours()).padStart(2, "0");
    const mi = String(endDate.getMinutes()).padStart(2, "0");
    await page.locator("[data-testid='studio-stop-end-at']").fill(`${yyyy}-${mm}-${dd}T${hh}:${mi}`);
  }

  await page.locator("[data-testid='studio-stop-save']").click();
  await expect(modal).toBeHidden();
  await expect(page.locator("[data-testid='studio-stop-session']")).toBeHidden();

  const sessionsAfterSave = await request.get("/api/sessions?limit=200");
  const savedRows = (await sessionsAfterSave.json()).sessions as Array<Record<string, unknown>>;
  const countAfterSave = savedRows.length;
  expect(countAfterSave).toBeGreaterThan(0);

  await startBtn.click();
  await expect(page.locator("[data-testid='studio-stop-session']")).toBeVisible();
  await page.locator("[data-testid='studio-stop-session']").click();
  await page.locator("[data-testid='studio-stop-discard']").click();
  await expect(page.locator("[data-testid='studio-stop-session']")).toBeHidden();

  const sessionsAfterDiscard = await request.get("/api/sessions?limit=200");
  const discardedRows = (await sessionsAfterDiscard.json()).sessions as Array<Record<string, unknown>>;
  expect(discardedRows.length).toBe(countAfterSave);
});
