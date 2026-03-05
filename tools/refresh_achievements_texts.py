from __future__ import annotations

import csv
import json
from pathlib import Path


TARGET_FILES = [
    Path("designPack/data/achievements_master.csv"),
    Path("app/data/achievements_master.csv"),
]

TIER_LABEL = {
    1: "동",
    2: "은",
    3: "금",
    4: "플래티넘",
}

RARITY_BY_TIER = {
    1: "common",
    2: "rare",
    3: "epic",
    4: "legendary",
}

STYLE_BY_TIER = {
    1: "bronze",
    2: "silver",
    3: "gold",
    4: "platinum",
}

GROUP_NAMES: dict[str, dict[int, str]] = {
    "ACH_AB": {
        1: "A/B 스위치 입문",
        2: "A/B 실험실 고정석",
    },
    "ACH_CLEAN": {
        1: "무소음 챌린지 입문",
        2: "무소음 루틴 장인",
    },
    "ACH_CORE": {
        1: "코어 출석 체크",
        2: "코어 루틴 성실러",
        3: "코어 루틴 설계자",
    },
    "ACH_DCOLLECT": {
        1: "드릴 탐험가",
        2: "드릴 큐레이터",
    },
    "ACH_DURATION": {
        1: "베이스 시동 걸기",
        2: "베이스 생활화",
        3: "현악 근육 완성형",
    },
    "ACH_FUNK": {
        1: "그루브 첫 진입",
        2: "그루브 체질",
    },
    "ACH_LEVEL": {
        1: "레벨 5 돌파",
        2: "레벨 15 정착",
        3: "레벨 30 상주",
    },
    "ACH_MSTREAK": {
        1: "월간 루틴 2연타",
        2: "월간 루틴 6연타",
    },
    "ACH_REC": {
        1: "기록 시작",
        2: "기록 아카이브",
    },
    "ACH_SCOLLECT": {
        1: "곡 수집 입문",
        2: "곡 디깅 매니아",
    },
    "ACH_SESSION": {
        1: "10분 루틴 착수",
        2: "루틴 중수",
        3: "루틴 상수",
        4: "루틴 장기집권",
    },
    "ACH_SLAP": {
        1: "슬랩 첫 손맛",
        2: "슬랩 파형 안정",
    },
    "ACH_SONG": {
        1: "곡 연습 첫 페달",
        2: "곡 연습 항속 모드",
        3: "곡 연습 내공형",
    },
    "ACH_THEORY": {
        1: "이론 연결 시작",
        2: "이론 적용 루틴",
    },
    "ACH_TOTALXP": {
        1: "XP 예금 시작",
        2: "XP 투자자",
        3: "XP 장기 복리",
    },
    "ACH_WSTREAK": {
        1: "주간 페이스 2연속",
        2: "주간 페이스 6연속",
    },
}

GROUP_CATEGORY = {
    "ACH_AB": "루틴",
    "ACH_CLEAN": "루틴",
    "ACH_CORE": "루틴",
    "ACH_DCOLLECT": "드릴",
    "ACH_DURATION": "성장",
    "ACH_FUNK": "드릴",
    "ACH_LEVEL": "성장",
    "ACH_MSTREAK": "루틴",
    "ACH_REC": "기록",
    "ACH_SCOLLECT": "곡",
    "ACH_SESSION": "루틴",
    "ACH_SLAP": "드릴",
    "ACH_SONG": "곡",
    "ACH_THEORY": "이론",
    "ACH_TOTALXP": "성장",
    "ACH_WSTREAK": "루틴",
}

GROUP_MAIN_LABEL = {
    "ACH_AB": "A/B 비교 체크 세션",
    "ACH_CLEAN": "클린 뮤트 체크 세션",
    "ACH_CORE": "Core 드릴 세션",
    "ACH_DCOLLECT": "서로 다른 드릴",
    "ACH_DURATION": "총 연습 시간",
    "ACH_FUNK": "펑크/재즈 계열 세션",
    "ACH_LEVEL": "플레이어 레벨",
    "ACH_MSTREAK": "월간 연속 달성",
    "ACH_REC": "녹음/영상 기록 세션",
    "ACH_SCOLLECT": "연습한 곡 종류",
    "ACH_SESSION": "10분 이상 세션",
    "ACH_SLAP": "슬랩 태그 세션",
    "ACH_SONG": "SongPractice 세션",
    "ACH_THEORY": "이론 태그 세션",
    "ACH_TOTALXP": "누적 XP",
    "ACH_WSTREAK": "주간 연속 달성",
}

