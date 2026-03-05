"""Main gameplay service layer."""

from __future__ import annotations

import json
import uuid
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from bassos.constants import ACTIVITY_TO_TAG, RECORD_ATTACHMENT_HEADERS, RECORD_POST_HEADERS, SUB_ACTIVITY_TO_TAG
from bassos.services.achievements import auto_grant_claims, reconcile_auto_claims
from bassos.services.calculations import (
    compute_level_summary,
    event_date,
    parse_json,
    session_xp_breakdown,
    split_tags,
    to_int,
    total_xp_from_events,
    xp_to_next,
)
from bassos.services.events import create_event_row
from bassos.services.gamification_messages import build_session_gamification, level_up_copy as build_level_up_copy
from bassos.services.motivation import build_session_coach_feedback
from bassos.services.storage import Storage
from bassos.utils.time_utils import now_local, parse_dt, to_iso


def _event_dt(event: dict[str, str]):
    return parse_dt(event.get("start_at")) or parse_dt(event.get("created_at")) or parse_dt(event.get("end_at"))


def _event_source_key(event_type: str) -> str:
    normalized = event_type.upper()
    if normalized == "SESSION":
        return "practice"
    if normalized == "QUEST_CLAIM":
        return "quest"
    if normalized == "ACHIEVEMENT_CLAIM":
        return "achievement"
    if normalized == "LONG_GOAL_CLEAR":
        return "long_goal"
    return "other"


def _is_in_last_days(target_date: date, today: date, days: int) -> bool:
    if days <= 0:
        return True
    threshold = today - timedelta(days=days - 1)
    return threshold <= target_date <= today


def _split_semicolon(raw: str | None) -> list[str]:
    if not raw:
        return []
    values = [item.strip() for item in str(raw).split(";")]
    return [item for item in values if item]


def _join_semicolon(values: list[str]) -> str:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        token = str(value).strip()
        if not token:
            continue
        lowered = token.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        out.append(token)
    return ";".join(out)


def _normalize_token(value: str) -> str:
    return "".join(ch for ch in str(value or "").strip().lower() if ch.isalnum())


def _canonical_session_activity(activity: str, sub_activity: str = "") -> tuple[str, str]:
    a = _normalize_token(activity)
    s = _normalize_token(sub_activity)

    if s in {"songpractice", "songlearn", "songcopy"}:
        sub = {"songpractice": "SongPractice", "songlearn": "SongLearn", "songcopy": "SongCopy"}[s]
        return "Song", sub
    if s in {"core", "funk", "slap", "theory"}:
        sub = {"core": "Core", "funk": "Funk", "slap": "Slap", "theory": "Theory"}[s]
        return "Drill", sub

    if a in {"song", "노래", "곡", "songpractice", "songlearn", "songcopy"}:
        mapped = {"songpractice": "SongPractice", "songlearn": "SongLearn", "songcopy": "SongCopy"}
        return "Song", mapped.get(a, "SongPractice")
    if a in {"drill", "드릴", "drillpractice", "core", "funk", "slap", "theory"}:
        mapped = {"drillpractice": "Core", "core": "Core", "funk": "Funk", "slap": "Slap", "theory": "Theory"}
        return "Drill", mapped.get(a, "Core")
    if a in {"etc", "freepractice", "tutorial", "quest", ""}:
        return "Etc", "Etc"
    return "Etc", "Etc"


def _guess_media_type(evidence_type: str, path: str, url: str) -> str:
    normalized = (evidence_type or "").lower().strip()
    if normalized in {"image", "video", "audio"}:
        return normalized

    ref = (path or url or "").lower()
    if any(ref.endswith(ext) for ext in [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]):
        return "image"
    if any(ref.endswith(ext) for ext in [".mp4", ".mov", ".webm", ".avi", ".mkv"]):
        return "video"
    if any(ref.endswith(ext) for ext in [".mp3", ".wav", ".ogg", ".m4a", ".flac"]):
        return "audio"
    return "image"


