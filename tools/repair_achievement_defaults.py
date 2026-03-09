from __future__ import annotations

import csv
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from bassos.services.achievements import (  # noqa: E402
    _humanize_description_ko,
    _needs_user_facing_description,
    _safe_json,
    _user_facing_description_ko,
)
from bassos.services.calculations import to_int  # noqa: E402

TARGETS = [
    ROOT / "designPack" / "data" / "achievements_master.csv",
    ROOT / "app" / "data" / "achievements_master.csv",
    ROOT / "app" / "profiles" / "mock" / "realistic_mix_8w" / "data" / "achievements_master.csv",
]

EMOJI_BY_GROUP_ID = {
    "ACH_TIER_SESSION_ROUTINE": "\U0001F5D3\ufe0f",
    "ACH_TIER_DEEP_FOCUS": "\U0001F3AF",
    "ACH_TIER_LONG_FOCUS": "\U0001F3AF",
    "ACH_TIER_DURATION_SUM": "\u23f1\ufe0f",
    "ACH_TIER_XP_STACK": "\u26a1",
    "ACH_TIER_LEVEL_CLIMB": "\U0001F4C8",
    "ACH_TIER_SONG_PRACTICE": "\U0001F3B5",
    "ACH_TIER_REPERTOIRE_DISTINCT": "\U0001F4DA",
    "ACH_TIER_DRILL_DISTINCT": "\U0001F3B8",
    "ACH_TIER_CORE_WEEKLY": "\U0001F5D3\ufe0f",
    "ACH_TIER_MONTHLY_PACE": "\U0001F5D3\ufe0f",
    "ACH_TIER_SLAP_MASTERY": "\U0001F590\ufe0f",
    "ACH_TIER_THEORY_EAR": "\U0001F4D8",
    "ACH_TIER_ARCHIVE_RECORD": "\U0001F399\ufe0f",
    "ACH_TIER_VIDEO_REVIEW": "\U0001F3A5",
    "ACH_TIER_BAND_FLOW": "\U0001F3A4",
    "ACH_TIER_COMMUNITY": "\U0001F91D",
    "ACH_ONE_FIRST_SESSION": "\U0001F680",
    "ACH_ONE_FIRST_FOCUS_30": "\U0001F3AF",
    "ACH_ONE_FIRST_AUDIO_LOG": "\U0001F399\ufe0f",
    "ACH_ONE_FIRST_VIDEO_REVIEW": "\U0001F3A5",
    "ACH_ONE_FIRST_BAND_STAGE": "\U0001F3A4",
    "ACH_ONE_FIRST_COMMUNITY": "\U0001F91D",
    "ACH_ONE_WEEK_KEEPER_2W": "\U0001F525",
    "ACH_ONE_MONTH_KEEPER_2M": "\U0001F525",
    "ACH_ONE_STYLE_SWITCHER": "\U0001F3A8",
    "ACH_ONE_STAGE_DEBUT": "\U0001F3A4",
    "ACH_HID_QUIET_ENGINE": "\U0001F507",
    "ACH_HID_DOUBLE_ARCHIVE": "\U0001F3A5",
    "ACH_HID_IRON_STREAK": "\U0001F525",
    "ACH_HID_NIGHT_OWL": "\U0001F3AF",
    "ACH_HID_REPERTOIRE_MASTER": "\U0001F4DA",
    "ACH_TIER_QUEST_CLAIM": "\U0001F9ED",
    "ACH_ONE_QUEST_HIGH_FIRST": "\U0001F9ED",
    "ACH_HID_QUEST_GENRE_TRIO": "\U0001F9ED",
    "ACH_SESSION": "\U0001F5D3\ufe0f",
    "ACH_DURATION": "\u23f1\ufe0f",
    "ACH_XP": "\u26a1",
    "ACH_LEVEL": "\U0001F4C8",
    "ACH_SONG": "\U0001F3B5",
    "ACH_DRILL": "\U0001F3B8",
    "ACH_SCOLLECT": "\U0001F4DA",
    "ACH_RECORD": "\U0001F399\ufe0f",
    "ACH_CORE_STREAK": "\U0001F5D3\ufe0f",
    "ACH_MONTHLY_STREAK": "\U0001F5D3\ufe0f",
    "ACH_BAND_STAGE": "\U0001F3A4",
    "ACH_COMMUNITY": "\U0001F91D",
    "ACH_THEORY": "\U0001F4D8",
    "ACH_SLAP": "\U0001F590\ufe0f",
    "ACH_MUTE_METRO": "\U0001F507",
    "ACH_AB_ARCHIVE": "\U0001F3A5",
    "ACH_ONEOFF_FIRST_BAND": "\U0001F3A4",
    "ACH_ONEOFF_FIRST_VIDEO_REVIEW": "\U0001F3A5",
    "ACH_ONEOFF_FIRST_AUDIO_LOG": "\U0001F399\ufe0f",
    "ACH_ONEOFF_FIRST_COMMUNITY": "\U0001F91D",
    "ACH_ONEOFF_STYLE_SWITCH": "\U0001F3A8",
    "ACH_ONEOFF_STAGE_DEBUT": "\U0001F3A4",
    "ACH_ONEOFF_GENRE_OPEN": "\U0001F9ED",
    "ACH_ONEOFF_GEAR_UP": "\U0001F6E0\ufe0f",
    "ACH_ONEOFF_WEEK_KEEPER": "\U0001F525",
    "ACH_ONEOFF_MONTH_KEEPER": "\U0001F525",
    "ACH_HIDDEN_QUIET_ENGINE": "\U0001F507",
    "ACH_HIDDEN_DOUBLE_ARCHIVE": "\U0001F3A5",
    "ACH_HIDDEN_NIGHT_OWL": "\U0001F3AF",
    "ACH_HIDDEN_IRON_STREAK": "\U0001F525",
    "ACH_HIDDEN_REPERTOIRE_MASTER": "\U0001F4DA",
}


