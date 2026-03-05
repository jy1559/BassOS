"""Rebuild achievement catalogs with cleaner taxonomy and clearer copy."""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DESIGN_CSV = ROOT / "designPack" / "data" / "achievements_master.csv"
APP_CSV = ROOT / "app" / "data" / "achievements_master.csv"


REMOVE_GIMMICK_GROUPS = {
    "ACH_MIDNIGHT",
    "ACH_MORNING",
    "ACH_OUTSIDE",
}

CATEGORY_RENAME = {
    "습관": "루틴",
    "지속성": "루틴",
    "타임/그루브": "타임 · 그루브",
    "클린/뮤트": "클린 · 뮤트",
    "이론/리딩": "이론 · 리딩",
    "지판/이론": "지판 · 이론",
    "펑크&재즈": "펑크 · 재즈",
    "합주/공연": "합주 · 공연",
    "장비/톤": "장비 · 톤",
    "음악감상": "감상 · 분석",
    "콘텐츠": "콘텐츠 제작",
    "기록": "기록 관리",
    "카피/암기": "카피 · 암기",
}

TAG_LABELS = {
    "CORE": "기본기(Core)",
    "METRO_24": "메트로놈 2&4",
    "METRO_ONEBAR": "원바 메트로놈",
    "CLEAN_MUTE": "클린/뮤트",
    "EAR_COPY": "귀카피",
    "RECORDING_AUDIO": "오디오 녹음",
    "RECORDING_VIDEO": "영상 녹화",
    "AB_COMPARE": "A/B 비교",
    "THEORY": "이론",
    "SLAP": "슬랩",
    "BAND": "합주",
    "PERFORMANCE": "공연",
    "FUNKJAZZ": "펑크/재즈",
    "SONG_COPY": "곡 카피",
    "SONG_PRACTICE": "곡 연습",
    "GEAR": "장비/톤",
    "COMMUNITY": "커뮤니티",
    "QUICK": "빠른 기록",
}

EVENT_LABELS = {
    "SESSION": "연습 세션",
    "BOSS_CLEAR": "보스 클리어",
    "GEAR": "장비/톤 기록",
    "COMMUNITY": "커뮤니티 활동",
}

SOURCE_LABELS = {
    "BACKFILL": "백필(나중 기록)",
    "APP": "앱 입력",
    "SYSTEM": "시스템 자동 기록",
}

BOSS_LABELS = {
    "SONG": "곡",
    "EARCOPY": "귀카피",
}

DISTINCT_FIELD_LABELS = {
    "song_library_id": "서로 다른 곡",
    "drill_id": "서로 다른 드릴",
    "activity": "서로 다른 활동",
}

MANUAL_COPY = {
    "ACH_FIRST_UPLOAD": (
        "첫 공개 업로드를 남기면 달성됩니다. 완성도보다 기록 시작이 목적이므로 짧은 클립도 충분합니다.",
        "링크 또는 첨부 파일을 남긴 뒤 수동으로 수령하세요. 업로드 플랫폼은 비공개/언리스트도 인정됩니다.",
    ),
    "ACH_FIRST_COVER": (
        "커버 영상 1개를 완주 형태로 남기면 달성됩니다. 중간 실수가 있어도 끝까지 연주하면 인정됩니다.",
        "영상 링크 또는 파일을 첨부하고 수동 수령하세요. 날짜와 곡명을 노트에 함께 남기면 복기에 유리합니다.",
    ),
    "ACH_FIRST_BOSS": (
        "곡 1개를 끊지 않고 끝까지 연주한 풀테이크를 남기면 달성됩니다.",
        "오디오/영상 첨부를 권장합니다. 노트에 난이도와 체감 난관을 적어두면 다음 도전에 도움이 됩니다.",
    ),
    "ACH_FIRST_EARCOPY": (
        "악보 없이 귀로 잡은 구간을 실제로 연주해 기록하면 달성됩니다.",
        "짧은 구간도 가능합니다. 원곡 구간 정보와 함께 녹음 파일을 남기고 수동 수령하세요.",
    ),
    "ACH_FIRST_WALK": (
        "워킹 라인을 직접 구성해 8마디 이상 연주하면 달성됩니다.",
        "코드 진행을 노트에 적고 오디오를 첨부한 뒤 수동 수령하세요.",
    ),
    "ACH_FIRST_SHEET": (
        "악보를 보며 리듬 정확도를 유지해 8마디 이상 연주하면 달성됩니다.",
        "연습 메모에 BPM과 실수 포인트를 남기면 다음 정확도 개선에 도움이 됩니다.",
    ),
    "ACH_FIRST_JAM": (
        "루프나 백킹 트랙 위에서 1분 이상 즉흥 연주를 기록하면 달성됩니다.",
        "오디오/영상 첨부를 권장합니다. 사용한 스케일 또는 코드톤 메모를 함께 남기세요.",
    ),
    "ACH_FIRST_SLAP_SONG": (
        "슬랩이 포함된 곡의 한 섹션을 안정적으로 완주해 기록하면 달성됩니다.",
        "손 피로도와 템포를 노트에 남기고 파일을 첨부한 뒤 수동 수령하세요.",
    ),
    "ACH_FIRST_BANDSONG": (
        "합주 곡 1개를 처음부터 끝까지 끊지 않고 연주하면 달성됩니다.",
        "합주 날짜와 셋리스트를 노트에 기록하면 향후 공연 준비에 유용합니다.",
    ),
    "ACH_FIRST_AB": (
        "같은 구절을 두 가지 톤 또는 포지션으로 비교 기록하면 달성됩니다.",
        "A/B 비교 기준(톤, 포지션, 다이내믹)을 노트에 남기고 수동 수령하세요.",
    ),
    "ACH_FIRST_GIG": (
        "공연/버스킹/세션 참여 기록을 남기면 달성됩니다.",
        "장소, 날짜, 셋리스트를 함께 기록하면 개인 이력 관리에 도움이 됩니다.",
    ),
    "ACH_SETUP": (
        "악기 셋업(넥, 현고, 인토네이션 등) 점검 또는 작업 기록을 남기면 달성됩니다.",
        "작업 전/후 상태를 노트로 남기고 필요하면 사진 첨부 후 수동 수령하세요.",
    ),
    "ACH_NEW_STRINGS": (
        "현 교체 후 동일 구절을 비교 기록해 톤 변화를 확인하면 달성됩니다.",
        "교체 전/후 녹음 두 개를 남기면 가장 정확하게 비교할 수 있습니다.",
    ),
    "ACH_TEACH": (
        "연습법이나 팁을 글/영상으로 정리해 공유하면 달성됩니다.",
        "공유 링크를 남기고 수동 수령하세요. 본인 복습용으로도 큰 효과가 있습니다.",
    ),
    "ACH_FEEDBACK": (
        "피드백을 반영해 리메이크 버전을 기록하면 달성됩니다.",
        "수정 전/후 차이를 노트에 적고 결과물을 첨부하면 성장 추적이 쉬워집니다.",
    ),
}


