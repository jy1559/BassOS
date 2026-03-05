from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETS = [
    ROOT / "app" / "data" / "achievements_master.csv",
    ROOT / "designPack" / "data" / "achievements_master.csv",
]

HEADERS = [
    "achievement_id",
    "group_id",
    "name",
    "tier",
    "tier_name",
    "category",
    "rarity",
    "rule_type",
    "rule_filter",
    "target",
    "display_order",
    "xp_reward",
    "description",
    "evidence_hint",
    "is_hidden",
    "hint",
    "auto_grant",
    "ui_badge_style",
    "icon_path",
    "icon_url",
]

TIER_NAMES = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master"]
RARITY = ["common", "rare", "epic", "legendary", "mythic", "mythic"]
XP_REWARD = [70, 120, 200, 320, 500, 760]
STYLE_BY_TIER = [
    "tier_bronze",
    "tier_silver",
    "tier_gold",
    "tier_platinum",
    "tier_diamond",
    "tier_master",
]


def dumps_filter(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False)


def explain_rule(rule_type: str, target: int, rule_filter: dict) -> tuple[str, str]:
    bits: list[str] = []
    event_type = str(rule_filter.get("event_type") or "").strip()
    if event_type:
        bits.append(f"이벤트: {event_type}")
    if rule_filter.get("min_duration") is not None:
        bits.append(f"세션 {rule_filter['min_duration']}분 이상")
    if rule_filter.get("tags_any"):
        bits.append("태그 하나 이상: " + ", ".join(rule_filter["tags_any"]))
    if rule_filter.get("tags_all"):
        bits.append("태그 모두 포함: " + ", ".join(rule_filter["tags_all"]))
    if rule_filter.get("field"):
        bits.append(f"고유 필드: {rule_filter['field']}")
    if rule_filter.get("boss_type"):
        bits.append(f"보스 타입: {rule_filter['boss_type']}")
    if rule_filter.get("condition_tree"):
        bits.append("조건 트리 사용")
    if rule_type == "sum_duration":
        body = f"누적 연습 시간을 {target}분 달성하세요."
    elif rule_type == "sum_xp":
        body = f"누적 XP {target:,}을 달성하세요."
    elif rule_type == "level_reach":
        body = f"플레이어 레벨 {target}에 도달하세요."
    elif rule_type == "distinct_count":
        body = f"중복 제외 고유 개수 {target}개를 달성하세요."
    elif rule_type in {"streak_weekly", "streak_monthly", "boss_monthly"}:
        body = f"연속/월간 달성 지표를 {target}까지 달성하세요."
    elif rule_type == "manual":
        body = "자동 판별이 아닌 수동 체크 업적입니다."
    else:
        body = f"조건을 만족한 이벤트를 {target}회 달성하세요."
    hint = " / ".join(bits) if bits else "기본 조건"
    evidence = "권장 증빙: 세션 메모 + 태그/링크/미디어 중 가능한 항목 기록"
    return f"{body} ({hint})", evidence


