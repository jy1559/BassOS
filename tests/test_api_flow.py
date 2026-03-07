from __future__ import annotations

import io
import csv
import json
import shutil
from time import sleep
from datetime import timedelta
from pathlib import Path

from bassos.app_factory import create_app
from bassos.constants import EVENT_HEADERS, RECORD_COMMENT_HEADERS, RECORD_POST_HEADERS
from bassos.services.events import create_event_row
from bassos.utils.time_utils import now_local


def _prepare_temp_root(tmp_path: Path) -> Path:
    src_designpack = Path(__file__).resolve().parents[1] / "designPack"
    dst_designpack = tmp_path / "designPack"
    shutil.copytree(src_designpack, dst_designpack)
    return tmp_path


def _session_events(storage) -> list[dict[str, str]]:
    return [row for row in storage.read_csv("events.csv") if str(row.get("event_type") or "").upper() == "SESSION"]


def _meta(row: dict[str, str]) -> dict[str, object]:
    raw = str(row.get("meta_json") or "")
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _journal_catalogs(storage) -> tuple[list[dict[str, object]], list[dict[str, object]], list[dict[str, object]]]:
    settings = storage.read_json("settings.json")
    profile = settings.get("profile") if isinstance(settings.get("profile"), dict) else {}
    headers = profile.get("journal_header_catalog") if isinstance(profile, dict) else []
    statuses = profile.get("journal_status_catalog") if isinstance(profile, dict) else []
    templates = profile.get("journal_template_catalog") if isinstance(profile, dict) else []
    return (
        headers if isinstance(headers, list) else [],
        statuses if isinstance(statuses, list) else [],
        templates if isinstance(templates, list) else [],
    )