def _normalize_icon_emoji(value: str | None) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if set(text) == {"?"}:
        return ""
    return text


def _fallback_emoji(row: dict[str, str]) -> str:
    group_id = str(row.get("group_id") or row.get("achievement_id") or "").strip()
    if group_id in EMOJI_BY_GROUP_ID:
        return EMOJI_BY_GROUP_ID[group_id]
    text = " ".join(
        [
            str(row.get("group_id") or ""),
            str(row.get("achievement_id") or ""),
            str(row.get("category") or ""),
            str(row.get("name") or ""),
        ]
    ).upper()
    if "QUIET_ENGINE" in text or "MUTE" in text:
        return "\U0001F507"
    if "QUEST" in text or "GENRE" in text:
        return "\U0001F9ED"
    if "STYLE" in text:
        return "\U0001F3A8"
    if "COMMUNITY" in text:
        return "\U0001F91D"
    if "BAND" in text or "STAGE" in text or "PERFORMANCE" in text:
        return "\U0001F3A4"
    if "VIDEO" in text or "AB_" in text or "DOUBLE_ARCHIVE" in text:
        return "\U0001F3A5"
    if "ARCHIVE" in text or "AUDIO" in text or "RECORD" in text:
        return "\U0001F399\ufe0f"
    if "THEORY" in text or "EAR" in text:
        return "\U0001F4D8"
    if "SLAP" in text:
        return "\U0001F590\ufe0f"
    if "DRILL" in text:
        return "\U0001F3B8"
    if "SCOLLECT" in text or "REPERTOIRE" in text:
        return "\U0001F4DA"
    if "SONG" in text:
        return "\U0001F3B5"
    if "LEVEL" in text:
        return "\U0001F4C8"
    if "XP" in text:
        return "\u26a1"
    if "DURATION" in text:
        return "\u23f1\ufe0f"
    if "DEEP_FOCUS" in text or "LONG_FOCUS" in text or "FOCUS" in text or "NIGHT_OWL" in text:
        return "\U0001F3AF"
    if "SESSION" in text or "CORE" in text or "MONTHLY" in text:
        return "\U0001F5D3\ufe0f"
    if "KEEPER" in text or "STREAK" in text:
        return "\U0001F525"
    if "HIDDEN" in text or "HID_" in text:
        return "\U0001F576\ufe0f"
    return "\U0001F3C6"


def _rewrite_description(row: dict[str, str]) -> str:
    target = to_int(row.get("target"), 1)
    rule_filter = _safe_json(row.get("rule_filter"))
    rule_type = str(row.get("rule_type") or "").strip().lower()
    if rule_type and rule_type != "manual":
        return _humanize_description_ko(row, target, rule_filter).strip()
    return _user_facing_description_ko(row, target, rule_filter).strip()


def repair_file(path: Path) -> None:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        headers = list(reader.fieldnames or [])
        rows = [dict(row) for row in reader]

    if "icon_emoji" not in headers:
        headers.append("icon_emoji")

    for row in rows:
        raw_description = str(row.get("description") or "").strip()
        if _needs_user_facing_description(raw_description) or str(row.get("rule_type") or "").strip().lower() != "manual":
            row["description"] = _rewrite_description(row)
        row["icon_emoji"] = _normalize_icon_emoji(row.get("icon_emoji")) or _fallback_emoji(row)

    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in headers})


def main() -> None:
    for target in TARGETS:
        repair_file(target)
        print(target.relative_to(ROOT))


if __name__ == "__main__":
    main()
