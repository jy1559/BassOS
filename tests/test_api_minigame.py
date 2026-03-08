from __future__ import annotations

import json
import shutil
from datetime import datetime, timedelta
from pathlib import Path

from bassos.app_factory import create_app
from bassos.minigame_defaults import MINIGAME_RECORD_HEADERS


def _prepare_temp_root(tmp_path: Path) -> Path:
    src_designpack = Path(__file__).resolve().parents[1] / "designPack"
    dst_designpack = tmp_path / "designPack"
    shutil.copytree(src_designpack, dst_designpack)
    return tmp_path


def test_minigame_config_and_seed(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    config_res = client.get("/api/minigame/config")
    assert config_res.status_code == 200
    config = config_res.get_json()["config"]
    assert config["challenge_seconds"] == 120
    assert config["tick"]["beat"] == 48
    assert config["fretboard"]["max_visible_fret"] == 21
    assert config["rhythm"]["preroll_beats"] == 4
    assert config["rhythm"]["challenge_problem_count"] == 5
    assert config["rhythm"]["challenge_attempts_per_problem"] == 1
    assert config["rhythm"]["calibration"]["bpm"] == 140
    assert config["rhythm"]["calibration"]["capture_sec"] == 8
    assert config["rhythm_windows_ms"]["VERY_HARD"] == 52
    assert "major_pentatonic" in config["scale_rules"]
    assert "maj7" in config["chord_qualities"]

    first_seed = client.get("/api/minigame/seed?date=2026-03-01").get_json()
    second_seed = client.get("/api/minigame/seed?date=2026-03-01").get_json()
    next_seed = client.get("/api/minigame/seed?date=2026-03-02").get_json()
    assert first_seed["seed"] == "2026-03-01"
    assert first_seed["numeric_seed"] == second_seed["numeric_seed"]
    assert first_seed["numeric_seed"] != next_seed["numeric_seed"]


def test_minigame_record_crud_leaderboard_and_stats(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    create_res = client.post(
        "/api/minigame/records",
        json={
            "game": "RC",
            "mode": "CHALLENGE",
            "difficulty": "NORMAL",
            "score": 77,
            "accuracy": 88.5,
            "seed": "2026-03-01",
            "duration_sec": 95,
            "share_text": "RC|CHALLENGE|NORMAL|SCORE=77|SEED=2026-03-01",
            "detail_json": {
                "perfect": 5,
                "good": 2,
                "miss": 1,
                "avg_abs_ms": 32.5,
                "note_accuracy": 100.0,
                "timing_accuracy": 88.5,
                "stray_inputs": 1,
            },
        },
    )
    assert create_res.status_code == 200
    record_id = create_res.get_json()["item"]["record_id"]

    list_res = client.get("/api/minigame/records?game=RC&difficulty=NORMAL&period=ALL&limit=30")
    assert list_res.status_code == 200
    items = list_res.get_json()["items"]
    assert len(items) == 1
    assert items[0]["record_id"] == record_id

    leaderboard_res = client.get("/api/minigame/leaderboard?game=RC&difficulty=ALL&period=ALL&limit=10")
    assert leaderboard_res.status_code == 200
    assert leaderboard_res.get_json()["items"][0]["score"] == 77

    stats_res = client.get("/api/minigame/stats?game=RC&difficulty=ALL&period=ALL")
    assert stats_res.status_code == 200
    stats = stats_res.get_json()
    assert stats["summary"]["plays"] == 1
    assert stats["detail"]["total_perfect"] == 5
    assert stats["detail"]["avg_note_accuracy"] == 100.0
    assert stats["detail"]["avg_timing_accuracy"] == 88.5
    assert stats["detail"]["total_stray_inputs"] == 1

    delete_res = client.delete(f"/api/minigame/records/{record_id}")
    assert delete_res.status_code == 200
    after_delete = client.get("/api/minigame/records?game=RC&difficulty=ALL&period=ALL&limit=30").get_json()["items"]
    assert after_delete == []


def test_minigame_period_filter_and_image_endpoint(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()
    storage = app.config["storage"]

    now = datetime.now().replace(microsecond=0)
    old = now - timedelta(days=45)
    storage.write_csv(
        "minigame_records.csv",
        [
            {
                "record_id": "MR_TEST_NOW",
                "created_at": now.isoformat(),
                "game": "FBH",
                "mode": "CHALLENGE",
                "difficulty": "EASY",
                "score": "10",
                "accuracy": "80",
                "seed": "2026-03-01",
                "duration_sec": "90",
                "share_text": "FBH|CHALLENGE|EASY|SCORE=10|SEED=2026-03-01",
                "detail_json": json.dumps({"correct": 3, "wrong": 1, "judge": "PC_RANGE"}, ensure_ascii=False),
                "source": "app",
            },
            {
                "record_id": "MR_TEST_OLD",
                "created_at": old.isoformat(),
                "game": "FBH",
                "mode": "CHALLENGE",
                "difficulty": "EASY",
                "score": "20",
                "accuracy": "91",
                "seed": "2026-01-01",
                "duration_sec": "120",
                "share_text": "FBH|CHALLENGE|EASY|SCORE=20|SEED=2026-01-01",
                "detail_json": json.dumps({"correct": 4, "wrong": 0, "judge": "MIDI"}, ensure_ascii=False),
                "source": "app",
            },
        ],
        headers=MINIGAME_RECORD_HEADERS,
    )

    d30_res = client.get("/api/minigame/records?game=FBH&difficulty=ALL&period=D30&limit=30")
    assert d30_res.status_code == 200
    assert [item["record_id"] for item in d30_res.get_json()["items"]] == ["MR_TEST_NOW"]

    image_res = client.get("/api/minigame/game-image/FBH")
    assert image_res.status_code == 200
    assert image_res.content_type.startswith("image/")


def test_minigame_user_settings_persist_in_practice_tools_section(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()
    storage = app.config["storage"]

    initial_res = client.get("/api/minigame/user-settings")
    assert initial_res.status_code == 200
    initial = initial_res.get_json()["settings"]
    assert initial["fretboard"]["boardPreset"] == "CLASSIC"
    assert initial["rhythm"]["windowsMs"]["MASTER"] == 45

    update_res = client.put(
        "/api/minigame/user-settings",
        json={
            "settings": {
                **initial,
                "fretboard": {**initial["fretboard"], "boardPreset": "MAPLE"},
                "theory": {**initial["theory"], "scaleSpreadMs": 180},
            }
        },
    )
    assert update_res.status_code == 200
    saved = update_res.get_json()["settings"]
    assert saved["fretboard"]["boardPreset"] == "MAPLE"
    assert saved["theory"]["scaleSpreadMs"] == 180

    persisted = storage.read_json("settings.json")
    assert persisted["practice_tools"]["minigame_user_settings"]["fretboard"]["boardPreset"] == "MAPLE"
    assert persisted["practice_tools"]["minigame_user_settings"]["theory"]["scaleSpreadMs"] == 180


def test_minigame_user_settings_recovers_from_invalid_settings_json(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()
    storage = app.config["storage"]

    settings_path = storage.paths.runtime_data / "settings.json"
    settings_path.write_text('{"practice_tools": ', encoding="utf-8")

    res = client.get("/api/minigame/user-settings")
    assert res.status_code == 200
    payload = res.get_json()["settings"]
    assert payload["version"] == 3
    assert payload["fretboard"]["inlayPreset"] == "DOT"
