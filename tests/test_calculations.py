from __future__ import annotations

from datetime import datetime

from bassos.services.calculations import (
    compute_level_summary,
    evaluate_rule,
    session_xp_breakdown,
    xp_to_next,
)


def _event(
    event_type: str,
    created_at: str,
    xp: int = 0,
    duration: int = 0,
    tags: str = "",
    song_library_id: str = "",
    meta_json: str = "{}",
):
    return {
        "event_type": event_type,
        "created_at": created_at,
        "xp": str(xp),
        "duration_min": str(duration),
        "tags": tags,
        "song_library_id": song_library_id,
        "meta_json": meta_json,
    }


def _settings():
    return {
        "xp": {
            "session": {"per_min": 3},
            "backfill_multiplier": 0.5,
        },
        "level_curve": {
            "type": "decade_linear",
            "base": 174,
            "slope": 4,
            "step_10": 40,
            "step_20": 90,
            "step_30": 200,
            "step_40": 347,
            "rank_thresholds": [{"rank": "Bronze", "min_level": 1}],
        },
    }


def test_session_xp_breakdown_basic_and_backfill():
    settings = _settings()
    normal = session_xp_breakdown({"duration_min": 30, "tags": ["METRO_24"]}, settings)
    assert normal["base_xp"] == 90
    assert normal["bonus_xp"] == 0
    assert normal["total_xp"] == 90

    backfill = session_xp_breakdown(
        {"duration_min": 30, "tags": ["METRO_24"], "is_backfill": True},
        settings,
    )
    assert backfill["total_xp"] == 45



def test_session_xp_breakdown_per_minute_constant():
    settings = _settings()
    short = session_xp_breakdown({"duration_min": 30}, settings)
    long = session_xp_breakdown({"duration_min": 60}, settings)
    assert short["total_xp"] == 90
    assert long["total_xp"] == 180


def test_decade_linear_curve_total_to_level_50():
    curve = _settings()["level_curve"]
    total = sum(xp_to_next(level, curve) for level in range(1, 50))
    assert total == 20000


def test_level_curve_progression():
    summary = compute_level_summary(1000, _settings())
    assert summary.level >= 3
    assert summary.total_xp == 1000
    assert summary.xp_to_next > 0


def test_rule_engine_supports_all_core_types():
    events = [
        _event("SESSION", "2026-02-02T10:00:00", xp=100, duration=30, tags="CORE;METRO_24", song_library_id="L001"),
        _event("SESSION", "2026-02-03T10:00:00", xp=80, duration=20, tags="CORE", song_library_id="L002"),
        _event("SESSION", "2026-02-10T10:00:00", xp=90, duration=25, tags="CORE;METRO_ONEBAR", song_library_id="L001"),
        _event(
            "QUEST_CLAIM",
            "2026-02-12T10:00:00",
            xp=120,
            duration=0,
            tags="QUEST;QUEST_PERIOD_SHORT;QUEST_DIFF_HIGH;QUEST_GENRE_ROCK",
            meta_json='{"quest":{"period_class":"short","difficulty":"high","genres":["Rock"],"genre_primary":"Rock"}}',
        ),
        _event(
            "QUEST_CLAIM",
            "2026-03-13T10:00:00",
            xp=150,
            duration=0,
            tags="QUEST;QUEST_PERIOD_LONG;QUEST_DIFF_MID;QUEST_GENRE_JAZZ",
            meta_json='{"quest":{"period_class":"long","difficulty":"mid","genres":["Jazz"],"genre_primary":"Jazz"}}',
        ),
    ]
    settings = _settings()

    progress, unlocked = evaluate_rule("count_events", {"event_type": "SESSION"}, 3, events, settings)
    assert progress == 3 and unlocked

    progress, unlocked = evaluate_rule("sum_duration", {"event_type": "SESSION"}, 70, events, settings)
    assert progress == 75 and unlocked

    progress, unlocked = evaluate_rule(
        "distinct_count", {"event_type": "SESSION", "field": "song_library_id"}, 2, events, settings
    )
    assert progress == 2 and unlocked

    progress, unlocked = evaluate_rule("sum_xp", {"all_events": True}, 500, events, settings)
    assert progress == 540 and unlocked

    progress, unlocked = evaluate_rule(
        "streak_weekly",
        {"min_sessions": 1, "min_duration": 10},
        2,
        events,
        settings,
    )
    assert progress >= 2 and unlocked

    progress, unlocked = evaluate_rule(
        "streak_monthly",
        {"min_sessions_per_month": 1, "min_duration": 10},
        1,
        events,
        settings,
    )
    assert progress >= 1 and unlocked

    progress, unlocked = evaluate_rule("level_reach", {}, 2, events, settings)
    assert progress >= 2 and unlocked

    progress, unlocked = evaluate_rule("manual", {}, 1, events, settings)
    assert progress == 0 and not unlocked