def test_session_stop_updates_hud(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    start_res = client.post("/api/session/start", json={})
    assert start_res.status_code == 200

    stop_res = client.post(
        "/api/session/stop",
        json={
            "activity": "Core",
            "tags": ["CORE", "METRO_24"],
            "start_at": "2026-02-27T10:00:00",
            "end_at": "2026-02-27T10:30:00",
        },
    )
    assert stop_res.status_code == 200

    hud_res = client.get("/api/hud/summary")
    assert hud_res.status_code == 200
    payload = hud_res.get_json()["summary"]
    assert payload["total_xp"] > 0
    assert payload["level"] >= 1


def test_core_api_smoke(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    assert client.get("/api/health").status_code == 200
    assert client.get("/api/quests/current").status_code == 200
    assert client.get("/api/achievements").status_code == 200
    assert client.get("/api/stats/overview").status_code == 200

    assert client.post("/api/session/start", json={"activity": "Song", "sub_activity": "SongPractice"}).status_code == 200
    assert (
        client.post(
            "/api/session/stop",
            json={
                "activity": "Song",
                "sub_activity": "SongPractice",
                "start_at": "2026-03-01T10:00:00",
                "end_at": "2026-03-01T10:15:00",
                "tags": [],
            },
        ).status_code
        == 200
    )


def test_api_unhandled_error_returns_json(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)

    @app.get("/api/_boom")
    def _boom():  # pragma: no cover - exercised by client request
        raise RuntimeError("boom-test")

    client = app.test_client()
    res = client.get("/api/_boom")
    assert res.status_code == 500
    assert res.content_type.startswith("application/json")
    payload = res.get_json()
    assert payload["ok"] is False
    assert "boom-test" in payload["message"]


def test_settings_basic_keyboard_shortcuts_are_normalized(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    res = client.put(
        "/api/settings/basic",
        json={
            "ui": {
                "keyboard_shortcuts": {
                    "bindings": {
                        "video_toggle": {"code": "ShiftLeft"},
                        "tab_dashboard": {"code": "KeyK", "ctrl": True},
                    }
                }
            }
        },
    )
    assert res.status_code == 200
    payload = res.get_json()["settings"]
    bindings = payload["ui"]["keyboard_shortcuts"]["bindings"]
    assert bindings["video_toggle"]["code"] == "Space"
    assert bindings["tab_dashboard"]["code"] == "KeyK"
    assert bindings["tab_dashboard"]["ctrl"] is True
    assert bindings["metronome_toggle"]["code"] == "KeyM"


def test_session_switch_under_10_min_skips_save(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()
    storage = app.config["storage"]

    before_count = len(_session_events(storage))
    now = now_local()
    start_at = (now - timedelta(minutes=5)).isoformat()

    start_res = client.post(
        "/api/session/start",
        json={
            "activity": "Song",
            "sub_activity": "SongPractice",
            "song_library_id": "L0001",
            "title": "song-a",
            "start_at": start_at,
        },
    )
    assert start_res.status_code == 200

    switch_res = client.post(
        "/api/session/switch",
        json={
            "activity": "Drill",
            "sub_activity": "Core",
            "drill_id": "DL0001",
            "title": "drill-a",
        },
    )
    assert switch_res.status_code == 200
    payload = switch_res.get_json()
    assert payload["under_min_skipped"] is True
    assert payload["auto_saved"]["event_saved"] is False

    after_count = len(_session_events(storage))
    assert after_count == before_count

    active = client.get("/api/hud/summary").get_json()["summary"]["active_session"]
    assert active.get("drill_id") == "DL0001"
    assert active.get("song_library_id") == ""


def test_session_switch_over_10_min_autosaves_and_chains(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()
    storage = app.config["storage"]

    before_count = len(_session_events(storage))
    before_hud = client.get("/api/hud/summary").get_json()["summary"]
    now = now_local()
    start_at = (now - timedelta(minutes=14)).isoformat()

    start_res = client.post(
        "/api/session/start",
        json={
            "activity": "Song",
            "sub_activity": "SongPractice",
            "song_library_id": "L0001",
            "title": "song-a",
            "start_at": start_at,
        },
    )
    assert start_res.status_code == 200

    switch_res = client.post(
        "/api/session/switch",
        json={
            "activity": "Song",
            "sub_activity": "SongPractice",
            "song_library_id": "L0002",
            "title": "song-b",
            "start_at": (now - timedelta(minutes=12)).isoformat(),
        },
    )
    assert switch_res.status_code == 200
    payload = switch_res.get_json()
    assert payload["under_min_skipped"] is False
    assert payload["auto_saved"]["event_saved"] is True
    auto_saved_event_id = str((payload["auto_saved"].get("event") or {}).get("event_id") or "")
    assert auto_saved_event_id

    after_count = len(_session_events(storage))
    assert after_count == before_count + 1
    switched_event = next(row for row in _session_events(storage) if str(row.get("event_id") or "") == auto_saved_event_id)
    assert bool(_meta(switched_event).get("pending_chain")) is True

    hud_after_switch = client.get("/api/hud/summary").get_json()["summary"]
    assert hud_after_switch["total_xp"] == before_hud["total_xp"]
    assert hud_after_switch["level"] == before_hud["level"]
    active = hud_after_switch["active_session"]
    assert active.get("song_library_id") == "L0002"
    assert len(active.get("chain_saved_segments") or []) == 1


def test_session_finalize_applies_pending_chain_rewards(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()
    storage = app.config["storage"]
    now = now_local()

    before_hud = client.get("/api/hud/summary").get_json()["summary"]
    start_res = client.post(
        "/api/session/start",
        json={
            "activity": "Song",
            "sub_activity": "SongPractice",
            "song_library_id": "L0001",
            "title": "song-a",
            "start_at": (now - timedelta(minutes=16)).isoformat(),
        },
    )
    assert start_res.status_code == 200

    switch_res = client.post(
        "/api/session/switch",
        json={
            "activity": "Song",
            "sub_activity": "SongPractice",
            "song_library_id": "L0002",
            "title": "song-b",
        },
    )
    assert switch_res.status_code == 200
    active = client.get("/api/hud/summary").get_json()["summary"]["active_session"]
    saved_segments = active.get("chain_saved_segments") or []
    assert len(saved_segments) == 1
    pending_event_id = str(saved_segments[0]["event_id"])
    pending_row = next(row for row in _session_events(storage) if str(row.get("event_id") or "") == pending_event_id)
    assert bool(_meta(pending_row).get("pending_chain")) is True

    hud_after_switch = client.get("/api/hud/summary").get_json()["summary"]
    assert hud_after_switch["total_xp"] == before_hud["total_xp"]

    finalize_res = client.post(
        "/api/session/finalize",
        json={
            "include_saved_event_ids": [pending_event_id],
            "include_current": False,
        },
    )
    assert finalize_res.status_code == 200
    pending_row_after = next(row for row in _session_events(storage) if str(row.get("event_id") or "") == pending_event_id)
    assert bool(_meta(pending_row_after).get("pending_chain")) is False

    hud_after_finalize = client.get("/api/hud/summary").get_json()["summary"]
    assert hud_after_finalize["total_xp"] > before_hud["total_xp"]


def test_pending_chain_does_not_unlock_quest_until_finalize(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()
    now = now_local()

    quest_res = client.post(
        "/api/quests",
        json={
            "title": "pending chain gate",
            "description": "count one finalized session",
            "period_class": "short",
            "difficulty": "low",
            "rule_type": "count_events",
            "target": 1,
            "rule_filter": {"event_type": "SESSION"},
        },
    )
    assert quest_res.status_code == 200
    quest_id = str(quest_res.get_json()["quest"]["quest_id"] or "")
    assert quest_id

    start_res = client.post(
        "/api/session/start",
        json={
            "activity": "Song",
            "sub_activity": "SongPractice",
            "song_library_id": "L0001",
            "title": "song-a",
            "start_at": (now - timedelta(minutes=14)).isoformat(),
        },
    )
    assert start_res.status_code == 200

    switch_res = client.post(
        "/api/session/switch",
        json={
            "activity": "Song",
            "sub_activity": "SongPractice",
            "song_library_id": "L0002",
            "title": "song-b",
        },
    )
    assert switch_res.status_code == 200

    quests_before = client.get("/api/quests/current").get_json()["quests"]
    target_before = next(item for item in quests_before if str(item.get("quest_id") or "") == quest_id)
    assert target_before["claimable"] is False

    active = client.get("/api/hud/summary").get_json()["summary"]["active_session"]
    pending_event_id = str((active.get("chain_saved_segments") or [])[0]["event_id"])
    finalize_res = client.post(
        "/api/session/finalize",
        json={
            "include_saved_event_ids": [pending_event_id],
            "include_current": False,
        },
    )
    assert finalize_res.status_code == 200

    quests_after = client.get("/api/quests/current").get_json()["quests"]
    target_after = next(item for item in quests_after if str(item.get("quest_id") or "") == quest_id)
    assert target_after["claimable"] is True


def test_session_retarget_updates_none_session_without_restart(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()
    storage = app.config["storage"]

    start_res = client.post(
        "/api/session/start",
        json={
            "activity": "Etc",
            "sub_activity": "Etc",
            "title": "quick-start",
        },
    )
    assert start_res.status_code == 200
    started = start_res.get_json()["session"]
    started_id = started["session_id"]
    started_at = started["start_at"]

    before_count = len(_session_events(storage))
    retarget_res = client.post(
        "/api/session/retarget",
        json={
            "activity": "Song",
            "sub_activity": "SongPractice",
            "song_library_id": "L0001",
            "title": "song-a",
        },
    )
    assert retarget_res.status_code == 200
    payload = retarget_res.get_json()
    assert payload["retargeted"] is True

    active = client.get("/api/hud/summary").get_json()["summary"]["active_session"]
    assert active.get("session_id") == started_id
    assert active.get("start_at") == started_at
    assert active.get("activity") == "Song"
    assert active.get("song_library_id") == "L0001"
    assert active.get("drill_id") == ""

    after_count = len(_session_events(storage))
    assert after_count == before_count


def test_session_retarget_fails_without_active_session(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    res = client.post(
        "/api/session/retarget",
        json={
            "activity": "Song",
            "sub_activity": "SongPractice",
            "song_library_id": "L0001",
        },
    )
    assert res.status_code == 400
    payload = res.get_json()
    assert payload["ok"] is False
    assert "No active session" in payload["message"]


def test_session_retarget_fails_when_target_already_exists(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    start_res = client.post(
        "/api/session/start",
        json={
            "activity": "Song",
            "sub_activity": "SongPractice",
            "song_library_id": "L0001",
            "title": "song-a",
        },
    )
    assert start_res.status_code == 200

    retarget_res = client.post(
        "/api/session/retarget",
        json={
            "activity": "Song",
            "sub_activity": "SongPractice",
            "song_library_id": "L0002",
            "title": "song-b",
        },
    )
    assert retarget_res.status_code == 400
    payload = retarget_res.get_json()
    assert payload["ok"] is False
    assert payload["message"] == "use switch"


def test_session_finalize_include_exclude_saved_events(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()
    storage = app.config["storage"]
    now = now_local()

    start_res = client.post(
        "/api/session/start",
        json={
            "activity": "Song",
            "sub_activity": "SongPractice",
            "song_library_id": "L0001",
            "title": "song-a",
            "start_at": (now - timedelta(minutes=40)).isoformat(),
        },
    )
    assert start_res.status_code == 200

    first_switch = client.post(
        "/api/session/switch",
        json={
            "activity": "Song",
            "sub_activity": "SongPractice",
            "song_library_id": "L0002",
            "title": "song-b",
            "start_at": (now - timedelta(minutes=24)).isoformat(),
        },
    )
    assert first_switch.status_code == 200
    assert first_switch.get_json()["auto_saved"]["event_saved"] is True

    second_switch = client.post(
        "/api/session/switch",
        json={
            "activity": "Song",
            "sub_activity": "SongPractice",
            "song_library_id": "L0003",
            "title": "song-c",
            "start_at": (now - timedelta(minutes=5)).isoformat(),
        },
    )
    assert second_switch.status_code == 200
    assert second_switch.get_json()["auto_saved"]["event_saved"] is True

    active = client.get("/api/hud/summary").get_json()["summary"]["active_session"]
    saved_segments = active.get("chain_saved_segments") or []
    assert len(saved_segments) == 2
    keep_id = saved_segments[0]["event_id"]
    remove_id = saved_segments[1]["event_id"]

    finalize_res = client.post(
        "/api/session/finalize",
        json={
            "include_saved_event_ids": [keep_id],
            "include_current": False,
        },
    )
    assert finalize_res.status_code == 200
    payload = finalize_res.get_json()
    assert payload["current_saved"] is False
    assert len(payload["kept_sessions"]) == 1
    assert len(payload["removed_sessions"]) == 1
    assert payload["removed_sessions"][0]["event_id"] == remove_id

    ids_after = {row.get("event_id") for row in _session_events(storage)}
    assert keep_id in ids_after
    assert remove_id not in ids_after

    active_after = client.get("/api/hud/summary").get_json()["summary"]["active_session"]
    assert not active_after.get("session_id")


def test_session_finalize_current_on_under_10_skips_current_save(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()
    storage = app.config["storage"]
    now = now_local()

    start_res = client.post(
        "/api/session/start",
        json={
            "activity": "Song",
            "sub_activity": "SongPractice",
            "song_library_id": "L0001",
            "title": "song-a",
            "start_at": (now - timedelta(minutes=22)).isoformat(),
        },
    )
    assert start_res.status_code == 200

    switch_res = client.post(
        "/api/session/switch",
        json={
            "activity": "Song",
            "sub_activity": "SongPractice",
            "song_library_id": "L0002",
            "title": "song-b",
            "start_at": (now - timedelta(minutes=5)).isoformat(),
        },
    )
    assert switch_res.status_code == 200
    assert switch_res.get_json()["auto_saved"]["event_saved"] is True

    before_ids = {row.get("event_id") for row in _session_events(storage)}

    finalize_res = client.post(
        "/api/session/finalize",
        json={
            "include_saved_event_ids": list(before_ids),
            "include_current": True,
            "current_stop_payload": {
                "activity": "Song",
                "sub_activity": "SongPractice",
                "song_library_id": "L0002",
                "start_at": (now - timedelta(minutes=5)).isoformat(),
                "end_at": now.isoformat(),
                "tags": ["SONG", "SONG_PRACTICE"],
            },
        },
    )
    assert finalize_res.status_code == 200
    payload = finalize_res.get_json()
    assert payload["current_saved"] is False
    assert payload["current_skipped_under_min"] is True

    after_ids = {row.get("event_id") for row in _session_events(storage)}
    assert after_ids == before_ids


def test_quest_claim_path(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    create_res = client.post(
        "/api/quests",
        json={
            "title": "manual claim quest",
            "description": "manual",
            "period_class": "short",
            "difficulty": "high",
            "rule_type": "manual",
            "target": 1,
            "xp_reward": 10,
        },
    )
    assert create_res.status_code == 200
    quest_id = create_res.get_json()["quest"]["quest_id"]

    claim_res = client.post(f"/api/quests/{quest_id}/claim", json={})
    assert claim_res.status_code == 200


def test_custom_quest_and_session_delete(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    create_quest = client.post(
        "/api/quests",
        json={"title": "Custom TODO", "xp_reward": 5, "period_class": "short", "difficulty": "low"},
    )
    assert create_quest.status_code == 200

    stop_res = client.post(
        "/api/session/quick-log",
        json={
            "activity": "Core",
            "tags": ["CORE"],
            "start_at": "2026-02-20T10:00:00",
            "end_at": "2026-02-20T10:20:00",
            "duration_min": 20,
        },
    )
    assert stop_res.status_code == 200
    stop_payload = stop_res.get_json()
    assert "level_up" in stop_payload
    assert "before_level" in stop_payload
    assert "after_level" in stop_payload
    assert isinstance(stop_payload.get("auto_granted_names"), list)
    gamification = stop_payload.get("gamification")
    assert isinstance(gamification, dict)
    assert "session_bucket" in gamification
    assert "streak_days" in gamification
    assert "streak_weeks" in gamification
    assert "is_first_session_of_week" in gamification
    assert "is_long_session" in gamification
    assert "long_session_probability" in gamification
    assert "long_session_roll" in gamification
    assert gamification.get("long_session_threshold_min") == 60
    event_id = stop_payload["event"]["event_id"]

    sessions_before = client.get("/api/sessions").get_json()["sessions"]
    assert any(s["event_id"] == event_id for s in sessions_before)

    delete_res = client.delete(f"/api/sessions/{event_id}")
    assert delete_res.status_code == 200

    sessions_after = client.get("/api/sessions").get_json()["sessions"]
    assert all(s["event_id"] != event_id for s in sessions_after)


def test_quick_log_none_mapping_saves_as_etc(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    res = client.post(
        "/api/session/quick-log",
        json={
            "activity": "Etc",
            "sub_activity": "Etc",
            "tags": ["QUICK", "ETC"],
            "duration_min": 10,
            "notes": "Quick log none mapping",
        },
    )
    assert res.status_code == 200
    payload = res.get_json()
    assert payload["event"]["activity"] == "Etc"
    assert payload["event"]["song_library_id"] == ""
    assert payload["event"]["drill_id"] == ""

    sessions = client.get("/api/sessions?limit=10").get_json()["sessions"]
    assert sessions
    assert sessions[0]["activity"] == "Etc"
    assert sessions[0]["sub_activity"] == "Etc"


def test_gamification_level_up_copy_endpoint(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    res = client.get("/api/gamification/level-up-copy?level=10&before_level=9&lang=ko")
    assert res.status_code == 200
    payload = res.get_json()
    assert payload.get("ok") is True
    copy = payload.get("copy")
    assert isinstance(copy, dict)
    assert "line" in copy
    assert copy.get("before_tier") == "bronze"
    assert copy.get("after_tier") == "silver"
    assert isinstance(copy.get("tier_up"), bool)


def test_achievements_endpoint_auto_claims_non_manual_even_if_auto_grant_false(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()
    storage = app.config["storage"]

    rows = storage.read_csv("achievements_master.csv")
    headers = storage.read_csv_headers("achievements_master.csv")
    base = dict(rows[0]) if rows else {}
    custom = {
        **base,
        "achievement_id": "TEST_AUTO_NON_MANUAL",
        "group_id": "TEST_AUTO_NON_MANUAL",
        "name": "Auto Non Manual",
        "description": "auto claim check",
        "hint": "",
        "category": "test",
        "tier": "1",
        "tier_name": "Bronze",
        "target": "1",
        "display_order": "99901",
        "rule_type": "count_events",
        "rule_filter": '{"event_type":"SESSION"}',
        "xp_reward": "10",
        "is_hidden": "false",
        "auto_grant": "false",
        "ui_badge_style": "custom",
        "evidence_hint": "",
        "icon_path": "",
        "icon_url": "",
    }
    rows.append(custom)
    storage.write_csv("achievements_master.csv", rows, headers=headers)

    quick = client.post(
        "/api/session/quick-log",
        json={
            "activity": "Core",
            "tags": ["CORE"],
            "start_at": "2026-03-01T10:00:00",
            "end_at": "2026-03-01T10:20:00",
            "duration_min": 20,
        },
    )
    assert quick.status_code == 200

    ach_res = client.get("/api/achievements")
    assert ach_res.status_code == 200
    items = ach_res.get_json()["achievements"]
    target = next((item for item in items if item.get("achievement_id") == "TEST_AUTO_NON_MANUAL"), None)
    assert target is not None
    assert target["claimed"] is True


def test_stats_overview_includes_quest_breakdown(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    create_res = client.post(
        "/api/quests",
        json={
            "title": "stats quest",
            "period_class": "short",
            "difficulty": "high",
            "genre_tags": ["Rock"],
            "rule_type": "manual",
            "target": 1,
            "xp_reward": 10,
        },
    )
    assert create_res.status_code == 200
    quest_id = create_res.get_json()["quest"]["quest_id"]
    claim_res = client.post(f"/api/quests/{quest_id}/claim", json={})
    assert claim_res.status_code == 200

    stats_res = client.get("/api/stats/overview")
    assert stats_res.status_code == 200
    stats = stats_res.get_json()["stats"]
    assert "quest_breakdown" in stats
    assert "by_period" in stats["quest_breakdown"]
    assert "by_difficulty" in stats["quest_breakdown"]
    assert "by_priority" in stats["quest_breakdown"]
    assert "by_genre" in stats["quest_breakdown"]
    assert stats["quest_breakdown"]["claimed_total"] >= 1

    narrow_res = client.get("/api/stats/overview?quest_range=7d")
    assert narrow_res.status_code == 200
    narrow = narrow_res.get_json()["stats"]["quest_breakdown"]
    assert narrow["claimed_total"] <= stats["quest_breakdown"]["claimed_total"]


def test_player_xp_story_payload_has_ranges_and_charts(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    today = now_local().date()
    for days_ago in [0, 1, 9, 28, 74]:
        start = today - timedelta(days=days_ago)
        start_at = f"{start.isoformat()}T10:00:00"
        end_at = f"{start.isoformat()}T10:30:00"
        res = client.post(
            "/api/session/quick-log",
            json={
                "activity": "Core",
                "tags": ["CORE"],
                "start_at": start_at,
                "end_at": end_at,
                "duration_min": 30,
            },
        )
        assert res.status_code == 200

    payload = client.get("/api/player/xp").get_json()["player"]
    assert "story" in payload
    assert "90d" in payload["xp_timeline"]
    assert "90d" in payload["xp_sources"]
    assert "90d" in payload["xp_by_activity"]

    story = payload["story"]
    for key in ["7d", "30d", "90d", "all"]:
        assert key in story["summary_by_range"]
        assert key in story["charts"]["xp"]
        assert key in story["charts"]["level_progress"]
        assert "day" in story["charts"]["xp"][key]
        assert "week" in story["charts"]["xp"][key]
        assert "month" in story["charts"]["xp"][key]
    assert story["goals"]["weekly"]["min"] == 800
    assert story["goals"]["weekly"]["max"] == 6000
    assert story["goals"]["monthly"]["min"] == 3200
    assert story["goals"]["monthly"]["max"] == 24000
    assert story["heatmap"]["shape"] == "14x3"
    assert len(story["heatmap"]["cells"]) == 42
    assert "longest_weeks" in story["streaks"]
    assert "best_practice_day" in story["highlights"]
    assert "upcoming" in story["unlock_preview"]
    assert story["streaks"]["longest_days"] >= 2
    assert story["streaks"]["longest_weeks"] >= 2
    latest_level_point = story["charts"]["level_progress"]["7d"][-1]
    assert latest_level_point["value"] >= latest_level_point["level"]


def test_player_xp_story_manual_goals_override_effective_goal(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    update_res = client.put("/api/settings/basic", json={"profile": {"xp_goal_weekly": 1234, "xp_goal_monthly": 6789}})
    assert update_res.status_code == 200

    player = client.get("/api/player/xp").get_json()["player"]
    goals = player["story"]["goals"]
    assert goals["weekly"]["manual"] == 1234
    assert goals["weekly"]["effective"] == 1234
    assert goals["monthly"]["manual"] == 6789
    assert goals["monthly"]["effective"] == 6789


def test_post_quest_uses_server_xp_and_priority(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    create_res = client.post(
        "/api/quests",
        json={
            "title": "Priority quest",
            "period_class": "long",
            "difficulty": "high",
            "priority": "urgent",
            "rule_type": "manual",
            "target": 1,
            "xp_reward": 99999,
        },
    )
    assert create_res.status_code == 200
    quest = create_res.get_json()["quest"]
    assert quest["priority"] == "urgent"
    # manual uses 1/6 of long+high matrix(480) => 80
    assert int(quest["xp_reward"]) == 80


def test_auto_quest_refresh_rollover_and_single_active_policy(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    # force refresh short period twice, second call should expire previous auto quest
    first = client.post("/api/quests/auto/refresh", json={"period_class": "short", "force": True})
    assert first.status_code == 200
    first_data = first.get_json()
    assert len(first_data.get("created_ids", [])) == 1

    second = client.post("/api/quests/auto/refresh", json={"period_class": "short", "force": True})
    assert second.status_code == 200
    second_data = second.get_json()
    assert len(second_data.get("created_ids", [])) == 1
    assert len(second_data.get("expired_ids", [])) >= 1

    quests = client.get("/api/quests/current").get_json()["quests"]
    active_short_auto = [
        q
        for q in quests
        if q.get("period_class") == "short" and q.get("status") == "Active" and bool(q.get("auto_generated"))
    ]
    assert len(active_short_auto) == 1


def test_post_quest_rejects_unsupported_rule_type(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    res = client.post(
        "/api/quests",
        json={
            "title": "bad rule",
            "period_class": "short",
            "difficulty": "low",
            "priority": "normal",
            "rule_type": "sum_xp",
            "target": 1,
        },
    )
    assert res.status_code == 400


def test_put_quest_updates_active_quest(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    create_res = client.post(
        "/api/quests",
        json={
            "title": "editable quest",
            "period_class": "short",
            "difficulty": "mid",
            "priority": "normal",
            "rule_type": "manual",
            "target": 1,
        },
    )
    assert create_res.status_code == 200
    quest = create_res.get_json()["quest"]
    quest_id = quest["quest_id"]
    start_date = quest["start_date"]

    update_res = client.put(
        f"/api/quests/{quest_id}",
        json={
            "title": "edited quest",
            "priority": "urgent",
            "difficulty": "high",
            "target": 3,
            "due_date": start_date,
        },
    )
    assert update_res.status_code == 200
    updated = update_res.get_json()["quest"]
    assert updated["title"] == "edited quest"
    assert updated["priority"] == "urgent"
    assert updated["difficulty"] == "high"
    assert int(updated["target"]) == 3
    assert updated["due_date"] == start_date


def test_put_quest_rejects_non_active_and_invalid_due_date(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    create_res = client.post(
        "/api/quests",
        json={
            "title": "stateful quest",
            "period_class": "short",
            "difficulty": "mid",
            "priority": "normal",
            "rule_type": "manual",
            "target": 1,
        },
    )
    assert create_res.status_code == 200
    quest = create_res.get_json()["quest"]
    quest_id = quest["quest_id"]
    start_date = quest["start_date"]

    invalid_res = client.put(f"/api/quests/{quest_id}", json={"due_date": "1999-01-01"})
    assert invalid_res.status_code == 400

    claim_res = client.post(f"/api/quests/{quest_id}/claim", json={})
    assert claim_res.status_code == 200

    non_active_res = client.put(f"/api/quests/{quest_id}", json={"due_date": start_date})
    assert non_active_res.status_code == 400


def test_session_update_and_xp_reconciliation(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    stop_res = client.post(
        "/api/session/quick-log",
        json={
            "activity": "Core",
            "tags": ["CORE"],
            "start_at": "2026-02-20T10:00:00",
            "end_at": "2026-02-20T10:30:00",
            "duration_min": 30,
        },
    )
    assert stop_res.status_code == 200
    event_id = stop_res.get_json()["event"]["event_id"]

    before = client.get("/api/hud/summary").get_json()["summary"]
    assert before["total_xp"] > 0

    update_res = client.put(
        f"/api/sessions/{event_id}",
        json={
            "start_at": "2026-02-20T10:00:00",
            "end_at": "2026-02-20T10:10:00",
            "activity": "Theory",
            "tags": ["THEORY"],
            "notes": "edited",
        },
    )
    assert update_res.status_code == 200
    updated_session = update_res.get_json()["session"]
    assert updated_session["duration_min"] == 10
    assert updated_session["activity"] == "Drill"
    assert updated_session["sub_activity"] == "Theory"

    after_update = client.get("/api/hud/summary").get_json()["summary"]
    assert after_update["total_xp"] < before["total_xp"]

    delete_res = client.delete(f"/api/sessions/{event_id}")
    assert delete_res.status_code == 200
    after_delete = client.get("/api/hud/summary").get_json()["summary"]
    assert after_delete["total_xp"] < after_update["total_xp"]


def test_daily_session_xp_cap(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    cap_res = client.put("/api/settings/critical", json={"critical": {"daily_session_xp_cap": 100}})
    assert cap_res.status_code == 200

    for idx in range(2):
        res = client.post(
            "/api/session/quick-log",
            json={
                "activity": "Song",
                "tags": ["METRO_24", "RECORDING_AUDIO"],
                "start_at": f"2026-02-20T1{idx}:00:00",
                "end_at": f"2026-02-20T1{idx}:30:00",
                "duration_min": 30,
            },
        )
        assert res.status_code == 200

    sessions = client.get("/api/sessions").get_json()["sessions"]
    same_day_xp = sum(s["xp"] for s in sessions if str(s["start_at"]).startswith("2026-02-20"))
    assert same_day_xp == 100


def test_records_crud_and_attachment_limit(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    text_only = client.post(
        "/api/records",
        json={
            "title": "주간 회고",
            "body": "꾸준히 진행 중",
            "post_type": "회고",
            "tags": ["회고", "주간결산"],
            "linked_song_ids": [],
            "linked_drill_ids": [],
            "free_targets": ["다음 주 4회"],
        },
    )
    assert text_only.status_code == 200
    post = text_only.get_json()["item"]
    assert post["title"] == "주간 회고"
    assert post["attachments"] == []

    media_post = client.post(
        "/api/records",
        data={
            "title": "연습 영상",
            "body": "템포 점검",
            "post_type": "연습영상",
            "tags": '["연습영상","회고"]',
            "external_attachments": json.dumps(
                [
                    {
                        "media_type": "video",
                        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                        "title": "유튜브 회고",
                    }
                ],
                ensure_ascii=False,
            ),
            "files": [
                (io.BytesIO(b"fake-image-bytes"), "snap.png"),
                (io.BytesIO(b"fake-audio-bytes"), "take.mp3"),
            ],
        },
        content_type="multipart/form-data",
    )
    assert media_post.status_code == 200
    media_item = media_post.get_json()["item"]
    assert len(media_item["attachments"]) == 3
    assert any(
        item["media_type"] == "video" and item["url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        for item in media_item["attachments"]
    )

    detail_res = client.get(f"/api/records/{media_item['post_id']}")
    assert detail_res.status_code == 200
    assert any(
        item["media_type"] == "video" and item["url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        for item in detail_res.get_json()["item"]["attachments"]
    )

    list_res = client.get("/api/records/list?q=연습")
    assert list_res.status_code == 200
    assert any(item["post_id"] == media_item["post_id"] for item in list_res.get_json()["items"])

    update_res = client.put(
        f"/api/records/{media_item['post_id']}",
        json={
            "title": "연습 영상 수정",
            "tags": ["연습영상", "수정됨"],
            "external_attachments": [
                {
                    "media_type": "video",
                    "url": "https://youtu.be/5qap5aO4i9A",
                    "title": "두 번째 링크",
                }
            ],
        },
    )
    assert update_res.status_code == 200
    assert update_res.get_json()["item"]["title"] == "연습 영상 수정"
    assert len(update_res.get_json()["item"]["attachments"]) == 4
    assert any(item["url"] == "https://youtu.be/5qap5aO4i9A" for item in update_res.get_json()["item"]["attachments"])

    update_limit_res = client.put(
        f"/api/records/{media_item['post_id']}",
        json={
            "external_attachments": [
                {"media_type": "video", "url": f"https://www.youtube.com/watch?v=limit{idx}"}
                for idx in range(5)
            ]
        },
    )
    assert update_limit_res.status_code == 400

    attachment_id = update_res.get_json()["item"]["attachments"][0]["attachment_id"]
    att_update = client.put(
        f"/api/records/{media_item['post_id']}/attachments/{attachment_id}",
        json={"title": "대표컷", "sort_order": 3},
    )
    assert att_update.status_code == 200
    assert att_update.get_json()["attachment"]["title"] == "대표컷"

    att_delete = client.delete(f"/api/records/{media_item['post_id']}/attachments/{attachment_id}")
    assert att_delete.status_code == 200

    delete_res = client.delete(f"/api/records/{media_item['post_id']}")
    assert delete_res.status_code == 200

    too_many = [
        (io.BytesIO(b"x"), f"f{idx}.png")
        for idx in range(9)
    ]
    limit_res = client.post(
        "/api/records",
        data={"title": "limit", "files": too_many},
        content_type="multipart/form-data",
    )
    assert limit_res.status_code == 400


def test_records_detail_filters_comments_and_meta(tmp_path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()
    storage = app.config["storage"]
    headers, statuses, templates = _journal_catalogs(storage)

    daily_header = next(item for item in headers if item.get("label") == "일일연습")
    monthly_header = next(item for item in headers if item.get("label") == "월간회고")
    draft_status = next(item for item in statuses if item.get("label") == "초안")
    archived_status = next(item for item in statuses if item.get("label") == "보관")
    daily_template = next(item for item in templates if item.get("name") == "일일 연습 일지")
    monthly_template = next(item for item in templates if item.get("name") == "한 달 연습 회고")

    first_res = client.post(
        "/api/records",
        json={
            "title": "3월 1주차 연습",
            "body": "## 포커스\n슬랩 타이밍 점검",
            "post_type": "일일연습",
            "header_id": daily_header["id"],
            "status_id": draft_status["id"],
            "template_id": daily_template["id"],
            "meta": {
                "practice_date": "2026-03-07",
                "duration_min": 55,
                "focus": "슬랩",
                "next_action": "16비트 메트로놈",
            },
            "tags": ["슬랩", "루틴"],
            "linked_song_ids": ["L0001"],
            "linked_drill_ids": ["DL0001"],
            "free_targets": ["템포 96"],
            "source_context": "practice",
        },
    )
    assert first_res.status_code == 200
    first_item = first_res.get_json()["item"]
    assert first_item["header_id"] == daily_header["id"]
    assert first_item["status_id"] == draft_status["id"]
    assert first_item["template_id"] == daily_template["id"]
    assert first_item["meta"]["practice_date"] == "2026-03-07"
    assert first_item["meta"]["duration_min"] == 55

    second_res = client.post(
        "/api/records",
        json={
            "title": "2월 월간 회고",
            "body": "한 달 회고 정리",
            "post_type": "월간회고",
            "header_id": monthly_header["id"],
            "status_id": archived_status["id"],
            "template_id": monthly_template["id"],
            "meta": {"practice_date": "2026-02-29", "focus": "루트-5도"},
            "tags": ["회고"],
            "linked_song_ids": [],
            "linked_drill_ids": [],
            "free_targets": [],
            "source_context": "review",
        },
    )
    assert second_res.status_code == 200
    second_item = second_res.get_json()["item"]

    detail_res = client.get(f"/api/records/{first_item['post_id']}")
    assert detail_res.status_code == 200
    detail_item = detail_res.get_json()["item"]
    assert detail_item["template_name"] == "일일 연습 일지"
    assert detail_item["header_label"] == "일일연습"
    assert detail_item["status_label"] == "초안"
    assert detail_item["comments"] == []
    assert detail_item["linked_song_titles"]
    assert detail_item["linked_drill_titles"]

    search_res = client.get("/api/records/list?q=슬랩")
    assert search_res.status_code == 200
    search_ids = {item["post_id"] for item in search_res.get_json()["items"]}
    assert first_item["post_id"] in search_ids
    assert second_item["post_id"] not in search_ids

    header_res = client.get(f"/api/records/list?header_id={daily_header['id']}")
    assert header_res.status_code == 200
    header_ids = {item["post_id"] for item in header_res.get_json()["items"]}
    assert header_ids == {first_item["post_id"]}

    status_res = client.get(f"/api/records/list?status_id={archived_status['id']}")
    assert status_res.status_code == 200
    status_ids = {item["post_id"] for item in status_res.get_json()["items"]}
    assert status_ids == {second_item["post_id"]}

    template_res = client.get(f"/api/records/list?template_id={daily_template['id']}")
    assert template_res.status_code == 200
    template_ids = {item["post_id"] for item in template_res.get_json()["items"]}
    assert template_ids == {first_item["post_id"]}

    comment_res = client.post(
        f"/api/records/{first_item['post_id']}/comments",
        json={"body": "첫 코멘트"},
    )
    assert comment_res.status_code == 200
    root_comment = comment_res.get_json()["item"]
    reply_res = client.post(
        f"/api/records/{first_item['post_id']}/comments",
        json={"body": "답글 메모", "parent_comment_id": root_comment["comment_id"]},
    )
    assert reply_res.status_code == 200
    reply_comment = reply_res.get_json()["item"]

    comments_res = client.get(f"/api/records/{first_item['post_id']}/comments")
    assert comments_res.status_code == 200
    comments = comments_res.get_json()["items"]
    assert [item["depth"] for item in comments] == [0, 1]
    assert comments[1]["parent_comment_id"] == root_comment["comment_id"]

    edit_res = client.put(
        f"/api/records/{first_item['post_id']}/comments/{reply_comment['comment_id']}",
        json={"body": "답글 수정"},
    )
    assert edit_res.status_code == 200
    assert edit_res.get_json()["item"]["body"] == "답글 수정"

    delete_parent_res = client.delete(f"/api/records/{first_item['post_id']}/comments/{root_comment['comment_id']}")
    assert delete_parent_res.status_code == 200
    detail_after_soft_delete = client.get(f"/api/records/{first_item['post_id']}").get_json()["item"]
    assert detail_after_soft_delete["comment_count"] == 2
    assert detail_after_soft_delete["comments"][0]["deleted"] is True
    assert detail_after_soft_delete["comments"][0]["body"] == ""

    delete_reply_res = client.delete(f"/api/records/{first_item['post_id']}/comments/{reply_comment['comment_id']}")
    assert delete_reply_res.status_code == 200
    delete_parent_hard_res = client.delete(f"/api/records/{first_item['post_id']}/comments/{root_comment['comment_id']}")
    assert delete_parent_hard_res.status_code == 200
    detail_after_cleanup = client.get(f"/api/records/{first_item['post_id']}").get_json()["item"]
    assert detail_after_cleanup["comments"] == []
    assert detail_after_cleanup["comment_count"] == 0

    sleep(1.1)
    touch_res = client.put(
        f"/api/records/{second_item['post_id']}",
        json={"body": "업데이트된 월간 회고"},
    )
    assert touch_res.status_code == 200
    sorted_res = client.get("/api/records/list?sort=updated_desc")
    assert sorted_res.status_code == 200
    sorted_items = sorted_res.get_json()["items"]
    assert sorted_items[0]["post_id"] == second_item["post_id"]


def test_records_migration_is_idempotent(tmp_path):
    root = _prepare_temp_root(tmp_path)
    events_path = root / "designPack" / "data" / "events.csv"
    with events_path.open("r", newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))

    created = create_event_row(
        created_at=now_local(),
        event_type="GALLERY_UPLOAD",
        activity="Gallery",
        title="legacy gallery",
        notes="legacy note",
        evidence_type="image",
        evidence_path="gallery/image/legacy.png",
        tags=["GALLERY", "IMAGE", "LEGACY"],
        source="app",
    )
    rows.append(created)
    with events_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=EVENT_HEADERS)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in EVENT_HEADERS})

    app = create_app(root)
    client = app.test_client()
    first = client.get("/api/records/list?limit=2000").get_json()["items"]
    first_count = sum(1 for item in first if item.get("legacy_event_id") == created["event_id"])
    assert first_count == 1

    app2 = create_app(root)
    client2 = app2.test_client()
    second = client2.get("/api/records/list?limit=2000").get_json()["items"]
    second_count = sum(1 for item in second if item.get("legacy_event_id") == created["event_id"])
    assert second_count == 1

    posts_path = app2.config["storage"].paths.runtime_data / "record_posts.csv"
    with posts_path.open("r", newline="", encoding="utf-8-sig") as fh:
        post_reader = csv.DictReader(fh)
        assert post_reader.fieldnames == RECORD_POST_HEADERS

    comments_path = app2.config["storage"].paths.runtime_data / "record_comments.csv"
    with comments_path.open("r", newline="", encoding="utf-8-sig") as fh:
        comment_reader = csv.DictReader(fh)
        assert comment_reader.fieldnames == RECORD_COMMENT_HEADERS
