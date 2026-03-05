"""Project-wide constants."""

EVENT_HEADERS = [
    "event_id",
    "created_at",
    "start_at",
    "end_at",
    "duration_min",
    "event_type",
    "activity",
    "xp",
    "title",
    "notes",
    "song_library_id",
    "drill_id",
    "quest_id",
    "achievement_id",
    "tags",
    "evidence_type",
    "evidence_path",
    "evidence_url",
    "meta_json",
    "source",
]

ACHIEVEMENT_EXTRA_HEADERS = ["is_hidden", "hint", "auto_grant", "ui_badge_style"]

ACHIEVEMENT_HEADERS = [
    "achievement_id",
    "group_id",
    "name",
    "tier",
    "tier_name",
    "category",
    "rarity",
    "rule_type",
    "rule_filter",
    "target",
    "display_order",
    "xp_reward",
    "description",
    "evidence_hint",
    "is_hidden",
    "hint",
    "auto_grant",
    "ui_badge_style",
    "icon_path",
    "icon_url",
]

QUEST_HEADERS = [
    "quest_id",
    "title",
    "emoji",
    "description",
    "status",
    "xp_reward",
    "start_date",
    "due_date",
    "period_class",
    "difficulty",
    "priority",
    "auto_generated",
    "resolved_at",
    "genre_tags",
    "linked_song_ids",
    "linked_drill_ids",
    "rule_type",
    "rule_filter",
    "target",
    "source",
]

# Legacy quest columns are intentionally deprecated in the new quest model.
QUEST_EXTRA_HEADERS: list[str] = []

DRILL_LIBRARY_HEADERS = [
    "drill_id",
    "name",
    "description",
    "area",
    "favorite",
    "tags",
    "bpm_min",
    "bpm_max",
    "bpm_step",
    "default_backing_id",
    "image_path",
    "image_paths",
    "image_url",
    "resource",
    "notes",
    "created_at",
    "last_used_at",
]

BACKING_TRACK_HEADERS = [
    "backing_id",
    "title",
    "description",
    "genre",
    "favorite",
    "chords",
    "bpm",
    "youtube_url",
    "drill_id",
    "tags",
    "notes",
    "created_at",
    "last_used_at",
]

RECORD_POST_HEADERS = [
    "post_id",
    "created_at",
    "updated_at",
    "title",
    "body",
    "post_type",
    "tags",
    "linked_song_ids",
    "linked_drill_ids",
    "free_targets",
    "source_context",
    "legacy_event_id",
    "source",
]

RECORD_ATTACHMENT_HEADERS = [
    "attachment_id",
    "post_id",
    "created_at",
    "media_type",
    "path",
    "url",
    "title",
    "notes",
    "sort_order",
]

SONG_LIBRARY_HEADERS = [
    "library_id",
    "song_id",
    "title",
    "artist",
    "genre",
    "mood",
    "difficulty",
    "favorite",
    "purpose",
    "status",
    "focus_section",
    "goal_bpm",
    "key",
    "original_url",
    "sub_urls",
    "cover_path",
    "score_pdf_path",
    "score_image_paths",
    "cover_url",
    "best_take_path",
    "best_take_url",
    "tags",
    "notes",
    "created_at",
    "last_practiced_at",
]

TUTORIAL_CAMPAIGN_ID = "core_v1"
TUTORIAL_REWARD_XP = 60
TUTORIAL_TITLE_ID = "guide_finisher"

DASHBOARD_LAYOUT_LEGACY_DEFAULT = {
    "hud": {"x": 1, "y": 1, "w": 1, "h": 1, "visible": True},
    "timer": {"x": 2, "y": 1, "w": 1, "h": 1, "visible": True},
    "progress": {"x": 1, "y": 2, "w": 2, "h": 1, "visible": True},
    "nextWin": {"x": 3, "y": 3, "w": 1, "h": 1, "visible": True},
    "photo": {"x": 3, "y": 1, "w": 1, "h": 2, "visible": True},
    "songShortcut": {"x": 1, "y": 3, "w": 2, "h": 1, "visible": True},
    "achievements": {"x": 1, "y": 4, "w": 2, "h": 1, "visible": False},
}

DASHBOARD_LAYOUT_FOCUS_DEFAULT = {
    "hud": {"x": 1, "y": 1, "w": 1, "h": 1, "visible": True},
    "timer": {"x": 2, "y": 1, "w": 1, "h": 1, "visible": True},
    "nextWin": {"x": 3, "y": 4, "w": 1, "h": 1, "visible": True},
    "progress": {"x": 1, "y": 2, "w": 2, "h": 1, "visible": True},
    "photo": {"x": 3, "y": 1, "w": 1, "h": 3, "visible": True},
    "songShortcut": {"x": 1, "y": 3, "w": 2, "h": 1, "visible": True},
    "achievements": {"x": 1, "y": 4, "w": 2, "h": 1, "visible": True},
}


