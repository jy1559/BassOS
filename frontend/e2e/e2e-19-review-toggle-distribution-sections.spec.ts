import { expect, test } from "@playwright/test";
import { gotoRecordTab, openApp, resetRuntime } from "./helpers";

test("E2E-19 review default compact + toggle distribution sections", async ({ page, request }) => {
  await resetRuntime(request);
  await openApp(page, 1366, 768);
  await gotoRecordTab(page, "review");

  await expect(page.locator("[data-testid='review-highlights']")).toBeVisible();
  await expect(page.locator(".stat-grid").first()).toBeVisible();

  const practice = page.locator("[data-testid='review-toggle-practice']");
  const songDrill = page.locator("[data-testid='review-toggle-songdrill']");
  const records = page.locator("[data-testid='review-toggle-records']");
  await expect(practice).not.toHaveAttribute("open", "");
  await expect(songDrill).not.toHaveAttribute("open", "");
  await expect(records).not.toHaveAttribute("open", "");

  await practice.evaluate((el) => {
    (el as HTMLDetailsElement).open = true;
  });
  await expect(page.locator("[data-testid='review-week-rhythm']")).toBeVisible();
  await expect(page.locator("[data-testid='review-6w-heatmap']")).toBeVisible();
  await expect(page.locator("[data-testid='review-session-duration-buckets']")).toBeVisible();
  await expect(page.getByText(/<=10/)).toBeVisible();
  await expect(page.getByText(/10~30/)).toBeVisible();
  await expect(page.getByText(/30~60/)).toBeVisible();
  await expect(page.getByText(/60~120/)).toBeVisible();
  await expect(page.getByText(/120\+/)).toBeVisible();

  await songDrill.evaluate((el) => {
    (el as HTMLDetailsElement).open = true;
  });
  await expect(songDrill.locator("[data-testid='review-songdrill-chart']").first()).toHaveCount(1);
  await expect(songDrill.locator(".review-songdrill-grid .review-subcard")).toHaveCount(8);

  await records.evaluate((el) => {
    (el as HTMLDetailsElement).open = true;
  });
  await expect(records.locator(".review-record-top-stats")).toBeVisible();
  await expect(records.locator(".review-record-grid")).toBeVisible();
});
