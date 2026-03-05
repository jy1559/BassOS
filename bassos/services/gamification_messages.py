"""Gamification message selection helpers."""

from __future__ import annotations

import hashlib
import json
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from bassos.services.storage import Storage
from bassos.utils.time_utils import parse_dt

MESSAGE_FILENAME = "bass_gamification_messages_v2.json"

LONG_SESSION_MINUTES = 60
LONG_SESSION_STEP_90_MINUTES = 90
LONG_SESSION_MAX_MINUTES = 120

_CATALOG_CACHE: dict[str, tuple[int, dict[str, Any]]] = {}

_DEFAULT_TIER_RULES = [
    {"name": "bronze", "min_level": 1, "max_level": 9},
    {"name": "silver", "min_level": 10, "max_level": 19},
    {"name": "gold", "min_level": 20, "max_level": 29},
    {"name": "platinum", "min_level": 30, "max_level": 39},
    {"name": "diamond", "min_level": 40, "max_level": 49},
    {"name": "master", "min_level": 50, "max_level": 50},
]

_TIER_COLORS = {
    "bronze": "#C9855B",
    "silver": "#AAB6C7",
    "gold": "#E8BE4B",
    "platinum": "#6EC6D5",
    "diamond": "#6D8DFF",
    "master": "#F3A942",
}

_BADGE_ASSETS = {
    "bronze": "/assets/badges/bronze.svg",
    "silver": "/assets/badges/silver.svg",
    "gold": "/assets/badges/gold.svg",
    "platinum": "/assets/badges/platinum.svg",
    "diamond": "/assets/badges/diamond.svg",
    "master": "/assets/badges/diamond.svg",
}

_DEFAULT_CATALOG: dict[str, Any] = {
    "meta": {
        "tier_rules": _DEFAULT_TIER_RULES,
    },
    "session_end": {
        "general": [
            {"ko": "세션 완료! 리듬이 올라오고 있어요.", "en": "Session complete! Your groove is climbing."}
        ],
        "long_session": [
            {"ko": "긴 세션 완료! 집중력이 강해졌어요.", "en": "Long session complete! Focus level up."}
        ],
        "streak_days": {
            "mid_3plus": {
                "messages": [{"ko": "N일 연속! 흐름이 붙었어요.", "en": "N-day streak! Momentum locked."}]
            },
            "long_7plus": {
                "messages": [{"ko": "N일 연속! 꾸준함이 미쳤어요.", "en": "N-day streak! Consistency is elite."}]
            },
        },
        "streak_weeks": {
            "mid_4plus": {
                "messages": [{"ko": "N주 연속 시작! 주간 루틴 완성.", "en": "N-week streak started! Weekly loop complete."}]
            },
            "long_8plus": {
                "messages": [{"ko": "N주 연속! 시즌급 꾸준함.", "en": "N-week streak! Season-level consistency."}]
            },
        },
    },
    "level_up": {
        "by_level": {},
    },
}


def _stable_roll(seed: str) -> float:
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    value = int.from_bytes(digest[:8], "big")
    return value / float(2**64 - 1)


def _stable_index(seed: str, size: int) -> int:
    if size <= 1:
        return 0
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    value = int.from_bytes(digest[8:16], "big")
    return value % size


def _lang_text(item: dict[str, Any], lang: str) -> str:
    preferred = str(lang or "ko").strip().lower()
    if preferred not in {"ko", "en"}:
        preferred = "ko"
    if preferred == "ko":
        return str(item.get("ko") or item.get("en") or "")
    return str(item.get("en") or item.get("ko") or "")


def _message_paths(storage: Storage) -> list[Path]:
    ordered = [
        storage.paths.designpack_data / MESSAGE_FILENAME,
        storage.paths.runtime_data / MESSAGE_FILENAME,
    ]
    unique: list[Path] = []
    seen: set[str] = set()
    for path in ordered:
        key = str(path.resolve()) if path.exists() else str(path)
        if key in seen:
            continue
        seen.add(key)
        unique.append(path)
    return unique


def _load_catalog_from_path(path: Path) -> dict[str, Any]:
    cache_key = str(path.resolve()) if path.exists() else str(path)
    if path.exists():
        stamp = int(path.stat().st_mtime_ns)
        cached = _CATALOG_CACHE.get(cache_key)
        if cached and cached[0] == stamp:
            return cached[1]
        parsed = json.loads(path.read_text(encoding="utf-8-sig"))
        if not isinstance(parsed, dict):
            raise ValueError("catalog root must be an object")
        _CATALOG_CACHE[cache_key] = (stamp, parsed)
        return parsed
    return _DEFAULT_CATALOG


def load_catalog(storage: Storage) -> dict[str, Any]:
    for path in _message_paths(storage):
        if not path.exists():
            continue
        try:
            return _load_catalog_from_path(path)
        except (OSError, ValueError, json.JSONDecodeError):
            continue
    return _DEFAULT_CATALOG


