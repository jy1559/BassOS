from __future__ import annotations

import csv
import io
import shutil
from pathlib import Path

from bassos.app_factory import create_app


def _prepare_temp_root(tmp_path: Path) -> Path:
    src_designpack = Path(__file__).resolve().parents[1] / "designPack"
    dst_designpack = tmp_path / "designPack"
    shutil.copytree(src_designpack, dst_designpack)
    return tmp_path


def test_admin_achievements_crud_and_group_delete(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    before = client.get("/api/admin/achievements/master")
    assert before.status_code == 200
    base_count = len(before.get_json()["items"])

    create_one = client.post(
        "/api/admin/achievements/master",
        json={
            "achievement_id": "ACH_TEST_ROW_1",
            "group_id": "ACH_TEST_GROUP",
            "name": "테스트 1",
            "tier": 1,
            "tier_name": "동",
            "category": "테스트",
            "rule_type": "manual",
            "target": 1,
            "xp_reward": 50,
        },
    )
    assert create_one.status_code == 200

    update_one = client.put(
        "/api/admin/achievements/master/ACH_TEST_ROW_1",
        json={
            "name": "테스트 수정",
            "rule_type": "count_events",
            "rule_filter": {"event_type": "SESSION", "min_duration": 10},
            "auto_grant": True,
        },
    )
    assert update_one.status_code == 200
    updated = update_one.get_json()["item"]
    assert updated["name"] == "테스트 수정"
    assert updated["auto_grant"] == "true"

    create_two = client.post(
        "/api/admin/achievements/master",
        json={
            "achievement_id": "ACH_TEST_ROW_2",
            "group_id": "ACH_TEST_GROUP",
            "name": "테스트 2",
            "tier": 2,
            "tier_name": "은",
            "category": "테스트",
            "rule_type": "count_events",
            "rule_filter": {"event_type": "SESSION", "min_duration": 20},
            "target": 2,
            "xp_reward": 90,
        },
    )
    assert create_two.status_code == 200

    row_delete = client.delete("/api/admin/achievements/master/ACH_TEST_ROW_2?scope=row")
    assert row_delete.status_code == 200
    assert row_delete.get_json()["deleted"] == 1

    create_two_again = client.post(
        "/api/admin/achievements/master",
        json={
            "achievement_id": "ACH_TEST_ROW_2",
            "group_id": "ACH_TEST_GROUP",
            "name": "테스트 2",
            "tier": 2,
            "tier_name": "은",
            "category": "테스트",
            "rule_type": "count_events",
            "rule_filter": {"event_type": "SESSION", "min_duration": 20},
            "target": 2,
            "xp_reward": 90,
        },
    )
    assert create_two_again.status_code == 200

    group_delete = client.delete("/api/admin/achievements/master/ACH_TEST_ROW_1?scope=group")
    assert group_delete.status_code == 200
    assert group_delete.get_json()["deleted"] == 2

    after = client.get("/api/admin/achievements/master")
    assert after.status_code == 200
    after_rows = after.get_json()["items"]
    assert len(after_rows) == base_count
    assert all(item.get("group_id") != "ACH_TEST_GROUP" for item in after_rows)


def test_admin_achievement_icon_upload_export_pack_and_mock_activate_media(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    upload = client.post(
        "/api/admin/achievements/icon-upload",
        data={"file": (io.BytesIO(b"fake-png"), "badge.png")},
        content_type="multipart/form-data",
    )
    assert upload.status_code == 200
    uploaded = upload.get_json()
    assert uploaded["path"].startswith("achievements/icons/")

    create = client.post(
        "/api/admin/achievements/master",
        json={
            "achievement_id": "ACH_ICON_TEST",
            "group_id": "ACH_ICON_TEST",
            "name": "아이콘 테스트",
            "rule_type": "manual",
            "target": 1,
            "xp_reward": 20,
            "icon_path": uploaded["path"],
        },
    )
    assert create.status_code == 200

    export_res = client.post(
        "/api/admin/achievements/export-pack",
        json={"dataset_id": "ach_export_media_test", "name": "media pack"},
    )
    assert export_res.status_code == 200
    payload = export_res.get_json()
    assert payload["dataset_id"] == "ach_export_media_test"
    assert payload["icon_file_count"] >= 1

    dataset_root = root / "designPack" / "mock_datasets" / "ach_export_media_test"
    csv_path = dataset_root / "data" / "achievements_master.csv"
    media_path = dataset_root / "media" / uploaded["path"]
    assert csv_path.exists()
    assert media_path.exists()

    with csv_path.open("r", newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    assert any(row.get("achievement_id") == "ACH_ICON_TEST" for row in rows)

    activate = client.post("/api/admin/mock-data/activate", json={"dataset_id": "ach_export_media_test", "reset": True})
    assert activate.status_code == 200
    runtime_media = root / "app" / "profiles" / "mock" / "ach_export_media_test" / "media" / uploaded["path"]
    assert runtime_media.exists()

    achievements = client.get("/api/achievements")
    assert achievements.status_code == 200
    ach_rows = achievements.get_json()["achievements"]
    row = next(item for item in ach_rows if item.get("achievement_id") == "ACH_ICON_TEST")
    assert "icon_path" in row and "icon_url" in row


def test_admin_achievements_reset_curated(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    create = client.post(
        "/api/admin/achievements/master",
        json={
            "achievement_id": "ACH_RESET_TEST",
            "group_id": "ACH_RESET_TEST",
            "name": "리셋 테스트",
            "rule_type": "manual",
            "target": 1,
            "xp_reward": 10,
        },
    )
    assert create.status_code == 200

    reset = client.post("/api/admin/achievements/reset-curated", json={})
    assert reset.status_code == 200
    assert reset.get_json()["count"] >= 20

    rows = client.get("/api/admin/achievements/master").get_json()["items"]
    assert all(item.get("achievement_id") != "ACH_RESET_TEST" for item in rows)


def test_admin_achievement_rule_options(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    response = client.get("/api/admin/achievements/rule-options")
    assert response.status_code == 200
    payload = response.get_json()

    assert isinstance(payload.get("rule_types"), list)
    assert isinstance(payload.get("event_types"), list)
    assert isinstance(payload.get("tags"), list)
    assert isinstance(payload.get("fields"), list)
    assert isinstance(payload.get("condition_fields"), list)
    assert isinstance(payload.get("condition_ops"), list)
    assert isinstance(payload.get("feature_values"), dict)
    assert isinstance(payload.get("example_rules"), list)
    assert isinstance(payload.get("rule_type_meta"), dict)
    assert isinstance(payload.get("field_meta"), dict)
    assert isinstance(payload.get("operator_meta"), dict)
    assert isinstance(payload.get("field_groups"), list)
    assert isinstance(payload.get("value_suggestions"), dict)
    assert isinstance(payload.get("builder_examples"), list)

    assert "manual" in payload["rule_types"]
    assert "SESSION" in payload["event_types"]
    assert "박자" in payload["tags"]
    assert "CORE" not in payload["tags"]
    assert "song_library_id" in payload["fields"]
    assert "boss_types" not in payload
    assert "song.genre" in payload["condition_fields"]
    assert "drill.tags" in payload["condition_fields"]
    assert "gte" in payload["condition_ops"]
    assert "count_events" in payload["rule_type_meta"]
    assert "duration_min" in payload["field_meta"]
    assert "gte" in payload["operator_meta"]


def test_admin_master_includes_rule_explain_and_rejects_invalid_condition_tree(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    rows = client.get("/api/admin/achievements/master")
    assert rows.status_code == 200
    first = rows.get_json()["items"][0]
    assert isinstance(first.get("_rule_summary_ko"), str)
    assert isinstance(first.get("_rule_steps_ko"), list)

    bad = client.post(
        "/api/admin/achievements/master",
        json={
            "achievement_id": "ACH_BAD_TREE",
            "group_id": "ACH_BAD_TREE",
            "name": "bad tree",
            "rule_type": "count_events",
            "target": 1,
            "xp_reward": 10,
            "rule_filter": {
                "event_type": "SESSION",
                "condition_tree": {"type": "group", "logic": "all", "children": [{"type": "condition", "field": "duration_min", "op": "gte", "value": "oops"}]},
            },
        },
    )
    assert bad.status_code == 400


def test_admin_master_rejects_legacy_rule_filter_keys(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    for legacy_filter in (
        {"event_type": "SESSION", "conditions": [{"field": "duration_min", "op": "gte", "value": 10}]},
        {"event_type": "SESSION", "conditions_mode": "all"},
        {"event_type": "LONG_GOAL_CLEAR", "boss_type": "SONG_FULLTAKE"},
        {"event_type": "SESSION", "tag_quick": "QUICK"},
    ):
        res = client.post(
            "/api/admin/achievements/master",
            json={
                "achievement_id": f"ACH_LEGACY_{hash(str(legacy_filter)) & 0xffff}",
                "group_id": "ACH_LEGACY_REJECT",
                "name": "legacy reject",
                "rule_type": "count_events",
                "target": 1,
                "xp_reward": 10,
                "rule_filter": legacy_filter,
            },
        )
        assert res.status_code == 400
