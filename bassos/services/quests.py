"""Quest management services."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from bassos.constants import QUEST_HEADERS
from bassos.services.calculations import evaluate_rule, to_int
from bassos.services.events import create_event_row, filter_finalized_events
from bassos.services.storage import Storage

PERIOD_ORDER = {"short": 0, "mid": 1, "long": 2}
DIFFICULTY_ORDER = {"low": 0, "mid": 1, "high": 2}
PRIORITY_ORDER = {"urgent": 0, "normal": 1, "low": 2}
STATUS_ACTIVE = "Active"
STATUS_CLAIMED = "Claimed"
STATUS_FAILED = "Failed"
STATUS_EXPIRED = "Expired"
DEFAULT_PERIOD_DAYS = {"short": 7, "mid": 30, "long": 90}
QUEST_RULE_TYPES = {"count_events", "sum_duration", "manual"}

XP_MATRIX: dict[str, dict[str, int]] = {
    "short": {"low": 80, "mid": 110, "high": 140},
    "mid": {"low": 150, "mid": 210, "high": 280},
    "long": {"low": 260, "mid": 360, "high": 480},
}


@dataclass
class QuestState:
    quest_id: str
    title: str
    emoji: str
    description: str
    status: str
    xp_reward: int
    start_date: str
    due_date: str
    period_class: str
    difficulty: str
    priority: str
    auto_generated: bool
    resolved_at: str | None
    genre_tags: list[str]
    linked_song_ids: list[str]
    linked_drill_ids: list[str]
    rule_type: str
    progress: int
    target: int
    claimable: bool
    source: str


def _safe_json(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    text = str(raw or "").strip()
    if not text:
        return {}
    try:
        value = json.loads(text)
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        return {}


def _parse_csv_or_json_list(raw: Any) -> list[str]:
    if isinstance(raw, list):
        values = [str(item or "").strip() for item in raw]
        return [item for item in values if item]
    text = str(raw or "").strip()
    if not text:
        return []
    if text.startswith("[") and text.endswith("]"):
        try:
            decoded = json.loads(text)
            if isinstance(decoded, list):
                values = [str(item or "").strip() for item in decoded]
                return [item for item in values if item]
        except json.JSONDecodeError:
            pass
    values = [item.strip() for item in text.replace(";", ",").split(",")]
    return [item for item in values if item]


def _feature_context(storage: Storage) -> dict[str, dict[str, dict[str, str]]]:
    song_by_id = {
        str(row.get("library_id") or "").strip(): row
        for row in storage.read_csv("song_library.csv")
        if str(row.get("library_id") or "").strip()
    }
    drill_by_id = {
        str(row.get("drill_id") or "").strip(): row
        for row in storage.read_csv("drill_library.csv")
        if str(row.get("drill_id") or "").strip()
    }
    return {"song_by_id": song_by_id, "drill_by_id": drill_by_id}


def _normalize_period(raw: Any) -> str:
    token = str(raw or "").strip().lower()
    if token in PERIOD_ORDER:
        return token
    return "mid"


def _normalize_difficulty(raw: Any) -> str:
    token = str(raw or "").strip().lower()
    if token in DIFFICULTY_ORDER:
        return token
    return "mid"


def _normalize_priority(raw: Any) -> str:
    token = str(raw or "").strip().lower()
    if token in PRIORITY_ORDER:
        return token
    return "normal"


def _normalize_rule_type(raw: Any) -> str:
    token = str(raw or "").strip().lower()
    if token in QUEST_RULE_TYPES:
        return token
    return "count_events"


def _normalize_status(raw: Any) -> str:
    token = str(raw or "").strip().lower()
    if token == "claimed":
        return STATUS_CLAIMED
    if token == "failed":
        return STATUS_FAILED
    if token == "expired":
        return STATUS_EXPIRED
    return STATUS_ACTIVE


def _to_bool(raw: Any) -> bool:
    if isinstance(raw, bool):
        return raw
    return str(raw or "").strip().lower() in {"1", "true", "yes", "on"}


def _to_bool_text(raw: Any) -> str:
    return "true" if _to_bool(raw) else "false"


def _period_days(settings: dict[str, Any]) -> dict[str, int]:
    profile = settings.get("profile", {}) if isinstance(settings, dict) else {}
    quest_settings = profile.get("quest_settings", {}) if isinstance(profile, dict) else {}
    raw = quest_settings.get("period_days", {}) if isinstance(quest_settings, dict) else {}
    out: dict[str, int] = {}
    for key in ("short", "mid", "long"):
        try:
            out[key] = max(1, int(raw.get(key, DEFAULT_PERIOD_DAYS[key])))
        except (TypeError, ValueError):
            out[key] = DEFAULT_PERIOD_DAYS[key]
    return out


def _default_due_date(start: date, period_class: str, settings: dict[str, Any]) -> str:
    days = _period_days(settings).get(period_class, DEFAULT_PERIOD_DAYS["mid"])
    return (start + timedelta(days=days)).isoformat()


def _parse_iso_date(raw: str, fallback: date) -> date:
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return fallback


def _parse_iso_date_text(raw: Any, fallback: date) -> tuple[str, date]:
    text = str(raw or "").strip()
    if not text:
        return fallback.isoformat(), fallback
    parsed = _parse_iso_date(text, fallback)
    return parsed.isoformat(), parsed


def _slug_tag(value: str) -> str:
    token = "".join(ch if ch.isalnum() else "_" for ch in value.strip().upper())
    token = "_".join(part for part in token.split("_") if part)
    return token or "UNKNOWN"


def _quest_sort_key(item: QuestState) -> tuple[int, int, str, str]:
    return (
        PERIOD_ORDER.get(item.period_class, 99),
        PRIORITY_ORDER.get(item.priority, 99),
        item.due_date or "9999-12-31",
        item.quest_id,
    )


def _resolve_priority_tag(priority: str) -> str:
    return f"QUEST_PRIORITY_{priority.upper()}"


def _effective_xp(raw_xp: int, settings: dict[str, Any]) -> int:
    quest_multiplier = settings.get("critical", {}).get("quest_xp_multiplier", 0.15)
    try:
        q_mult = float(quest_multiplier)
    except (TypeError, ValueError):
        q_mult = 0.15
    return max(0, int(round(max(0, raw_xp) * q_mult)))


def _next_quest_id(rows: list[dict[str, str]]) -> str:
    existing = {str(row.get("quest_id") or "").strip() for row in rows}
    highest = 0
    for item in existing:
        match = re.fullmatch(r"QX(\d{4,})", item)
        if match:
            highest = max(highest, int(match.group(1)))
    seq = highest + 1 if highest > 0 else 1
    while True:
        candidate = f"QX{seq:04d}"
        if candidate not in existing:
            return candidate
        seq += 1


def compute_quest_xp(period_class: str, difficulty: str, rule_type: str) -> int:
    period = _normalize_period(period_class)
    diff = _normalize_difficulty(difficulty)
    base = XP_MATRIX[period][diff]
    if _normalize_rule_type(rule_type) == "manual":
        return max(1, int(round(base / 6.0)))
    return base


def _apply_model_filters(
    rule_filter: dict[str, Any],
    *,
    genre_tags: list[str],
    linked_song_ids: list[str],
    linked_drill_ids: list[str],
) -> dict[str, Any]:
    payload = dict(rule_filter)
    auto_conditions: list[dict[str, Any]] = []
    if genre_tags:
        auto_conditions.append({"type": "condition", "field": "song.genre", "op": "in", "value": genre_tags})
    if linked_song_ids:
        auto_conditions.append({"type": "condition", "field": "song_library_id", "op": "in", "value": linked_song_ids})
    if linked_drill_ids:
        auto_conditions.append({"type": "condition", "field": "drill_id", "op": "in", "value": linked_drill_ids})

    if auto_conditions:
        existing_tree = payload.get("condition_tree")
        if isinstance(existing_tree, dict):
            payload["condition_tree"] = {
                "type": "group",
                "logic": "all",
                "children": [existing_tree, *auto_conditions],
            }
        else:
            payload["condition_tree"] = {
                "type": "group",
                "logic": "all",
                "children": auto_conditions,
            }
    return payload


def _ensure_session_filter(rule_filter: dict[str, Any], rule_type: str) -> dict[str, Any]:
    payload = dict(rule_filter)
    if _normalize_rule_type(rule_type) == "manual":
        return payload
    if not str(payload.get("event_type") or "").strip():
        payload["event_type"] = "SESSION"
    return payload


def _normalize_quest_rows(storage: Storage, settings: dict[str, Any], today: date | None = None) -> list[dict[str, str]]:
    rows = storage.read_csv("quests.csv")
    today = today or date.today()
    normalized: list[dict[str, str]] = []
    changed = False

    for row in rows:
        start_text, start_value = _parse_iso_date_text(row.get("start_date"), today)
        period_class = _normalize_period(row.get("period_class"))
        due_fallback = _default_due_date(start_value, period_class, settings)
        due_text, _ = _parse_iso_date_text(row.get("due_date"), _parse_iso_date(due_fallback, start_value))
        status = _normalize_status(row.get("status"))
        resolved_at = str(row.get("resolved_at") or "").strip()
        quest_id = str(row.get("quest_id") or "").strip()
        auto_generated = _to_bool(row.get("auto_generated"))
        title = str(row.get("title") or "").strip()
        description = str(row.get("description") or "").strip()
        emoji = str(row.get("emoji") or "").strip()

        if status == STATUS_ACTIVE:
            due_date = _parse_iso_date(due_text, today)
            if due_date < today:
                status = STATUS_EXPIRED
                if not resolved_at:
                    resolved_at = datetime.combine(today, datetime.min.time()).isoformat(timespec="seconds")
                changed = True

        if auto_generated:
            auto_meta = {
                "short": {"label": "단기", "emoji": "⏱️"},
                "mid": {"label": "중기", "emoji": "🎯"},
                "long": {"label": "장기", "emoji": "🏁"},
            }[period_class]
            if not title or title.startswith("[Auto]") or title.startswith("[자동]"):
                title = f"[자동] {auto_meta['label']} 세션 시간"
            if (
                (not description)
                or description.startswith("Accumulate ")
                or description.endswith("session time.")
                or description.endswith("session minutes.")
            ):
                target_minutes = max(1, to_int(row.get("target"), 1))
                description = f"세션 시간 {target_minutes}분을 누적하세요."
            if not emoji:
                emoji = auto_meta["emoji"]

        normalized_row = {
            "quest_id": quest_id,
            "title": title,
            "emoji": emoji,
            "description": description,
            "status": status,
            "xp_reward": str(max(0, to_int(row.get("xp_reward"), 0))),
            "start_date": start_text,
            "due_date": due_text,
            "period_class": period_class,
            "difficulty": _normalize_difficulty(row.get("difficulty")),
            "priority": _normalize_priority(row.get("priority")),
            "auto_generated": _to_bool_text(auto_generated),
            "resolved_at": resolved_at,
            "genre_tags": json.dumps(_parse_csv_or_json_list(row.get("genre_tags")), ensure_ascii=False),
            "linked_song_ids": json.dumps(_parse_csv_or_json_list(row.get("linked_song_ids")), ensure_ascii=False),
            "linked_drill_ids": json.dumps(_parse_csv_or_json_list(row.get("linked_drill_ids")), ensure_ascii=False),
            "rule_type": _normalize_rule_type(row.get("rule_type")),
            "rule_filter": json.dumps(_safe_json(row.get("rule_filter")), ensure_ascii=False),
            "target": str(max(1, to_int(row.get("target"), 1))),
            "source": str(row.get("source") or "manual").strip() or "manual",
        }
        normalized.append(normalized_row)
        if any(str(row.get(key, "")) != normalized_row.get(key, "") for key in QUEST_HEADERS):
            changed = True

    if changed:
        storage.write_csv("quests.csv", normalized, headers=QUEST_HEADERS)
    return normalized


def _auto_settings_for_period(settings: dict[str, Any], period_class: str) -> dict[str, Any]:
    profile = settings.get("profile", {}) if isinstance(settings, dict) else {}
    quest_settings = profile.get("quest_settings", {}) if isinstance(profile, dict) else {}
    defaults = {
        "enabled": True,
        "target_minutes": {"short": 120, "mid": 360, "long": 900}[period_class],
        "priority": {"short": "normal", "mid": "normal", "long": "urgent"}[period_class],
        "difficulty": {"short": "low", "mid": "mid", "long": "high"}[period_class],
    }
    enabled_map = quest_settings.get("auto_enabled_by_period", {}) if isinstance(quest_settings, dict) else {}
    target_map = quest_settings.get("auto_target_minutes_by_period", {}) if isinstance(quest_settings, dict) else {}
    priority_map = quest_settings.get("auto_priority_by_period", {}) if isinstance(quest_settings, dict) else {}
    difficulty_map = quest_settings.get("auto_difficulty_by_period", {}) if isinstance(quest_settings, dict) else {}

    enabled_raw = enabled_map.get(period_class, defaults["enabled"]) if isinstance(enabled_map, dict) else defaults["enabled"]
    if isinstance(enabled_raw, str):
        enabled = enabled_raw.strip().lower() in {"1", "true", "yes", "on"}
    else:
        enabled = bool(enabled_raw)

    try:
        target_minutes = max(1, int(target_map.get(period_class, defaults["target_minutes"])))
    except (TypeError, ValueError):
        target_minutes = defaults["target_minutes"]

    priority = _normalize_priority(priority_map.get(period_class, defaults["priority"])) if isinstance(priority_map, dict) else defaults["priority"]
    difficulty = _normalize_difficulty(difficulty_map.get(period_class, defaults["difficulty"])) if isinstance(difficulty_map, dict) else defaults["difficulty"]

    return {
        "enabled": enabled,
        "target_minutes": target_minutes,
        "priority": priority,
        "difficulty": difficulty,
    }


def _build_auto_quest_row(
    rows: list[dict[str, str]],
    settings: dict[str, Any],
    period_class: str,
    today: date,
) -> dict[str, str]:
    cfg = _auto_settings_for_period(settings, period_class)
    difficulty = cfg["difficulty"]
    priority = cfg["priority"]
    target_minutes = cfg["target_minutes"]
    quest_id = _next_quest_id(rows)
    due_date = _default_due_date(today, period_class, settings)
    xp_reward = compute_quest_xp(period_class, difficulty, "sum_duration")
    period_meta = {
        "short": {"label": "단기", "emoji": "⏱️"},
        "mid": {"label": "중기", "emoji": "🎯"},
        "long": {"label": "장기", "emoji": "🏁"},
    }[period_class]
    title = f"[자동] {period_meta['label']} 세션 시간"
    description = f"세션 시간 {target_minutes}분을 누적하세요."
    return {
        "quest_id": quest_id,
        "title": title,
        "emoji": period_meta["emoji"],
        "description": description,
        "status": STATUS_ACTIVE,
        "xp_reward": str(xp_reward),
        "start_date": today.isoformat(),
        "due_date": due_date,
        "period_class": period_class,
        "difficulty": difficulty,
        "priority": priority,
        "auto_generated": "true",
        "resolved_at": "",
        "genre_tags": "[]",
        "linked_song_ids": "[]",
        "linked_drill_ids": "[]",
        "rule_type": "sum_duration",
        "rule_filter": json.dumps({"event_type": "SESSION"}, ensure_ascii=False),
        "target": str(target_minutes),
        "source": "auto",
    }


def _expire_quest_row(row: dict[str, str], now: datetime) -> None:
    row["status"] = STATUS_EXPIRED
    row["resolved_at"] = now.isoformat(timespec="seconds")


def refresh_auto_quests(
    storage: Storage,
    settings: dict[str, Any],
    now: datetime | None = None,
    period_class: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    now = now or datetime.now()
    today = now.date()
    rows = _normalize_quest_rows(storage, settings, today=today)

    target_periods = [period_class] if period_class in PERIOD_ORDER else ["short", "mid", "long"]
    created_ids: list[str] = []
    expired_ids: list[str] = []
    changed = False

    for period in target_periods:
        cfg = _auto_settings_for_period(settings, period)
        period_auto_rows = [
            row
            for row in rows
            if _normalize_period(row.get("period_class")) == period and _to_bool(row.get("auto_generated"))
        ]
        active_auto_rows = [
            row
            for row in period_auto_rows
            if _normalize_status(row.get("status")) == STATUS_ACTIVE
        ]

        if len(active_auto_rows) > 1:
            active_auto_rows.sort(key=lambda item: str(item.get("due_date") or "9999-12-31"))
            keep = active_auto_rows[0]
            for extra in active_auto_rows[1:]:
                _expire_quest_row(extra, now)
                expired_ids.append(str(extra.get("quest_id") or ""))
                changed = True
            active_auto_rows = [keep]

        active_row = active_auto_rows[0] if active_auto_rows else None

        if active_row:
            due_date = _parse_iso_date(str(active_row.get("due_date") or ""), today)
            if force or due_date < today:
                _expire_quest_row(active_row, now)
                expired_ids.append(str(active_row.get("quest_id") or ""))
                changed = True
                active_row = None

        if not cfg["enabled"]:
            continue

        if not force:
            has_period_lock = any(
                _normalize_status(row.get("status")) in {STATUS_ACTIVE, STATUS_CLAIMED, STATUS_FAILED}
                and _parse_iso_date(str(row.get("due_date") or ""), today) >= today
                for row in period_auto_rows
            )
            if has_period_lock:
                continue

        if active_row is None:
            new_row = _build_auto_quest_row(rows, settings, period, today)
            rows.append(new_row)
            created_ids.append(new_row["quest_id"])
            changed = True

    if changed:
        storage.write_csv("quests.csv", rows, headers=QUEST_HEADERS)
    return {"created_ids": created_ids, "expired_ids": expired_ids, "periods": target_periods}


def list_current_quests(storage: Storage, settings: dict[str, Any]) -> list[QuestState]:
    refresh_auto_quests(storage, settings, now=datetime.now())
    rows = _normalize_quest_rows(storage, settings)
    events = filter_finalized_events(storage.read_csv("events.csv"))
    feature_context = _feature_context(storage)
    out: list[QuestState] = []

    for row in rows:
        status = _normalize_status(row.get("status"))
        genre_tags = _parse_csv_or_json_list(row.get("genre_tags"))
        linked_song_ids = _parse_csv_or_json_list(row.get("linked_song_ids"))
        linked_drill_ids = _parse_csv_or_json_list(row.get("linked_drill_ids"))
        target = max(1, to_int(row.get("target"), 1))
        rule_type = _normalize_rule_type(row.get("rule_type"))
        base_rule_filter = _safe_json(row.get("rule_filter"))
        effective_filter = _ensure_session_filter(
            _apply_model_filters(
                base_rule_filter,
                genre_tags=genre_tags,
                linked_song_ids=linked_song_ids,
                linked_drill_ids=linked_drill_ids,
            ),
            rule_type,
        )
        progress, unlocked = evaluate_rule(rule_type, effective_filter, target, events, settings, feature_context=feature_context)
        if rule_type == "manual":
            progress = target
            unlocked = True
        claimable = status == STATUS_ACTIVE and unlocked
        resolved_at = str(row.get("resolved_at") or "").strip() or None
        raw_reward = max(0, to_int(row.get("xp_reward"), 0))
        out.append(
            QuestState(
                quest_id=str(row.get("quest_id") or ""),
                title=str(row.get("title") or ""),
                emoji=str(row.get("emoji") or ""),
                description=str(row.get("description") or ""),
                status=status,
                xp_reward=_effective_xp(raw_reward, settings),
                start_date=str(row.get("start_date") or ""),
                due_date=str(row.get("due_date") or ""),
                period_class=_normalize_period(row.get("period_class")),
                difficulty=_normalize_difficulty(row.get("difficulty")),
                priority=_normalize_priority(row.get("priority")),
                auto_generated=_to_bool(row.get("auto_generated")),
                resolved_at=resolved_at,
                genre_tags=genre_tags,
                linked_song_ids=linked_song_ids,
                linked_drill_ids=linked_drill_ids,
                rule_type=rule_type,
                progress=progress,
                target=target,
                claimable=claimable,
                source=str(row.get("source") or "manual"),
            )
        )

    out.sort(key=_quest_sort_key)
    return out


def create_custom_quest(storage: Storage, payload: dict[str, Any], settings: dict[str, Any], today: date | None = None) -> dict[str, str]:
    today = today or date.today()
    rows = _normalize_quest_rows(storage, settings, today=today)

    period_class = _normalize_period(payload.get("period_class"))
    difficulty = _normalize_difficulty(payload.get("difficulty"))
    priority = _normalize_priority(payload.get("priority"))
    rule_type = _normalize_rule_type(payload.get("rule_type"))
    title = str(payload.get("title") or "퀘스트").strip()
    emoji = str(payload.get("emoji") or "").strip()
    description = str(payload.get("description") or "").strip()
    target = max(1, to_int(payload.get("target"), 1))
    due_text = str(payload.get("due_date") or "").strip()
    if due_text:
        due_date = _parse_iso_date(due_text, today).isoformat()
    else:
        due_date = _default_due_date(today, period_class, settings)
    xp_reward = compute_quest_xp(period_class, difficulty, rule_type)
    rule_filter = _safe_json(payload.get("rule_filter"))
    rule_filter = _ensure_session_filter(rule_filter, rule_type)

    row = {
        "quest_id": _next_quest_id(rows),
        "title": title,
        "emoji": emoji,
        "description": description,
        "status": STATUS_ACTIVE,
        "xp_reward": str(xp_reward),
        "start_date": today.isoformat(),
        "due_date": due_date,
        "period_class": period_class,
        "difficulty": difficulty,
        "priority": priority,
        "auto_generated": "false",
        "resolved_at": "",
        "genre_tags": json.dumps(_parse_csv_or_json_list(payload.get("genre_tags")), ensure_ascii=False),
        "linked_song_ids": json.dumps(_parse_csv_or_json_list(payload.get("linked_song_ids")), ensure_ascii=False),
        "linked_drill_ids": json.dumps(_parse_csv_or_json_list(payload.get("linked_drill_ids")), ensure_ascii=False),
        "rule_type": rule_type,
        "rule_filter": json.dumps(rule_filter, ensure_ascii=False),
        "target": str(target),
        "source": str(payload.get("source") or "manual").strip() or "manual",
    }
    rows.append(row)
    storage.write_csv("quests.csv", rows, headers=QUEST_HEADERS)
    return row


def update_quest(
    storage: Storage,
    settings: dict[str, Any],
    quest_id: str,
    payload: dict[str, Any],
    now: datetime | None = None,
) -> tuple[bool, str, dict[str, str] | None]:
    now = now or datetime.now()
    rows = _normalize_quest_rows(storage, settings, today=now.date())
    row = next((item for item in rows if str(item.get("quest_id") or "") == quest_id), None)
    if not row:
        return False, "Quest not found.", None

    status = _normalize_status(row.get("status"))
    if status != STATUS_ACTIVE:
        return False, "Only active quests can be updated.", None

    allowed = {"title", "emoji", "description", "priority", "difficulty", "target", "due_date"}
    unknown = [key for key in payload.keys() if key not in allowed]
    if unknown:
        return False, f"unsupported fields: {', '.join(sorted(unknown))}", None

    changed = False

    if "title" in payload:
        title = str(payload.get("title") or "").strip()
        if not title:
            return False, "title is required", None
        if row.get("title") != title:
            row["title"] = title
            changed = True

    if "emoji" in payload:
        emoji = str(payload.get("emoji") or "").strip()
        if len(emoji) > 8:
            return False, "emoji must be 8 characters or less", None
        if row.get("emoji") != emoji:
            row["emoji"] = emoji
            changed = True

    if "description" in payload:
        description = str(payload.get("description") or "").strip()
        if row.get("description") != description:
            row["description"] = description
            changed = True

    if "priority" in payload:
        priority = str(payload.get("priority") or "").strip().lower()
        if priority not in PRIORITY_ORDER:
            return False, f"unsupported priority: {priority}", None
        if row.get("priority") != priority:
            row["priority"] = priority
            changed = True

    if "difficulty" in payload:
        difficulty = str(payload.get("difficulty") or "").strip().lower()
        if difficulty not in DIFFICULTY_ORDER:
            return False, f"unsupported difficulty: {difficulty}", None
        if row.get("difficulty") != difficulty:
            row["difficulty"] = difficulty
            changed = True

    if "target" in payload:
        target = max(1, to_int(payload.get("target"), 1))
        target_text = str(target)
        if str(row.get("target") or "") != target_text:
            row["target"] = target_text
            changed = True

    if "due_date" in payload:
        due_text = str(payload.get("due_date") or "").strip()
        if not due_text:
            return False, "due_date must be YYYY-MM-DD", None
        try:
            due_value = date.fromisoformat(due_text)
        except ValueError:
            return False, "due_date must be YYYY-MM-DD", None
        start_value = _parse_iso_date(str(row.get("start_date") or ""), now.date())
        if due_value < start_value:
            return False, "due_date must be on or after start_date", None
        if str(row.get("due_date") or "") != due_value.isoformat():
            row["due_date"] = due_value.isoformat()
            changed = True

    if not changed:
        return False, "No updatable fields provided.", None

    storage.write_csv("quests.csv", rows, headers=QUEST_HEADERS)
    return True, "Quest updated.", row


def claim_quest(storage: Storage, settings: dict[str, Any], quest_id: str, now: datetime) -> tuple[bool, str]:
    rows = _normalize_quest_rows(storage, settings, today=now.date())
    row = next((item for item in rows if str(item.get("quest_id") or "") == quest_id), None)
    if not row:
        return False, "Quest not found."
    status = _normalize_status(row.get("status"))
    if status == STATUS_CLAIMED:
        return False, "Quest is already claimed."
    if status != STATUS_ACTIVE:
        return False, "Only active quests can be claimed."

    events = filter_finalized_events(storage.read_csv("events.csv"))
    feature_context = _feature_context(storage)
    target = max(1, to_int(row.get("target"), 1))
    rule_type = _normalize_rule_type(row.get("rule_type"))
    genre_tags = _parse_csv_or_json_list(row.get("genre_tags"))
    linked_song_ids = _parse_csv_or_json_list(row.get("linked_song_ids"))
    linked_drill_ids = _parse_csv_or_json_list(row.get("linked_drill_ids"))
    merged_filter = _ensure_session_filter(
        _apply_model_filters(
            _safe_json(row.get("rule_filter")),
            genre_tags=genre_tags,
            linked_song_ids=linked_song_ids,
            linked_drill_ids=linked_drill_ids,
        ),
        rule_type,
    )
    progress, unlocked = evaluate_rule(
        rule_type,
        merged_filter,
        target,
        events,
        settings,
        feature_context=feature_context,
    )
    if rule_type == "manual":
        progress = target
        unlocked = True
    if not unlocked:
        return False, f"Quest is not complete yet. ({progress}/{target})"

    raw_reward = max(0, to_int(row.get("xp_reward"), 0))
    effective_reward = _effective_xp(raw_reward, settings)
    period_class = _normalize_period(row.get("period_class"))
    difficulty = _normalize_difficulty(row.get("difficulty"))
    priority = _normalize_priority(row.get("priority"))
    auto_generated = _to_bool(row.get("auto_generated"))
    primary_genre = genre_tags[0] if genre_tags else ""

    tags = {
        "QUEST",
        f"QUEST_PERIOD_{period_class.upper()}",
        f"QUEST_DIFF_{difficulty.upper()}",
        _resolve_priority_tag(priority),
    }
    tags.update(f"QUEST_GENRE_{_slug_tag(item)}" for item in genre_tags)
    event_meta = {
        "progress": progress,
        "target": target,
        "raw_reward": raw_reward,
        "quest": {
            "period_class": period_class,
            "difficulty": difficulty,
            "priority": priority,
            "genres": genre_tags,
            "genre_primary": primary_genre,
            "linked_song_ids": linked_song_ids,
            "linked_drill_ids": linked_drill_ids,
            "auto_generated": auto_generated,
        },
    }
    event = create_event_row(
        created_at=now,
        event_type="QUEST_CLAIM",
        xp=effective_reward,
        title=f"Quest: {row.get('title', quest_id)}",
        notes=f"Quest claimed ({progress}/{target})",
        quest_id=quest_id,
        tags=sorted(tags),
        meta=event_meta,
        source="app",
    )
    storage.append_csv_row("events.csv", event, storage.read_csv_headers("events.csv"))
    row["status"] = STATUS_CLAIMED
    row["resolved_at"] = now.isoformat(timespec="seconds")
    storage.write_csv("quests.csv", rows, headers=QUEST_HEADERS)
    return True, "Quest reward claimed."


def fail_quest(storage: Storage, settings: dict[str, Any], quest_id: str, now: datetime) -> tuple[bool, str]:
    rows = _normalize_quest_rows(storage, settings, today=now.date())
    row = next((item for item in rows if str(item.get("quest_id") or "") == quest_id), None)
    if not row:
        return False, "Quest not found."
    status = _normalize_status(row.get("status"))
    if status == STATUS_FAILED:
        return False, "Quest is already failed."
    if status == STATUS_CLAIMED:
        return False, "Claimed quest cannot be failed."
    if status != STATUS_ACTIVE:
        return False, "Only active quests can be failed."

    row["status"] = STATUS_FAILED
    row["resolved_at"] = now.isoformat(timespec="seconds")
    storage.write_csv("quests.csv", rows, headers=QUEST_HEADERS)
    period_class = _normalize_period(row.get("period_class"))
    difficulty = _normalize_difficulty(row.get("difficulty"))
    priority = _normalize_priority(row.get("priority"))
    tags = [
        "QUEST",
        "FAILED",
        f"QUEST_PERIOD_{period_class.upper()}",
        f"QUEST_DIFF_{difficulty.upper()}",
        _resolve_priority_tag(priority),
    ]
    event = create_event_row(
        created_at=now,
        event_type="QUEST_FAIL",
        xp=0,
        title=f"Quest Failed: {row.get('title', quest_id)}",
        notes="Quest marked as failed",
        quest_id=quest_id,
        tags=tags,
        meta={"quest": {"period_class": period_class, "difficulty": difficulty, "priority": priority}},
        source="app",
    )
    storage.append_csv_row("events.csv", event, storage.read_csv_headers("events.csv"))
    return True, "Quest marked as failed."
