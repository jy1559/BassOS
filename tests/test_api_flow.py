from __future__ import annotations

import io
import csv
import shutil
from datetime import timedelta
from pathlib import Path

from bassos.app_factory import create_app
from bassos.constants import EVENT_HEADERS
from bassos.services.events import create_event_row
from bassos.utils.time_utils import now_local


def _prepare_temp_root(tmp_path: Path) -> Path:
    src_designpack = Path(__file__).resolve().parents[1] / "designPack"
    dst_designpack = tmp_path / "designPack"
    shutil.copytree(src_designpack, dst_designpack)
    return tmp_path


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
            "files": [
                (io.BytesIO(b"fake-image-bytes"), "snap.png"),
                (io.BytesIO(b"fake-audio-bytes"), "take.mp3"),
            ],
        },
        content_type="multipart/form-data",
    )
    assert media_post.status_code == 200
    media_item = media_post.get_json()["item"]
    assert len(media_item["attachments"]) == 2

    list_res = client.get("/api/records/list?q=연습")
    assert list_res.status_code == 200
    assert any(item["post_id"] == media_item["post_id"] for item in list_res.get_json()["items"])

    update_res = client.put(
        f"/api/records/{media_item['post_id']}",
        json={"title": "연습 영상 수정", "tags": ["연습영상", "수정됨"]},
    )
    assert update_res.status_code == 200
    assert update_res.get_json()["item"]["title"] == "연습 영상 수정"

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
