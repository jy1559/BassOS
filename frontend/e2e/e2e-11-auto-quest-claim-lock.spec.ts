import { expect, test, type APIRequestContext } from "@playwright/test";
import { gotoChallengeTab, openApp, resetRuntime } from "./helpers";

type QuestRow = {
  quest_id: string;
  auto_generated: boolean;
  status: string;
  claimable: boolean;
  period_class: "short" | "mid" | "long";
};

async function fetchQuests(request: APIRequestContext): Promise<QuestRow[]> {
  const response = await request.get("/api/quests/current");
  const json = (await response.json()) as { quests: QuestRow[] };
  return json.quests || [];
}

function activeAutoInPeriod(quests: QuestRow[], period: "short" | "mid" | "long"): QuestRow[] {
  return quests.filter((item) => item.auto_generated && item.period_class === period && item.status === "Active");
}

test("E2E-11 auto quest lock after claim and force regenerate from top control", async ({ page, request }) => {
  await resetRuntime(request);
  await request.post("/api/session/quick-log", {
    data: {
      activity: "Drill",
      sub_activity: "Core",
      duration_min: 2000,
    },
  });

  const beforeClaim = await fetchQuests(request);
  const target = beforeClaim.find((item) => item.auto_generated && item.status === "Active" && item.claimable);
  expect(target).toBeTruthy();
  if (!target) return;

  const claimResponse = await request.post(`/api/quests/${target.quest_id}/claim`, { data: {} });
  expect(claimResponse.ok()).toBeTruthy();

  const afterClaim = await fetchQuests(request);
  expect(activeAutoInPeriod(afterClaim, target.period_class)).toHaveLength(0);

  const afterReload = await fetchQuests(request);
  expect(activeAutoInPeriod(afterReload, target.period_class)).toHaveLength(0);

  await openApp(page, 1366, 768);
  await gotoChallengeTab(page, "quests");

  const refreshRow = page.locator(".quest-auto-refresh-row");
  await expect(refreshRow).toBeVisible();
  const periodIndexMap: Record<"short" | "mid" | "long", number> = { short: 0, mid: 1, long: 2 };
  await refreshRow.locator(".ghost-btn").nth(periodIndexMap[target.period_class]).click();

  await expect
    .poll(async () => {
      const quests = await fetchQuests(request);
      return activeAutoInPeriod(quests, target.period_class).length;
    })
    .toBeGreaterThan(0);
});
