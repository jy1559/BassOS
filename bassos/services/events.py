"""Event row helpers."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

from bassos.constants import EVENT_HEADERS
from bassos.utils.time_utils import to_iso


def empty_event() -> dict[str, str]:
    return {header: "" for header in EVENT_HEADERS}


def create_event_row(
    *,
    created_at: datetime,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    duration_min: int = 0,
    event_type: str,
    activity: str = "",
    xp: int = 0,
    title: str = "",
    notes: str = "",
    song_library_id: str = "",
    drill_id: str = "",
    quest_id: str = "",
    achievement_id: str = "",
    tags: list[str] | None = None,
    evidence_type: str = "",
    evidence_path: str = "",
    evidence_url: str = "",
    meta: dict[str, Any] | None = None,
    source: str = "app",
) -> dict[str, str]:
    row = empty_event()
    row["event_id"] = f"EVT_{uuid.uuid4().hex[:12]}"
    row["created_at"] = to_iso(created_at)
    row["start_at"] = to_iso(start_at)
    row["end_at"] = to_iso(end_at)
    row["duration_min"] = str(max(duration_min, 0))
    row["event_type"] = event_type
    row["activity"] = activity
    row["xp"] = str(int(xp))
    row["title"] = title
    row["notes"] = notes
    row["song_library_id"] = song_library_id
    row["drill_id"] = drill_id
    row["quest_id"] = quest_id
    row["achievement_id"] = achievement_id
    row["tags"] = ";".join(sorted(set(tags or [])))
    row["evidence_type"] = evidence_type
    row["evidence_path"] = evidence_path
    row["evidence_url"] = evidence_url
    row["meta_json"] = json.dumps(meta or {}, ensure_ascii=False)
    row["source"] = source
    return row


def parse_event_meta(row: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(row, dict):
        return {}
    raw = row.get("meta_json")
    if not raw:
        return {}
    try:
        value = json.loads(str(raw))
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def is_pending_chain_session(row: dict[str, Any] | None) -> bool:
    if not isinstance(row, dict):
        return False
    if str(row.get("event_type") or "").upper() != "SESSION":
        return False
    meta = parse_event_meta(row)
    return bool(meta.get("pending_chain"))


def filter_finalized_events(rows: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not isinstance(rows, list):
        return []
    return [row for row in rows if not is_pending_chain_session(row)]