def _tier_rules(catalog: dict[str, Any]) -> list[dict[str, Any]]:
    raw = (((catalog.get("meta") or {}).get("tier_rules")) if isinstance(catalog.get("meta"), dict) else None) or []
    if not isinstance(raw, list) or not raw:
        return _DEFAULT_TIER_RULES
    rules: list[dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip().lower()
        if not name:
            continue
        try:
            min_level = int(row.get("min_level"))
            max_level = int(row.get("max_level"))
        except (TypeError, ValueError):
            continue
        rules.append({"name": name, "min_level": min_level, "max_level": max_level})
    return rules or _DEFAULT_TIER_RULES


def tier_for_level(level: int, catalog: dict[str, Any]) -> str:
    safe_level = max(1, int(level))
    for row in _tier_rules(catalog):
        if row["min_level"] <= safe_level <= row["max_level"]:
            return row["name"]
    return "master" if safe_level >= 50 else "bronze"


def level_up_copy(storage: Storage, *, level: int, before_level: int, lang: str, seed_key: str = "") -> dict[str, Any]:
    catalog = load_catalog(storage)
    level_data = (((catalog.get("level_up") or {}).get("by_level")) if isinstance(catalog.get("level_up"), dict) else None) or {}
    row = level_data.get(str(max(1, int(level)))) if isinstance(level_data, dict) else None
    messages = []
    if isinstance(row, dict):
        raw_messages = row.get("messages")
        if isinstance(raw_messages, list):
            messages = [item for item in raw_messages if isinstance(item, dict)]

    seed = seed_key or f"level:{before_level}:{level}"
    if messages:
        selected = messages[_stable_index(seed, len(messages))]
        line = _lang_text(selected, lang)
    else:
        line = "LEVEL UP!"

    before_tier = tier_for_level(before_level, catalog)
    after_tier = tier_for_level(level, catalog)
    row_tier_up = row.get("tier_up") if isinstance(row, dict) else None
    if isinstance(row_tier_up, bool):
        tier_up = row_tier_up
    else:
        tier_up = before_tier != after_tier

    return {
        "line": line,
        "tier_up": bool(tier_up),
        "before_tier": before_tier,
        "after_tier": after_tier,
        "tier_color": _TIER_COLORS.get(after_tier, _TIER_COLORS["bronze"]),
        "badge_before": _BADGE_ASSETS.get(before_tier, _BADGE_ASSETS["bronze"]),
        "badge_after": _BADGE_ASSETS.get(after_tier, _BADGE_ASSETS["bronze"]),
    }


def long_session_probability(duration_min: int) -> float:
    safe = max(0, int(duration_min))
    if safe < LONG_SESSION_MINUTES:
        return 0.0
    if safe >= LONG_SESSION_MAX_MINUTES:
        return 1.0
    if safe >= LONG_SESSION_STEP_90_MINUTES:
        return 0.75
    return 0.5


def _session_datetime(event: dict[str, str]) -> Any:
    return parse_dt(event.get("start_at")) or parse_dt(event.get("created_at")) or parse_dt(event.get("end_at"))


def _session_streak_context(storage: Storage, event: dict[str, str]) -> dict[str, Any]:
    current_dt = _session_datetime(event)
    if not current_dt:
        return {
            "session_day": date.today(),
            "streak_days": 1,
            "streak_weeks": 1,
            "is_first_session_of_week": True,
        }

    session_rows = [
        row
        for row in storage.read_csv("events.csv")
        if str(row.get("event_type") or "").upper() == "SESSION"
    ]
    session_points: list[tuple[Any, dict[str, str]]] = []
    for row in session_rows:
        dt = _session_datetime(row)
        if not dt:
            continue
        session_points.append((dt, row))
    session_points.sort(key=lambda item: item[0])

    session_day = current_dt.date()
    week_start = session_day - timedelta(days=session_day.weekday())

    is_first_session_of_week = True
    for dt, _ in session_points:
        if dt >= current_dt:
            break
        day = dt.date()
        if day - timedelta(days=day.weekday()) == week_start:
            is_first_session_of_week = False
            break

    session_days = {dt.date() for dt, _ in session_points if dt.date() <= session_day}
    if session_day not in session_days:
        session_days.add(session_day)

    streak_days = 0
    cursor = session_day
    while cursor in session_days:
        streak_days += 1
        cursor -= timedelta(days=1)

    week_days = {day - timedelta(days=day.weekday()) for day in session_days}
    streak_weeks = 0
    week_cursor = week_start
    while week_cursor in week_days:
        streak_weeks += 1
        week_cursor -= timedelta(days=7)

    return {
        "session_day": session_day,
        "streak_days": max(1, streak_days),
        "streak_weeks": max(1, streak_weeks),
        "is_first_session_of_week": is_first_session_of_week,
    }


def _session_message_pool(catalog: dict[str, Any], bucket: str) -> list[dict[str, Any]]:
    session_end = catalog.get("session_end") if isinstance(catalog.get("session_end"), dict) else {}
    if not isinstance(session_end, dict):
        session_end = {}
    if bucket == "general":
        raw = session_end.get("general")
        return [item for item in raw if isinstance(item, dict)] if isinstance(raw, list) else []
    if bucket == "long_session":
        raw = session_end.get("long_session")
        return [item for item in raw if isinstance(item, dict)] if isinstance(raw, list) else []
    if bucket == "streak_days_mid_3plus":
        raw = (((session_end.get("streak_days") or {}).get("mid_3plus") or {}).get("messages"))
        return [item for item in raw if isinstance(item, dict)] if isinstance(raw, list) else []
    if bucket == "streak_days_long_7plus":
        raw = (((session_end.get("streak_days") or {}).get("long_7plus") or {}).get("messages"))
        return [item for item in raw if isinstance(item, dict)] if isinstance(raw, list) else []
    if bucket == "streak_weeks_mid_4plus":
        raw = (((session_end.get("streak_weeks") or {}).get("mid_4plus") or {}).get("messages"))
        return [item for item in raw if isinstance(item, dict)] if isinstance(raw, list) else []
    if bucket == "streak_weeks_long_8plus":
        raw = (((session_end.get("streak_weeks") or {}).get("long_8plus") or {}).get("messages"))
        return [item for item in raw if isinstance(item, dict)] if isinstance(raw, list) else []
    return []


def _replace_streak_tokens(text: str, streak_days: int, streak_weeks: int) -> str:
    out = str(text)
    out = out.replace("N일", f"{streak_days}일")
    out = out.replace("N주", f"{streak_weeks}주")
    out = out.replace("N-day", f"{streak_days}-day")
    out = out.replace("N days", f"{streak_days} days")
    out = out.replace("N-week", f"{streak_weeks}-week")
    out = out.replace("N weeks", f"{streak_weeks} weeks")
    return out


def build_session_gamification(
    storage: Storage,
    *,
    event: dict[str, str],
    duration_min: int,
    before_level: int,
    after_level: int,
    lang: str,
) -> dict[str, Any]:
    catalog = load_catalog(storage)
    event_id = str(event.get("event_id") or "").strip() or f"{event.get('start_at', '')}:{event.get('created_at', '')}"
    context = _session_streak_context(storage, event)
    streak_days = int(context["streak_days"])
    streak_weeks = int(context["streak_weeks"])
    is_first_week = bool(context["is_first_session_of_week"])

    long_prob = long_session_probability(duration_min)
    long_roll = _stable_roll(f"{event_id}:long")

    bucket = "general"
    if is_first_week and streak_weeks >= 8:
        bucket = "streak_weeks_long_8plus"
    elif is_first_week and streak_weeks >= 4:
        bucket = "streak_weeks_mid_4plus"
    elif streak_days >= 7:
        day_long_prob = 1.0 if streak_days == 7 else 0.30
        day_long_roll = _stable_roll(f"{event_id}:day_long")
        if day_long_roll < day_long_prob:
            bucket = "streak_days_long_7plus"
    elif streak_days >= 3:
        day_mid_prob = 1.0 if streak_days == 3 else 0.20
        day_mid_roll = _stable_roll(f"{event_id}:day_mid")
        if day_mid_roll < day_mid_prob:
            bucket = "streak_days_mid_3plus"

    if bucket == "general" and long_prob > 0 and long_roll < long_prob:
        bucket = "long_session"

    pool = _session_message_pool(catalog, bucket)
    if not pool and bucket != "general":
        bucket = "general"
        pool = _session_message_pool(catalog, bucket)
    if not pool:
        pool = _session_message_pool(_DEFAULT_CATALOG, "general")
    picked = pool[_stable_index(f"{event_id}:{bucket}", len(pool))]
    session_message = _replace_streak_tokens(_lang_text(picked, lang), streak_days, streak_weeks)

    level_meta = level_up_copy(
        storage,
        level=max(1, int(after_level)),
        before_level=max(1, int(before_level)),
        lang=lang,
        seed_key=f"{event_id}:level",
    )
    if int(after_level) <= int(before_level):
        level_meta["line"] = ""
        level_meta["tier_up"] = False

    return {
        "session_bucket": bucket,
        "streak_days": streak_days,
        "streak_weeks": streak_weeks,
        "is_first_session_of_week": is_first_week,
        "is_long_session": int(duration_min) >= LONG_SESSION_MINUTES,
        "long_session_probability": round(long_prob, 6),
        "long_session_roll": round(long_roll, 6),
        "long_session_threshold_min": LONG_SESSION_MINUTES,
        "session_message": session_message,
        "level_message": str(level_meta.get("line") or ""),
        "tier_up": bool(level_meta.get("tier_up")),
        "before_tier": str(level_meta.get("before_tier") or "bronze"),
        "after_tier": str(level_meta.get("after_tier") or "bronze"),
        "tier_color": str(level_meta.get("tier_color") or _TIER_COLORS["bronze"]),
        "badge_before": str(level_meta.get("badge_before") or _BADGE_ASSETS["bronze"]),
        "badge_after": str(level_meta.get("badge_after") or _BADGE_ASSETS["bronze"]),
    }