def make_tier_rows() -> list[dict[str, str]]:
    groups = [
        {
            "slug": "session_routine",
            "name": "세션 루틴",
            "category": "루틴",
            "rule_type": "count_events",
            "rule_filter": {"event_type": "SESSION", "min_duration": 10},
            "targets": [8, 24, 60, 140, 280, 520],
        },
        {
            "slug": "deep_focus",
            "name": "딥 포커스",
            "category": "집중",
            "rule_type": "count_events",
            "rule_filter": {"event_type": "SESSION", "min_duration": 30},
            "targets": [3, 10, 25, 55, 110, 200],
        },
        {
            "slug": "long_focus",
            "name": "롱폼 집중",
            "category": "집중",
            "rule_type": "count_events",
            "rule_filter": {"event_type": "SESSION", "min_duration": 50},
            "targets": [2, 6, 14, 30, 55, 90],
        },
        {
            "slug": "duration_sum",
            "name": "누적 시간",
            "category": "성장",
            "rule_type": "sum_duration",
            "rule_filter": {"event_type": "SESSION"},
            "targets": [300, 1200, 3600, 9000, 18000, 30000],
        },
        {
            "slug": "xp_stack",
            "name": "XP 축적",
            "category": "성장",
            "rule_type": "sum_xp",
            "rule_filter": {"all_events": True},
            "targets": [2000, 8000, 20000, 50000, 120000, 250000],
        },
        {
            "slug": "level_climb",
            "name": "레벨 등반",
            "category": "성장",
            "rule_type": "level_reach",
            "rule_filter": {},
            "targets": [8, 15, 25, 35, 45, 50],
        },
        {
            "slug": "song_practice",
            "name": "곡 연습 루틴",
            "category": "곡",
            "rule_type": "count_events",
            "rule_filter": {"event_type": "SESSION", "tags_any": ["SONG_PRACTICE"]},
            "targets": [5, 15, 35, 75, 150, 260],
        },
        {
            "slug": "repertoire_distinct",
            "name": "레퍼토리 확장",
            "category": "곡",
            "rule_type": "distinct_count",
            "rule_filter": {"event_type": "SESSION", "field": "song_library_id"},
            "targets": [3, 8, 16, 28, 42, 60],
        },
        {
            "slug": "drill_distinct",
            "name": "드릴 다양화",
            "category": "드릴",
            "rule_type": "distinct_count",
            "rule_filter": {"event_type": "SESSION", "field": "drill_id"},
            "targets": [3, 8, 16, 28, 42, 60],
        },
        {
            "slug": "core_weekly",
            "name": "코어 연속 루틴",
            "category": "루틴",
            "rule_type": "streak_weekly",
            "rule_filter": {"min_sessions": 3, "min_core_sessions": 2, "tag_core": "CORE"},
            "targets": [2, 4, 6, 10, 16, 24],
        },
        {
            "slug": "monthly_pace",
            "name": "월간 페이스",
            "category": "루틴",
            "rule_type": "streak_monthly",
            "rule_filter": {"min_sessions_per_month": 8},
            "targets": [2, 4, 6, 10, 14, 20],
        },
        {
            "slug": "slap_mastery",
            "name": "슬랩 마스터리",
            "category": "테크닉",
            "rule_type": "count_events",
            "rule_filter": {"event_type": "SESSION", "tags_any": ["SLAP"]},
            "targets": [3, 8, 18, 35, 65, 110],
        },
        {
            "slug": "theory_ear",
            "name": "이론/귀카피 탐구",
            "category": "학습",
            "rule_type": "count_events",
            "rule_filter": {
                "event_type": "SESSION",
                "condition_tree": {
                    "type": "group",
                    "logic": "any",
                    "children": [
                        {"type": "condition", "field": "tags", "op": "contains", "value": "THEORY"},
                        {"type": "condition", "field": "tags", "op": "contains", "value": "EAR_COPY"},
                    ],
                },
            },
            "targets": [3, 8, 18, 35, 65, 110],
        },
        {
            "slug": "archive_record",
            "name": "기록 아카이브",
            "category": "기록",
            "rule_type": "count_events",
            "rule_filter": {"event_type": "SESSION", "tags_any": ["RECORDING_AUDIO", "RECORDING_VIDEO"]},
            "targets": [3, 10, 24, 50, 90, 150],
        },
        {
            "slug": "video_review",
            "name": "영상 리뷰",
            "category": "기록",
            "rule_type": "count_events",
            "rule_filter": {"event_type": "SESSION", "tags_all": ["RECORDING_VIDEO", "AB_COMPARE"]},
            "targets": [2, 6, 14, 30, 55, 90],
        },
        {
            "slug": "band_flow",
            "name": "합주/무대 흐름",
            "category": "무대",
            "rule_type": "count_events",
            "rule_filter": {
                "event_type": "SESSION",
                "condition_tree": {
                    "type": "group",
                    "logic": "all",
                    "children": [
                        {"type": "condition", "field": "duration_min", "op": "gte", "value": 20},
                        {
                            "type": "group",
                            "logic": "any",
                            "children": [
                                {"type": "condition", "field": "tags", "op": "contains", "value": "BAND"},
                                {"type": "condition", "field": "tags", "op": "contains", "value": "PERFORMANCE"},
                            ],
                        },
                    ],
                },
            },
            "targets": [2, 6, 14, 28, 50, 84],
        },
        {
            "slug": "community",
            "name": "커뮤니티 챌린지",
            "category": "커뮤니티",
            "rule_type": "count_events",
            "rule_filter": {"event_type": "SESSION", "tags_any": ["COMMUNITY"]},
            "targets": [2, 6, 14, 28, 50, 84],
        },
        {
            "slug": "boss_song_hunter",
            "name": "보스 송 헌터",
            "category": "보스",
            "rule_type": "boss_monthly",
            "rule_filter": {"event_type": "LONG_GOAL_CLEAR", "boss_type": "SONG_FULLTAKE"},
            "targets": [2, 4, 6, 9, 12, 18],
        },
    ]

    out: list[dict[str, str]] = []
    display_order = 1
    for group in groups:
        group_id = f"ACH_TIER_{group['slug'].upper()}"
        for i in range(6):
            tier = i + 1
            target = int(group["targets"][i])
            desc, evidence = explain_rule(group["rule_type"], target, group["rule_filter"])
            out.append(
                {
                    "achievement_id": f"{group_id}_T{tier}",
                    "group_id": group_id,
                    "name": f"{group['name']} {tier}",
                    "tier": str(tier),
                    "tier_name": TIER_NAMES[i],
                    "category": group["category"],
                    "rarity": RARITY[i],
                    "rule_type": group["rule_type"],
                    "rule_filter": dumps_filter(group["rule_filter"]),
                    "target": str(target),
                    "display_order": str(display_order),
                    "xp_reward": str(XP_REWARD[i]),
                    "description": desc,
                    "evidence_hint": evidence,
                    "is_hidden": "false",
                    "hint": "",
                    "auto_grant": "true",
                    "ui_badge_style": STYLE_BY_TIER[i],
                    "icon_path": "",
                    "icon_url": "",
                }
            )
        display_order += 1
    return out


