"""Tutorial state and reward service helpers."""

from __future__ import annotations

from typing import Any

from bassos.constants import EVENT_HEADERS, TUTORIAL_CAMPAIGN_ID, TUTORIAL_REWARD_XP, TUTORIAL_TITLE_ID
from bassos.services.events import create_event_row
from bassos.services.storage import Storage
from bassos.utils.time_utils import now_local, to_iso


CAMPAIGN_STEP_COUNTS: dict[str, int] = {
    "core_v1": 11,
    "deep_review": 2,
    "deep_xp": 2,
    "deep_songs": 3,
    "deep_drills": 2,
    "deep_quests": 2,
    "deep_achievements": 2,
    "deep_recommend": 2,
    "deep_tools": 2,
}


def _clean_campaign_id(raw: str | None) -> str:
    candidate = str(raw or "").strip()
    return candidate or TUTORIAL_CAMPAIGN_ID


def _clean_string_list(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        text = str(item or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)
    return out


def _safe_int(raw: Any, default: int = 0) -> int:
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _normalize_tutorial_state(raw: Any) -> dict[str, Any]:
    state = raw if isinstance(raw, dict) else {}
    return {
        "campaign_id": _clean_campaign_id(state.get("campaign_id")),
        "banner_seen_campaigns": _clean_string_list(state.get("banner_seen_campaigns")),
        "completed_campaigns": _clean_string_list(state.get("completed_campaigns")),
        "reward_claimed_campaigns": _clean_string_list(state.get("reward_claimed_campaigns")),
        "resume_campaign_id": str(state.get("resume_campaign_id") or ""),
        "resume_step_index": max(0, _safe_int(state.get("resume_step_index"), 0)),
        "last_started_at": str(state.get("last_started_at") or ""),
        "last_completed_at": str(state.get("last_completed_at") or ""),
    }


def _load_state(storage: Storage) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    settings = storage.read_json("settings.json")
    profile = settings.setdefault("profile", {})
    profile.setdefault("guide_finisher_unlocked", False)
    state = _normalize_tutorial_state(profile.get("tutorial_state"))
    profile["tutorial_state"] = state
    return settings, profile, state


def _save_state(storage: Storage, settings: dict[str, Any]) -> None:
    storage.write_json("settings.json", settings)


def _state_payload(profile: dict[str, Any], state: dict[str, Any], campaign_id: str) -> dict[str, Any]:
    completed_campaigns = _clean_string_list(state.get("completed_campaigns"))
    reward_claimed_campaigns = _clean_string_list(state.get("reward_claimed_campaigns"))
    banner_seen_campaigns = _clean_string_list(state.get("banner_seen_campaigns"))
    resume_campaign_id = str(state.get("resume_campaign_id") or "")
    resume_step_index = max(0, _safe_int(state.get("resume_step_index"), 0))
    return {
        "campaign_id": campaign_id,
        "completed": campaign_id in completed_campaigns,
        "reward_claimed": campaign_id in reward_claimed_campaigns,
        "banner_seen": campaign_id in banner_seen_campaigns,
        "resume_step_index": resume_step_index if resume_campaign_id == campaign_id else 0,
        "total_steps": CAMPAIGN_STEP_COUNTS.get(campaign_id, 0),
        "guide_finisher_unlocked": bool(profile.get("guide_finisher_unlocked")),
    }


def get_tutorial_state(storage: Storage, campaign_id: str | None = None) -> dict[str, Any]:
    target = _clean_campaign_id(campaign_id)
    settings, profile, state = _load_state(storage)
    _save_state(storage, settings)
    return _state_payload(profile, state, target)


def start_tutorial(storage: Storage, campaign_id: str | None = None) -> dict[str, Any]:
    target = _clean_campaign_id(campaign_id)
    settings, profile, state = _load_state(storage)
    now = now_local()
    if str(state.get("resume_campaign_id") or "") != target:
        state["resume_step_index"] = 0
    state["resume_campaign_id"] = target
    state["campaign_id"] = target
    state["last_started_at"] = to_iso(now)
    profile["tutorial_state"] = state
    _save_state(storage, settings)
    return {
        "campaign_id": target,
        "resume_step_index": max(0, _safe_int(state.get("resume_step_index"), 0)),
        "started_at": state["last_started_at"],
    }


def save_tutorial_progress(storage: Storage, campaign_id: str | None, step_index: int) -> dict[str, Any]:
    target = _clean_campaign_id(campaign_id)
    settings, profile, state = _load_state(storage)
    state["campaign_id"] = target
    state["resume_campaign_id"] = target
    state["resume_step_index"] = max(0, _safe_int(step_index, 0))
    profile["tutorial_state"] = state
    _save_state(storage, settings)
    return {
        "campaign_id": target,
        "resume_step_index": state["resume_step_index"],
    }


def mark_tutorial_banner_seen(storage: Storage, campaign_id: str | None = None) -> dict[str, Any]:
    target = _clean_campaign_id(campaign_id)
    settings, profile, state = _load_state(storage)
    seen = _clean_string_list(state.get("banner_seen_campaigns"))
    if target not in seen:
        seen.append(target)
    state["banner_seen_campaigns"] = seen
    profile["tutorial_state"] = state
    _save_state(storage, settings)
    return {"campaign_id": target, "banner_seen": True}


def complete_tutorial(storage: Storage, campaign_id: str | None = None) -> dict[str, Any]:
    target = _clean_campaign_id(campaign_id)
    settings, profile, state = _load_state(storage)
    now = now_local()

    completed = _clean_string_list(state.get("completed_campaigns"))
    if target not in completed:
        completed.append(target)
    state["completed_campaigns"] = completed
    state["campaign_id"] = target
    state["resume_campaign_id"] = ""
    state["resume_step_index"] = 0
    state["last_completed_at"] = to_iso(now)

    reward_claimed_campaigns = _clean_string_list(state.get("reward_claimed_campaigns"))
    reward_granted = False
    xp_granted = 0
    if target == TUTORIAL_CAMPAIGN_ID and target not in reward_claimed_campaigns:
        reward_claimed_campaigns.append(target)
        state["reward_claimed_campaigns"] = reward_claimed_campaigns
        profile["guide_finisher_unlocked"] = True
        reward_event = create_event_row(
            created_at=now,
            event_type="TUTORIAL_REWARD",
            activity="Tutorial",
            xp=TUTORIAL_REWARD_XP,
            title=f"Tutorial Clear: {target}",
            notes="One-time tutorial completion reward",
            tags=["TUTORIAL", "GUIDE", "REWARD"],
            source="app",
        )
        headers = storage.read_csv_headers("events.csv") or EVENT_HEADERS
        storage.append_csv_row("events.csv", reward_event, headers=headers)
        reward_granted = True
        xp_granted = TUTORIAL_REWARD_XP
    else:
        state["reward_claimed_campaigns"] = reward_claimed_campaigns

    profile["tutorial_state"] = state
    _save_state(storage, settings)

    unlocked = bool(profile.get("guide_finisher_unlocked"))
    return {
        "campaign_id": target,
        "completed": True,
        "reward_granted": reward_granted,
        "xp_granted": xp_granted,
        "title_unlocked": TUTORIAL_TITLE_ID if unlocked else "",
        "guide_finisher_unlocked": unlocked,
    }
