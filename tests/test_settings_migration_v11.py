from __future__ import annotations

from pathlib import Path

from bassos.services.storage import Storage


def _build_storage(tmp_path: Path) -> Storage:
    root = tmp_path
    (root / "designPack" / "data").mkdir(parents=True, exist_ok=True)
    storage = Storage(root, app_root=root / "app", seed_data_sources=[root / "designPack" / "data"])
    storage.ensure_directories()
    return storage


def test_migrate_v11_existing_user_defaults_to_legacy_and_cleans_removed_keys(tmp_path: Path):
    storage = _build_storage(tmp_path)
    storage.write_json(
        "settings.json",
        {
            "policy_version": 10,
            "ui": {
                "default_theme": "midnight",
                "language": "ko",
                "animation_intensity": "adaptive",
                "dashboard_bg_mode": "auto",
                "dashboard_live_motion": True,
                "dashboard_layout": {
                    "hud": {"x": 2, "y": 1, "w": 1, "h": 1, "visible": True},
                    "timer": {"x": 2, "y": 1, "w": 1, "h": 1, "visible": True},
                    "progress": {"x": 1, "y": 2, "w": 2, "h": 1, "visible": True},
                    "nextWin": {"x": 3, "y": 2, "w": 1, "h": 1, "visible": True},
                    "photo": {"x": 3, "y": 1, "w": 1, "h": 2, "visible": True},
                    "songShortcut": {"x": 2, "y": 3, "w": 2, "h": 1, "visible": True},
                    "todo": {"x": 1, "y": 3, "w": 1, "h": 1, "visible": True},
                    "inProgress": {"x": 2, "y": 4, "w": 2, "h": 1, "visible": False},
                    "quests": {"x": 3, "y": 3, "w": 1, "h": 1, "visible": False},
                },
            },
            "profile": {
                "onboarded": True,
                "dashboard_photo_fit": "contain",
                "dashboard_todo": ["legacy todo"],
                "dashboard_todo_items": [{"id": "t1", "title": "legacy", "created_at": "2026-01-01T00:00:00"}],
            },
        },
    )

    storage.migrate_files()
    migrated = storage.read_json("settings.json")

    assert int(migrated.get("policy_version", 0)) == 17
    ui = migrated["ui"]
    profile = migrated["profile"]

    assert ui.get("dashboard_version") == "legacy"
    assert "dashboard_bg_mode" not in ui
    assert "dashboard_live_motion" not in ui
    assert "dashboard_layout" not in ui

    assert "dashboard_photo_fit" not in profile
    assert "dashboard_todo" not in profile
    assert "dashboard_todo_items" not in profile

    legacy_layout = ui.get("dashboard_layout_legacy", {})
    assert set(legacy_layout.keys()) == {
        "hud",
        "timer",
        "progress",
        "nextWin",
        "photo",
        "songShortcut",
        "achievements",
    }
    assert legacy_layout["hud"]["x"] == 2
    assert "todo" not in legacy_layout
    assert "inProgress" not in legacy_layout
    assert "quests" not in legacy_layout

    focus_layout = ui.get("dashboard_layout_focus", {})
    assert focus_layout["nextWin"]["y"] == 4
    assert focus_layout["nextWin"]["h"] == 1
    assert focus_layout["photo"]["y"] == 1
    assert focus_layout["photo"]["h"] == 3
    assert int(migrated.get("xp", {}).get("display_scale", 0)) == 50
    assert migrated.get("level_curve", {}).get("type") == "decade_linear"


def test_migrate_v11_new_user_defaults_to_focus_and_seeds_layouts(tmp_path: Path):
    storage = _build_storage(tmp_path)
    storage.write_json(
        "settings.json",
        {
            "policy_version": 10,
            "ui": {
                "default_theme": "midnight",
                "language": "ko",
                "animation_intensity": "adaptive",
            },
            "profile": {
                "onboarded": False,
            },
        },
    )

    storage.migrate_files()
    migrated = storage.read_json("settings.json")

    assert int(migrated.get("policy_version", 0)) == 17
    ui = migrated["ui"]
    assert ui.get("dashboard_version") == "focus"

    legacy_layout = ui.get("dashboard_layout_legacy", {})
    focus_layout = ui.get("dashboard_layout_focus", {})
    assert "hud" in legacy_layout and "timer" in legacy_layout and "nextWin" in legacy_layout
    assert "hud" in focus_layout and "timer" in focus_layout and "nextWin" in focus_layout
    assert focus_layout["nextWin"]["x"] == 3
    assert focus_layout["nextWin"]["y"] == 4
    assert focus_layout["nextWin"]["h"] == 1
    assert focus_layout["photo"]["x"] == 3
    assert focus_layout["photo"]["y"] == 1
    assert focus_layout["photo"]["h"] == 3
    assert focus_layout["achievements"]["y"] == 4
    assert focus_layout["achievements"]["visible"] is True
    assert focus_layout["songShortcut"]["y"] == 3
    assert int(migrated.get("xp", {}).get("display_scale", 0)) == 50


