"""Motivation and coaching message helpers."""

from __future__ import annotations

from typing import Any

from bassos.services.calculations import to_int


def _latest_week_session_count(stats: dict[str, Any]) -> int:
    weekly = stats.get("weekly", [])
    if not isinstance(weekly, list) or not weekly:
        return 0
    latest = weekly[-1] if isinstance(weekly[-1], dict) else {}
    return max(0, to_int(latest.get("session_count"), 0))


def _latest_week_xp(stats: dict[str, Any]) -> int:
    weekly = stats.get("weekly", [])
    if not isinstance(weekly, list) or not weekly:
        return 0
    latest = weekly[-1] if isinstance(weekly[-1], dict) else {}
    return max(0, to_int(latest.get("xp"), 0))


def _remaining_to_week_goal(settings: dict[str, Any], stats: dict[str, Any]) -> int:
    goal = max(1, to_int(settings.get("profile", {}).get("weekly_goal_sessions"), 3))
    done = _latest_week_session_count(stats)
    return max(0, goal - done)


def build_session_coach_feedback(
    *,
    duration_min: int,
    gained_xp: int,
    daily_cap_reduced: int,
    before_level: int,
    after_level: int,
    after_hud: dict[str, Any],
    stats: dict[str, Any],
    settings: dict[str, Any],
) -> dict[str, Any]:
    reasons: list[str] = []
    lines: list[str] = []

    if after_level > before_level:
        reasons.append("LEVEL_UP")
        lines.append(f"레벨업 성공. {duration_min}분 집중으로 +{gained_xp}XP 확보")

    if duration_min >= 45:
        reasons.append("LONG_SESSION")
        lines.append(f"롱런 좋습니다. {duration_min}분 페이스 유지 완료")
    elif duration_min >= 25:
        reasons.append("FOCUS_BLOCK")
        lines.append(f"집중 블록 완료. {duration_min}분 세션으로 루틴 고정")

    if gained_xp >= 140:
        reasons.append("HIGH_XP")
        lines.append(f"보상 강하게 받았습니다. 이번 세션 +{gained_xp}XP")

    week_xp = _latest_week_xp(stats)
    if week_xp >= 300:
        reasons.append("WEEKLY_MOMENTUM")
        lines.append(f"이번 주 누적 {week_xp}XP. 텐션이 살아있습니다")

    if daily_cap_reduced > 0:
        reasons.append("DAILY_CAP")
        lines.append(f"오늘 세션 캡으로 {daily_cap_reduced}XP 보정됨")

    if not lines:
        lines.append(f"{duration_min}분 기록 완료. 오늘 흐름 좋습니다 (+{gained_xp}XP)")

    level_remain = max(0, to_int(after_hud.get("xp_to_next"), 0) - to_int(after_hud.get("current_level_xp"), 0))
    remain_sessions = _remaining_to_week_goal(settings, stats)
    if remain_sessions > 0:
        next_hint = f"다음 액션: 이번 주 목표까지 {remain_sessions}세션 남음. 다음 레벨까지 {level_remain}XP"
    else:
        next_hint = f"다음 액션: 주간 목표 달성 완료. 다음 레벨까지 {level_remain}XP"

    coach_message = f"{lines[0]}. {next_hint}"
    return {
        "coach_message": coach_message,
        "coach_reason_tags": reasons,
        "next_win_hint": next_hint,
    }

