"""Runtime bootstrap and data normalization routines."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from bassos.constants import QUEST_HEADERS
from bassos.services.storage import Storage

DEFAULT_PERIOD_DAYS = {"short": 7, "mid": 30, "long": 90}
SEED_QUEST_COPY = {
    "QX_SHORT_SESSION_COUNT": {
        "title": "단기 세션 횟수",
        "emoji": "🎵",
        "description": "이번 기간에 세션 3회를 완료하세요.",
    },
    "QX_MID_SESSION_MINUTES": {
        "title": "중기 세션 시간",
        "emoji": "⏱️",
        "description": "세션 시간 240분을 누적하세요.",
    },
    "QX_LONG_MANUAL_GOAL": {
        "title": "장기 수동 목표",
        "emoji": "🏆",
        "description": "장기 목표 하나를 직접 설정하고 완료 체크하세요.",
    },
}


@dataclass
class BootstrapReport:
    normalized_quests: int
    added_unlockables: int


def _as_json_text(value: Any) -> str:
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    text = str(value or "").strip()
    if not text:
        return "{}"
    try:
        decoded = json.loads(text)
    except json.JSONDecodeError:
        return "{}"
    return json.dumps(decoded if isinstance(decoded, dict) else {}, ensure_ascii=False)


def _split_tokens(raw: Any) -> list[str]:
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


def _as_json_array_text(raw: Any) -> str:
    return json.dumps(_split_tokens(raw), ensure_ascii=False)


def _normalize_period(raw: Any) -> str:
    token = str(raw or "").strip().lower()
    if token in {"short", "mid", "long"}:
        return token
    return "mid"


def _normalize_difficulty(raw: Any, xp_reward: int) -> str:
    token = str(raw or "").strip().lower()
    if token in {"low", "mid", "high"}:
        return token
    if xp_reward >= 280:
        return "high"
    if xp_reward >= 150:
        return "mid"
    return "low"


def _normalize_priority(raw: Any) -> str:
    token = str(raw or "").strip().lower()
    if token in {"low", "normal", "urgent"}:
        return token
    return "normal"


def _to_bool_text(raw: Any) -> str:
    token = str(raw or "").strip().lower()
    if token in {"1", "true", "yes", "on"}:
        return "true"
    return "false"


def _default_due_date(start: date, period_class: str) -> str:
    days = DEFAULT_PERIOD_DAYS.get(period_class, DEFAULT_PERIOD_DAYS["mid"])
    return (start + timedelta(days=days)).isoformat()


def _seed_quests(today: date) -> list[dict[str, str]]:
    return [
        {
            "quest_id": "QX_SHORT_SESSION_COUNT",
            "title": "단기 세션 횟수",
            "emoji": "🎵",
            "description": "이번 기간에 세션 3회를 완료하세요.",
            "status": "Active",
            "xp_reward": "80",
            "start_date": today.isoformat(),
            "due_date": _default_due_date(today, "short"),
            "period_class": "short",
            "difficulty": "low",
            "priority": "normal",
            "auto_generated": "false",
            "resolved_at": "",
            "genre_tags": "[]",
            "linked_song_ids": "[]",
            "linked_drill_ids": "[]",
            "rule_type": "count_events",
            "rule_filter": json.dumps({"event_type": "SESSION"}, ensure_ascii=False),
            "target": "3",
            "source": "seed",
        },
        {
            "quest_id": "QX_MID_SESSION_MINUTES",
            "title": "중기 세션 시간",
            "emoji": "⏱️",
            "description": "세션 시간 240분을 누적하세요.",
            "status": "Active",
            "xp_reward": "210",
            "start_date": today.isoformat(),
            "due_date": _default_due_date(today, "mid"),
            "period_class": "mid",
            "difficulty": "mid",
            "priority": "normal",
            "auto_generated": "false",
            "resolved_at": "",
            "genre_tags": "[]",
            "linked_song_ids": "[]",
            "linked_drill_ids": "[]",
            "rule_type": "sum_duration",
            "rule_filter": json.dumps({"event_type": "SESSION"}, ensure_ascii=False),
            "target": "240",
            "source": "seed",
        },
        {
            "quest_id": "QX_LONG_MANUAL_GOAL",
            "title": "장기 수동 목표",
            "emoji": "🏆",
            "description": "장기 목표 하나를 직접 설정하고 완료 체크하세요.",
            "status": "Active",
            "xp_reward": "52",
            "start_date": today.isoformat(),
            "due_date": _default_due_date(today, "long"),
            "period_class": "long",
            "difficulty": "mid",
            "priority": "urgent",
            "auto_generated": "false",
            "resolved_at": "",
            "genre_tags": "[]",
            "linked_song_ids": "[]",
            "linked_drill_ids": "[]",
            "rule_type": "manual",
            "rule_filter": "{}",
            "target": "1",
            "source": "seed",
        },
    ]


def initialize_quest_templates(storage: Storage) -> int:
    rows = storage.read_csv("quests.csv")
    today = date.today()
    normalized: list[dict[str, str]] = []

    if not rows:
        normalized = _seed_quests(today)
        storage.write_csv("quests.csv", normalized, headers=QUEST_HEADERS)
        return len(normalized)

    for row in rows:
        start_text = str(row.get("start_date") or "").strip() or today.isoformat()
        try:
            start_value = date.fromisoformat(start_text)
        except ValueError:
            start_value = today
            start_text = today.isoformat()

        xp_reward = max(0, int(float(str(row.get("xp_reward") or 0))))
        period_class = _normalize_period(row.get("period_class"))
        quest_id = str(row.get("quest_id") or f"QX_{uuid.uuid4().hex[:8].upper()}").strip()
        normalized_row = {
            "quest_id": quest_id,
            "title": str(row.get("title") or "퀘스트").strip(),
            "emoji": str(row.get("emoji") or "").strip(),
            "description": str(row.get("description") or "").strip(),
            "status": str(row.get("status") or "Active").strip() or "Active",
            "xp_reward": str(xp_reward),
            "start_date": start_text,
            "due_date": str(row.get("due_date") or _default_due_date(start_value, period_class)).strip(),
            "period_class": period_class,
            "difficulty": _normalize_difficulty(row.get("difficulty"), xp_reward),
            "priority": _normalize_priority(row.get("priority")),
            "auto_generated": _to_bool_text(row.get("auto_generated")),
            "resolved_at": str(row.get("resolved_at") or "").strip(),
            "genre_tags": _as_json_array_text(row.get("genre_tags")),
            "linked_song_ids": _as_json_array_text(row.get("linked_song_ids")),
            "linked_drill_ids": _as_json_array_text(row.get("linked_drill_ids")),
            "rule_type": str(row.get("rule_type") or "count_events").strip() or "count_events",
            "rule_filter": _as_json_text(row.get("rule_filter")),
            "target": str(max(1, int(float(str(row.get("target") or 1))))),
            "source": str(row.get("source") or "seed").strip() or "seed",
        }
        seed_copy = SEED_QUEST_COPY.get(quest_id)
        if seed_copy:
            normalized_row["title"] = seed_copy["title"]
            normalized_row["emoji"] = seed_copy["emoji"]
            normalized_row["description"] = seed_copy["description"]
        normalized.append(normalized_row)

    storage.write_csv("quests.csv", normalized, headers=QUEST_HEADERS)
    return len(normalized)


def ensure_unlockables_per_level(storage: Storage, max_level: int = 50) -> int:
    rows = storage.read_csv("unlockables.csv")
    if not rows:
        return 0
    headers = storage.read_csv_headers("unlockables.csv")
    existing_levels = {int(row.get("level_required", "0") or 0) for row in rows}
    existing_ids = {str(row.get("unlock_id") or "").strip() for row in rows}

    templates = [
        ("Feature", "HUD Upgrade", "Expanded HUD stats become available."),
        ("Title", "Title Slot", "A new profile title slot is unlocked."),
        ("Visual", "Badge Upgrade", "Badge visuals are upgraded."),
        ("Utility", "Search Upgrade", "Record search options are expanded."),
        ("Collectible", "Collection Slot", "A new collectible slot is unlocked."),
    ]

    added = 0
    for level in range(1, max_level + 1):
        if level in existing_levels:
            continue
        unlock_id = f"AUTO_LV{level:03d}"
        if unlock_id in existing_ids:
            continue
        template = templates[(level - 1) % len(templates)]
        rows.append(
            {
                "unlock_id": unlock_id,
                "level_required": str(level),
                "type": template[0],
                "name": f"Lv.{level} {template[1]}",
                "description": template[2],
                "asset": "",
                "notes": "auto-generated",
            }
        )
        added += 1

    if added:
        rows.sort(key=lambda row: int(row.get("level_required", "0") or 0))
        storage.write_csv("unlockables.csv", rows, headers=headers)
    return added


def ensure_bootstrap_data(storage: Storage) -> BootstrapReport:
    normalized_quests = initialize_quest_templates(storage)
    added_unlockables = ensure_unlockables_per_level(storage, max_level=50)
    return BootstrapReport(normalized_quests=normalized_quests, added_unlockables=added_unlockables)