def test_existing_v11_old_focus_default_gets_photo_y_upgrade(tmp_path: Path):
    storage = _build_storage(tmp_path)
    storage.write_json(
        "settings.json",
        {
            "policy_version": 11,
            "ui": {
                "default_theme": "midnight",
                "language": "ko",
                "animation_intensity": "adaptive",
                "dashboard_version": "focus",
                "dashboard_layout_focus": {
                    "hud": {"x": 1, "y": 1, "w": 1, "h": 1, "visible": True},
                    "timer": {"x": 2, "y": 1, "w": 1, "h": 1, "visible": True},
                    "nextWin": {"x": 3, "y": 1, "w": 1, "h": 1, "visible": True},
                    "progress": {"x": 1, "y": 2, "w": 2, "h": 1, "visible": True},
                    "songShortcut": {"x": 1, "y": 3, "w": 2, "h": 1, "visible": True},
                    "photo": {"x": 3, "y": 3, "w": 1, "h": 2, "visible": True},
                    "achievements": {"x": 1, "y": 4, "w": 2, "h": 1, "visible": False},
                },
            },
            "profile": {"onboarded": False},
        },
    )

    storage.migrate_files()
    migrated = storage.read_json("settings.json")
    focus_layout = migrated["ui"]["dashboard_layout_focus"]
    assert focus_layout["photo"]["y"] == 1
    assert focus_layout["photo"]["h"] == 3
    assert focus_layout["achievements"]["y"] == 4
    assert focus_layout["achievements"]["visible"] is True
    assert focus_layout["songShortcut"]["y"] == 3
    assert focus_layout["nextWin"]["y"] == 4
    assert focus_layout["nextWin"]["h"] == 1


def test_existing_v11_mid_focus_default_gets_photo_h_upgrade(tmp_path: Path):
    storage = _build_storage(tmp_path)
    storage.write_json(
        "settings.json",
        {
            "policy_version": 11,
            "ui": {
                "default_theme": "midnight",
                "language": "ko",
                "animation_intensity": "adaptive",
                "dashboard_version": "focus",
                "dashboard_layout_focus": {
                    "hud": {"x": 1, "y": 1, "w": 1, "h": 1, "visible": True},
                    "timer": {"x": 2, "y": 1, "w": 1, "h": 1, "visible": True},
                    "nextWin": {"x": 3, "y": 1, "w": 1, "h": 1, "visible": True},
                    "progress": {"x": 1, "y": 2, "w": 2, "h": 1, "visible": True},
                    "songShortcut": {"x": 1, "y": 3, "w": 2, "h": 1, "visible": True},
                    "photo": {"x": 3, "y": 2, "w": 1, "h": 2, "visible": True},
                    "achievements": {"x": 1, "y": 4, "w": 2, "h": 1, "visible": False},
                },
            },
            "profile": {"onboarded": False},
        },
    )

    storage.migrate_files()
    migrated = storage.read_json("settings.json")
    focus_layout = migrated["ui"]["dashboard_layout_focus"]
    assert focus_layout["photo"]["y"] == 1
    assert focus_layout["photo"]["h"] == 3
    assert focus_layout["achievements"]["y"] == 4
    assert focus_layout["songShortcut"]["y"] == 3
    assert focus_layout["nextWin"]["y"] == 4


def test_existing_v11_custom_focus_layout_is_not_overwritten(tmp_path: Path):
    storage = _build_storage(tmp_path)
    storage.write_json(
        "settings.json",
        {
            "policy_version": 11,
            "ui": {
                "default_theme": "midnight",
                "language": "ko",
                "animation_intensity": "adaptive",
                "dashboard_version": "focus",
                "dashboard_layout_focus": {
                    "hud": {"x": 1, "y": 1, "w": 1, "h": 1, "visible": True},
                    "timer": {"x": 2, "y": 1, "w": 1, "h": 1, "visible": True},
                    "nextWin": {"x": 3, "y": 1, "w": 1, "h": 1, "visible": True},
                    "progress": {"x": 1, "y": 2, "w": 2, "h": 1, "visible": True},
                    "songShortcut": {"x": 1, "y": 3, "w": 2, "h": 1, "visible": True},
                    "photo": {"x": 3, "y": 3, "w": 1, "h": 1, "visible": True},
                    "achievements": {"x": 1, "y": 4, "w": 2, "h": 1, "visible": False},
                },
            },
            "profile": {"onboarded": False},
        },
    )

    storage.migrate_files()
    migrated = storage.read_json("settings.json")
    focus_layout = migrated["ui"]["dashboard_layout_focus"]
    assert focus_layout["photo"]["y"] == 3
    assert focus_layout["photo"]["h"] == 1


