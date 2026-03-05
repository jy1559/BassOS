from __future__ import annotations

import csv
import json
import shutil
from datetime import datetime, timedelta
from pathlib import Path

from bassos.app_factory import create_app
from bassos.constants import EVENT_HEADERS
from bassos.services.events import create_event_row


def _prepare_temp_root(tmp_path: Path) -> Path:
    src_designpack = Path(__file__).resolve().parents[1] / "designPack"
    dst_designpack = tmp_path / "designPack"
    shutil.copytree(src_designpack, dst_designpack)
    return tmp_path


def _write_mock_dataset_with_single_session(root: Path, dataset_id: str, title: str) -> None:
    dataset_root = root / "designPack" / "mock_datasets" / dataset_id / "data"
    dataset_root.mkdir(parents=True, exist_ok=True)

    now = datetime.now().replace(microsecond=0)
    row = create_event_row(
        created_at=now,
        start_at=now - timedelta(minutes=25),
        end_at=now,
        duration_min=25,
        event_type="SESSION",
        activity="Song",
        xp=120,
        title=title,
        tags=["MOCK", "E2E"],
    )
    with (dataset_root / "events.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=EVENT_HEADERS)
        writer.writeheader()
        writer.writerow({key: row.get(key, "") for key in EVENT_HEADERS})

    meta = {"name": "E2E Mock Dataset", "description": "runtime profile switch test"}
    (dataset_root.parent / "dataset.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_mock_dataset_with_root_csv(root: Path, dataset_id: str) -> None:
    dataset_root = root / "designPack" / "mock_datasets" / dataset_id
    (dataset_root / "data").mkdir(parents=True, exist_ok=True)

    row = create_event_row(
        created_at=datetime.now().replace(microsecond=0),
        event_type="SESSION",
        activity="Song",
        xp=100,
        title="ROOT_CSV_DATASET",
        tags=["MOCK", "ROOT"],
    )
    with (dataset_root / "events.csv").open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=EVENT_HEADERS)
        writer.writeheader()
        writer.writerow({key: row.get(key, "") for key in EVENT_HEADERS})

    meta = {"name": "Root CSV Dataset", "description": "dataset/data empty + csv in root"}
    (dataset_root / "dataset.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def test_mock_profile_activate_and_deactivate(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    mock_dataset_id = "e2e_mock_profile"
    mock_title = "MOCK_ONLY_SESSION_TITLE"
    _write_mock_dataset_with_single_session(root, mock_dataset_id, mock_title)

    app = create_app(root)
    client = app.test_client()

    status_real = client.get("/api/admin/mock-data/status").get_json()
    assert status_real["profile"] == "real"
    assert status_real["active"] is False

    datasets = client.get("/api/admin/mock-data/datasets").get_json()["datasets"]
    assert any(item["id"] == mock_dataset_id for item in datasets)

    activate = client.post("/api/admin/mock-data/activate", json={"dataset_id": mock_dataset_id, "reset": True})
    assert activate.status_code == 200
    activate_payload = activate.get_json()
    assert activate_payload["profile"] == "mock"
    assert activate_payload["dataset_id"] == mock_dataset_id

    sessions_mock = client.get("/api/sessions?limit=1000").get_json()["sessions"]
    assert any(item.get("title") == mock_title for item in sessions_mock)

    deactivate = client.post("/api/admin/mock-data/deactivate", json={})
    assert deactivate.status_code == 200
    deactivate_payload = deactivate.get_json()
    assert deactivate_payload["profile"] == "real"
    assert deactivate_payload["active"] is False

    sessions_real = client.get("/api/sessions?limit=1000").get_json()["sessions"]
    assert all(item.get("title") != mock_title for item in sessions_real)


def test_mock_dataset_detects_root_csv_when_data_dir_is_empty(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    dataset_id = "e2e_mock_root_csv"
    _write_mock_dataset_with_root_csv(root, dataset_id)

    app = create_app(root)
    client = app.test_client()

    datasets = client.get("/api/admin/mock-data/datasets").get_json()["datasets"]
    assert any(item["id"] == dataset_id for item in datasets)

    activate = client.post("/api/admin/mock-data/activate", json={"dataset_id": dataset_id, "reset": True})
    assert activate.status_code == 200
    payload = activate.get_json()
    assert payload["profile"] == "mock"
    assert payload["dataset_id"] == dataset_id


def test_export_current_state_as_mock_dataset_with_generated_sessions(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    create_song = client.post(
        "/api/song-library",
        json={
            "library_id": "LIB_EXPORT_01",
            "title": "Export Song",
            "artist": "Test Artist",
            "genre": "Rock",
            "status": "시작",
        },
    )
    assert create_song.status_code == 200

    create_drill = client.post(
        "/api/drill-library",
        json={
            "drill_id": "DRILL_EXPORT_01",
            "name": "Export Drill",
            "area": "Technique",
        },
    )
    assert create_drill.status_code == 200

    create_backing = client.post(
        "/api/backing-tracks",
        json={
            "backing_id": "BACK_EXPORT_01",
            "title": "Export Backing",
            "genre": "Rock",
            "bpm": "100",
        },
    )
    assert create_backing.status_code == 200

    export_res = client.post(
        "/api/admin/mock-data/export-current",
        json={
            "dataset_id": "my_snapshot",
            "name": "My Snapshot",
            "generate_sessions_60d": True,
            "session_days": 60,
        },
    )
    assert export_res.status_code == 200
    payload = export_res.get_json()
    assert payload["dataset_id"] == "my_snapshot"
    assert payload["generated_sessions"] >= 20

    dataset_data_dir = root / "designPack" / "mock_datasets" / "my_snapshot" / "data"
    assert (dataset_data_dir / "song_library.csv").exists()
    assert (dataset_data_dir / "drill_library.csv").exists()
    assert (dataset_data_dir / "backing_tracks.csv").exists()
    assert (dataset_data_dir / "events.csv").exists()

    with (dataset_data_dir / "song_library.csv").open("r", newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    assert any(item.get("library_id") == "LIB_EXPORT_01" for item in rows)

    with (dataset_data_dir / "events.csv").open("r", newline="", encoding="utf-8-sig") as fh:
        events = list(csv.DictReader(fh))
    assert len(events) >= 20
    created_at = sorted(datetime.fromisoformat(item["created_at"]) for item in events if item.get("created_at"))
    assert (created_at[-1] - created_at[0]).days >= 45


def test_song_library_create_persists_mood_difficulty_and_semicolon_genres(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    create_song = client.post(
        "/api/song-library",
        json={
            "library_id": "LIB_MOOD_01",
            "title": "Mood Song",
            "artist": "Tester",
            "genre": "Rock;Funk",
            "mood": "그루브/펑키",
            "difficulty": "Lv.3",
            "status": "예정",
        },
    )
    assert create_song.status_code == 200
    created = create_song.get_json()["item"]
    assert created["genre"] == "Rock;Funk"
    assert created["mood"] == "그루브/펑키"
    assert created["difficulty"] == "Lv.3"

    rows = client.get("/api/song-library").get_json()["items"]
    saved = next(item for item in rows if item.get("library_id") == "LIB_MOOD_01")
    assert saved["genre"] == "Rock;Funk"
    assert saved["mood"] == "그루브/펑키"
    assert saved["difficulty"] == "Lv.3"


def test_song_library_migration_adds_difficulty_header(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    _ = app.test_client()

    song_library_path = root / "app" / "data" / "song_library.csv"
    with song_library_path.open("r", newline="", encoding="utf-8-sig") as fh:
        headers = next(csv.reader(fh), [])

    assert "difficulty" in headers


def test_stats_overview_revisit_7d_and_active_days(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    reset = client.post("/api/admin/reset-progress", json={})
    assert reset.status_code == 200

    today = datetime.now().replace(hour=10, minute=0, second=0, microsecond=0)
    day_offsets = [20, 16, 8, 2, 0]
    for idx, offset in enumerate(day_offsets):
        start = today - timedelta(days=offset)
        end = start + timedelta(minutes=20)
        res = client.post(
            "/api/session/quick-log",
            json={
                "activity": "Song",
                "sub_activity": "SongPractice",
                "tags": ["E2E", "REVISIT"],
                "notes": f"revisit_seed_{idx}",
                "start_at": start.isoformat(),
                "end_at": end.isoformat(),
                "duration_min": 20,
            },
        )
        assert res.status_code == 200

    stats = client.get("/api/stats/overview").get_json()["stats"]
    engagement = stats["engagement"]
    assert engagement["active_days_30d"] == 5
    assert engagement["revisit_7d_rate"] == 60.0
    assert 0.0 <= engagement["weekly_goal_hit_rate"] <= 100.0


def test_session_stop_returns_coach_feedback_fields(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    start = client.post("/api/session/start", json={"activity": "Song", "sub_activity": "SongPractice"})
    assert start.status_code == 200

    stop = client.post(
        "/api/session/stop",
        json={
            "activity": "Song",
            "sub_activity": "SongPractice",
            "start_at": "2026-02-24T09:00:00",
            "end_at": "2026-02-24T09:30:00",
            "tags": ["E2E", "COACH"],
            "notes": "coach feedback test",
        },
    )
    assert stop.status_code == 200
    payload = stop.get_json()
    assert isinstance(payload.get("coach_message"), str) and payload["coach_message"].strip() != ""
    assert isinstance(payload.get("next_win_hint"), str) and payload["next_win_hint"].strip() != ""
    assert isinstance(payload.get("coach_reason_tags"), list)
