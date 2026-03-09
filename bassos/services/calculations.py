"""Core calculation logic for XP, levels, quests, and achievements."""

from __future__ import annotations

import json
import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from bassos.utils.time_utils import parse_dt


def to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def to_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def split_tags(raw: str | None) -> set[str]:
    if not raw:
        return set()
    return {token.strip().upper() for token in raw.split(";") if token.strip()}


def event_tags(event: dict[str, str]) -> set[str]:
    return split_tags(event.get("tags"))


def parse_json(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        return {}


def event_datetime(event: dict[str, str]) -> datetime | None:
    # Session analytics should be anchored to activity time, not write time.
    return parse_dt(event.get("start_at")) or parse_dt(event.get("created_at")) or parse_dt(event.get("end_at"))


def event_date(event: dict[str, str]) -> date | None:
    dt = event_datetime(event)
    return dt.date() if dt else None


def session_xp_breakdown(payload: dict[str, Any], settings: dict[str, Any]) -> dict[str, Any]:
    duration = to_int(payload.get("duration_min"), 0)
    session_cfg = settings.get("xp", {}).get("session", {})
    per_min = to_int(session_cfg.get("per_min"), 3)
    base_xp = max(0, duration) * max(0, per_min)
    bonus_breakdown: dict[str, int] = {}
    bonus_xp = 0
    total = base_xp
    session_multiplier = to_float(settings.get("critical", {}).get("session_xp_multiplier"), 1.0)
    total = int(round(total * session_multiplier))
    if payload.get("is_backfill"):
        multiplier = to_float(settings.get("xp", {}).get("backfill_multiplier"), 0.5)
        total = int(round(total * multiplier))

    return {
        "duration_min": duration,
        "base_xp": int(base_xp),
        "bonus_xp": int(bonus_xp),
        "bonus_breakdown": bonus_breakdown,
        "total_xp": int(total),
        "tags": sorted({str(tag).upper() for tag in payload.get("tags", []) if str(tag).strip()}),
    }


@dataclass
class LevelSummary:
    total_xp: int
    level: int
    current_level_xp: int
    xp_to_next: int
    progress: float
    rank: str


def xp_to_next(level: int, level_curve: dict[str, Any]) -> int:
    l = max(level, 1)
    curve_type = str(level_curve.get("type") or "quadratic").strip().lower()
    if curve_type == "decade_linear":
        base = to_float(level_curve.get("base"), 220.0)
        slope = to_float(level_curve.get("slope"), 5.0)
        step_10 = to_float(level_curve.get("step_10"), 50.0)
        step_20 = to_float(level_curve.get("step_20"), 110.0)
        step_30 = to_float(level_curve.get("step_30"), 240.0)
        step_40 = to_float(level_curve.get("step_40"), 434.0)
        step = 0.0
        if l >= 40:
            step = step_40
        elif l >= 30:
            step = step_30
        elif l >= 20:
            step = step_20
        elif l >= 10:
            step = step_10
        needed = base + slope * (l - 1) + step
    else:
        a = to_float(level_curve.get("a"), 230.0)
        b = to_float(level_curve.get("b"), 13.0)
        c = to_float(level_curve.get("c"), 1.1)
        needed = a + b * (l - 1) + c * ((l - 1) ** 2)
    return max(1, int(round(needed)))


def compute_level_summary(total_xp: int, settings: dict[str, Any]) -> LevelSummary:
    curve = settings.get("level_curve", {})
    max_level = to_int(curve.get("max_level"), 50)
    if max_level < 1:
        max_level = 50
    remaining = max(total_xp, 0)
    level = 1
    needed = xp_to_next(level, curve)
    while remaining >= needed and level < max_level:
        remaining -= needed
        level += 1
        needed = xp_to_next(level, curve)
    if level >= max_level:
        progress = 1.0
        current_level_xp = needed
    else:
        progress = 0.0 if needed <= 0 else min(1.0, remaining / needed)
        current_level_xp = int(remaining)
    rank = "Bronze"
    for item in curve.get("rank_thresholds", []):
        if level >= to_int(item.get("min_level"), 1):
            rank = item.get("rank", rank)
    return LevelSummary(
        total_xp=int(total_xp),
        level=level,
        current_level_xp=current_level_xp,
        xp_to_next=int(needed),
        progress=progress,
        rank=rank,
    )


def total_xp_from_events(events: list[dict[str, str]]) -> int:
    return int(sum(to_int(e.get("xp"), 0) for e in events))


def _to_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (list, tuple, set)):
        return ";".join(_to_text(item) for item in value if _to_text(item))
    return str(value)


