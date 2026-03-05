from __future__ import annotations

import csv
from pathlib import Path

TARGETS = [
    Path("app/data/achievements_master.csv"),
    Path("designPack/data/achievements_master.csv"),
]

NAME_MAP = {
    "A_SESSION_T1": "세션 루틴 I",
    "A_SESSION_T2": "세션 루틴 II",
    "A_SESSION_T3": "세션 루틴 III",
    "A_SESSION_T4": "세션 루틴 IV",
    "A_DURATION_T1": "누적 5시간",
    "A_DURATION_T2": "누적 20시간",
    "A_DURATION_T3": "누적 60시간",
    "A_DURATION_T4": "누적 150시간",
    "A_SONGP_T1": "곡 연습 시작",
    "A_SONGP_T2": "곡 연습 집중",
    "A_SONGP_T3": "곡 연습 루틴",
    "A_SONGC_T1": "카피 입문",
    "A_SONGC_T2": "카피 빌더",
    "A_CORE_T1": "코어 워밍업",
    "A_CORE_T2": "코어 앵커",
    "A_CORE_T3": "코어 스택",
    "A_SLAP_T1": "슬랩 입문",
    "A_SLAP_T2": "슬랩 루틴",
    "A_THEORY_T1": "이론 노트",
    "A_THEORY_T2": "이론 루틴",
    "A_FUNK_T1": "그루브 입문",
    "A_FUNK_T2": "그루브 유지자",
    "A_SCOLLECT_T1": "곡 3개 기록",
    "A_SCOLLECT_T2": "곡 10개 기록",
    "A_SCOLLECT_T3": "곡 25개 기록",
    "A_DCOLLECT_T1": "드릴 3개 기록",
    "A_DCOLLECT_T2": "드릴 10개 기록",
    "A_DCOLLECT_T3": "드릴 25개 기록",
    "A_WSTREAK_T1": "주간 연속 2주",
    "A_WSTREAK_T2": "주간 연속 4주",
    "A_WSTREAK_T3": "주간 연속 8주",
    "A_MSTREAK_T1": "월간 연속 2개월",
    "A_MSTREAK_T2": "월간 연속 4개월",
    "A_TOTALXP_T1": "총 XP 5,000",
    "A_TOTALXP_T2": "총 XP 20,000",
    "A_TOTALXP_T3": "총 XP 60,000",
    "A_LEVEL_T1": "레벨 10 달성",
    "A_LEVEL_T2": "레벨 20 달성",
    "A_LEVEL_T3": "레벨 35 달성",
    "A_QUICK_T1": "빠른 기록 10회",
    "A_QUICK_T2": "빠른 기록 40회",
    "A_MANUAL_T1": "첫 공개 연주",
    "A_MANUAL_T2": "첫 풀커버 완주",
    "A_MANUAL_T3": "야간 집중 세션",
}

DESC_MAP = {
    "A_SESSION_T1": "10분 이상 세션을 12회 기록하세요.",
    "A_SESSION_T2": "10분 이상 세션을 40회 기록하세요.",
    "A_SESSION_T3": "10분 이상 세션을 100회 기록하세요.",
    "A_SESSION_T4": "10분 이상 세션을 220회 기록하세요.",
    "A_DURATION_T1": "누적 연습 시간 300분을 달성하세요.",
    "A_DURATION_T2": "누적 연습 시간 1,200분을 달성하세요.",
    "A_DURATION_T3": "누적 연습 시간 3,600분을 달성하세요.",
    "A_DURATION_T4": "누적 연습 시간 9,000분을 달성하세요.",
    "A_SONGP_T1": "곡 연습 세션을 10회 기록하세요.",
    "A_SONGP_T2": "곡 연습 세션을 30회 기록하세요.",
    "A_SONGP_T3": "곡 연습 세션을 80회 기록하세요.",
    "A_SONGC_T1": "곡 카피 세션을 5회 기록하세요.",
    "A_SONGC_T2": "곡 카피 세션을 20회 기록하세요.",
    "A_CORE_T1": "코어 드릴 세션을 8회 기록하세요.",
    "A_CORE_T2": "코어 드릴 세션을 30회 기록하세요.",
    "A_CORE_T3": "코어 드릴 세션을 90회 기록하세요.",
    "A_SLAP_T1": "슬랩 세션을 5회 기록하세요.",
    "A_SLAP_T2": "슬랩 세션을 20회 기록하세요.",
    "A_THEORY_T1": "이론 세션을 5회 기록하세요.",
    "A_THEORY_T2": "이론 세션을 20회 기록하세요.",
    "A_FUNK_T1": "펑크/재즈 세션을 5회 기록하세요.",
    "A_FUNK_T2": "펑크/재즈 세션을 20회 기록하세요.",
    "A_SCOLLECT_T1": "서로 다른 곡 3개에 대해 세션을 기록하세요.",
    "A_SCOLLECT_T2": "서로 다른 곡 10개에 대해 세션을 기록하세요.",
    "A_SCOLLECT_T3": "서로 다른 곡 25개에 대해 세션을 기록하세요.",
    "A_DCOLLECT_T1": "서로 다른 드릴 3개에 대해 세션을 기록하세요.",
    "A_DCOLLECT_T2": "서로 다른 드릴 10개에 대해 세션을 기록하세요.",
    "A_DCOLLECT_T3": "서로 다른 드릴 25개에 대해 세션을 기록하세요.",
    "A_WSTREAK_T1": "주 3회 이상 연습을 2주 연속 유지하세요.",
    "A_WSTREAK_T2": "주 3회 이상 연습을 4주 연속 유지하세요.",
    "A_WSTREAK_T3": "주 3회 이상 연습을 8주 연속 유지하세요.",
    "A_MSTREAK_T1": "월 12회 이상 연습을 2개월 연속 유지하세요.",
    "A_MSTREAK_T2": "월 12회 이상 연습을 4개월 연속 유지하세요.",
    "A_TOTALXP_T1": "총 XP 5,000을 달성하세요.",
    "A_TOTALXP_T2": "총 XP 20,000을 달성하세요.",
    "A_TOTALXP_T3": "총 XP 60,000을 달성하세요.",
    "A_LEVEL_T1": "플레이어 레벨 10을 달성하세요.",
    "A_LEVEL_T2": "플레이어 레벨 20을 달성하세요.",
    "A_LEVEL_T3": "플레이어 레벨 35를 달성하세요.",
    "A_QUICK_T1": "빠른 기록 세션을 10회 저장하세요.",
    "A_QUICK_T2": "빠른 기록 세션을 40회 저장하세요.",
    "A_MANUAL_T1": "첫 공개 연주/잼을 마친 뒤 수동으로 수령하세요.",
    "A_MANUAL_T2": "곡을 처음부터 끝까지 풀커버 완주한 뒤 수동으로 수령하세요.",
    "A_MANUAL_T3": "스스로 정한 야간 집중 루틴을 완료한 뒤 수동으로 수령하세요.",
}