SETTINGS_DEFAULTS = {
    "policy_version": 11,
    "ui": {
        "default_theme": "midnight",
        "enable_confetti": True,
        "animation_intensity": "adaptive",
        "language": "ko",
        "dashboard_glass_cards": True,
        "dashboard_version": "focus",
        "dashboard_layout_legacy": DASHBOARD_LAYOUT_LEGACY_DEFAULT,
        "dashboard_layout_focus": DASHBOARD_LAYOUT_FOCUS_DEFAULT,
        "song_genres": [
            "Rock",
            "Punk Rock",
            "Alt Rock",
            "Hard Rock",
            "Metal",
            "Funk",
            "Jazz",
            "Fusion",
            "R&B",
            "Soul",
            "Hip-hop",
            "Pop",
            "City Pop",
            "Ballad",
            "Disco",
            "Blues",
            "Latin",
            "World",
        ],
        "achievement_card_styles": {
            "tier_bronze": {"border": "#b88746", "fill": "#f8f1e7"},
            "tier_silver": {"border": "#8ca0ad", "fill": "#eff4f7"},
            "tier_gold": {"border": "#d6aa2d", "fill": "#fcf6e7"},
            "tier_platinum": {"border": "#58a4be", "fill": "#e8f7fa"},
            "tier_diamond": {"border": "#6f72ff", "fill": "#f0f0ff"},
            "tier_master": {"border": "#ff9640", "fill": "#fff1e2"},
            "single_event": {"border": "#4f8b92", "fill": "#ebf6f8"},
            "single_hidden": {"border": "#59606a", "fill": "#f0f2f5"},
        },
    },
    "audio": {
        "enabled": False,
        "master_volume": 0.6,
        "levelup_sound": "media/sfx_levelup.mp3",
    },
    "critical": {
        "backfill_multiplier_default": 0.5,
        "max_backup_files": 3,
        "backup_min_hours": 12,
        "achievement_xp_multiplier": 0.15,
        "quest_xp_multiplier": 0.06,
        "session_xp_multiplier": 1.0,
        "daily_session_xp_cap": 200,
    },
    "admin": {
        "gate_enabled": False,
        "pin_hash": "",
    },
    "backup": {
        "enabled": True,
        "max_files": 3,
        "min_hours_between": 12,
    },
    "performance": {
        "target_dashboard_ms": 1000,
    },
    "profile": {
        "nickname": "",
        "weekly_goal_sessions": 3,
        "onboarded": False,
        "quest_settings": {
            "period_days": {"short": 7, "mid": 30, "long": 90},
            "auto_enabled_by_period": {"short": True, "mid": True, "long": True},
            "auto_target_minutes_by_period": {"short": 120, "mid": 360, "long": 900},
            "auto_priority_by_period": {"short": "normal", "mid": "normal", "long": "urgent"},
            "auto_difficulty_by_period": {"short": "low", "mid": "mid", "long": "high"},
            "ui_style": {
                "period_border": {"short": "#44728a", "mid": "#5e6f8f", "long": "#6e5f8d"},
                "period_fill": {"short": "#e7f5ff", "mid": "#eef2ff", "long": "#f4efff"},
                "priority_border": {"urgent": "#d8664a", "normal": "#4f8bc4", "low": "#6b8892"},
                "difficulty_fill": {"low": "#eef8f5", "mid": "#eef2ff", "high": "#fff0f1"},
            },
        },
        "guide_finisher_unlocked": False,
        "tutorial_state": {
            "campaign_id": TUTORIAL_CAMPAIGN_ID,
            "banner_seen_campaigns": [],
            "completed_campaigns": [],
            "reward_claimed_campaigns": [],
            "resume_campaign_id": "",
            "resume_step_index": 0,
            "last_started_at": "",
            "last_completed_at": "",
        },
        "dashboard_photo_items": [],
        "dashboard_featured_photo_id": "",
        "dashboard_photo_anchor": "center",
        "journal_tag_catalog": [],
    },
}

XP_BALANCE_V2 = {
    # 30-minute baseline session ~= 62 XP before optional bonuses.
    "session": {"start_bonus": 20, "per_10min": 14, "max_base_xp": 100},
    "bonus": {
        "core_warmup": 8,
        "metronome_24": 6,
        "metronome_onebar": 12,
        "recording_audio": 14,
        "recording_video": 16,
        "earcopy": 14,
        "theory": 10,
        "slap": 10,
        "clean_mute": 8,
        "ab_compare": 12,
    },
    "weekly_chest": {"xp": 180},
    "monthly_long_goal": {"song_fulltake": 650, "earcopy_full": 900},
    "rehearsal_bonus": 16,
    "performance_bonus": 48,
    "backfill_multiplier": 0.5,
}

# Target milestones: Lv10 ~1 month, Lv20 ~3 months, Lv30 ~6 months,
# Lv40 ~1 year, Lv50 ~2 years (3x30m/week + moderate quest/achievement).
LEVEL_BALANCE_V2 = {"a": 230, "b": 13, "c": 1.1, "max_level": 50}

ACTIVITY_TO_TAG = {
    "Song": "SONG",
    "Drill": "DRILL",
    "Etc": "ETC",
    "Core": "CORE",
    "Funk&Jazz": "FUNKJAZZ",
    "Theory": "THEORY",
    "Slap": "SLAP",
    "SongCopy": "SONG_COPY",
    "SongPractice": "SONG_PRACTICE",
    "Band": "BAND",
    "Performance": "PERFORMANCE",
    "Community": "COMMUNITY",
    "Gear": "GEAR",
}

SUB_ACTIVITY_TO_TAG = {
    "SongCopy": "SONG_COPY",
    "SongLearn": "SONG_LEARN",
    "SongPractice": "SONG_PRACTICE",
    "Core": "CORE",
    "Funk": "FUNK",
    "Slap": "SLAP",
    "Theory": "THEORY",
    "SongDiscovery": "SONG_DISCOVERY",
    "Community": "COMMUNITY",
    "Gear": "GEAR",
    "Etc": "ETC",
}

CHECKBOX_TAG_TO_BONUS_KEY = {
    "METRO_24": "metronome_24",
    "METRO_ONEBAR": "metronome_onebar",
    "CLEAN_MUTE": "clean_mute",
    "EAR_COPY": "earcopy",
    "RECORDING_AUDIO": "recording_audio",
    "RECORDING_VIDEO": "recording_video",
    "AB_COMPARE": "ab_compare",
    "THEORY": "theory",
    "SLAP": "slap",
    "CORE": "core_warmup",
}