def _to_lower_set(value: Any) -> set[str]:
    if isinstance(value, list):
        return {str(item).strip().lower() for item in value if str(item).strip()}
    if isinstance(value, str):
        return {token.strip().lower() for token in value.replace(";", ",").split(",") if token.strip()}
    return set()


OP_COMPATIBILITY: dict[str, set[str]] = {
    # any = text/number/bool/list can all be compared via normalized string representation.
    "eq": {"any"},
    "ne": {"any"},
    # Numeric comparisons are only meaningful for number-like values.
    "gt": {"number"},
    "gte": {"number"},
    "lt": {"number"},
    "lte": {"number"},
    # Membership/text checks.
    "contains": {"text", "list"},
    "in": {"any"},
    "not_in": {"any"},
    "exists": {"any"},
    "not_exists": {"any"},
}


def _value_kind(value: Any) -> str:
    if isinstance(value, (list, tuple, set)):
        return "list"
    if isinstance(value, bool):
        return "bool"
    if value is None:
        return "text"
    numeric = to_float(value, float("nan"))
    if not math.isnan(numeric):
        return "number"
    return "text"


def _resolve_feature(
    event: dict[str, str],
    field: str,
    feature_context: dict[str, dict[str, dict[str, str]]] | None = None,
) -> Any:
    key = str(field or "").strip()
    if not key:
        return ""
    if "." not in key:
        if key == "tags":
            return sorted(event_tags(event))
        return event.get(key, "")

    head, tail = key.split(".", 1)
    head = head.strip().lower()
    tail = tail.strip()
    if not tail:
        return ""
    if head == "event":
        dt = event_datetime(event)
        if tail == "hour_local":
            return dt.hour if dt else ""
        if tail == "weekday":
            # Monday=0 ... Sunday=6
            return dt.weekday() if dt else ""
        if tail == "month":
            return dt.month if dt else ""
        if tail == "is_weekend":
            return bool(dt and dt.weekday() >= 5)
        if tail == "date":
            return dt.date().isoformat() if dt else ""
        return ""
    ctx = feature_context or {}
    if head == "song":
        song_id = str(event.get("song_library_id") or "").strip()
        if not song_id:
            return ""
        return ctx.get("song_by_id", {}).get(song_id, {}).get(tail, "")
    if head == "drill":
        drill_id = str(event.get("drill_id") or "").strip()
        if not drill_id:
            return ""
        return ctx.get("drill_by_id", {}).get(drill_id, {}).get(tail, "")
    if head == "quest":
        meta = parse_json(event.get("meta_json"))
        quest_meta = meta.get("quest")
        if isinstance(quest_meta, dict):
            return quest_meta.get(tail, "")
        return ""
    if head == "minigame":
        meta = parse_json(event.get("meta_json"))
        minigame_meta = meta.get("minigame")
        if isinstance(minigame_meta, dict):
            return minigame_meta.get(tail, meta.get(tail, ""))
        return meta.get(tail, "")
    return ""