GROUP_HINT = {
    "ACH_AB": "세션 저장에서 'A/B 비교'를 체크하고, 비교 포인트를 노트에 한 줄 남기세요.",
    "ACH_CLEAN": "왼손/오른손 뮤트를 먼저 안정시킨 뒤 템포를 올리면 달성 속도가 빨라집니다.",
    "ACH_CORE": "10분 단위 코어 루틴을 끊기지 않게 누적해 주세요.",
    "ACH_DCOLLECT": "같은 드릴만 반복하지 말고 주간마다 새로운 드릴을 하나씩 추가해 보세요.",
    "ACH_DURATION": "짧게라도 매일 이어가는 누적이 가장 강력합니다.",
    "ACH_FUNK": "펑크/재즈 드릴은 메트로놈 2&4와 함께하면 체감이 빨리 옵니다.",
    "ACH_LEVEL": "세션·퀘스트·업적 XP를 균형 있게 가져가면 안정적으로 레벨이 오릅니다.",
    "ACH_MSTREAK": "월말 몰아치기보다 주 3회 루틴을 고정하는 편이 훨씬 유리합니다.",
    "ACH_REC": "짧은 오디오라도 자주 남기면 성장 체감이 크게 올라갑니다.",
    "ACH_SCOLLECT": "장르를 바꿔가며 곡을 늘리면 손/귀 모두 빠르게 확장됩니다.",
    "ACH_SESSION": "한 번 길게보다 짧고 자주가 누적 속도가 빠릅니다.",
    "ACH_SLAP": "슬랩은 톤보다 타이밍 우선. 느린 BPM에서 정확도 먼저 잡으세요.",
    "ACH_SONG": "곡 연습 세션은 구간 목표(예: 후렴 8마디)를 함께 적으면 효율이 올라갑니다.",
    "ACH_THEORY": "이론은 드릴/곡 적용과 함께 갈 때 오래 남습니다.",
    "ACH_TOTALXP": "퀘스트를 같이 챙기면 같은 시간 대비 XP 효율이 크게 좋아집니다.",
    "ACH_WSTREAK": "주간 목표를 초반에 먼저 채우면 연속 기록이 끊기지 않습니다.",
}

SPECIAL_TEXT = {
    "ACH_MANUAL_001": {
        "name": "오늘도 베이스 잡음",
        "tier_name": "단발",
        "category": "단발",
        "rarity": "rare",
        "description": "연습 시작 자체가 승리였던 날에 수동 수령하는 업적입니다.\n짧아도 좋으니 오늘 베이스를 잡았다는 기록을 남겨주세요.",
        "evidence_hint": "수동 업적입니다. 오늘 연습했다면 바로 수령하세요.",
        "hint": "작은 시작이 루틴을 만듭니다.",
        "auto_grant": "false",
        "ui_badge_style": "manual",
    },
    "ACH_MANUAL_002": {
        "name": "합주 다녀옴",
        "tier_name": "단발",
        "category": "단발",
        "rarity": "epic",
        "description": "합주/밴드 세션을 실제로 진행한 날 수동 수령하세요.\n현장 경험은 연습 효율을 크게 끌어올립니다.",
        "evidence_hint": "수동 업적입니다. 합주 노트나 간단한 기록을 남기고 수령하세요.",
        "hint": "합주 1회는 연습 10회의 힌트를 줍니다.",
        "auto_grant": "false",
        "ui_badge_style": "manual",
    },
    "ACH_MANUAL_003": {
        "name": "공연/촬영 완료",
        "tier_name": "단발",
        "category": "단발",
        "rarity": "legendary",
        "description": "공연, 촬영, 공개 업로드처럼 결과물을 남긴 날 수동 수령하세요.\n완주 경험은 다음 루틴의 강력한 연료가 됩니다.",
        "evidence_hint": "수동 업적입니다. 기록장에 링크/사진을 남기면 나중에 돌아보기 좋습니다.",
        "hint": "결과물을 남긴 날은 크게 칭찬받아야 합니다.",
        "auto_grant": "false",
        "ui_badge_style": "manual",
    },
    "ACH_HIDDEN_001": {
        "name": "무음 암살자",
        "tier_name": "히든",
        "category": "히든",
        "rarity": "legendary",
        "description": "한 세션에서 '메트로놈 2&4'와 '클린 뮤트'를 동시에 체크해 달성하세요.\n소음이 줄어들수록 그루브는 더 선명해집니다.",
        "evidence_hint": "세션 저장 태그에서 두 항목을 동시에 체크하세요.",
        "hint": "힌트: 조용한 세션이 답입니다.",
        "auto_grant": "true",
        "ui_badge_style": "hidden",
        "rule_type": "count_events",
        "target": "1",
        "rule_filter": {"event_type": "SESSION", "tags_all": ["METRO_24", "CLEAN_MUTE"]},
        "is_hidden": "true",
    },
    "ACH_HIDDEN_002": {
        "name": "테이크 수집가",
        "tier_name": "히든",
        "category": "히든",
        "rarity": "legendary",
        "description": "한 세션에서 'A/B 비교'와 '오디오 녹음'을 동시에 체크해 달성하세요.\n비교 + 기록 조합은 성장 체감의 지름길입니다.",
        "evidence_hint": "세션 저장 태그에서 A/B 비교 + 오디오 녹음을 같이 체크하세요.",
        "hint": "힌트: 듣고, 다시 듣고, 또 남기기.",
        "auto_grant": "true",
        "ui_badge_style": "hidden",
        "rule_type": "count_events",
        "target": "1",
        "rule_filter": {"event_type": "SESSION", "tags_all": ["AB_COMPARE", "RECORDING_AUDIO"]},
        "is_hidden": "true",
    },
    "ACH_HIDDEN_003": {
        "name": "뇌-손 동기화",
        "tier_name": "히든",
        "category": "히든",
        "rarity": "legendary",
        "description": "한 세션에서 '이론'과 '슬랩' 태그를 동시에 체크해 달성하세요.\n지식과 손맛을 같은 날 연결하면 기억이 오래 갑니다.",
        "evidence_hint": "세션 저장 태그에서 이론 + 슬랩을 동시에 체크하세요.",
        "hint": "힌트: 머리와 손을 같은 날 쓰기.",
        "auto_grant": "true",
        "ui_badge_style": "hidden",
        "rule_type": "count_events",
        "target": "1",
        "rule_filter": {"event_type": "SESSION", "tags_all": ["THEORY", "SLAP"]},
        "is_hidden": "true",
    },
    "ACH_HIDDEN_004": {
        "name": "잠수 훈련병",
        "tier_name": "히든",
        "category": "히든",
        "rarity": "legendary",
        "description": "60분 이상 드릴 세션 1회를 달성하면 해금됩니다.\n길게 파고드는 집중 세션은 한 번만 해도 큰 전환점이 됩니다.",
        "evidence_hint": "드릴 세션을 60분 이상으로 기록하세요.",
        "hint": "힌트: 한 번 길게 몰입해 보세요.",
        "auto_grant": "true",
        "ui_badge_style": "hidden",
        "rule_type": "count_events",
        "target": "1",
        "rule_filter": {"event_type": "SESSION", "tags_all": ["DRILL"], "min_duration": 60},
        "is_hidden": "true",
    },
}