class GameService:
    def __init__(self, storage: Storage):
        self.storage = storage

    def _session_day_xp_used(self, session_day: date, exclude_event_id: str = "") -> int:
        total = 0
        for event in self.storage.read_csv("events.csv"):
            if (event.get("event_type") or "").upper() != "SESSION":
                continue
            if exclude_event_id and event.get("event_id") == exclude_event_id:
                continue
            dt = parse_dt(event.get("start_at")) or parse_dt(event.get("end_at")) or parse_dt(event.get("created_at"))
            if not dt or dt.date() != session_day:
                continue
            total += max(0, to_int(event.get("xp"), 0))
        return total

    def _apply_daily_session_cap(
        self,
        raw_xp: int,
        session_day: date,
        settings: dict[str, Any],
        exclude_event_id: str = "",
    ) -> tuple[int, int]:
        candidate = max(0, to_int(raw_xp, 0))
        cap = to_int(settings.get("critical", {}).get("daily_session_xp_cap"), 0)
        if cap <= 0:
            return candidate, 0
        used = self._session_day_xp_used(session_day, exclude_event_id=exclude_event_id)
        remaining = max(0, cap - used)
        applied = min(candidate, remaining)
        reduced = max(0, candidate - applied)
        return applied, reduced

    def start_session(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload or {}
        started_at = parse_dt(payload.get("start_at")) or now_local()
        activity, sub_activity = _canonical_session_activity(
            str(payload.get("activity") or "Song"),
            str(payload.get("sub_activity") or ""),
        )
        state = {
            "session_id": payload.get("session_id") or f"S_{started_at.strftime('%Y%m%d%H%M%S')}",
            "start_at": to_iso(started_at),
            "created_at": to_iso(now_local()),
            "activity": activity,
            "sub_activity": sub_activity,
            "song_library_id": str(payload.get("song_library_id") or ""),
            "drill_id": str(payload.get("drill_id") or ""),
            "title": str(payload.get("title") or ""),
            "notes": str(payload.get("notes") or ""),
        }
        self.storage.write_session_state(state)
        return state

    def discard_session(self) -> dict[str, Any]:
        active = self.storage.read_session_state()
        self.storage.clear_session_state()
        return {"discarded": bool(active), "session": active}

    def get_active_session(self) -> dict[str, Any]:
        return self.storage.read_session_state()

    def stop_session(self, payload: dict[str, Any], settings: dict[str, Any]) -> dict[str, Any]:
        before_hud = self.hud_summary(settings)
        active = self.storage.read_session_state()
        now = now_local()
        end_at = parse_dt(payload.get("end_at")) or now

        start_at = parse_dt(payload.get("start_at"))
        if not start_at and active:
            start_at = parse_dt(active.get("start_at"))
        if not start_at:
            duration = to_int(payload.get("duration_min"), 10)
            start_at = end_at - timedelta(minutes=max(duration, 1))

        duration_min = max(0, int((end_at - start_at).total_seconds() // 60))
        payload = dict(payload)
        payload["duration_min"] = duration_min
        if not payload.get("activity"):
            payload["activity"] = (active or {}).get("activity", "Song")
        if not payload.get("sub_activity"):
            payload["sub_activity"] = (active or {}).get("sub_activity", "")
        if not payload.get("song_library_id"):
            payload["song_library_id"] = (active or {}).get("song_library_id", "")
        if not payload.get("drill_id"):
            payload["drill_id"] = (active or {}).get("drill_id", "")
        normalized_activity, normalized_sub = _canonical_session_activity(
            str(payload.get("activity") or "Song"),
            str(payload.get("sub_activity") or ""),
        )
        payload["activity"] = normalized_activity
        payload["sub_activity"] = normalized_sub
        breakdown = session_xp_breakdown(payload, settings)
        applied_xp, reduced_by_cap = self._apply_daily_session_cap(
            breakdown.get("total_xp", 0),
            start_at.date(),
            settings,
        )
        breakdown["pre_cap_total_xp"] = breakdown.get("total_xp", 0)
        breakdown["daily_cap_reduced"] = reduced_by_cap
        breakdown["total_xp"] = applied_xp

        tags = set(str(tag).upper() for tag in breakdown["tags"])
        raw_activity = str(payload.get("activity", "Song"))
        raw_sub_activity = str(payload.get("sub_activity") or "")
        activity, inferred_sub = _canonical_session_activity(raw_activity, raw_sub_activity)
        sub_activity = raw_sub_activity or inferred_sub
        if activity in ACTIVITY_TO_TAG:
            tags.add(ACTIVITY_TO_TAG[activity])
        if sub_activity in SUB_ACTIVITY_TO_TAG:
            tags.add(SUB_ACTIVITY_TO_TAG[sub_activity])
        if payload.get("is_quick_log"):
            tags.add("QUICK")

        event = create_event_row(
            created_at=now,
            start_at=start_at,
            end_at=end_at,
            duration_min=duration_min,
            event_type="SESSION",
            activity=activity,
            xp=breakdown["total_xp"],
            title=payload.get("title") or f"Session - {activity}{f'/{sub_activity}' if sub_activity else ''}",
            notes=payload.get("notes", ""),
            song_library_id=payload.get("song_library_id", ""),
            drill_id=payload.get("drill_id", ""),
            tags=sorted(tags),
            evidence_type=payload.get("evidence_type", ""),
            evidence_path=payload.get("evidence_path", ""),
            evidence_url=payload.get("evidence_url", ""),
            meta={
                "xp_breakdown": {
                    "base_xp": breakdown["base_xp"],
                    "bonus_xp": breakdown["bonus_xp"],
                    "bonus_breakdown": breakdown["bonus_breakdown"],
                    "pre_cap_total_xp": breakdown.get("pre_cap_total_xp", breakdown["total_xp"]),
                    "daily_cap_reduced": breakdown.get("daily_cap_reduced", 0),
                },
                "is_backfill": bool(payload.get("is_backfill")),
                "is_quick_log": bool(payload.get("is_quick_log")),
                "sub_activity": sub_activity,
                "song_speed": payload.get("song_speed", {}),
                "drill_bpm": payload.get("drill_bpm", {}),
                "feelings": payload.get("feelings", []),
            },
            source=payload.get("source", "app"),
        )
        self.storage.append_csv_row("events.csv", event, self.storage.read_csv_headers("events.csv"))
        self.storage.clear_session_state()
        granted = auto_grant_claims(self.storage, settings, created_at=now)
        after_hud = self.hud_summary(settings)
        stats = self.stats_overview(settings)
        lang = str((settings.get("ui") or {}).get("language") or "ko").strip().lower()
        if lang not in {"ko", "en"}:
            lang = "ko"
        before_level = to_int(before_hud.get("level"), 1)
        after_level = to_int(after_hud.get("level"), 1)
        gamification = build_session_gamification(
            self.storage,
            event=event,
            duration_min=duration_min,
            before_level=before_level,
            after_level=after_level,
            lang=lang,
        )
        feedback = build_session_coach_feedback(
            duration_min=duration_min,
            gained_xp=to_int(breakdown.get("total_xp"), 0),
            daily_cap_reduced=to_int(breakdown.get("daily_cap_reduced"), 0),
            before_level=before_level,
            after_level=after_level,
            after_hud=after_hud,
            stats=stats,
            settings=settings,
        )
        feedback["coach_message"] = str(gamification.get("session_message") or feedback.get("coach_message") or "")
        reason_tags = feedback.get("coach_reason_tags")
        if not isinstance(reason_tags, list):
            reason_tags = []
        bucket = str(gamification.get("session_bucket") or "").strip().upper()
        if bucket:
            reason_tags.insert(0, bucket)
        feedback["coach_reason_tags"] = reason_tags
        return {
            "event": event,
            "xp_breakdown": breakdown,
            "auto_granted": granted,
            "gamification": gamification,
            **feedback,
        }

    def quick_log(self, payload: dict[str, Any], settings: dict[str, Any]) -> dict[str, Any]:
        payload = dict(payload)
        payload.setdefault("activity", "Drill")
        payload.setdefault("sub_activity", "Core")
        payload.setdefault("duration_min", 10)
        payload["is_quick_log"] = True
        if not payload.get("end_at"):
            end_at = now_local()
            payload["end_at"] = to_iso(end_at)
            payload["start_at"] = to_iso(end_at - timedelta(minutes=to_int(payload["duration_min"], 10)))
        return self.stop_session(payload, settings)

    def level_up_copy(self, *, level: int, before_level: int, lang: str = "ko") -> dict[str, Any]:
        return build_level_up_copy(
            self.storage,
            level=max(1, to_int(level, 1)),
            before_level=max(1, to_int(before_level, 1)),
            lang=lang,
            seed_key=f"api:{to_int(before_level, 1)}:{to_int(level, 1)}:{lang}",
        )

    def hud_summary(self, settings: dict[str, Any]) -> dict[str, Any]:
        events = self.storage.read_csv("events.csv")
        total_xp = total_xp_from_events(events)
        level = compute_level_summary(total_xp, settings)
        today = now_local().date()
        week_start = today - timedelta(days=today.weekday())
        today_xp = 0
        week_xp = 0
        for event in events:
            d = event_date(event)
            if not d:
                continue
            xp = to_int(event.get("xp"), 0)
            if d == today:
                today_xp += xp
            if week_start <= d <= today:
                week_xp += xp

        unlockables = self.storage.read_csv("unlockables.csv")
        unlocked = []
        next_unlock = None
        for row in unlockables:
            required = to_int(row.get("level_required"), 1)
            item = {
                "unlock_id": row.get("unlock_id"),
                "name": row.get("name"),
                "type": row.get("type"),
                "level_required": required,
                "description": row.get("description", ""),
                "asset": row.get("asset", ""),
                "unlocked": level.level >= required,
            }
            if item["unlocked"]:
                unlocked.append(item)
            elif not next_unlock:
                next_unlock = item

        return {
            "total_xp": level.total_xp,
            "level": level.level,
            "level_title": self.level_title(level.level),
            "rank": level.rank,
            "progress_pct": round(level.progress * 100, 1),
            "xp_to_next": level.xp_to_next,
            "current_level_xp": level.current_level_xp,
            "today_xp": today_xp,
            "week_xp": week_xp,
            "active_session": self.storage.read_session_state(),
            "unlocked_count": len(unlocked),
            "next_unlock": next_unlock,
            "badge": self.badge_for_level(level.level),
        }

    def badge_for_level(self, level: int) -> dict[str, str]:
        capped = max(1, min(50, level))
        if capped >= 50:
            tier = "challenger"
        elif capped >= 40:
            tier = "diamond"
        elif capped >= 30:
            tier = "platinum"
        elif capped >= 20:
            tier = "gold"
        elif capped >= 10:
            tier = "silver"
        else:
            tier = "bronze"

        if capped >= 50:
            step = 10
        elif capped >= 40:
            step = capped - 39
        elif capped >= 30:
            step = capped - 29
        elif capped >= 20:
            step = capped - 19
        elif capped >= 10:
            step = capped - 9
        else:
            step = capped
        name_map = {
            "bronze": "Bronze Starter",
            "silver": "Silver Pulse",
            "gold": "Gold Timekeeper",
            "platinum": "Platinum Pocket",
            "diamond": "Diamond Groove",
            "challenger": "Challenger Crown",
        }
        asset_map = {
            "bronze": "/assets/badges/bronze.svg",
            "silver": "/assets/badges/silver.svg",
            "gold": "/assets/badges/gold.svg",
            "platinum": "/assets/badges/platinum.svg",
            "diamond": "/assets/badges/diamond.svg",
            "challenger": "/assets/badges/diamond.svg",
        }
        return {
            "id": tier,
            "name": name_map[tier],
            "style": tier,
            "asset": asset_map[tier],
            "tier_step": str(step),
        }

    def list_unlockables(self, settings: dict[str, Any]) -> dict[str, Any]:
        summary = self.hud_summary(settings)
        current_level = summary["level"]
        rows = self.storage.read_csv("unlockables.csv")
        data = []
        for row in rows:
            required = to_int(row.get("level_required"), 1)
            data.append(
                {
                    **row,
                    "level_required": required,
                    "unlocked": current_level >= required,
                }
            )
        data.sort(key=lambda x: x["level_required"])
        return {"level": current_level, "items": data}

    def list_media(self) -> list[dict[str, Any]]:
        events = self.storage.read_csv("events.csv")
        media = []
        for event in events:
            if event.get("evidence_path") or event.get("evidence_url"):
                meta = parse_json(event.get("meta_json"))
                media.append(
                    {
                        "event_id": event.get("event_id"),
                        "created_at": event.get("created_at"),
                        "song_library_id": event.get("song_library_id"),
                        "event_type": event.get("event_type"),
                        "title": event.get("title"),
                        "evidence_type": event.get("evidence_type"),
                        "evidence_path": event.get("evidence_path"),
                        "evidence_url": event.get("evidence_url"),
                        "tags": sorted(split_tags(event.get("tags"))),
                        "meta": meta,
                    }
                )
        media.sort(key=lambda item: item.get("created_at", ""), reverse=True)
        return media

    def _normalize_record_attachment(self, row: dict[str, str]) -> dict[str, Any]:
        return {
            "attachment_id": row.get("attachment_id", ""),
            "post_id": row.get("post_id", ""),
            "created_at": row.get("created_at", ""),
            "media_type": row.get("media_type", ""),
            "path": row.get("path", ""),
            "url": row.get("url", ""),
            "title": row.get("title", ""),
            "notes": row.get("notes", ""),
            "sort_order": to_int(row.get("sort_order"), 0),
        }

    def _record_rows(self) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
        posts = self.storage.read_csv("record_posts.csv")
        attachments = self.storage.read_csv("record_attachments.csv")
        return posts, attachments

    def _normalize_record_post(
        self,
        row: dict[str, str],
        attachment_rows: list[dict[str, str]],
        songs: dict[str, dict[str, str]],
        drills: dict[str, dict[str, str]],
    ) -> dict[str, Any]:
        linked_song_ids = _split_semicolon(row.get("linked_song_ids"))
        linked_drill_ids = _split_semicolon(row.get("linked_drill_ids"))
        free_targets = _split_semicolon(row.get("free_targets"))
        tags = _split_semicolon(row.get("tags"))

        attachments = [self._normalize_record_attachment(item) for item in attachment_rows]
        attachments.sort(key=lambda item: (to_int(item.get("sort_order"), 0), item.get("created_at", "")))

        return {
            "post_id": row.get("post_id", ""),
            "created_at": row.get("created_at", ""),
            "updated_at": row.get("updated_at", ""),
            "title": row.get("title", ""),
            "body": row.get("body", ""),
            "post_type": row.get("post_type", ""),
            "tags": tags,
            "linked_song_ids": linked_song_ids,
            "linked_song_titles": [songs.get(item, {}).get("title", item) for item in linked_song_ids],
            "linked_drill_ids": linked_drill_ids,
            "linked_drill_titles": [drills.get(item, {}).get("name", item) for item in linked_drill_ids],
            "free_targets": free_targets,
            "source_context": row.get("source_context", ""),
            "legacy_event_id": row.get("legacy_event_id", ""),
            "source": row.get("source", ""),
            "attachments": attachments,
        }

    def get_record(self, post_id: str) -> dict[str, Any] | None:
        posts, attachments = self._record_rows()
        songs = {item.get("library_id", ""): item for item in self.storage.read_csv("song_library.csv")}
        drills = {item.get("drill_id", ""): item for item in self.storage.read_csv("drill_library.csv")}
        target = next((item for item in posts if item.get("post_id") == post_id), None)
        if not target:
            return None
        owned = [item for item in attachments if item.get("post_id") == post_id]
        return self._normalize_record_post(target, owned, songs, drills)

    def list_records(
        self,
        limit: int = 500,
        query: str = "",
        post_type: str = "",
        media_type: str = "",
        song_library_id: str = "",
        drill_id: str = "",
    ) -> list[dict[str, Any]]:
        posts, attachments = self._record_rows()
        songs = {item.get("library_id", ""): item for item in self.storage.read_csv("song_library.csv")}
        drills = {item.get("drill_id", ""): item for item in self.storage.read_csv("drill_library.csv")}

        attachment_by_post: dict[str, list[dict[str, str]]] = defaultdict(list)
        for row in attachments:
            attachment_by_post[row.get("post_id", "")].append(row)

        needle = query.strip().lower()
        normalized_media_type = media_type.strip().lower()
        normalized_post_type = post_type.strip()

        items: list[dict[str, Any]] = []
        for row in posts:
            normalized = self._normalize_record_post(
                row,
                attachment_by_post.get(row.get("post_id", ""), []),
                songs,
                drills,
            )

            if normalized_post_type and normalized.get("post_type") != normalized_post_type:
                continue
            if song_library_id and song_library_id not in normalized.get("linked_song_ids", []):
                continue
            if drill_id and drill_id not in normalized.get("linked_drill_ids", []):
                continue
            if normalized_media_type and normalized_media_type != "all":
                if not any(att.get("media_type") == normalized_media_type for att in normalized.get("attachments", [])):
                    continue
            if needle:
                haystack = " ".join(
                    [
                        normalized.get("title", ""),
                        normalized.get("body", ""),
                        normalized.get("post_type", ""),
                        " ".join(normalized.get("tags", [])),
                        " ".join(normalized.get("linked_song_ids", [])),
                        " ".join(normalized.get("linked_song_titles", [])),
                        " ".join(normalized.get("linked_drill_ids", [])),
                        " ".join(normalized.get("linked_drill_titles", [])),
                        " ".join(normalized.get("free_targets", [])),
                    ]
                ).lower()
                if needle not in haystack:
                    continue
            items.append(normalized)

        items.sort(key=lambda item: item.get("created_at", ""), reverse=True)
        return items[: max(limit, 1)]

    def create_record(self, payload: dict[str, Any], attachments_payload: list[dict[str, Any]]) -> dict[str, Any]:
        posts, attachments = self._record_rows()
        headers_posts = self.storage.read_csv_headers("record_posts.csv") or RECORD_POST_HEADERS
        headers_attachments = self.storage.read_csv_headers("record_attachments.csv") or RECORD_ATTACHMENT_HEADERS
        now_iso = to_iso(now_local())

        def parse_list(value: Any) -> list[str]:
            if isinstance(value, list):
                return [str(item).strip() for item in value if str(item).strip()]
            if value is None:
                return []
            text = str(value)
            if not text.strip():
                return []
            text = text.replace(",", ";")
            return [item.strip() for item in text.split(";") if item.strip()]

        post_id = str(payload.get("post_id") or f"POST_{uuid.uuid4().hex[:12]}")
        title = str(payload.get("title") or "").strip()
        post_type = str(payload.get("post_type") or "").strip() or "자유기록"
        if not title:
            title = post_type

        row = {
            "post_id": post_id,
            "created_at": now_iso,
            "updated_at": now_iso,
            "title": title,
            "body": str(payload.get("body") or ""),
            "post_type": post_type,
            "tags": _join_semicolon(parse_list(payload.get("tags"))),
            "linked_song_ids": _join_semicolon(parse_list(payload.get("linked_song_ids"))),
            "linked_drill_ids": _join_semicolon(parse_list(payload.get("linked_drill_ids"))),
            "free_targets": _join_semicolon(parse_list(payload.get("free_targets"))),
            "source_context": str(payload.get("source_context") or ""),
            "legacy_event_id": str(payload.get("legacy_event_id") or ""),
            "source": str(payload.get("source") or "app"),
        }
        posts.append(row)

        for idx, item in enumerate(attachments_payload, start=1):
            attachments.append(
                {
                    "attachment_id": str(item.get("attachment_id") or f"ATT_{uuid.uuid4().hex[:12]}"),
                    "post_id": post_id,
                    "created_at": now_iso,
                    "media_type": str(item.get("media_type") or "image"),
                    "path": str(item.get("path") or ""),
                    "url": str(item.get("url") or ""),
                    "title": str(item.get("title") or ""),
                    "notes": str(item.get("notes") or ""),
                    "sort_order": str(to_int(item.get("sort_order"), idx)),
                }
            )

        self.storage.write_csv("record_posts.csv", posts, headers=headers_posts)
        self.storage.write_csv("record_attachments.csv", attachments, headers=headers_attachments)
        created = self.get_record(post_id)
        if not created:
            raise ValueError("Failed to create record.")
        return created

    def update_record(self, post_id: str, payload: dict[str, Any]) -> tuple[bool, str, dict[str, Any] | None]:
        posts, attachments = self._record_rows()
        target = next((item for item in posts if item.get("post_id") == post_id), None)
        if not target:
            return False, "Record not found.", None

        def parse_list(value: Any) -> str:
            if isinstance(value, list):
                return _join_semicolon([str(item).strip() for item in value if str(item).strip()])
            if value is None:
                return ""
            text = str(value).replace(",", ";")
            return _join_semicolon([item.strip() for item in text.split(";") if item.strip()])

        if payload.get("title") is not None:
            target["title"] = str(payload.get("title") or "")
        if payload.get("body") is not None:
            target["body"] = str(payload.get("body") or "")
        if payload.get("post_type") is not None:
            target["post_type"] = str(payload.get("post_type") or "")
        if payload.get("source_context") is not None:
            target["source_context"] = str(payload.get("source_context") or "")

        if payload.get("tags") is not None:
            target["tags"] = parse_list(payload.get("tags"))
        if payload.get("linked_song_ids") is not None:
            target["linked_song_ids"] = parse_list(payload.get("linked_song_ids"))
        if payload.get("linked_drill_ids") is not None:
            target["linked_drill_ids"] = parse_list(payload.get("linked_drill_ids"))
        if payload.get("free_targets") is not None:
            target["free_targets"] = parse_list(payload.get("free_targets"))

        target["updated_at"] = to_iso(now_local())
        headers_posts = self.storage.read_csv_headers("record_posts.csv") or RECORD_POST_HEADERS
        self.storage.write_csv("record_posts.csv", posts, headers=headers_posts)
        headers_attachments = self.storage.read_csv_headers("record_attachments.csv") or RECORD_ATTACHMENT_HEADERS
        self.storage.write_csv("record_attachments.csv", attachments, headers=headers_attachments)

        updated = self.get_record(post_id)
        return True, "Record updated.", updated

    def delete_record(self, post_id: str) -> tuple[bool, str]:
        posts, attachments = self._record_rows()
        if not any(item.get("post_id") == post_id for item in posts):
            return False, "Record not found."

        kept_posts = [item for item in posts if item.get("post_id") != post_id]
        delete_attachments = [item for item in attachments if item.get("post_id") == post_id]
        kept_attachments = [item for item in attachments if item.get("post_id") != post_id]

        for item in delete_attachments:
            rel = item.get("path", "")
            if not rel:
                continue
            path = self.storage.paths.runtime_media / Path(rel)
            try:
                if path.exists() and path.is_file():
                    path.unlink()
            except OSError:
                pass

        headers_posts = self.storage.read_csv_headers("record_posts.csv") or RECORD_POST_HEADERS
        headers_attachments = self.storage.read_csv_headers("record_attachments.csv") or RECORD_ATTACHMENT_HEADERS
        self.storage.write_csv("record_posts.csv", kept_posts, headers=headers_posts)
        self.storage.write_csv("record_attachments.csv", kept_attachments, headers=headers_attachments)
        return True, "Record deleted."

    def delete_record_attachment(self, post_id: str, attachment_id: str) -> tuple[bool, str]:
        attachments = self.storage.read_csv("record_attachments.csv")
        target = next(
            (
                item
                for item in attachments
                if item.get("attachment_id") == attachment_id and item.get("post_id") == post_id
            ),
            None,
        )
        if not target:
            return False, "Attachment not found."

        rel = target.get("path", "")
        if rel:
            path = self.storage.paths.runtime_media / Path(rel)
            try:
                if path.exists() and path.is_file():
                    path.unlink()
            except OSError:
                pass

        kept = [item for item in attachments if item.get("attachment_id") != attachment_id]
        headers = self.storage.read_csv_headers("record_attachments.csv") or RECORD_ATTACHMENT_HEADERS
        self.storage.write_csv("record_attachments.csv", kept, headers=headers)
        posts = self.storage.read_csv("record_posts.csv")
        target_post = next((row for row in posts if row.get("post_id") == post_id), None)
        if target_post:
            target_post["updated_at"] = to_iso(now_local())
            self.storage.write_csv(
                "record_posts.csv",
                posts,
                headers=self.storage.read_csv_headers("record_posts.csv") or RECORD_POST_HEADERS,
            )
        return True, "Attachment deleted."

    def update_record_attachment(
        self,
        post_id: str,
        attachment_id: str,
        payload: dict[str, Any],
    ) -> tuple[bool, str, dict[str, Any] | None]:
        attachments = self.storage.read_csv("record_attachments.csv")
        target = next(
            (
                item
                for item in attachments
                if item.get("attachment_id") == attachment_id and item.get("post_id") == post_id
            ),
            None,
        )
        if not target:
            return False, "Attachment not found.", None

        if payload.get("title") is not None:
            target["title"] = str(payload.get("title") or "")
        if payload.get("notes") is not None:
            target["notes"] = str(payload.get("notes") or "")
        if payload.get("sort_order") is not None:
            target["sort_order"] = str(max(0, to_int(payload.get("sort_order"), 0)))

        headers = self.storage.read_csv_headers("record_attachments.csv") or RECORD_ATTACHMENT_HEADERS
        self.storage.write_csv("record_attachments.csv", attachments, headers=headers)
        posts = self.storage.read_csv("record_posts.csv")
        target_post = next((row for row in posts if row.get("post_id") == post_id), None)
        if target_post:
            target_post["updated_at"] = to_iso(now_local())
            self.storage.write_csv(
                "record_posts.csv",
                posts,
                headers=self.storage.read_csv_headers("record_posts.csv") or RECORD_POST_HEADERS,
            )
        return True, "Attachment updated.", self._normalize_record_attachment(target)

    def _normalize_session(self, session: dict[str, str]) -> dict[str, Any]:
        meta = parse_json(session.get("meta_json"))
        raw_activity = session.get("activity", "")
        raw_sub_activity = (meta.get("sub_activity") if isinstance(meta, dict) else "") or ""
        activity, sub_activity = _canonical_session_activity(raw_activity, raw_sub_activity)
        return {
            "event_id": session.get("event_id"),
            "created_at": session.get("created_at"),
            "start_at": session.get("start_at"),
            "end_at": session.get("end_at"),
            "duration_min": to_int(session.get("duration_min"), 0),
            "activity": activity,
            "sub_activity": sub_activity,
            "xp": to_int(session.get("xp"), 0),
            "title": session.get("title", ""),
            "notes": session.get("notes", ""),
            "song_library_id": session.get("song_library_id", ""),
            "drill_id": session.get("drill_id", ""),
            "tags": sorted(split_tags(session.get("tags"))),
            "evidence_type": session.get("evidence_type", ""),
            "evidence_path": session.get("evidence_path", ""),
            "evidence_url": session.get("evidence_url", ""),
            "xp_breakdown": (meta.get("xp_breakdown") if isinstance(meta, dict) else {}) or {},
            "is_backfill": bool((meta or {}).get("is_backfill")),
            "song_speed": (meta.get("song_speed") if isinstance(meta, dict) else {}) or {},
            "drill_bpm": (meta.get("drill_bpm") if isinstance(meta, dict) else {}) or {},
            "feelings": list((meta.get("feelings") if isinstance(meta, dict) else []) or []),
        }

    def list_sessions(self, limit: int = 300) -> list[dict[str, Any]]:
        events = self.storage.read_csv("events.csv")
        sessions = [e for e in events if (e.get("event_type") or "").upper() == "SESSION"]
        sessions.sort(key=lambda e: _event_dt(e) or now_local(), reverse=True)
        songs = {item.get("library_id", ""): item for item in self.storage.read_csv("song_library.csv")}
        drills = {item.get("drill_id", ""): item for item in self.storage.read_csv("drill_library.csv")}

        normalized: list[dict[str, Any]] = []
        for session in sessions[: max(limit, 1)]:
            item = self._normalize_session(session)
            song = songs.get(item.get("song_library_id") or "", {})
            drill = drills.get(item.get("drill_id") or "", {})
            item["song_title"] = song.get("title", "")
            item["song_genre"] = song.get("genre", "")
            item["drill_name"] = drill.get("name", "")
            normalized.append(item)
        return normalized

    def delete_session(self, event_id: str, settings: dict[str, Any]) -> tuple[bool, str]:
        rows = self.storage.read_csv("events.csv")
        target = next(
            (row for row in rows if row.get("event_id") == event_id and (row.get("event_type") or "").upper() == "SESSION"),
            None,
        )
        if not target:
            return False, "삭제할 세션을 찾을 수 없습니다."
        kept = [row for row in rows if row.get("event_id") != event_id]
        self.storage.write_csv("events.csv", kept, headers=self.storage.read_csv_headers("events.csv"))
        reconcile_auto_claims(self.storage, settings, now_local())
        return True, "세션을 삭제했습니다."

    def update_session(self, event_id: str, payload: dict[str, Any], settings: dict[str, Any]) -> tuple[bool, str, dict[str, Any] | None]:
        rows = self.storage.read_csv("events.csv")
        target = next(
            (row for row in rows if row.get("event_id") == event_id and (row.get("event_type") or "").upper() == "SESSION"),
            None,
        )
        if not target:
            return False, "수정할 세션을 찾을 수 없습니다.", None

        current_meta = parse_json(target.get("meta_json"))
        start_at = parse_dt(payload.get("start_at")) or parse_dt(target.get("start_at"))
        end_at = parse_dt(payload.get("end_at")) or parse_dt(target.get("end_at"))
        if not start_at or not end_at:
            return False, "시작/종료 시간을 확인해주세요.", None
        if end_at <= start_at:
            return False, "종료 시간은 시작 시간보다 늦어야 합니다.", None

        duration_min = max(1, int((end_at - start_at).total_seconds() // 60))
        activity = str(payload.get("activity") or target.get("activity") or "Drill")
        sub_activity = str(
            payload.get("sub_activity")
            if payload.get("sub_activity") is not None
            else (current_meta.get("sub_activity") if isinstance(current_meta, dict) else "")
        )
        if payload.get("activity") is not None and payload.get("sub_activity") is None:
            sub_activity = ""
        activity, sub_activity = _canonical_session_activity(activity, sub_activity)

        if isinstance(payload.get("tags"), list):
            raw_tags = [str(tag).upper().strip() for tag in payload.get("tags", []) if str(tag).strip()]
            tags = sorted(set(raw_tags))
        else:
            tags = sorted(split_tags(target.get("tags")))

        is_backfill = bool(
            payload.get("is_backfill")
            if payload.get("is_backfill") is not None
            else (current_meta.get("is_backfill") if isinstance(current_meta, dict) else False)
        )

        breakdown = session_xp_breakdown(
            {
                "duration_min": duration_min,
                "activity": activity,
                "tags": tags,
                "is_backfill": is_backfill,
            },
            settings,
        )
        applied_xp, reduced_by_cap = self._apply_daily_session_cap(
            breakdown.get("total_xp", 0),
            start_at.date(),
            settings,
            exclude_event_id=event_id,
        )
        breakdown["pre_cap_total_xp"] = breakdown.get("total_xp", 0)
        breakdown["daily_cap_reduced"] = reduced_by_cap
        breakdown["total_xp"] = applied_xp
        tag_set = {str(tag).upper() for tag in tags}
        if activity in ACTIVITY_TO_TAG:
            tag_set.add(ACTIVITY_TO_TAG[activity])
        if sub_activity in SUB_ACTIVITY_TO_TAG:
            tag_set.add(SUB_ACTIVITY_TO_TAG[sub_activity])
        normalized_tags = sorted(tag_set)

        target["start_at"] = to_iso(start_at)
        target["end_at"] = to_iso(end_at)
        target["duration_min"] = str(duration_min)
        target["activity"] = activity
        target["xp"] = str(breakdown["total_xp"])
        target["tags"] = ";".join(normalized_tags)
        target["title"] = str(payload.get("title") if payload.get("title") is not None else target.get("title") or f"Session - {activity}")
        target["notes"] = str(payload.get("notes") if payload.get("notes") is not None else target.get("notes", ""))
        target["song_library_id"] = str(
            payload.get("song_library_id") if payload.get("song_library_id") is not None else target.get("song_library_id", "")
        )
        target["drill_id"] = str(payload.get("drill_id") if payload.get("drill_id") is not None else target.get("drill_id", ""))
        if payload.get("evidence_type") is not None:
            target["evidence_type"] = str(payload.get("evidence_type"))
        if payload.get("evidence_url") is not None:
            target["evidence_url"] = str(payload.get("evidence_url"))
        if payload.get("evidence_path") is not None:
            target["evidence_path"] = str(payload.get("evidence_path"))

        next_meta = current_meta if isinstance(current_meta, dict) else {}
        next_meta["xp_breakdown"] = {
            "base_xp": breakdown["base_xp"],
            "bonus_xp": breakdown["bonus_xp"],
            "bonus_breakdown": breakdown["bonus_breakdown"],
            "pre_cap_total_xp": breakdown.get("pre_cap_total_xp", breakdown["total_xp"]),
            "daily_cap_reduced": breakdown.get("daily_cap_reduced", 0),
        }
        next_meta["is_backfill"] = is_backfill
        next_meta["sub_activity"] = sub_activity
        if payload.get("song_speed") is not None:
            next_meta["song_speed"] = payload.get("song_speed")
        if payload.get("drill_bpm") is not None:
            next_meta["drill_bpm"] = payload.get("drill_bpm")
        if payload.get("feelings") is not None:
            next_meta["feelings"] = payload.get("feelings")
        target["meta_json"] = json.dumps(next_meta, ensure_ascii=False)

        self.storage.write_csv("events.csv", rows, headers=self.storage.read_csv_headers("events.csv"))
        reconcile_auto_claims(self.storage, settings, now_local())
        return True, "세션을 수정했습니다.", self._normalize_session(target)

    def stats_overview(self, settings: dict[str, Any], quest_range: str = "all") -> dict[str, Any]:
        events = self.storage.read_csv("events.csv")
        sessions = [e for e in events if (e.get("event_type") or "").upper() == "SESSION"]
        sessions.sort(key=lambda e: _event_dt(e) or now_local())
        today = now_local().date()
        range_days = {"7d": 7, "30d": 30, "6m": 180, "all": 0}
        quest_window_days = range_days.get(str(quest_range or "all").lower(), 0)

        daily: dict[str, dict[str, Any]] = defaultdict(lambda: {"xp": 0, "session_count": 0, "duration_min": 0})
        weekly: dict[str, dict[str, Any]] = defaultdict(lambda: {"xp": 0, "session_count": 0, "duration_min": 0})
        monthly: dict[str, dict[str, Any]] = defaultdict(lambda: {"xp": 0, "session_count": 0, "duration_min": 0})
        by_activity: dict[str, dict[str, Any]] = defaultdict(lambda: {"xp": 0, "session_count": 0, "duration_min": 0})
        quest_by_period: dict[str, dict[str, int]] = defaultdict(lambda: {"claimed": 0, "xp": 0})
        quest_by_difficulty: dict[str, dict[str, int]] = defaultdict(lambda: {"claimed": 0, "xp": 0})
        quest_by_priority: dict[str, dict[str, int]] = defaultdict(lambda: {"claimed": 0, "xp": 0})
        quest_by_genre: dict[str, dict[str, int]] = defaultdict(lambda: {"claimed": 0, "xp": 0})
        quest_claimed_total = 0
        quest_claimed_xp_total = 0

        for event in events:
            dt = _event_dt(event)
            if not dt:
                continue
            day_key = dt.date().isoformat()
            year, week, _ = dt.date().isocalendar()
            week_key = f"{year}-W{week:02d}"
            month_key = f"{dt.year:04d}-{dt.month:02d}"
            xp = to_int(event.get("xp"), 0)
            daily[day_key]["xp"] += xp
            weekly[week_key]["xp"] += xp
            monthly[month_key]["xp"] += xp
            if (event.get("event_type") or "").upper() == "SESSION":
                duration = to_int(event.get("duration_min"), 0)
                daily[day_key]["session_count"] += 1
                daily[day_key]["duration_min"] += duration
                weekly[week_key]["session_count"] += 1
                weekly[week_key]["duration_min"] += duration
                monthly[month_key]["session_count"] += 1
                monthly[month_key]["duration_min"] += duration

                meta = parse_json(event.get("meta_json"))
                activity, _ = _canonical_session_activity(event.get("activity", ""), str(meta.get("sub_activity", "")))
                by_activity[activity]["xp"] += xp
                by_activity[activity]["session_count"] += 1
                by_activity[activity]["duration_min"] += duration
            if (event.get("event_type") or "").upper() == "QUEST_CLAIM":
                if quest_window_days > 0 and not _is_in_last_days(dt.date(), today, quest_window_days):
                    continue
                meta = parse_json(event.get("meta_json"))
                quest_meta = meta.get("quest") if isinstance(meta, dict) else {}
                if not isinstance(quest_meta, dict):
                    quest_meta = {}
                period = str(quest_meta.get("period_class") or "").strip().lower()
                difficulty = str(quest_meta.get("difficulty") or "").strip().lower()
                priority = str(quest_meta.get("priority") or "").strip().lower()
                raw_genres = quest_meta.get("genres")
                genres = [str(item).strip() for item in raw_genres] if isinstance(raw_genres, list) else []
                if not genres:
                    primary = str(quest_meta.get("genre_primary") or "").strip()
                    if primary:
                        genres = [primary]
                quest_claimed_total += 1
                quest_claimed_xp_total += max(0, xp)
                if period:
                    quest_by_period[period]["claimed"] += 1
                    quest_by_period[period]["xp"] += max(0, xp)
                if difficulty:
                    quest_by_difficulty[difficulty]["claimed"] += 1
                    quest_by_difficulty[difficulty]["xp"] += max(0, xp)
                if priority:
                    quest_by_priority[priority]["claimed"] += 1
                    quest_by_priority[priority]["xp"] += max(0, xp)
                for genre in genres:
                    token = genre.strip()
                    if not token:
                        continue
                    quest_by_genre[token]["claimed"] += 1
                    quest_by_genre[token]["xp"] += max(0, xp)

        parsed_days = sorted(
            [date.fromisoformat(key) for key in daily.keys() if len(key) >= 10 and key[4:5] == "-" and key[7:8] == "-"]
        )
        first_day = parsed_days[0] if parsed_days else today
        window_start = max(first_day, today - timedelta(days=59))
        window_end = today
        daily_series: list[dict[str, Any]] = []
        cursor = window_start
        while cursor <= window_end:
            key = cursor.isoformat()
            bucket = daily.get(key, {"xp": 0, "session_count": 0, "duration_min": 0})
            daily_series.append({"key": key, **bucket})
            cursor += timedelta(days=1)
        weekly_series = [{"key": key, **weekly[key]} for key in sorted(weekly.keys())[-30:]]
        monthly_series = [{"key": key, **monthly[key]} for key in sorted(monthly.keys())[-24:]]
        activity_series = [{"key": key, **value} for key, value in by_activity.items()]
        activity_series.sort(key=lambda item: item["xp"], reverse=True)

        baseline_xp = 0
        for event in events:
            dt = _event_dt(event)
            if not dt:
                continue
            if dt.date() < window_start:
                baseline_xp += to_int(event.get("xp"), 0)
        cumulative = baseline_xp
        level_series = []
        for item in daily_series:
            cumulative += to_int(item.get("xp"), 0)
            level = compute_level_summary(cumulative, settings).level
            level_series.append({"key": item["key"], "level": level, "xp_total": cumulative})

        total_duration = sum(to_int(s.get("duration_min"), 0) for s in sessions)
        total_session_xp = sum(to_int(s.get("xp"), 0) for s in sessions)
        total_xp = total_xp_from_events(events)
        avg_duration = round(total_duration / len(sessions), 1) if sessions else 0.0
        session_days = sorted({event_date(item) for item in sessions if event_date(item)})
        session_days_30 = [item for item in session_days if _is_in_last_days(item, today, 30)]
        active_days_30d = len(session_days_30)

        revisit_hits = 0
        for idx, day in enumerate(session_days_30):
            future_window_hit = any(0 < (future - day).days <= 7 for future in session_days_30[idx + 1 :])
            if future_window_hit:
                revisit_hits += 1
        revisit_7d_rate = round((revisit_hits / max(1, len(session_days_30))) * 100, 1) if session_days_30 else 0.0

        weekly_goal = max(1, to_int(settings.get("profile", {}).get("weekly_goal_sessions"), 3))
        recent_weeks = weekly_series[-8:]
        weekly_hits = sum(1 for item in recent_weeks if to_int(item.get("session_count"), 0) >= weekly_goal)
        weekly_goal_hit_rate = round((weekly_hits / max(1, len(recent_weeks))) * 100, 1) if recent_weeks else 0.0
        quest_breakdown = {
            "by_period": [{"key": key, **value} for key, value in sorted(quest_by_period.items())],
            "by_difficulty": [{"key": key, **value} for key, value in sorted(quest_by_difficulty.items())],
            "by_priority": [{"key": key, **value} for key, value in sorted(quest_by_priority.items())],
            "by_genre": [{"key": key, **value} for key, value in sorted(quest_by_genre.items())],
            "claimed_total": quest_claimed_total,
            "claimed_xp_total": quest_claimed_xp_total,
        }

        return {
            "summary": {
                "sessions_count": len(sessions),
                "total_duration_min": total_duration,
                "avg_duration_min": avg_duration,
                "session_xp": total_session_xp,
                "total_xp": total_xp,
            },
            "daily": daily_series,
            "weekly": weekly_series,
            "monthly": monthly_series,
            "activity": activity_series,
            "level_timeline": level_series,
            "engagement": {
                "revisit_7d_rate": revisit_7d_rate,
                "active_days_30d": active_days_30d,
                "weekly_goal_hit_rate": weekly_goal_hit_rate,
            },
            "quest_breakdown": quest_breakdown,
        }

    @staticmethod
    def _iter_days(start_day: date, end_day: date):
        cursor = start_day
        while cursor <= end_day:
            yield cursor
            cursor += timedelta(days=1)

    @staticmethod
    def _aggregate_day_rows_by_week(day_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        bucket: dict[str, int] = defaultdict(int)
        for row in day_rows:
            try:
                d = date.fromisoformat(str(row.get("key", "")))
            except ValueError:
                continue
            year, week, _ = d.isocalendar()
            key = f"{year}-W{week:02d}"
            bucket[key] += max(0, to_int(row.get("xp"), 0))
        return [{"key": key, "xp": bucket[key]} for key in sorted(bucket.keys())]

    @staticmethod
    def _aggregate_day_rows_by_month(day_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        bucket: dict[str, int] = defaultdict(int)
        for row in day_rows:
            raw = str(row.get("key", ""))
            if len(raw) < 7:
                continue
            bucket[raw[:7]] += max(0, to_int(row.get("xp"), 0))
        return [{"key": key, "xp": bucket[key]} for key in sorted(bucket.keys())]

    @staticmethod
    def _delta_pct(current: int, previous: int) -> float:
        if previous <= 0:
            return 100.0 if current > 0 else 0.0
        return round(((current - previous) / previous) * 100, 1)

    @staticmethod
    def _sum_in_window(day_bucket: dict[str, int], start_day: date, end_day: date) -> int:
        total = 0
        for day in GameService._iter_days(start_day, end_day):
            total += max(0, to_int(day_bucket.get(day.isoformat()), 0))
        return total

    @staticmethod
    def _sort_xp_bucket(bucket: dict[str, int], top_n: int = 10) -> list[dict[str, Any]]:
        rows = [{"key": key, "xp": max(0, to_int(value, 0))} for key, value in bucket.items() if max(0, to_int(value, 0)) > 0]
        rows.sort(key=lambda item: item["xp"], reverse=True)
        return rows[: max(1, top_n)]

    @staticmethod
    def _resolve_xp_window(
        scope: str,
        period_unit: str,
        anchor: str,
        recent_days: int,
        today: date,
        first_data_day: date | None,
    ) -> dict[str, Any]:
        normalized_scope = str(scope or "all").strip().lower() or "all"
        if normalized_scope not in {"all", "period", "recent"}:
            raise ValueError(f"scope must be one of all|period|recent (received: {scope})")

        anchor_day = today
        if anchor:
            try:
                anchor_day = date.fromisoformat(str(anchor))
            except ValueError as exc:
                raise ValueError("anchor must be YYYY-MM-DD") from exc

        if normalized_scope == "all":
            start_day = first_data_day or today
            end_day = today
            return {
                "scope": "all",
                "period_unit": None,
                "recent_days": None,
                "anchor_key": today.isoformat(),
                "start_day": start_day,
                "end_day": end_day,
                "prev_start_day": None,
                "prev_end_day": None,
                "label": "All time",
            }

        if normalized_scope == "recent":
            if recent_days not in {7, 30, 90}:
                raise ValueError("recent_days must be one of 7, 30, 90")
            start_day = today - timedelta(days=recent_days - 1)
            end_day = today
            prev_start_day = start_day - timedelta(days=recent_days)
            prev_end_day = start_day - timedelta(days=1)
            return {
                "scope": "recent",
                "period_unit": None,
                "recent_days": recent_days,
                "anchor_key": today.isoformat(),
                "start_day": start_day,
                "end_day": end_day,
                "prev_start_day": prev_start_day,
                "prev_end_day": prev_end_day,
                "label": f"Recent {recent_days} days",
            }

        normalized_unit = str(period_unit or "").strip().lower()
        if normalized_unit not in {"week", "month", "year"}:
            raise ValueError("period_unit must be one of week, month, year when scope=period")

        if normalized_unit == "week":
            start_day = anchor_day - timedelta(days=anchor_day.weekday())
            end_day = start_day + timedelta(days=6)
            prev_start_day = start_day - timedelta(days=7)
            prev_end_day = end_day - timedelta(days=7)
            label = f"{start_day.isoformat()} ~ {end_day.isoformat()}"
        elif normalized_unit == "month":
            start_day = date(anchor_day.year, anchor_day.month, 1)
            if anchor_day.month == 12:
                end_day = date(anchor_day.year + 1, 1, 1) - timedelta(days=1)
            else:
                end_day = date(anchor_day.year, anchor_day.month + 1, 1) - timedelta(days=1)

            prev_anchor_month = 12 if anchor_day.month == 1 else anchor_day.month - 1
            prev_anchor_year = anchor_day.year - 1 if anchor_day.month == 1 else anchor_day.year
            prev_start_day = date(prev_anchor_year, prev_anchor_month, 1)
            if prev_anchor_month == 12:
                prev_end_day = date(prev_anchor_year + 1, 1, 1) - timedelta(days=1)
            else:
                prev_end_day = date(prev_anchor_year, prev_anchor_month + 1, 1) - timedelta(days=1)
            label = f"{anchor_day.year:04d}-{anchor_day.month:02d}"
        else:
            start_day = date(anchor_day.year, 1, 1)
            end_day = date(anchor_day.year, 12, 31)
            prev_start_day = date(anchor_day.year - 1, 1, 1)
            prev_end_day = date(anchor_day.year - 1, 12, 31)
            label = f"{anchor_day.year:04d}"

        return {
            "scope": "period",
            "period_unit": normalized_unit,
            "recent_days": None,
            "anchor_key": anchor_day.isoformat(),
            "start_day": start_day,
            "end_day": end_day,
            "prev_start_day": prev_start_day,
            "prev_end_day": prev_end_day,
            "label": label,
        }

    def player_xp_window(
        self,
        settings: dict[str, Any],
        *,
        scope: str = "all",
        period_unit: str = "",
        anchor: str = "",
        recent_days: int = 7,
    ) -> dict[str, Any]:
        events = self.storage.read_csv("events.csv")
        today = now_local().date()

        daily_xp_all: dict[str, int] = defaultdict(int)
        daily_duration_all: dict[str, int] = defaultdict(int)
        parsed_xp_days: list[tuple[date, int]] = []

        for event in events:
            dt = _event_dt(event)
            if not dt:
                continue
            day = dt.date()
            key = day.isoformat()
            xp = max(0, to_int(event.get("xp"), 0))
            if xp > 0:
                daily_xp_all[key] += xp
            if (event.get("event_type") or "").upper() == "SESSION":
                daily_duration_all[key] += max(0, to_int(event.get("duration_min"), 0))

        for key, value in daily_xp_all.items():
            try:
                parsed_xp_days.append((date.fromisoformat(key), max(0, to_int(value, 0))))
            except ValueError:
                continue
        parsed_xp_days.sort(key=lambda item: item[0])
        first_data_day = parsed_xp_days[0][0] if parsed_xp_days else None

        window = self._resolve_xp_window(scope, period_unit, anchor, to_int(recent_days, 7), today, first_data_day)
        start_day = window["start_day"]
        end_day = window["end_day"]
        prev_start_day = window["prev_start_day"]
        prev_end_day = window["prev_end_day"]

        day_rows: list[dict[str, Any]] = []
        xp_total = 0
        best_day_key = end_day.isoformat()
        best_day_xp = 0
        for day in self._iter_days(start_day, end_day):
            key = day.isoformat()
            xp_value = max(0, to_int(daily_xp_all.get(key), 0))
            day_rows.append({"key": key, "xp": xp_value, "is_today": key == today.isoformat()})
            xp_total += xp_value
            if xp_value > best_day_xp or (xp_value == best_day_xp and key > best_day_key):
                best_day_xp = xp_value
                best_day_key = key

        prev_xp_total = 0
        if prev_start_day and prev_end_day:
            prev_xp_total = self._sum_in_window(daily_xp_all, prev_start_day, prev_end_day)

        total_duration_min = self._sum_in_window(daily_duration_all, start_day, end_day)
        day_span = max(1, (end_day - start_day).days + 1)
        avg_xp_per_day = round(xp_total / day_span, 1)

        source_totals: dict[str, int] = defaultdict(int)
        activity_totals: dict[str, int] = defaultdict(int)
        for event in events:
            dt = _event_dt(event)
            if not dt:
                continue
            day = dt.date()
            if day < start_day or day > end_day:
                continue
            xp = max(0, to_int(event.get("xp"), 0))
            if xp <= 0:
                continue
            source_totals[_event_source_key(event.get("event_type", ""))] += xp
            if (event.get("event_type") or "").upper() == "SESSION":
                meta = parse_json(event.get("meta_json"))
                activity, _ = _canonical_session_activity(event.get("activity", ""), str(meta.get("sub_activity", "")))
                activity_totals[activity] += xp

        baseline_xp = sum(value for day, value in parsed_xp_days if day < start_day)
        cumulative = baseline_xp
        level_progress: list[dict[str, Any]] = []
        for row in day_rows:
            cumulative += max(0, to_int(row.get("xp"), 0))
            level_state = compute_level_summary(cumulative, settings)
            level_progress.append(
                {
                    "key": row.get("key", ""),
                    "level": level_state.level,
                    "progress_pct": round(level_state.progress * 100, 1),
                    "value": round(level_state.level + level_state.progress, 4),
                }
            )

        return {
            "window": {
                "scope": window["scope"],
                "period_unit": window["period_unit"],
                "recent_days": window["recent_days"],
                "anchor_key": window["anchor_key"],
                "start_key": start_day.isoformat(),
                "end_key": end_day.isoformat(),
                "prev_start_key": prev_start_day.isoformat() if prev_start_day else None,
                "prev_end_key": prev_end_day.isoformat() if prev_end_day else None,
                "label": window["label"],
            },
            "summary": {
                "xp_total": xp_total,
                "prev_xp_total": prev_xp_total,
                "delta_pct": self._delta_pct(xp_total, prev_xp_total),
                "avg_xp_per_day": avg_xp_per_day,
                "best_xp_day": {"key": best_day_key, "xp": best_day_xp},
                "total_duration_min": total_duration_min,
            },
            "charts": {
                "day": day_rows,
                "week": self._aggregate_day_rows_by_week(day_rows),
                "month": self._aggregate_day_rows_by_month(day_rows),
            },
            "level_progress": level_progress,
            "xp_by_activity": self._sort_xp_bucket(activity_totals, top_n=10),
            "xp_sources": self._sort_xp_bucket(source_totals, top_n=10),
        }

    def player_xp_page(self, settings: dict[str, Any]) -> dict[str, Any]:
        hud = self.hud_summary(settings)
        unlockables = self.storage.read_csv("unlockables.csv")
        events = self.storage.read_csv("events.csv")
        current_level = to_int(hud.get("level"), 1)
        upcoming = []
        for row in unlockables:
            required = to_int(row.get("level_required"), 1)
            if required > current_level:
                upcoming.append(
                    {
                        "level_required": required,
                        "name": row.get("name", ""),
                        "type": row.get("type", ""),
                        "description": row.get("description", ""),
                    }
                )
        upcoming.sort(key=lambda x: x["level_required"])
        stats = self.stats_overview(settings)
        cheer = ""

        today = now_local().date()
        week_start = today - timedelta(days=today.weekday())
        month_start = date(today.year, today.month, 1)
        range_days: dict[str, int] = {"7d": 7, "30d": 30, "90d": 90, "all": 0}
        source_totals: dict[str, dict[str, int]] = {
            "7d": defaultdict(int),
            "30d": defaultdict(int),
            "90d": defaultdict(int),
            "all": defaultdict(int),
        }
        activity_totals: dict[str, dict[str, int]] = {
            "7d": defaultdict(int),
            "30d": defaultdict(int),
            "90d": defaultdict(int),
            "all": defaultdict(int),
        }
        daily_xp_by_range: dict[str, dict[str, int]] = {
            "7d": defaultdict(int),
            "30d": defaultdict(int),
            "90d": defaultdict(int),
            "all": defaultdict(int),
        }
        daily_duration_by_range: dict[str, dict[str, int]] = {
            "7d": defaultdict(int),
            "30d": defaultdict(int),
            "90d": defaultdict(int),
            "all": defaultdict(int),
        }
        daily_xp_all: dict[str, int] = defaultdict(int)
        daily_session_minutes_all: dict[str, int] = defaultdict(int)
        session_day_set: set[date] = set()
        current_week_xp = 0
        current_month_xp = 0

        for event in events:
            dt = _event_dt(event)
            if not dt:
                continue
            event_day = dt.date()
            day_key = event_day.isoformat()
            xp = max(0, to_int(event.get("xp"), 0))
            source = _event_source_key(event.get("event_type", ""))
            is_session = (event.get("event_type") or "").upper() == "SESSION"
            duration = max(0, to_int(event.get("duration_min"), 0)) if is_session else 0
            meta = parse_json(event.get("meta_json"))
            activity, _ = _canonical_session_activity(event.get("activity", ""), str(meta.get("sub_activity", "")))

            if xp > 0:
                daily_xp_all[day_key] += xp
                if week_start <= event_day <= today:
                    current_week_xp += xp
                if month_start <= event_day <= today:
                    current_month_xp += xp

            if is_session:
                session_day_set.add(event_day)
                if duration > 0:
                    daily_session_minutes_all[day_key] += duration

            for range_key, days in range_days.items():
                if days > 0 and not _is_in_last_days(event_day, today, days):
                    continue
                if xp > 0:
                    source_totals[range_key][source] += xp
                    daily_xp_by_range[range_key][day_key] += xp
                    if is_session:
                        activity_totals[range_key][activity] += xp
                if is_session and duration > 0:
                    daily_duration_by_range[range_key][day_key] += duration

        def _to_sorted_series(bucket: dict[str, int], top_n: int = 8) -> list[dict[str, Any]]:
            rows = [{"key": k, "xp": v} for k, v in bucket.items() if v > 0]
            rows.sort(key=lambda item: item["xp"], reverse=True)
            return rows[:top_n]

        def _daily_series(bucket: dict[str, int], limit: int, days: int | None = None) -> list[dict[str, int]]:
            if days is not None and days > 0:
                start_day = today - timedelta(days=days - 1)
                rows: list[dict[str, int]] = []
                for idx in range(days):
                    day = start_day + timedelta(days=idx)
                    key = day.isoformat()
                    rows.append({"key": key, "xp": to_int(bucket.get(key), 0)})
                return rows[-limit:]

            parsed: list[date] = []
            for raw_key in bucket.keys():
                try:
                    parsed.append(date.fromisoformat(raw_key))
                except ValueError:
                    continue
            if not parsed:
                return [{"key": today.isoformat(), "xp": 0}]
            start_day = min(parsed)
            end_day = max(max(parsed), today)
            rows = []
            cursor = start_day
            while cursor <= end_day:
                key = cursor.isoformat()
                rows.append({"key": key, "xp": to_int(bucket.get(key), 0)})
                cursor += timedelta(days=1)
            return rows[-limit:]

        def _aggregate_by_week(day_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
            bucket: dict[str, int] = defaultdict(int)
            for row in day_rows:
                try:
                    d = date.fromisoformat(str(row.get("key", "")))
                except ValueError:
                    continue
                year, week, _ = d.isocalendar()
                key = f"{year}-W{week:02d}"
                bucket[key] += max(0, to_int(row.get("xp"), 0))
            return [{"key": key, "xp": bucket[key]} for key in sorted(bucket.keys())]

        def _aggregate_by_month(day_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
            bucket: dict[str, int] = defaultdict(int)
            for row in day_rows:
                raw = str(row.get("key", ""))
                if len(raw) >= 7:
                    key = raw[:7]
                    bucket[key] += max(0, to_int(row.get("xp"), 0))
            return [{"key": key, "xp": bucket[key]} for key in sorted(bucket.keys())]

        def _delta_pct(current: int, previous: int) -> float:
            if previous <= 0:
                return 100.0 if current > 0 else 0.0
            return round(((current - previous) / previous) * 100, 1)

        parsed_xp_days: list[tuple[date, int]] = []
        for raw_key, value in daily_xp_all.items():
            try:
                parsed_xp_days.append((date.fromisoformat(raw_key), max(0, to_int(value, 0))))
            except ValueError:
                continue
        parsed_xp_days.sort(key=lambda item: item[0])

        def _sum_xp_in_window(start_day: date, end_day: date) -> int:
            total = 0
            for d, value in parsed_xp_days:
                if d < start_day:
                    continue
                if d > end_day:
                    break
                total += value
            return total

        summary_by_range: dict[str, Any] = {}
        for range_key, days in range_days.items():
            if days > 0:
                current_start = today - timedelta(days=days - 1)
                current_end = today
                previous_start = current_start - timedelta(days=days)
                previous_end = current_start - timedelta(days=1)
                xp_total = _sum_xp_in_window(current_start, current_end)
                prev_xp_total = _sum_xp_in_window(previous_start, previous_end)
                avg_xp = round(xp_total / max(1, days), 1)
                best_day_key = current_end.isoformat()
                best_day_xp = 0
                cursor = current_start
                while cursor <= current_end:
                    value = max(0, to_int(daily_xp_by_range[range_key].get(cursor.isoformat()), 0))
                    if value >= best_day_xp:
                        best_day_xp = value
                        best_day_key = cursor.isoformat()
                    cursor += timedelta(days=1)
            else:
                xp_total = sum(max(0, to_int(value, 0)) for value in daily_xp_all.values())
                if parsed_xp_days:
                    current_end = today
                    current_start = min(item[0] for item in parsed_xp_days)
                else:
                    current_end = today
                    current_start = today
                previous_start = None
                previous_end = None
                prev_xp_total = 0
                if parsed_xp_days:
                    all_start = min(item[0] for item in parsed_xp_days)
                    span_days = max(1, (today - all_start).days + 1)
                else:
                    span_days = 1
                avg_xp = round(xp_total / max(1, span_days), 1)
                best_day_key = today.isoformat()
                best_day_xp = 0
                for raw_key, value in daily_xp_all.items():
                    safe_value = max(0, to_int(value, 0))
                    if safe_value > best_day_xp or (safe_value == best_day_xp and str(raw_key) > best_day_key):
                        best_day_xp = safe_value
                        best_day_key = str(raw_key)

            summary_by_range[range_key] = {
                "xp_total": xp_total,
                "prev_xp_total": prev_xp_total,
                "delta_pct": _delta_pct(xp_total, prev_xp_total),
                "avg_xp_per_day": avg_xp,
                "best_xp_day": {"key": best_day_key, "xp": best_day_xp},
                "total_duration_min": sum(max(0, to_int(value, 0)) for value in daily_duration_by_range[range_key].values()),
                "start_key": current_start.isoformat(),
                "end_key": current_end.isoformat(),
                "prev_start_key": previous_start.isoformat() if previous_start else None,
                "prev_end_key": previous_end.isoformat() if previous_end else None,
            }

        story_xp_charts: dict[str, dict[str, list[dict[str, Any]]]] = {}
        story_level_charts: dict[str, list[dict[str, Any]]] = {}
        for range_key, days in range_days.items():
            if days > 0:
                day_rows = _daily_series(daily_xp_by_range[range_key], limit=days, days=days)
            else:
                day_rows = _daily_series(daily_xp_by_range[range_key], limit=180)
            day_rows_with_today = [dict(row, is_today=(str(row.get("key")) == today.isoformat())) for row in day_rows]
            story_xp_charts[range_key] = {
                "day": day_rows_with_today,
                "week": _aggregate_by_week(day_rows),
                "month": _aggregate_by_month(day_rows),
            }

            if day_rows:
                try:
                    start_day = date.fromisoformat(str(day_rows[0].get("key", "")))
                except ValueError:
                    start_day = today
                baseline = sum(value for d, value in parsed_xp_days if d < start_day)
            else:
                baseline = 0
            cumulative = baseline
            level_rows: list[dict[str, Any]] = []
            for row in day_rows:
                cumulative += max(0, to_int(row.get("xp"), 0))
                level_state = compute_level_summary(cumulative, settings)
                progress_pct = round(level_state.progress * 100, 1)
                level_rows.append(
                    {
                        "key": row.get("key", ""),
                        "level": level_state.level,
                        "progress_pct": progress_pct,
                        "value": round(level_state.level + level_state.progress, 4),
                    }
                )
            story_level_charts[range_key] = level_rows

        session_days = sorted(session_day_set)
        if not session_days:
            current_streak_days = 0
            longest_streak_days = 0
        else:
            longest_streak_days = 1
            streak = 1
            for idx in range(1, len(session_days)):
                diff = (session_days[idx] - session_days[idx - 1]).days
                if diff == 1:
                    streak += 1
                    longest_streak_days = max(longest_streak_days, streak)
                else:
                    streak = 1

            if (today - session_days[-1]).days > 1:
                current_streak_days = 0
            else:
                current_streak_days = 1
                for idx in range(len(session_days) - 1, 0, -1):
                    diff = (session_days[idx] - session_days[idx - 1]).days
                    if diff == 1:
                        current_streak_days += 1
                    else:
                        break

        week_starts = sorted({item - timedelta(days=item.weekday()) for item in session_days})
        if not week_starts:
            longest_streak_weeks = 0
        else:
            longest_streak_weeks = 1
            streak = 1
            for idx in range(1, len(week_starts)):
                diff = (week_starts[idx] - week_starts[idx - 1]).days
                if diff == 7:
                    streak += 1
                    longest_streak_weeks = max(longest_streak_weeks, streak)
                else:
                    streak = 1

        heat_start = today - timedelta(days=41)
        heat_cells: list[dict[str, Any]] = []
        cursor = heat_start
        while cursor <= today:
            key = cursor.isoformat()
            minutes = max(0, to_int(daily_session_minutes_all.get(key), 0))
            xp = max(0, to_int(daily_xp_all.get(key), 0))
            heat_cells.append({"key": key, "minutes": minutes, "xp": xp})
            cursor += timedelta(days=1)
        max_heat_minutes = max((to_int(item.get("minutes"), 0) for item in heat_cells), default=0)
        for item in heat_cells:
            minutes = max(0, to_int(item.get("minutes"), 0))
            if minutes <= 0 or max_heat_minutes <= 0:
                intensity = 0
            else:
                ratio = minutes / max_heat_minutes
                if ratio >= 0.75:
                    intensity = 4
                elif ratio >= 0.5:
                    intensity = 3
                elif ratio >= 0.25:
                    intensity = 2
                else:
                    intensity = 1
            item["intensity"] = intensity

        if daily_session_minutes_all:
            parsed_minute_days = []
            for raw_key in daily_session_minutes_all.keys():
                try:
                    parsed_minute_days.append(date.fromisoformat(str(raw_key)))
                except ValueError:
                    continue
            history_start = min(parsed_minute_days) if parsed_minute_days else today
        else:
            history_start = today

        heat_history: list[dict[str, Any]] = []
        cursor = history_start
        while cursor <= today:
            key = cursor.isoformat()
            heat_history.append(
                {
                    "key": key,
                    "minutes": max(0, to_int(daily_session_minutes_all.get(key), 0)),
                    "xp": max(0, to_int(daily_xp_all.get(key), 0)),
                }
            )
            cursor += timedelta(days=1)

        best_practice_day_key = today.isoformat()
        best_practice_minutes = 0
        for raw_key, value in daily_session_minutes_all.items():
            safe = max(0, to_int(value, 0))
            if safe > best_practice_minutes or (safe == best_practice_minutes and str(raw_key) > best_practice_day_key):
                best_practice_day_key = str(raw_key)
                best_practice_minutes = safe

        auto_weekly = int(round((summary_by_range["30d"]["xp_total"] / 4.0) * 1.05))
        auto_weekly = min(6000, max(800, auto_weekly))
        auto_monthly = int(round(auto_weekly * 4.3))
        auto_monthly = min(24000, max(3200, auto_monthly))
        profile = settings.get("profile", {}) if isinstance(settings.get("profile"), dict) else {}
        manual_weekly = max(0, to_int(profile.get("xp_goal_weekly"), 0))
        manual_monthly = max(0, to_int(profile.get("xp_goal_monthly"), 0))
        effective_weekly = manual_weekly if manual_weekly > 0 else auto_weekly
        effective_monthly = manual_monthly if manual_monthly > 0 else auto_monthly
        # Weekly = Monday~Sunday, Monthly = 1st~end of month.
        current_week_start = week_start
        current_week_end = current_week_start + timedelta(days=6)
        prev_week_start = current_week_start - timedelta(days=7)
        prev_week_end = current_week_start - timedelta(days=1)
        goal_week_xp = current_week_xp
        prev_week_xp = _sum_xp_in_window(prev_week_start, prev_week_end)

        current_month_start = month_start
        if current_month_start.month == 12:
            current_month_end = date(current_month_start.year + 1, 1, 1) - timedelta(days=1)
        else:
            current_month_end = date(current_month_start.year, current_month_start.month + 1, 1) - timedelta(days=1)
        prev_month_end = current_month_start - timedelta(days=1)
        prev_month_start = date(prev_month_end.year, prev_month_end.month, 1)
        goal_month_xp = current_month_xp
        prev_month_xp = _sum_xp_in_window(prev_month_start, prev_month_end)
        current_week_progress = round(min(100.0, (goal_week_xp / max(1, effective_weekly)) * 100), 1)
        current_month_progress = round(min(100.0, (goal_month_xp / max(1, effective_monthly)) * 100), 1)
        prev_week_progress = round(min(100.0, (prev_week_xp / max(1, effective_weekly)) * 100), 1)
        prev_month_progress = round(min(100.0, (prev_month_xp / max(1, effective_monthly)) * 100), 1)

        curve = settings.get("level_curve", {}) if isinstance(settings.get("level_curve"), dict) else {}

        def _total_xp_for_level(level_required: int) -> int:
            if level_required <= 1:
                return 0
            total_needed = 0
            for level_idx in range(1, level_required):
                total_needed += max(1, xp_to_next(level_idx, curve))
            return total_needed

        total_xp_now = max(0, to_int(hud.get("total_xp"), 0))
        current_level_start_xp = max(0, total_xp_now - max(0, to_int(hud.get("current_level_xp"), 0)))

        def _unlock_progress(level_required: int) -> float:
            if level_required <= current_level:
                return 100.0
            target_total = _total_xp_for_level(level_required)
            needed = max(1, target_total - current_level_start_xp)
            earned = max(0, total_xp_now - current_level_start_xp)
            return round(min(100.0, (earned / needed) * 100), 1)

        unlock_story_rows = [
            {
                "level_required": item.get("level_required", 1),
                "name": item.get("name", ""),
                "type": item.get("type", ""),
                "description": item.get("description", ""),
                "progress_pct": _unlock_progress(to_int(item.get("level_required"), 1)),
            }
            for item in upcoming[:3]
        ]
        next_unlock_story = unlock_story_rows[0] if unlock_story_rows else None

        story = {
            "summary_by_range": summary_by_range,
            "goals": {
                "weekly": {
                    "auto": auto_weekly,
                    "manual": manual_weekly if manual_weekly > 0 else None,
                    "effective": effective_weekly,
                    "current_xp": goal_week_xp,
                    "progress_pct": current_week_progress,
                    "period_start_key": current_week_start.isoformat(),
                    "period_end_key": current_week_end.isoformat(),
                    "prev_period_start_key": prev_week_start.isoformat(),
                    "prev_period_end_key": prev_week_end.isoformat(),
                    "prev_xp": prev_week_xp,
                    "prev_progress_pct": prev_week_progress,
                    "min": 800,
                    "max": 6000,
                },
                "monthly": {
                    "auto": auto_monthly,
                    "manual": manual_monthly if manual_monthly > 0 else None,
                    "effective": effective_monthly,
                    "current_xp": goal_month_xp,
                    "progress_pct": current_month_progress,
                    "period_start_key": current_month_start.isoformat(),
                    "period_end_key": current_month_end.isoformat(),
                    "prev_period_start_key": prev_month_start.isoformat(),
                    "prev_period_end_key": prev_month_end.isoformat(),
                    "prev_xp": prev_month_xp,
                    "prev_progress_pct": prev_month_progress,
                    "min": 3200,
                    "max": 24000,
                },
            },
            "charts": {
                "xp": story_xp_charts,
                "level_progress": story_level_charts,
            },
            "streaks": {
                "current_days": current_streak_days,
                "longest_days": longest_streak_days,
                "longest_weeks": longest_streak_weeks,
            },
            "heatmap": {
                "shape": "14x3",
                "cells": heat_cells,
                "history": heat_history,
            },
            "highlights": {
                "best_practice_day": {"key": best_practice_day_key, "duration_min": best_practice_minutes},
                "longest_streak_days": longest_streak_days,
                "longest_streak_weeks": longest_streak_weeks,
            },
            "unlock_preview": {
                "next": next_unlock_story,
                "upcoming": unlock_story_rows,
            },
        }

        return {
            "hud": hud,
            "badge": self.badge_for_level(current_level),
            "level_title": self.level_title(current_level),
            "upcoming_unlocks": upcoming[:5],
            "cheer": cheer,
            "stats": stats,
            "xp_sources": {key: _to_sorted_series(value, top_n=10) for key, value in source_totals.items()},
            "xp_by_activity": {key: _to_sorted_series(value, top_n=10) for key, value in activity_totals.items()},
            "xp_timeline": {
                "7d": _daily_series(daily_xp_by_range["7d"], limit=7, days=7),
                "30d": _daily_series(daily_xp_by_range["30d"], limit=30, days=30),
                "90d": _daily_series(daily_xp_by_range["90d"], limit=90, days=90),
                "all": _daily_series(daily_xp_by_range["all"], limit=120),
            },
            "story": story,
        }

    def list_gallery(self, limit: int = 500) -> list[dict[str, Any]]:
        events = self.storage.read_csv("events.csv")
        songs = {row.get("library_id", ""): row for row in self.storage.read_csv("song_library.csv")}
        drills = {row.get("drill_id", ""): row for row in self.storage.read_csv("drill_library.csv")}
        items: list[dict[str, Any]] = []
        for row in events:
            event_type = (row.get("event_type") or "").upper()
            has_media = bool(row.get("evidence_path") or row.get("evidence_url"))
            if event_type == "GALLERY_UPLOAD" or (event_type == "SESSION" and has_media):
                evidence_type = row.get("evidence_type", "")
                if evidence_type in {"file", "url", ""}:
                    path = (row.get("evidence_path") or row.get("evidence_url") or "").lower()
                    if any(path.endswith(ext) for ext in [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]):
                        evidence_type = "image"
                    elif any(path.endswith(ext) for ext in [".mp4", ".mov", ".webm", ".avi", ".mkv"]):
                        evidence_type = "video"
                    elif any(path.endswith(ext) for ext in [".mp3", ".wav", ".ogg", ".m4a", ".flac"]):
                        evidence_type = "audio"
                items.append(
                    {
                        "event_id": row.get("event_id"),
                        "event_type": row.get("event_type", ""),
                        "created_at": row.get("created_at", ""),
                        "title": row.get("title", ""),
                        "notes": row.get("notes", ""),
                        "evidence_type": evidence_type,
                        "evidence_path": row.get("evidence_path", ""),
                        "evidence_url": row.get("evidence_url", ""),
                        "song_library_id": row.get("song_library_id", ""),
                        "drill_id": row.get("drill_id", ""),
                        "song_title": songs.get(row.get("song_library_id", ""), {}).get("title", ""),
                        "drill_name": drills.get(row.get("drill_id", ""), {}).get("name", ""),
                        "tags": sorted(split_tags(row.get("tags"))),
                        "source": row.get("source", ""),
                        "meta": parse_json(row.get("meta_json")),
                    }
                )
        items.sort(key=lambda item: item.get("created_at", ""), reverse=True)
        return items[: max(limit, 1)]

    def delete_gallery_item(self, event_id: str) -> tuple[bool, str]:
        rows = self.storage.read_csv("events.csv")
        target = next((row for row in rows if row.get("event_id") == event_id), None)
        if not target:
            return False, "Gallery item not found."

        event_type = (target.get("event_type") or "").upper()
        if event_type == "GALLERY_UPLOAD":
            rel = target.get("evidence_path", "")
            if rel:
                file_path = self.storage.paths.runtime_media / Path(rel)
                try:
                    if file_path.exists() and file_path.is_file():
                        file_path.unlink()
                except OSError:
                    pass
            kept = [row for row in rows if row.get("event_id") != event_id]
        else:
            rel = target.get("evidence_path", "")
            if rel:
                file_path = self.storage.paths.runtime_media / Path(rel)
                try:
                    if file_path.exists() and file_path.is_file():
                        file_path.unlink()
                except OSError:
                    pass
            target["evidence_path"] = ""
            target["evidence_url"] = ""
            target["evidence_type"] = ""
            tags = [tag for tag in split_tags(target.get("tags")) if tag not in {"GALLERY", "IMAGE", "VIDEO", "AUDIO"}]
            target["tags"] = ";".join(sorted(tags))
            kept = rows

        self.storage.write_csv("events.csv", kept, headers=self.storage.read_csv_headers("events.csv"))
        return True, "Gallery item deleted."

    def update_gallery_item(self, event_id: str, payload: dict[str, Any]) -> tuple[bool, str, dict[str, Any] | None]:
        rows = self.storage.read_csv("events.csv")
        target = next((row for row in rows if row.get("event_id") == event_id), None)
        if not target:
            return False, "Gallery item not found.", None

        event_type = (target.get("event_type") or "").upper()
        has_media = bool(target.get("evidence_path") or target.get("evidence_url"))
        if event_type not in {"GALLERY_UPLOAD", "SESSION"} or not has_media:
            return False, "미디어 항목만 수정할 수 있습니다.", None

        if payload.get("title") is not None:
            target["title"] = str(payload.get("title") or "")
        if payload.get("notes") is not None:
            target["notes"] = str(payload.get("notes") or "")

        if payload.get("song_library_id") is not None:
            target["song_library_id"] = str(payload.get("song_library_id") or "")
        if payload.get("drill_id") is not None:
            target["drill_id"] = str(payload.get("drill_id") or "")

        if payload.get("tags") is not None:
            raw_tags = payload.get("tags")
            tokens: set[str]
            if isinstance(raw_tags, list):
                tokens = {str(item).strip().upper() for item in raw_tags if str(item).strip()}
            else:
                tokens = {token.strip().upper() for token in str(raw_tags).replace(";", ",").split(",") if token.strip()}

            existing = split_tags(target.get("tags"))
            system_tags = {
                tag
                for tag in existing
                if tag in {"GALLERY", "IMAGE", "VIDEO", "AUDIO", "MEDIA_UPLOAD", "SONG_MEDIA", "DRILL_MEDIA"}
                or tag.startswith("SONG_")
                or tag.startswith("DRILL_")
            }
            if target.get("song_library_id"):
                system_tags.add("SONG_MEDIA")
                system_tags.add(f"SONG_{str(target.get('song_library_id')).upper()}")
            if target.get("drill_id"):
                system_tags.add("DRILL_MEDIA")
                system_tags.add(f"DRILL_{str(target.get('drill_id')).upper()}")
            target["tags"] = ";".join(sorted(system_tags | tokens))

        current_meta = parse_json(target.get("meta_json"))
        if not isinstance(current_meta, dict):
            current_meta = {}
        if payload.get("source_context") is not None:
            current_meta["source_context"] = str(payload.get("source_context") or "")
        if payload.get("tags") is not None:
            if isinstance(payload.get("tags"), list):
                current_meta["manual_tags"] = [str(item).strip() for item in payload.get("tags", []) if str(item).strip()]
            else:
                current_meta["manual_tags"] = [
                    token.strip()
                    for token in str(payload.get("tags") or "").replace(";", ",").split(",")
                    if token.strip()
                ]
        target["meta_json"] = json.dumps(current_meta, ensure_ascii=False)

        self.storage.write_csv("events.csv", rows, headers=self.storage.read_csv_headers("events.csv"))

        songs = {row.get("library_id", ""): row for row in self.storage.read_csv("song_library.csv")}
        drills = {row.get("drill_id", ""): row for row in self.storage.read_csv("drill_library.csv")}
        evidence_type = target.get("evidence_type", "")
        if evidence_type in {"file", "url", ""}:
            path = (target.get("evidence_path") or target.get("evidence_url") or "").lower()
            if any(path.endswith(ext) for ext in [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]):
                evidence_type = "image"
            elif any(path.endswith(ext) for ext in [".mp4", ".mov", ".webm", ".avi", ".mkv"]):
                evidence_type = "video"
            elif any(path.endswith(ext) for ext in [".mp3", ".wav", ".ogg", ".m4a", ".flac"]):
                evidence_type = "audio"

        item = {
            "event_id": target.get("event_id"),
            "event_type": target.get("event_type", ""),
            "created_at": target.get("created_at", ""),
            "title": target.get("title", ""),
            "notes": target.get("notes", ""),
            "evidence_type": evidence_type,
            "evidence_path": target.get("evidence_path", ""),
            "evidence_url": target.get("evidence_url", ""),
            "song_library_id": target.get("song_library_id", ""),
            "drill_id": target.get("drill_id", ""),
            "song_title": songs.get(target.get("song_library_id", ""), {}).get("title", ""),
            "drill_name": drills.get(target.get("drill_id", ""), {}).get("name", ""),
            "tags": sorted(split_tags(target.get("tags"))),
            "source": target.get("source", ""),
            "meta": parse_json(target.get("meta_json")),
        }
        return True, "갤러리 항목을 수정했습니다.", item

    def level_title(self, level: int) -> str:
        titles = [
            "베이스 입국 심사대",
            "첫 줄 적응생",
            "리듬 발돋움",
            "포켓 견습생",
            "한 박자 선점자",
            "클릭 친화형",
            "루트음 배치러",
            "8비트 정주행러",
            "뮤트 장착 완료",
            "브론즈 포켓러",
            "그루브 셋업러",
            "박자 세공사",
            "코어 루틴러",
            "클린톤 집착러",
            "실버 포켓러",
            "타임 라인 조정사",
            "리듬 체력러",
            "섹션 반복 장인",
            "한 마디 집중러",
            "골드 포켓러",
            "웜업 스택러",
            "다운피킹 정복러",
            "원노트 설계자",
            "16분음표 탐험가",
            "다이내믹 조율사",
            "베이스 엔진 시동",
            "합주 안정화 요원",
            "저역 밸런서",
            "그루브 주도권자",
            "플래티넘 포켓러",
            "리듬 내성 강화형",
            "톤 캐릭터 설계자",
            "코러스 받침대",
            "브리지 생존자",
            "세션 버팀목",
            "라인 빌더",
            "리듬 파이프라인",
            "펑크 추진기",
            "뮤트 컨트롤러",
            "다이아 포켓러",
            "무대 저역 관리자",
            "합주 중심축",
            "세션 드라이버",
            "클릭 무시 불가형",
            "리듬 수문장",
            "그루브 조타수",
            "밴드 저역 엔진",
            "무대 압력 제어자",
            "다이아 최종형",
            "챌린저 저역 군주",
        ]
        index = max(1, min(level, len(titles))) - 1
        return titles[index]