def _match_condition(
    event: dict[str, str],
    condition: dict[str, Any],
    feature_context: dict[str, dict[str, dict[str, str]]] | None = None,
) -> bool:
    field = str(condition.get("field") or "").strip()
    op = str(condition.get("op") or "eq").strip().lower()
    raw_value = condition.get("value")
    if not field:
        return True

    actual = _resolve_feature(event, field, feature_context)
    actual_text = _to_text(actual).strip()
    expected_text = _to_text(raw_value).strip()
    op_supported = OP_COMPATIBILITY.get(op, {"any"})
    actual_kind = _value_kind(actual)
    if "any" not in op_supported and actual_kind not in op_supported:
        return False

    if op == "exists":
        return bool(actual_text)
    if op == "not_exists":
        return not bool(actual_text)
    if op == "contains":
        if isinstance(actual, (list, tuple, set)):
            return expected_text.lower() in {str(item).strip().lower() for item in actual}
        return expected_text.lower() in actual_text.lower()
    if op == "in":
        return actual_text.lower() in _to_lower_set(raw_value)
    if op == "not_in":
        return actual_text.lower() not in _to_lower_set(raw_value)

    a_num = to_float(actual, float("nan"))
    b_num = to_float(raw_value, float("nan"))
    if not math.isnan(a_num) and not math.isnan(b_num):
        if op == "gt":
            return a_num > b_num
        if op == "gte":
            return a_num >= b_num
        if op == "lt":
            return a_num < b_num
        if op == "lte":
            return a_num <= b_num

    if op == "ne":
        return actual_text.lower() != expected_text.lower()
    return actual_text.lower() == expected_text.lower()


def _match_condition_tree_node(
    event: dict[str, str],
    node: Any,
    feature_context: dict[str, dict[str, dict[str, str]]] | None = None,
    depth: int = 0,
) -> bool:
    if not isinstance(node, dict):
        return True
    if depth > 8:
        return True
    node_type = str(node.get("type") or "").strip().lower()
    if node_type == "condition":
        return _match_condition(event, node, feature_context)
    if node_type == "group":
        logic = str(node.get("logic") or "all").strip().lower()
        children = node.get("children")
        if not isinstance(children, list):
            return True
        checks = [_match_condition_tree_node(event, child, feature_context, depth + 1) for child in children if isinstance(child, dict)]
        if not checks:
            return True
        return any(checks) if logic == "any" else all(checks)
    return True


def _apply_condition_tree(
    events: list[dict[str, str]],
    rule_filter: dict[str, Any],
    feature_context: dict[str, dict[str, dict[str, str]]] | None = None,
) -> list[dict[str, str]]:
    tree = rule_filter.get("condition_tree")
    if not isinstance(tree, dict):
        return events
    out: list[dict[str, str]] = []
    for event in events:
        if _match_condition_tree_node(event, tree, feature_context):
            out.append(event)
    return out


def filter_events(
    events: list[dict[str, str]],
    rule_filter: dict[str, Any],
    feature_context: dict[str, dict[str, dict[str, str]]] | None = None,
) -> list[dict[str, str]]:
    filtered = list(events)
    event_type = rule_filter.get("event_type")
    if event_type:
        filtered = [e for e in filtered if (e.get("event_type") or "").upper() == str(event_type).upper()]

    min_duration = rule_filter.get("min_duration")
    if min_duration is not None:
        filtered = [e for e in filtered if to_int(e.get("duration_min"), 0) >= to_int(min_duration, 0)]

    tags_all = [str(t).upper() for t in rule_filter.get("tags_all", [])]
    if tags_all:
        filtered = [e for e in filtered if all(tag in event_tags(e) for tag in tags_all)]

    tags_any = [str(t).upper() for t in rule_filter.get("tags_any", [])]
    if tags_any:
        filtered = [e for e in filtered if any(tag in event_tags(e) for tag in tags_any)]

    if rule_filter.get("tag_core"):
        core_tag = str(rule_filter["tag_core"]).upper()
        filtered = [e for e in filtered if core_tag in event_tags(e)]

    source_any = rule_filter.get("source_any")
    if source_any:
        allowed = {str(v).lower() for v in source_any}
        filtered = [e for e in filtered if (e.get("source") or "").lower() in allowed]

    return _apply_condition_tree(filtered, rule_filter, feature_context)