def evidence_text(achievement_id: str, rule_type: str) -> str:
    if rule_type == "manual":
        return "조건을 만족한 뒤 수동으로 수령하세요."
    if achievement_id.startswith("A_SESSION_"):
        return "세션 저장 시 자동 집계됩니다."
    if achievement_id.startswith("A_DURATION_"):
        return "세션 누적 시간(분) 기준으로 자동 합산됩니다."
    if achievement_id.startswith("A_SONGP_"):
        return "세부활동을 Song Practice로 기록하면 정확히 집계됩니다."
    if achievement_id.startswith("A_SONGC_"):
        return "세부활동을 Song Copy로 기록하면 정확히 집계됩니다."
    if achievement_id.startswith("A_CORE_"):
        return "드릴 세부활동 Core 기준으로 자동 집계됩니다."
    if achievement_id.startswith("A_SLAP_"):
        return "드릴 세부활동 Slap 기준으로 자동 집계됩니다."
    if achievement_id.startswith("A_THEORY_"):
        return "드릴 세부활동 Theory 기준으로 자동 집계됩니다."
    if achievement_id.startswith("A_FUNK_"):
        return "드릴 세부활동 Funk 기준으로 자동 집계됩니다."
    if achievement_id.startswith("A_SCOLLECT_"):
        return "중복 곡 ID는 1개로 계산됩니다."
    if achievement_id.startswith("A_DCOLLECT_"):
        return "중복 드릴 ID는 1개로 계산됩니다."
    if achievement_id.startswith("A_WSTREAK_"):
        return "주간 시작일은 월요일 기준입니다."
    if achievement_id.startswith("A_MSTREAK_"):
        return "한 달 목표 횟수 기준으로 자동 집계됩니다."
    if achievement_id.startswith("A_TOTALXP_"):
        return "세션/퀘스트/업적 XP를 모두 포함해 계산합니다."
    if achievement_id.startswith("A_LEVEL_"):
        return "총 XP를 기반으로 자동 레벨 계산됩니다."
    if achievement_id.startswith("A_QUICK_"):
        return "빠른 기록 저장 횟수가 자동 집계됩니다."
    return "세션 저장 시 자동 집계됩니다."


def tier_text(row: dict[str, str]) -> str:
    try:
        tier = int(str(row.get("tier", "1")).strip() or "1")
    except ValueError:
        tier = 1
    if (row.get("rule_type") or "").lower() == "manual":
        return "단발"
    if tier <= 1:
        return "동"
    if tier == 2:
        return "은"
    if tier == 3:
        return "금"
    return "플래티넘"


def category_text(achievement_id: str) -> str:
    if achievement_id.startswith(("A_SESSION_", "A_WSTREAK_", "A_MSTREAK_")):
        return "루틴"
    if achievement_id.startswith(("A_DURATION_", "A_TOTALXP_", "A_LEVEL_")):
        return "성장"
    if achievement_id.startswith(("A_SONGP_", "A_SONGC_")):
        return "곡"
    if achievement_id.startswith(("A_CORE_", "A_SLAP_")):
        return "드릴"
    if achievement_id.startswith("A_THEORY_"):
        return "이론"
    if achievement_id.startswith("A_FUNK_"):
        return "장르"
    if achievement_id.startswith(("A_SCOLLECT_", "A_DCOLLECT_")):
        return "수집"
    if achievement_id.startswith("A_QUICK_"):
        return "기록"
    if achievement_id.startswith("A_MANUAL_"):
        return "단발"
    return "루틴"


def translate_file(path: Path) -> None:
    with path.open("r", encoding="utf-8-sig", newline="") as fp:
        rows = list(csv.DictReader(fp))
        fieldnames = list(rows[0].keys()) if rows else []

    for row in rows:
        achievement_id = row.get("achievement_id", "")
        row["name"] = NAME_MAP.get(achievement_id, row.get("name", ""))
        row["description"] = DESC_MAP.get(achievement_id, row.get("description", ""))
        row["tier_name"] = tier_text(row)
        row["category"] = category_text(achievement_id)
        row["evidence_hint"] = evidence_text(achievement_id, row.get("rule_type", ""))
        if (row.get("is_hidden") or "").lower() == "true" and not row.get("hint"):
            row["hint"] = "지속적으로 연습하면 공개됩니다."

    with path.open("w", encoding="utf-8", newline="") as fp:
        writer = csv.DictWriter(fp, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    for target in TARGETS:
        translate_file(target)
        print(f"updated: {target}")


if __name__ == "__main__":
    main()