def base_description(group_id: str, target: int, rule_type: str) -> str:
    label = GROUP_MAIN_LABEL.get(group_id, "목표")
    tip = GROUP_HINT.get(group_id, "기록을 남기면 추이를 확인하기 쉽습니다.")
    if rule_type == "sum_duration":
        goal = f"{label} {target}분"
    elif rule_type == "sum_xp":
        goal = f"{label} {target:,} XP"
    elif rule_type == "level_reach":
        goal = f"{label} Lv.{target}"
    elif rule_type in {"streak_weekly", "streak_monthly", "boss_monthly"}:
        goal = f"{label} {target}회"
    elif rule_type == "distinct_count":
        goal = f"{label} {target}개"
    else:
        goal = f"{label} {target}회"
    return f"{goal} 달성 시 해금됩니다.\n팁: {tip}"


def update_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for row in rows:
        ach_id = row.get("achievement_id", "")
        group_id = row.get("group_id", ach_id)
        tier = int(float(row.get("tier", "1") or 1))
        rule_type = (row.get("rule_type", "") or "").strip()
        target = int(float(row.get("target", "1") or 1))

        if ach_id in SPECIAL_TEXT:
            spec = SPECIAL_TEXT[ach_id]
            row["name"] = spec["name"]
            row["tier_name"] = spec["tier_name"]
            row["category"] = spec["category"]
            row["rarity"] = spec["rarity"]
            row["description"] = spec["description"]
            row["evidence_hint"] = spec["evidence_hint"]
            row["hint"] = spec["hint"]
            row["auto_grant"] = spec["auto_grant"]
            row["ui_badge_style"] = spec["ui_badge_style"]
            row["is_hidden"] = spec.get("is_hidden", row.get("is_hidden", "false"))
            if "rule_type" in spec:
                row["rule_type"] = spec["rule_type"]
                rule_type = spec["rule_type"]
            if "target" in spec:
                row["target"] = spec["target"]
            if "rule_filter" in spec:
                row["rule_filter"] = json.dumps(spec["rule_filter"], ensure_ascii=False)
            out.append(row)
            continue

        names = GROUP_NAMES.get(group_id, {})
        row["name"] = names.get(tier, row.get("name", ach_id))
        row["tier_name"] = TIER_LABEL.get(tier, "단발")
        row["category"] = GROUP_CATEGORY.get(group_id, "루틴")
        row["rarity"] = RARITY_BY_TIER.get(tier, "rare")
        row["description"] = base_description(group_id, target, rule_type)
        row["evidence_hint"] = GROUP_HINT.get(group_id, "세션 저장 정보와 태그를 함께 기록해 주세요.")
        row["hint"] = ""
        row["auto_grant"] = "false" if rule_type == "manual" else "true"
        row["ui_badge_style"] = STYLE_BY_TIER.get(tier, "default")
        row["is_hidden"] = "false"
        out.append(row)
    return out


def process_file(path: Path) -> None:
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        headers = reader.fieldnames or []
        rows = list(reader)
    updated = update_rows(rows)
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=headers)
        writer.writeheader()
        writer.writerows(updated)


def main() -> None:
    for target in TARGET_FILES:
        if target.exists():
            process_file(target)
    print("achievements text refreshed")


if __name__ == "__main__":
    main()