def make_oneoff_rows(start_order: int) -> list[dict[str, str]]:
    defs = [
        ("FIRST_SESSION", "첫 세션", "count_events", {"event_type": "SESSION"}, 1, "일회성", "첫 기록을 남겨 시작하세요."),
        ("FIRST_FOCUS_30", "첫 30분 집중", "count_events", {"event_type": "SESSION", "min_duration": 30}, 1, "일회성", "30분 이상 집중 세션을 한번 완주하세요."),
        ("FIRST_AUDIO_LOG", "첫 오디오 로그", "count_events", {"event_type": "SESSION", "tags_any": ["RECORDING_AUDIO"]}, 1, "일회성", "녹음 태그를 켜고 세션을 종료하면 달성됩니다."),
        ("FIRST_VIDEO_REVIEW", "첫 영상 리뷰", "count_events", {"event_type": "SESSION", "tags_all": ["RECORDING_VIDEO", "AB_COMPARE"]}, 1, "일회성", "영상 기록과 A/B 비교를 함께 남겨보세요."),
        ("FIRST_BAND_STAGE", "첫 합주/무대", "count_events", {"event_type": "SESSION", "tags_any": ["BAND", "PERFORMANCE"]}, 1, "일회성", "합주 또는 무대 태그 세션 1회."),
        ("FIRST_COMMUNITY", "첫 커뮤니티", "count_events", {"event_type": "SESSION", "tags_any": ["COMMUNITY"]}, 1, "일회성", "커뮤니티 기반 세션 1회."),
        ("FIRST_BOSS_CLEAR", "첫 보스 클리어", "count_events", {"event_type": "LONG_GOAL_CLEAR"}, 1, "일회성", "롱골 보스 클리어 이벤트 1회."),
        ("FIRST_EARCOPY_BOSS", "첫 귀카피 보스", "count_events", {"event_type": "LONG_GOAL_CLEAR", "boss_type": "EARCOPY_FULL"}, 1, "일회성", "귀카피 보스 1회 달성."),
        ("WEEK_KEEPER_2W", "2주 지킴이", "streak_weekly", {"min_sessions": 4, "min_core_sessions": 1, "tag_core": "CORE"}, 2, "일회성", "주 4세션 이상 루틴을 2주 연속 유지."),
        ("MONTH_KEEPER_2M", "2개월 지킴이", "streak_monthly", {"min_sessions_per_month": 10}, 2, "일회성", "월 10세션 이상을 2개월 연속 유지."),
        ("STYLE_SWITCHER", "스타일 스위처", "manual", {}, 1, "수동", "새 연주 스타일 도전 후 직접 체크하세요."),
        ("STAGE_DEBUT", "무대 데뷔", "manual", {}, 1, "수동", "실전 무대/합주 경험 후 직접 체크하세요."),
    ]
    out: list[dict[str, str]] = []
    order = start_order
    for idx, (slug, name, rule_type, rule_filter, target, category, hint) in enumerate(defs, start=1):
        desc, evidence = explain_rule(rule_type, target, rule_filter)
        manual = rule_type == "manual"
        out.append(
            {
                "achievement_id": f"ACH_ONE_{slug}",
                "group_id": f"ACH_ONE_{slug}",
                "name": name,
                "tier": "1",
                "tier_name": "Single",
                "category": category,
                "rarity": "rare" if not manual else "epic",
                "rule_type": rule_type,
                "rule_filter": dumps_filter(rule_filter),
                "target": str(target),
                "display_order": str(order),
                "xp_reward": str(220 if not manual else 260),
                "description": desc,
                "evidence_hint": evidence,
                "is_hidden": "false",
                "hint": hint,
                "auto_grant": "false" if manual else "true",
                "ui_badge_style": "single_event",
                "icon_path": "",
                "icon_url": "",
            }
        )
        order += 1
    return out


