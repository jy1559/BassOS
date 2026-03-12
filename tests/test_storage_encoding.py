from __future__ import annotations

from pathlib import Path

from bassos.services.storage import Storage


def _build_storage(tmp_path: Path) -> Storage:
    root = tmp_path
    (root / "designPack" / "data").mkdir(parents=True, exist_ok=True)
    storage = Storage(root, app_root=root / "app", seed_data_sources=[root / "designPack" / "data"])
    storage.ensure_directories()
    return storage


def test_storage_reads_cp949_csv_and_rewrites_utf8_bom(tmp_path: Path):
    storage = _build_storage(tmp_path)
    target = storage.paths.runtime_data / "song_library.csv"
    target.write_bytes("library_id,title\nLIB1,한글곡\n".encode("cp949"))

    rows = storage.read_csv("song_library.csv")
    assert rows[0]["title"] == "한글곡"

    storage.write_csv("song_library.csv", rows, headers=["library_id", "title"])
    rewritten = target.read_bytes()
    assert rewritten.startswith(b"\xef\xbb\xbf")


def test_append_csv_row_keeps_single_bom(tmp_path: Path):
    storage = _build_storage(tmp_path)
    headers = ["event_id", "title"]
    storage.write_csv("events.csv", [{"event_id": "E1", "title": "first"}], headers=headers)
    storage.append_csv_row("events.csv", {"event_id": "E2", "title": "second"}, headers=headers)

    raw = (storage.paths.runtime_data / "events.csv").read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf")
    assert raw.count(b"\xef\xbb\xbf") == 1


def test_settings_migration_normalizes_keyboard_shortcuts(tmp_path: Path):
    storage = _build_storage(tmp_path)
    storage.write_json(
        "settings.json",
        {
            "ui": {
                "keyboard_shortcuts": {
                    "bindings": {
                        "video_toggle": {"code": "ShiftLeft"},
                        "metronome_toggle": {"code": "KeyT"},
                    }
                }
            }
        },
    )

    storage.migrate_files()
    settings = storage.read_json("settings.json")
    bindings = settings["ui"]["keyboard_shortcuts"]["bindings"]
    assert bindings["video_toggle"]["code"] == "Space"
    assert bindings["metronome_toggle"]["code"] == "KeyT"
    assert bindings["popup_close"]["code"] == "Escape"


def test_settings_migration_remaps_old_default_pin_shortcuts(tmp_path: Path):
    storage = _build_storage(tmp_path)
    storage.write_json(
        "settings.json",
        {
            "policy_version": 14,
            "ui": {
                "keyboard_shortcuts": {
                    "bindings": {
                        "video_pin_save": {"code": "KeyP"},
                        "video_pin_jump": {"code": "KeyJ"},
                        "video_pin_clear": {"code": "KeyP", "shift": True},
                    }
                }
            },
        },
    )

    storage.migrate_files()
    settings = storage.read_json("settings.json")
    bindings = settings["ui"]["keyboard_shortcuts"]["bindings"]
    assert bindings["video_pin_save"]["alt"] is True
    assert bindings["video_pin_jump"]["code"] == "KeyH"
    assert bindings["video_pin_jump"]["alt"] is False
    assert bindings["video_pin_clear"]["alt"] is True


def test_settings_migration_removes_journal_status_catalog(tmp_path: Path):
    storage = _build_storage(tmp_path)
    storage.write_json(
        "settings.json",
        {
            "policy_version": 17,
            "profile": {
                "journal_header_catalog": [{"id": "daily_practice", "label": "일일연습", "color": "#496f6a", "active": True, "order": 0}],
                "journal_status_catalog": [{"id": "draft", "label": "초안", "color": "#66727d", "active": True, "order": 0}],
                "journal_template_catalog": [
                    {
                        "id": "daily_log",
                        "name": "일일 연습 일지",
                        "description": "",
                        "header_id": "daily_practice",
                        "status_id": "draft",
                        "default_tags": ["일일연습"],
                        "body_markdown": "## 포커스",
                        "active": True,
                        "order": 0,
                    }
                ],
            },
        },
    )

    storage.migrate_files()
    settings = storage.read_json("settings.json")
    profile = settings["profile"]

    assert "journal_status_catalog" not in profile
    assert "status_id" not in profile["journal_template_catalog"][0]
    assert "default_source_context" not in profile["journal_template_catalog"][0]


def test_read_json_returns_defaults_for_empty_settings_file(tmp_path: Path):
    storage = _build_storage(tmp_path)
    settings_path = storage.paths.runtime_data / "settings.json"
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text("", encoding="utf-8")

    settings = storage.read_json("settings.json")

    assert settings["policy_version"] >= 1
    assert settings["ui"]["language"] == "ko"
    assert "profile" in settings


def test_read_json_returns_defaults_for_invalid_settings_file(tmp_path: Path):
    storage = _build_storage(tmp_path)
    settings_path = storage.paths.runtime_data / "settings.json"
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text('{"ui": ', encoding="utf-8")

    settings = storage.read_json("settings.json")

    assert settings["policy_version"] >= 1
    assert settings["ui"]["language"] == "ko"
    assert "profile" in settings


def test_read_session_state_ignores_partial_json(tmp_path: Path):
    storage = _build_storage(tmp_path)
    storage.paths.session_state.parent.mkdir(parents=True, exist_ok=True)
    storage.paths.session_state.write_text('{"session_id": ', encoding="utf-8")

    assert storage.read_session_state() == {}