def evaluate_rule(
    rule_type: str,
    rule_filter: dict[str, Any],
    target: int,
    events: list[dict[str, str]],
    settings: dict[str, Any],
    feature_context: dict[str, dict[str, dict[str, str]]] | None = None,
) -> tuple[int, bool]:
    rule = (rule_type or "").strip().lower()
    target = max(target, 1)

    if rule == "manual":
        return 0, False

    if rule == "sum_xp":
        if rule_filter.get("all_events"):
            progress = total_xp_from_events(events)
        else:
            progress = sum(to_int(e.get("xp")) for e in filter_events(events, rule_filter, feature_context))
        return progress, progress >= target

    if rule == "level_reach":
        total_xp = total_xp_from_events(events)
        level = compute_level_summary(total_xp, settings).level
        return level, level >= target

    filtered = filter_events(events, rule_filter, feature_context)

    if rule == "count_events":
        progress = len(filtered)
        return progress, progress >= target

    if rule == "sum_duration":
        progress = sum(to_int(e.get("duration_min"), 0) for e in filtered)
        return progress, progress >= target

    if rule == "distinct_count":
        field = str(rule_filter.get("field") or "").strip()
        if not field:
            return 0, False
        if "." in field:
            distinct = {
                _to_text(_resolve_feature(e, field, feature_context)).strip()
                for e in filtered
                if _to_text(_resolve_feature(e, field, feature_context)).strip()
            }
        else:
            distinct = {e.get(field, "").strip() for e in filtered if e.get(field, "").strip()}
        progress = len(distinct)
        return progress, progress >= target

    if rule == "streak_weekly":
        progress = _weekly_streak(events, rule_filter)
        return progress, progress >= target

    if rule == "streak_monthly":
        progress = _monthly_streak(events, rule_filter)
        return progress, progress >= target

    return 0, False


def _weekly_streak(events: list[dict[str, str]], rule_filter: dict[str, Any]) -> int:
    sessions = filter_events(events, {**rule_filter, "event_type": "SESSION"})
    by_week: dict[tuple[int, int], list[dict[str, str]]] = defaultdict(list)
    for event in sessions:
        dt = event_date(event)
        if not dt:
            continue
        year, week, _ = dt.isocalendar()
        by_week[(year, week)].append(event)
    if not by_week:
        return 0

    min_sessions = to_int(rule_filter.get("min_sessions"), 0)
    min_core = to_int(rule_filter.get("min_core_sessions"), 0)
    core_tag = str(rule_filter.get("tag_core", "CORE")).upper()

    keys = sorted(by_week.keys(), reverse=True)
    streak = 0
    prev: tuple[int, int] | None = None
    for key in keys:
        year, week = key
        if prev:
            prev_year, prev_week = prev
            expected_prev = (prev_year, prev_week - 1) if prev_week > 1 else (prev_year - 1, 52)
            if key != expected_prev:
                break
        events_in_week = by_week[key]
        total = len(events_in_week)
        core = sum(1 for event in events_in_week if core_tag in event_tags(event))
        if total >= min_sessions and core >= min_core:
            streak += 1
            prev = key
            continue
        break
    return streak


def _monthly_streak(events: list[dict[str, str]], rule_filter: dict[str, Any]) -> int:
    sessions = filter_events(events, {**rule_filter, "event_type": "SESSION"})
    by_month: dict[tuple[int, int], int] = defaultdict(int)
    for event in sessions:
        dt = event_date(event)
        if not dt:
            continue
        by_month[(dt.year, dt.month)] += 1

    if not by_month:
        return 0

    min_sessions = to_int(rule_filter.get("min_sessions_per_month"), 1)
    keys = sorted(by_month.keys(), reverse=True)
    streak = 0
    prev: tuple[int, int] | None = None
    for key in keys:
        year, month = key
        if prev:
            prev_year, prev_month = prev
            if prev_month == 1:
                expected_prev = (prev_year - 1, 12)
            else:
                expected_prev = (prev_year, prev_month - 1)
            if key != expected_prev:
                break
        if by_month[key] >= min_sessions:
            streak += 1
            prev = key
            continue
        break
    return streak
