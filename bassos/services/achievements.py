"""Achievement evaluation and claiming."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from bassos.services.calculations import evaluate_rule, to_int
from bassos.services.events import create_event_row
from bassos.services.storage import Storage


@dataclass
class AchievementState:
    achievement_id: str
    group_id: str
    name: str
    description: str
    hint: str
    category: str
    tier: int
    tier_name: str
    target: int
    display_order: int
    progress: int
    unlocked: bool
    claimed: bool
    claimed_at: str
    hidden: bool
    auto_grant: bool
    xp_reward: int
    effective_xp_reward: int
    ui_badge_style: str
    rule_type: str
    evidence_hint: str
    icon_path: str
    icon_url: str


def _safe_json(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        return {}


def _claimed_ids(events: list[dict[str, str]]) -> set[str]:
    return {
        e.get("achievement_id", "")
        for e in events
        if (e.get("event_type") or "").upper() == "ACHIEVEMENT_CLAIM" and e.get("achievement_id")
    }


def _claimed_map(events: list[dict[str, str]]) -> dict[str, str]:
    out: dict[str, str] = {}
    claims = [e for e in events if (e.get("event_type") or "").upper() == "ACHIEVEMENT_CLAIM" and e.get("achievement_id")]
    claims.sort(key=lambda row: str(row.get("created_at") or ""))
    for row in claims:
        out[str(row.get("achievement_id") or "")] = str(row.get("created_at") or "")
    return out


def _effective_reward(base: int, settings: dict[str, Any]) -> int:
    multiplier = settings.get("critical", {}).get("achievement_xp_multiplier", 1.0)
    try:
        m = float(multiplier)
    except (TypeError, ValueError):
        m = 0.2
    return max(1, int(round(base * m)))


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


def evaluate_achievements(storage: Storage, settings: dict[str, Any]) -> list[AchievementState]:
    achievements = storage.read_csv("achievements_master.csv")
    events = storage.read_csv("events.csv")
    feature_context = _feature_context(storage)
    claimed_map = _claimed_map(events)
    states: list[AchievementState] = []

    for row in achievements:
        target = to_int(row.get("target"), 1)
        progress, unlocked = evaluate_rule(
            row.get("rule_type", ""),
            _safe_json(row.get("rule_filter")),
            target,
            events,
            settings,
            feature_context=feature_context,
        )
        ach_id = row.get("achievement_id", "")
        claimed_at = str(claimed_map.get(ach_id) or "")
        claimed_flag = bool(claimed_at)
        hidden = (row.get("is_hidden") or "").lower() == "true"
        auto_grant = (row.get("auto_grant") or "").lower() == "true"
        xp_reward = to_int(row.get("xp_reward"), 0)
        masked_name = "???"
        masked_desc = "숨겨진 업적입니다."
        states.append(
            AchievementState(
                achievement_id=ach_id,
                group_id=row.get("group_id", ach_id),
                name=row.get("name", "") if (not hidden or unlocked or claimed_flag) else masked_name,
                description=row.get("description", "") if (not hidden or unlocked or claimed_flag) else masked_desc,
                hint=row.get("hint", ""),
                category=row.get("category", ""),
                tier=to_int(row.get("tier"), 1),
                tier_name=row.get("tier_name", ""),
                target=target,
                display_order=to_int(row.get("display_order"), 0),
                progress=progress,
                unlocked=unlocked,
                claimed=claimed_flag,
                claimed_at=claimed_at,
                hidden=hidden and not (unlocked or claimed_flag),
                auto_grant=auto_grant,
                xp_reward=xp_reward,
                effective_xp_reward=_effective_reward(xp_reward, settings),
                ui_badge_style=row.get("ui_badge_style", "default"),
                rule_type=row.get("rule_type", ""),
                evidence_hint=row.get("evidence_hint", ""),
                icon_path=row.get("icon_path", ""),
                icon_url=row.get("icon_url", ""),
            )
        )
    return states


def auto_grant_claims(storage: Storage, settings: dict[str, Any], created_at: datetime) -> list[str]:
    achievements = storage.read_csv("achievements_master.csv")
    events = storage.read_csv("events.csv")
    feature_context = _feature_context(storage)
    claimed = _claimed_ids(events)
    granted_ids: list[str] = []

    for _ in range(10):
        changed = False
        for row in achievements:
            ach_id = row.get("achievement_id", "")
            if not ach_id or ach_id in claimed:
                continue
            if (row.get("rule_type") or "").lower() == "manual":
                continue

            target = to_int(row.get("target"), 1)
            progress, unlocked = evaluate_rule(
                row.get("rule_type", ""),
                _safe_json(row.get("rule_filter")),
                target,
                events,
                settings,
                feature_context=feature_context,
            )
            if not unlocked:
                continue
            raw_reward = to_int(row.get("xp_reward"), 0)
            claim_event = create_event_row(
                created_at=created_at,
                event_type="ACHIEVEMENT_CLAIM",
                xp=_effective_reward(raw_reward, settings),
                title=f"Achievement: {row.get('name', ach_id)}",
                notes=f"Auto granted ({progress}/{target})",
                achievement_id=ach_id,
                tags=["ACHIEVEMENT", row.get("category", "").upper()],
                meta={"auto": True, "progress": progress, "target": target, "raw_reward": raw_reward},
                source="system",
            )
            storage.append_csv_row("events.csv", claim_event, storage.read_csv_headers("events.csv"))
            events.append(claim_event)
            claimed.add(ach_id)
            granted_ids.append(ach_id)
            changed = True
        if not changed:
            break
    return granted_ids


def reconcile_auto_claims(storage: Storage, settings: dict[str, Any], created_at: datetime) -> list[str]:
    rows = storage.read_csv("events.csv")
    headers = storage.read_csv_headers("events.csv")
    kept: list[dict[str, str]] = []
    for row in rows:
        if (row.get("event_type") or "").upper() != "ACHIEVEMENT_CLAIM":
            kept.append(row)
            continue
        meta = _safe_json(row.get("meta_json"))
        if bool(meta.get("auto")):
            continue
        kept.append(row)

    storage.write_csv("events.csv", kept, headers=headers)
    return auto_grant_claims(storage, settings, created_at)


def manual_claim(
    storage: Storage,
    settings: dict[str, Any],
    achievement_id: str,
    created_at: datetime,
    source: str = "app",
) -> tuple[bool, str]:
    achievements = {row.get("achievement_id", ""): row for row in storage.read_csv("achievements_master.csv")}
    row = achievements.get(achievement_id)
    if not row:
        return False, "업적을 찾을 수 없습니다."
    events = storage.read_csv("events.csv")
    feature_context = _feature_context(storage)
    if achievement_id in _claimed_ids(events):
        return False, "이미 수령한 업적입니다."

    target = to_int(row.get("target"), 1)
    progress, unlocked = evaluate_rule(
        row.get("rule_type", ""),
        _safe_json(row.get("rule_filter")),
        target,
        events,
        settings,
        feature_context=feature_context,
    )
    if (row.get("rule_type") or "").lower() != "manual" and not unlocked:
        return False, "아직 달성 조건을 충족하지 않았습니다."

    raw_reward = to_int(row.get("xp_reward"), 0)
    claim_event = create_event_row(
        created_at=created_at,
        event_type="ACHIEVEMENT_CLAIM",
        xp=_effective_reward(raw_reward, settings),
        title=f"Achievement: {row.get('name', achievement_id)}",
        notes=f"Manual claim ({progress}/{target})",
        achievement_id=achievement_id,
        tags=["ACHIEVEMENT", row.get("category", "").upper()],
        meta={"auto": False, "progress": progress, "target": target, "raw_reward": raw_reward},
        source=source,
    )
    storage.append_csv_row("events.csv", claim_event, storage.read_csv_headers("events.csv"))
    return True, "업적을 수령했습니다."


def recent_claims(storage: Storage, limit: int = 5) -> list[dict[str, str]]:
    rows = storage.read_csv("events.csv")
    name_by_id = {
        row.get("achievement_id", ""): row.get("name", "")
        for row in storage.read_csv("achievements_master.csv")
        if row.get("achievement_id")
    }
    claims = [row for row in rows if (row.get("event_type") or "").upper() == "ACHIEVEMENT_CLAIM"]
    claims.sort(key=lambda row: row.get("created_at", ""), reverse=True)
    out: list[dict[str, str]] = []
    for row in claims[: max(limit, 1)]:
        ach_id = row.get("achievement_id", "")
        out.append(
            {
                "achievement_id": ach_id,
                "name": name_by_id.get(ach_id, ach_id),
                "created_at": row.get("created_at", ""),
                "xp": row.get("xp", "0"),
            }
        )
    return out