def test_rule_engine_supports_custom_conditions():
    events = [
        _event("SESSION", "2026-02-02T10:00:00", xp=120, duration=35, tags="SONG_PRACTICE", song_library_id="L001"),
        _event("SESSION", "2026-02-03T10:00:00", xp=60, duration=20, tags="SONG_PRACTICE", song_library_id="L002"),
        _event("SESSION", "2026-02-05T10:00:00", xp=140, duration=42, tags="SONG_PRACTICE", song_library_id="L003"),
    ]
    settings = _settings()
    context = {
        "song_by_id": {
            "L001": {"genre": "Rock", "status": "In Progress"},
            "L002": {"genre": "Jazz", "status": "Done"},
            "L003": {"genre": "Rock", "status": "Done"},
        },
        "drill_by_id": {},
    }

    progress, unlocked = evaluate_rule(
        "count_events",
        {
            "event_type": "SESSION",
            "condition_tree": {
                "type": "group",
                "logic": "all",
                "children": [
                    {"type": "condition", "field": "duration_min", "op": "gte", "value": 30},
                    {"type": "condition", "field": "song.genre", "op": "eq", "value": "Rock"},
                ],
            },
        },
        2,
        events,
        settings,
        feature_context=context,
    )
    assert progress == 2 and unlocked


def test_rule_engine_supports_quest_meta_fields():
    events = [
        _event(
            "QUEST_CLAIM",
            "2026-02-12T10:00:00",
            xp=120,
            tags="QUEST;QUEST_DIFF_HIGH",
            meta_json='{"quest":{"period_class":"short","difficulty":"high","genre_primary":"Rock"}}',
        ),
        _event(
            "QUEST_CLAIM",
            "2026-02-13T10:00:00",
            xp=140,
            tags="QUEST;QUEST_DIFF_MID",
            meta_json='{"quest":{"period_class":"mid","difficulty":"mid","genre_primary":"Jazz"}}',
        ),
    ]
    progress, unlocked = evaluate_rule(
        "count_events",
        {
            "event_type": "QUEST_CLAIM",
            "condition_tree": {
                "type": "group",
                "logic": "all",
                "children": [{"type": "condition", "field": "quest.difficulty", "op": "eq", "value": "high"}],
            },
        },
        1,
        events,
        _settings(),
        feature_context={"song_by_id": {}, "drill_by_id": {}},
    )
    assert progress == 1 and unlocked


def test_rule_engine_supports_condition_tree_and_derived_event_fields():
    events = [
        _event("SESSION", "2026-02-02T22:10:00", xp=120, duration=45, tags="BAND;SONG_PRACTICE", song_library_id="L001"),
        _event("SESSION", "2026-02-03T21:00:00", xp=90, duration=20, tags="PERFORMANCE;SONG_PRACTICE", song_library_id="L002"),
        _event("SESSION", "2026-02-04T23:15:00", xp=140, duration=50, tags="SONG_PRACTICE", song_library_id="L003"),
    ]
    settings = _settings()
    context = {
        "song_by_id": {
            "L001": {"genre": "Rock", "status": "In Progress"},
            "L002": {"genre": "Jazz", "status": "Done"},
            "L003": {"genre": "Rock", "status": "Done"},
        },
        "drill_by_id": {},
    }

    progress, unlocked = evaluate_rule(
        "count_events",
        {
            "event_type": "SESSION",
            "condition_tree": {
                "type": "group",
                "logic": "all",
                "children": [
                    {"type": "condition", "field": "duration_min", "op": "gte", "value": 30},
                    {
                        "type": "group",
                        "logic": "any",
                        "children": [
                            {"type": "condition", "field": "tags", "op": "contains", "value": "BAND"},
                            {"type": "condition", "field": "tags", "op": "contains", "value": "PERFORMANCE"},
                        ],
                    },
                ],
            },
        },
        1,
        events,
        settings,
        feature_context=context,
    )
    assert progress == 1 and unlocked

    progress, unlocked = evaluate_rule(
        "count_events",
        {
            "event_type": "SESSION",
            "condition_tree": {
                "type": "group",
                "logic": "all",
                "children": [
                    {"type": "condition", "field": "event.hour_local", "op": "gte", "value": 22},
                    {"type": "condition", "field": "event.weekday", "op": "eq", "value": 0},
                ],
            },
        },
        1,
        events,
        settings,
        feature_context=context,
    )
    assert progress == 1 and unlocked


def test_distinct_count_supports_feature_dot_field():
    events = [
        _event("SESSION", "2026-02-02T10:00:00", xp=100, duration=30, song_library_id="L001"),
        _event("SESSION", "2026-02-03T10:00:00", xp=100, duration=30, song_library_id="L002"),
        _event("SESSION", "2026-02-04T10:00:00", xp=100, duration=30, song_library_id="L003"),
    ]
    context = {
        "song_by_id": {
            "L001": {"genre": "Rock"},
            "L002": {"genre": "Rock"},
            "L003": {"genre": "Jazz"},
        },
        "drill_by_id": {},
    }
    progress, unlocked = evaluate_rule(
        "distinct_count",
        {"event_type": "SESSION", "field": "song.genre"},
        2,
        events,
        _settings(),
        feature_context=context,
    )
    assert progress == 2 and unlocked