def make_hidden_rows(start_order: int) -> list[dict[str, str]]:
    defs = [
        (
            "QUIET_ENGINE",
            "고요한 엔진",
            "count_events",
            {"event_type": "SESSION", "tags_all": ["METRO_ONEBAR", "CLEAN_MUTE"]},
            1,
            "원바 메트로놈 + 클린 뮤트 태그 조합을 찾으세요.",
        ),
        (
            "DOUBLE_ARCHIVE",
            "더블 아카이브",
            "count_events",
            {"event_type": "SESSION", "tags_all": ["RECORDING_AUDIO", "RECORDING_VIDEO"]},
            1,
            "오디오/비디오를 동시에 남긴 세션이 필요합니다.",
        ),
        (
            "IRON_STREAK",
            "아이언 스트릭",
            "streak_weekly",
            {"min_sessions": 5, "min_core_sessions": 3, "tag_core": "CORE"},
            3,
            "주당 5세션 + 코어 3세션으로 3주 연속 도전하세요.",
        ),
        (
            "NIGHT_OWL",
            "심야 집중 모드",
            "count_events",
            {
                "event_type": "SESSION",
                "condition_tree": {
                    "type": "group",
                    "logic": "all",
                    "children": [
                        {"type": "condition", "field": "event.hour_local", "op": "gte", "value": 22},
                        {"type": "condition", "field": "duration_min", "op": "gte", "value": 40},
                    ],
                },
            },
            5,
            "밤 10시 이후 40분 이상 세션을 누적하세요.",
        ),
        (
            "BOSS_CYCLE",
            "보스 순환자",
            "boss_monthly",
            {"event_type": "LONG_GOAL_CLEAR"},
            4,
            "보스 클리어가 발생한 달을 4개월 채우세요.",
        ),
        (
            "REPERTOIRE_MASTER",
            "숨은 레퍼토리 장인",
            "distinct_count",
            {"event_type": "SESSION", "field": "song_library_id"},
            30,
            "서로 다른 곡 30개를 기록하세요.",
        ),
    ]
    out: list[dict[str, str]] = []
    order = start_order
    for slug, name, rule_type, rule_filter, target, hint in defs:
        desc, evidence = explain_rule(rule_type, target, rule_filter)
        out.append(
            {
                "achievement_id": f"ACH_HID_{slug}",
                "group_id": f"ACH_HID_{slug}",
                "name": name,
                "tier": "1",
                "tier_name": "Hidden",
                "category": "히든",
                "rarity": "legendary",
                "rule_type": rule_type,
                "rule_filter": dumps_filter(rule_filter),
                "target": str(target),
                "display_order": str(order),
                "xp_reward": "480",
                "description": desc,
                "evidence_hint": evidence,
                "is_hidden": "true",
                "hint": hint,
                "auto_grant": "true",
                "ui_badge_style": "single_hidden",
                "icon_path": "",
                "icon_url": "",
            }
        )
        order += 1
    return out


def build_rows() -> list[dict[str, str]]:
    tier_rows = make_tier_rows()
    one_rows = make_oneoff_rows(start_order=100)
    hidden_rows = make_hidden_rows(start_order=200)
    rows = tier_rows + one_rows + hidden_rows
    assert len(tier_rows) == 108
    assert len(one_rows) == 12
    assert len(hidden_rows) == 6
    assert len(rows) == 126
    return rows


def write_rows(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=HEADERS)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in HEADERS})


def main() -> None:
    rows = build_rows()
    for target in TARGETS:
        write_rows(target, rows)
    print(f"generated achievements: {len(rows)}")


if __name__ == "__main__":
    main()