def test_migrate_v11_seeds_new_ui_notification_and_fx_keys(tmp_path: Path):
    storage = _build_storage(tmp_path)
    storage.write_json(
        "settings.json",
        {
            "policy_version": 11,
            "ui": {
                "default_theme": "midnight",
                "language": "ko",
                "animation_intensity": "adaptive",
                "enable_confetti": False,
                "practice_video_pip_mode": "unknown",
                "practice_video_tab_switch_playback": "weird",
            },
            "profile": {"onboarded": True},
        },
    )

    storage.migrate_files()
    migrated = storage.read_json("settings.json")
    ui = migrated["ui"]

    assert ui["practice_video_pip_mode"] == "mini"
    assert ui["practice_video_tab_switch_playback"] == "continue"
    assert ui["notify_level_up"] is True
    assert ui["notify_achievement_unlock"] is True
    assert ui["notify_quest_complete"] is True
    assert ui["fx_level_up_overlay"] is False
    assert ui["enable_confetti"] is False
    assert ui["fx_achievement_unlock"] is True
    assert ui["fx_quest_complete"] is True
    assert ui["fx_session_complete_normal"] is True
    assert ui["fx_session_complete_quick"] is False
    assert ui["fx_claim_achievement"] is True
    assert ui["fx_claim_quest"] is True
    assert ui["keyboard_shortcuts"]["bindings"]["metronome_toggle"]["code"] == "KeyM"
    assert ui["keyboard_shortcuts"]["bindings"]["video_pin_save"]["alt"] is True
    assert ui["keyboard_shortcuts"]["bindings"]["video_pin_jump"]["code"] == "KeyH"
    assert ui["keyboard_shortcuts"]["bindings"]["video_pin_jump"].get("alt", False) is False
    assert ui["keyboard_shortcuts"]["bindings"]["video_pin_clear"]["alt"] is True


def test_migrate_v11_normalizes_native_pip_mode_to_mini(tmp_path: Path):
    storage = _build_storage(tmp_path)
    storage.write_json(
        "settings.json",
        {
            "policy_version": 11,
            "ui": {
                "default_theme": "midnight",
                "language": "ko",
                "animation_intensity": "adaptive",
                "practice_video_pip_mode": "native",
                "practice_video_tab_switch_playback": "continue",
            },
            "profile": {"onboarded": True},
        },
    )

    storage.migrate_files()
    migrated = storage.read_json("settings.json")
    ui = migrated["ui"]
    assert ui["practice_video_pip_mode"] == "mini"


def test_migrate_v14_updates_legacy_pin_shortcuts_to_new_alt_bindings(tmp_path: Path):
    storage = _build_storage(tmp_path)
    storage.write_json(
        "settings.json",
        {
            "policy_version": 14,
            "ui": {
                "default_theme": "midnight",
                "language": "ko",
                "keyboard_shortcuts": {
                    "bindings": {
                        "video_pin_save": {"code": "KeyP"},
                        "video_pin_jump": {"code": "KeyJ"},
                        "video_pin_clear": {"code": "KeyP", "shift": True},
                    }
                },
            },
            "profile": {"onboarded": True},
        },
    )

    storage.migrate_files()
    migrated = storage.read_json("settings.json")
    bindings = migrated["ui"]["keyboard_shortcuts"]["bindings"]
    assert int(migrated.get("policy_version", 0)) == 17
    assert bindings["video_pin_save"] == {"code": "KeyP", "ctrl": False, "alt": True, "shift": False}
    assert bindings["video_pin_jump"] == {"code": "KeyH", "ctrl": False, "alt": False, "shift": False}


def test_migrate_v15_updates_previous_pin_jump_default_to_home_key(tmp_path: Path):
    storage = _build_storage(tmp_path)
    storage.write_json(
        "settings.json",
        {
            "policy_version": 15,
            "ui": {
                "default_theme": "midnight",
                "language": "ko",
                "keyboard_shortcuts": {
                    "bindings": {
                        "video_pin_jump": {"code": "KeyY"},
                    }
                },
            },
            "profile": {"onboarded": True},
        },
    )

    storage.migrate_files()
    migrated = storage.read_json("settings.json")
    bindings = migrated["ui"]["keyboard_shortcuts"]["bindings"]
    assert int(migrated.get("policy_version", 0)) == 17
    assert bindings["video_pin_jump"] == {"code": "KeyH", "ctrl": False, "alt": False, "shift": False}


def test_migrate_v14_preserves_custom_pin_shortcuts(tmp_path: Path):
    storage = _build_storage(tmp_path)
    storage.write_json(
        "settings.json",
        {
            "policy_version": 14,
            "ui": {
                "default_theme": "midnight",
                "language": "ko",
                "keyboard_shortcuts": {
                    "bindings": {
                        "video_pin_save": {"code": "KeyY"},
                        "video_pin_jump": {"code": "KeyU"},
                        "video_pin_clear": {"code": "KeyI"},
                    }
                },
            },
            "profile": {"onboarded": True},
        },
    )

    storage.migrate_files()
    migrated = storage.read_json("settings.json")
    bindings = migrated["ui"]["keyboard_shortcuts"]["bindings"]
    assert bindings["video_pin_save"]["code"] == "KeyY"
    assert bindings["video_pin_save"]["alt"] is False
    assert bindings["video_pin_jump"]["code"] == "KeyU"
    assert bindings["video_pin_jump"]["alt"] is False
    assert bindings["video_pin_clear"]["code"] == "KeyI"