def _to_int(raw: str | int | float, default: int = 0) -> int:
    try:
        return int(float(raw))
    except (TypeError, ValueError):
        return default


def _parse_json(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def _tag_list(labels: list[str]) -> str:
    values = [TAG_LABELS.get(label, label) for label in labels if label]
    return ", ".join(values)


def _condition_text(rule_filter: dict) -> str:
    parts: list[str] = []

    boss_type = str(rule_filter.get("boss_type", "")).strip().upper()
    if boss_type:
        parts.append(f"{BOSS_LABELS.get(boss_type, boss_type)} 보스 클리어")
    else:
        event_type = str(rule_filter.get("event_type", "")).strip().upper()
        if event_type:
            parts.append(EVENT_LABELS.get(event_type, event_type))

    min_duration = _to_int(rule_filter.get("min_duration"), 0)
    if min_duration > 0:
        parts.append(f"세션당 {min_duration}분 이상")

    tags_all = [str(tag).upper() for tag in rule_filter.get("tags_all", [])]
    tags_any = [str(tag).upper() for tag in rule_filter.get("tags_any", [])]
    if rule_filter.get("tag_core"):
        tags_all.append(str(rule_filter.get("tag_core")).upper())
    if rule_filter.get("tag_quick"):
        tags_all.append(str(rule_filter.get("tag_quick")).upper())

    if tags_all:
        parts.append(f"필수 태그: {_tag_list(tags_all)}")
    if tags_any:
        parts.append(f"선택 태그: {_tag_list(tags_any)}")

    source_any = [str(src).upper() for src in rule_filter.get("source_any", [])]
    if source_any:
        readable = ", ".join(SOURCE_LABELS.get(src, src) for src in source_any)
        parts.append(f"기록 경로: {readable}")

    return " / ".join(parts) if parts else "기록"


def _description_and_hint(row: dict[str, str]) -> tuple[str, str]:
    rule = str(row.get("rule_type", "")).strip().lower()
    group_id = row.get("group_id", "")
    target = max(1, _to_int(row.get("target"), 1))
    rule_filter = _parse_json(row.get("rule_filter"))

    if rule == "manual":
        if group_id in MANUAL_COPY:
            return MANUAL_COPY[group_id]
        return (
            f"수동 인증 업적입니다. 챌린지 조건을 직접 수행한 뒤 수령 버튼으로 완료하세요. 목표 횟수: {target}회.",
            "권장 증빙: 세션 노트, 첨부 파일(오디오/영상/이미지), URL 링크. 기록을 남겨두면 나중에 비교가 쉬워집니다.",
        )

    if rule == "count_events":
        return (
            f"{_condition_text(rule_filter)} 조건을 만족하는 기록을 누적 {target}회 달성하세요.",
            "자동 집계 업적입니다. 세션을 저장할 때 태그와 활동을 정확히 선택하면 진행도가 올바르게 반영됩니다.",
        )
    if rule == "sum_duration":
        return (
            f"{_condition_text(rule_filter)} 조건으로 누적 연습 시간을 {target}분 이상 달성하세요.",
            "자동 집계 업적입니다. 짧은 세션을 자주 쌓아도 누적 시간에 정상 반영됩니다.",
        )
    if rule == "sum_xp":
        return (
            f"전체 기록에서 획득한 누적 XP를 {target} 이상 달성하세요.",
            "자동 집계 업적입니다. 세션/퀘스트/업적 보상 XP가 모두 합산됩니다.",
        )
    if rule == "distinct_count":
        field = str(rule_filter.get("field", "")).strip()
        subject = DISTINCT_FIELD_LABELS.get(field, f"서로 다른 {field}" if field else "서로 다른 항목")
        return (
            f"{_condition_text(rule_filter)} 기준으로 {subject}을(를) {target}개 이상 달성하세요.",
            "중복 항목은 1개로만 계산됩니다. 새 곡/새 드릴처럼 고유 항목을 늘려야 진행됩니다.",
        )
    if rule == "streak_weekly":
        min_sessions = max(1, _to_int(rule_filter.get("min_sessions"), 1))
        min_duration = max(0, _to_int(rule_filter.get("min_duration"), 0))
        min_core = max(0, _to_int(rule_filter.get("min_core_sessions"), 0))
        sentence = f"주간 {min_sessions}회 이상"
        if min_duration > 0:
            sentence += f"(세션당 {min_duration}분 이상)"
        if min_core > 0:
            sentence += f" + 기본기(Core) {min_core}회 이상"
        return (
            f"{sentence} 조건을 연속 {target}주 유지하세요.",
            "주간 연속 업적입니다. 중간에 조건 미달 주간이 생기면 스트릭이 끊길 수 있습니다.",
        )
    if rule == "streak_monthly":
        min_sessions = max(1, _to_int(rule_filter.get("min_sessions_per_month"), 1))
        return (
            f"월간 {min_sessions}회 이상 세션 조건을 연속 {target}개월 유지하세요.",
            "월 단위 루틴 업적입니다. 월말에 몰아서 하지 말고 주차별로 분산하면 안정적으로 달성됩니다.",
        )
    if rule == "boss_monthly":
        boss = BOSS_LABELS.get(str(rule_filter.get("boss_type", "")).upper(), "보스")
        return (
            f"{boss} 보스 클리어가 발생한 달을 누적 {target}개월 달성하세요.",
            "같은 달에 여러 번 클리어해도 1개월로 계산됩니다. 달 단위로 꾸준히 보스를 완료하세요.",
        )
    if rule == "level_reach":
        return (
            f"플레이어 레벨 {target}에 도달하세요.",
            "자동 집계 업적입니다. 전체 XP가 누적되면 레벨이 상승하며 즉시 반영됩니다.",
        )

    return ("업적 조건을 달성하면 자동으로 진행됩니다.", "세션 기록과 태그 정보를 정확히 남겨 진행도를 확인하세요.")


def main() -> None:
    with DESIGN_CSV.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        headers = reader.fieldnames or []
        rows = [dict(row) for row in reader]

    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        grouped[row.get("group_id", "")].append(row)

    remove_groups = set(REMOVE_GIMMICK_GROUPS)
    for group_id, members in grouped.items():
        rules = {str(item.get("rule_type", "")).strip().lower() for item in members}
        if rules == {"manual"} and len(members) > 1:
            remove_groups.add(group_id)

    kept_rows: list[dict[str, str]] = []
    for row in rows:
        if row.get("group_id") in remove_groups:
            continue
        if row.get("achievement_id", "").startswith("ACHX_"):
            continue

        row["category"] = CATEGORY_RENAME.get(row.get("category", ""), row.get("category", ""))
        description, hint = _description_and_hint(row)
        row["description"] = description
        row["evidence_hint"] = hint
        kept_rows.append(row)

    with DESIGN_CSV.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=headers)
        writer.writeheader()
        for row in kept_rows:
            writer.writerow({key: row.get(key, "") for key in headers})

    app_headers = list(headers) + ["is_hidden", "hint", "auto_grant", "ui_badge_style"]
    app_rows: list[dict[str, str]] = []
    for row in kept_rows:
        manual = str(row.get("rule_type", "")).strip().lower() == "manual"
        app_rows.append(
            {
                **{key: row.get(key, "") for key in headers},
                "is_hidden": "false",
                "hint": "",
                "auto_grant": "false" if manual else "true",
                "ui_badge_style": "default",
            }
        )

    with APP_CSV.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=app_headers)
        writer.writeheader()
        for row in app_rows:
            writer.writerow({key: row.get(key, "") for key in app_headers})

    print(f"achievement rows: {len(rows)} -> {len(kept_rows)}")
    print(f"removed groups: {len(remove_groups)}")


if __name__ == "__main__":
    main()
