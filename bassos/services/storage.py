"""File-system backed storage for CSV/JSON data."""

from __future__ import annotations

import csv
import io
import json
import shutil
import uuid
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from bassos.constants import (
    ACHIEVEMENT_HEADERS,
    ACHIEVEMENT_EXTRA_HEADERS,
    BACKING_TRACK_HEADERS,
    DASHBOARD_LAYOUT_FOCUS_DEFAULT,
    DASHBOARD_LAYOUT_LEGACY_DEFAULT,
    DRILL_LIBRARY_HEADERS,
    EVENT_HEADERS,
    JOURNAL_HEADER_CATALOG_DEFAULTS,
    JOURNAL_TEMPLATE_CATALOG_DEFAULTS,
    LEVEL_BALANCE_V2,
    QUEST_HEADERS,
    RECORD_ATTACHMENT_HEADERS,
    RECORD_COMMENT_HEADERS,
    RECORD_POST_HEADERS,
    SETTINGS_DEFAULTS,
    SONG_LIBRARY_HEADERS,
    XP_BALANCE_V2,
)
from bassos.services.calculations import to_int

DRILL_TAG_CANONICAL = [
    "박자",
    "포지션",
    "지구력",
    "스피드",
    "클린",
    "다이내믹",
    "리딩",
    "핑거",
    "피크",
    "슬랩",
    "고스트",
    "레가토",
    "크로매틱",
    "스케일",
    "코드톤",
    "인터벌",
    "진행",
    "8분음표",
    "16분음표",
    "트리플렛",
    "싱코페이션",
    "그루브",
    "워킹",
    "컴핑",
]
_DRILL_TAG_CANONICAL_SET = set(DRILL_TAG_CANONICAL)
_FOCUS_LAYOUT_PREVIOUS_DEFAULTS: list[dict[str, dict[str, Any]]] = [
    {
        "hud": {"x": 1, "y": 1, "w": 1, "h": 1, "visible": True},
        "timer": {"x": 2, "y": 1, "w": 1, "h": 1, "visible": True},
        "nextWin": {"x": 3, "y": 4, "w": 1, "h": 1, "visible": True},
        "progress": {"x": 1, "y": 2, "w": 2, "h": 1, "visible": True},
        "photo": {"x": 3, "y": 1, "w": 1, "h": 3, "visible": True},
        "songShortcut": {"x": 1, "y": 4, "w": 2, "h": 1, "visible": True},
        "achievements": {"x": 1, "y": 3, "w": 2, "h": 1, "visible": True},
    },
    {
        "hud": {"x": 1, "y": 1, "w": 1, "h": 1, "visible": True},
        "timer": {"x": 2, "y": 1, "w": 1, "h": 1, "visible": True},
        "nextWin": {"x": 3, "y": 1, "w": 1, "h": 1, "visible": True},
        "progress": {"x": 1, "y": 2, "w": 2, "h": 1, "visible": True},
        "songShortcut": {"x": 1, "y": 3, "w": 2, "h": 1, "visible": True},
        "photo": {"x": 3, "y": 3, "w": 1, "h": 2, "visible": True},
        "achievements": {"x": 1, "y": 4, "w": 2, "h": 1, "visible": False},
    },
    {
        "hud": {"x": 1, "y": 1, "w": 1, "h": 1, "visible": True},
        "timer": {"x": 2, "y": 1, "w": 1, "h": 1, "visible": True},
        "nextWin": {"x": 3, "y": 1, "w": 1, "h": 1, "visible": True},
        "progress": {"x": 1, "y": 2, "w": 2, "h": 1, "visible": True},
        "songShortcut": {"x": 1, "y": 3, "w": 2, "h": 1, "visible": True},
        "photo": {"x": 3, "y": 2, "w": 1, "h": 2, "visible": True},
        "achievements": {"x": 1, "y": 4, "w": 2, "h": 1, "visible": False},
    },
    {
        "hud": {"x": 1, "y": 1, "w": 1, "h": 1, "visible": True},
        "timer": {"x": 2, "y": 1, "w": 1, "h": 1, "visible": True},
        "nextWin": {"x": 3, "y": 1, "w": 1, "h": 1, "visible": True},
        "progress": {"x": 1, "y": 2, "w": 2, "h": 1, "visible": True},
        "songShortcut": {"x": 1, "y": 4, "w": 2, "h": 1, "visible": True},
        "photo": {"x": 3, "y": 2, "w": 1, "h": 3, "visible": True},
        "achievements": {"x": 1, "y": 3, "w": 2, "h": 1, "visible": True},
    },
]

_SHORTCUT_MODIFIER_CODES = {
    "ShiftLeft",
    "ShiftRight",
    "ControlLeft",
    "ControlRight",
    "AltLeft",
    "AltRight",
    "MetaLeft",
    "MetaRight",
}
_SHORTCUT_SUPPORTED_CODES = {
    "Space",
    "Enter",
    "Escape",
    "Delete",
    "Backspace",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    *[f"Digit{idx}" for idx in range(10)],
    *[f"Key{chr(code)}" for code in range(ord("A"), ord("Z") + 1)],
}

_PREVIOUS_PIN_SHORTCUT_DEFAULTS = {
    "video_pin_save": {"code": "KeyP", "ctrl": False, "alt": False, "shift": False},
    "video_pin_jump": {"code": "KeyJ", "ctrl": False, "alt": False, "shift": False},
    "video_pin_clear": {"code": "KeyP", "ctrl": False, "alt": False, "shift": True},
}

_PREVIOUS_PIN_JUMP_SHORTCUT_DEFAULT = {"code": "KeyY", "ctrl": False, "alt": False, "shift": False}


def _drill_tag_key(raw: str | None) -> str:
    return str(raw or "").strip().lower().replace(" ", "").replace("_", "").replace("-", "").replace("&", "and")


_DRILL_TAG_ALIAS = {
    _drill_tag_key("기본기"): "박자",
    _drill_tag_key("core"): "박자",
    _drill_tag_key("메트로놈 2&4"): "박자",
    _drill_tag_key("metronome 2&4"): "박자",
    _drill_tag_key("METRO_24"): "박자",
    _drill_tag_key("한 마디 한 클릭"): "박자",
    _drill_tag_key("METRO_ONEBAR"): "박자",
    _drill_tag_key("클린 뮤트"): "클린",
    _drill_tag_key("clean mute"): "클린",
    _drill_tag_key("CLEAN_MUTE"): "클린",
    _drill_tag_key("muting"): "클린",
    _drill_tag_key("다이내믹"): "다이내믹",
    _drill_tag_key("dynamics"): "다이내믹",
    _drill_tag_key("포지션"): "포지션",
    _drill_tag_key("fretboard"): "포지션",
    _drill_tag_key("리듬 읽기"): "리딩",
    _drill_tag_key("reading"): "리딩",
    _drill_tag_key("슬랩"): "슬랩",
    _drill_tag_key("SLAP"): "슬랩",
    _drill_tag_key("썸"): "슬랩",
    _drill_tag_key("thumb"): "슬랩",
    _drill_tag_key("팝"): "슬랩",
    _drill_tag_key("pop"): "슬랩",
    _drill_tag_key("고스트"): "고스트",
    _drill_tag_key("ghost"): "고스트",
    _drill_tag_key("레가토"): "레가토",
    _drill_tag_key("legato"): "레가토",
    _drill_tag_key("핑거"): "핑거",
    _drill_tag_key("finger"): "핑거",
    _drill_tag_key("피크"): "피크",
    _drill_tag_key("pick"): "피크",
    _drill_tag_key("크로매틱"): "크로매틱",
    _drill_tag_key("chromatic"): "크로매틱",
    _drill_tag_key("스케일"): "스케일",
    _drill_tag_key("scale"): "스케일",
    _drill_tag_key("코드톤"): "코드톤",
    _drill_tag_key("chord tones"): "코드톤",
    _drill_tag_key("도수"): "인터벌",
    _drill_tag_key("인터벌"): "인터벌",
    _drill_tag_key("ii-v"): "진행",
    _drill_tag_key("II_V"): "진행",
    _drill_tag_key("진행"): "진행",
    _drill_tag_key("워킹"): "워킹",
    _drill_tag_key("walking"): "워킹",
    _drill_tag_key("컴핑"): "컴핑",
    _drill_tag_key("comping"): "컴핑",
    _drill_tag_key("그루브"): "그루브",
    _drill_tag_key("groove"): "그루브",
    _drill_tag_key("8분음표"): "8분음표",
    _drill_tag_key("8th"): "8분음표",
    _drill_tag_key("16비트"): "16분음표",
    _drill_tag_key("16분음표"): "16분음표",
    _drill_tag_key("16th"): "16분음표",
    _drill_tag_key("트리플렛"): "트리플렛",
    _drill_tag_key("triplet"): "트리플렛",
    _drill_tag_key("싱코페이션"): "싱코페이션",
    _drill_tag_key("syncopation"): "싱코페이션",
    _drill_tag_key("warmup"): "지구력",
    _drill_tag_key("지구력"): "지구력",
    _drill_tag_key("speed"): "스피드",
    _drill_tag_key("스피드"): "스피드",
}


def _deep_copy_json(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False))


def _catalog_slug(value: str, prefix: str, index: int) -> str:
    text = str(value or "").strip()
    normalized = []
    previous_sep = False
    for ch in text:
        if ch.isalnum():
            normalized.append(ch.lower())
            previous_sep = False
            continue
        if previous_sep:
            continue
        normalized.append("_")
        previous_sep = True
    slug = "".join(normalized).strip("_")
    return slug or f"{prefix}_{index}"


def _normalize_catalog_color(raw: Any, fallback: str) -> str:
    token = str(raw or "").strip()
    if len(token) == 7 and token.startswith("#") and all(ch in "0123456789abcdefABCDEF" for ch in token[1:]):
        return token
    return fallback


def _normalize_catalog_active(raw: Any, default: bool = True) -> bool:
    if raw is None:
        return default
    if isinstance(raw, bool):
        return raw
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _normalize_journal_tag_catalog(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        if not label:
            continue
        lowered = label.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        out.append(
            {
                "id": str(item.get("id") or _catalog_slug(label, "tag", index)).strip(),
                "label": label,
                "category": str(item.get("category") or "기타").strip() or "기타",
                "active": _normalize_catalog_active(item.get("active"), True),
                "order": index,
            }
        )
    return out


def _normalize_journal_header_catalog(raw: Any) -> list[dict[str, Any]]:
    source = raw if isinstance(raw, list) and raw else _deep_copy_json(JOURNAL_HEADER_CATALOG_DEFAULTS)
    out: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for index, item in enumerate(source):
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        if not label:
            continue
        entry_id = str(item.get("id") or _catalog_slug(label, "header", index)).strip()
        lowered = entry_id.lower()
        if lowered in seen_ids:
            continue
        seen_ids.add(lowered)
        fallback = JOURNAL_HEADER_CATALOG_DEFAULTS[min(index, len(JOURNAL_HEADER_CATALOG_DEFAULTS) - 1)]
        out.append(
            {
                "id": entry_id,
                "label": label,
                "color": _normalize_catalog_color(item.get("color"), str(fallback.get("color") or "#5c6e7c")),
                "active": _normalize_catalog_active(item.get("active"), True),
                "order": index,
            }
        )
    return out or _deep_copy_json(JOURNAL_HEADER_CATALOG_DEFAULTS)

def _normalize_template_tags(raw: Any) -> list[str]:
    if isinstance(raw, list):
        values = raw
    else:
        values = str(raw or "").replace(",", ";").split(";")
    out: list[str] = []
    seen: set[str] = set()
    for item in values:
        token = str(item or "").strip()
        lowered = token.lower()
        if not token or lowered in seen:
            continue
        seen.add(lowered)
        out.append(token)
    return out


def _normalize_journal_template_catalog(
    raw: Any,
    header_catalog: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    source = raw if isinstance(raw, list) and raw else _deep_copy_json(JOURNAL_TEMPLATE_CATALOG_DEFAULTS)
    header_ids = {str(item.get("id") or "") for item in header_catalog}
    fallback_header = str(header_catalog[0].get("id") or "daily_practice")
    out: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for index, item in enumerate(source):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        entry_id = str(item.get("id") or _catalog_slug(name, "template", index)).strip()
        lowered = entry_id.lower()
        if lowered in seen_ids:
            continue
        seen_ids.add(lowered)
        header_id = str(item.get("header_id") or "").strip()
        if header_id not in header_ids:
            header_id = fallback_header
        source_context = str(item.get("default_source_context") or "practice").strip().lower()
        if source_context not in {"practice", "review", "performance", "archive"}:
            source_context = "practice"
        out.append(
            {
                "id": entry_id,
                "name": name,
                "description": str(item.get("description") or "").strip(),
                "header_id": header_id,
                "default_tags": _normalize_template_tags(item.get("default_tags")),
                "default_source_context": source_context,
                "body_markdown": str(item.get("body_markdown") or ""),
                "active": _normalize_catalog_active(item.get("active"), True),
                "order": index,
            }
        )
    return out or _deep_copy_json(JOURNAL_TEMPLATE_CATALOG_DEFAULTS)


@dataclass
class Paths:
    root: Path
    designpack_data: Path
    runtime_data: Path
    runtime_media: Path
    backups: Path
    exports: Path
    session_state: Path


class Storage:
    def __init__(
        self,
        project_root: Path,
        app_root: Path | None = None,
        seed_data_sources: list[Path] | None = None,
    ) -> None:
        runtime_root = app_root or (project_root / "app")
        default_seed = project_root / "designPack" / "data"
        normalized_sources = [Path(item) for item in (seed_data_sources or [default_seed])]
        self.seed_data_sources = [item for item in normalized_sources if item.exists()]
        if not self.seed_data_sources:
            self.seed_data_sources = [default_seed]
        self.paths = Paths(
            root=project_root,
            designpack_data=self.seed_data_sources[0],
            runtime_data=runtime_root / "data",
            runtime_media=runtime_root / "media",
            backups=runtime_root / "backups",
            exports=runtime_root / "exports",
            session_state=runtime_root / "session_state.json",
        )

    def ensure_directories(self) -> None:
        self.paths.runtime_data.mkdir(parents=True, exist_ok=True)
        (self.paths.runtime_media / "evidence" / "audio").mkdir(parents=True, exist_ok=True)
        (self.paths.runtime_media / "evidence" / "video").mkdir(parents=True, exist_ok=True)
        (self.paths.runtime_media / "evidence" / "image").mkdir(parents=True, exist_ok=True)
        (self.paths.runtime_media / "gallery" / "audio").mkdir(parents=True, exist_ok=True)
        (self.paths.runtime_media / "gallery" / "video").mkdir(parents=True, exist_ok=True)
        (self.paths.runtime_media / "gallery" / "image").mkdir(parents=True, exist_ok=True)
        (self.paths.runtime_media / "records" / "audio").mkdir(parents=True, exist_ok=True)
        (self.paths.runtime_media / "records" / "video").mkdir(parents=True, exist_ok=True)
        (self.paths.runtime_media / "records" / "image").mkdir(parents=True, exist_ok=True)
        self.paths.backups.mkdir(parents=True, exist_ok=True)
        self.paths.exports.mkdir(parents=True, exist_ok=True)

    def seed_runtime_data(self) -> None:
        """Copy designPack data to runtime data on first launch."""
        self.ensure_directories()
        for source_dir in self.seed_data_sources:
            if not source_dir.exists():
                continue
            for src in source_dir.glob("*"):
                if not src.is_file():
                    continue
                dst = self.paths.runtime_data / src.name
                if not dst.exists():
                    shutil.copy2(src, dst)
        events_path = self.paths.runtime_data / "events.csv"
        if not events_path.exists():
            self.write_csv("events.csv", [], headers=EVENT_HEADERS)

    def read_csv(self, filename: str) -> list[dict[str, str]]:
        path = self.paths.runtime_data / filename
        if not path.exists():
            return []
        text = self._read_csv_text(path)
        if not text.strip():
            return []
        reader = csv.DictReader(io.StringIO(text))
        return [dict(row) for row in reader]

    def read_csv_headers(self, filename: str) -> list[str]:
        path = self.paths.runtime_data / filename
        if not path.exists():
            return []
        text = self._read_csv_text(path)
        if not text.strip():
            return []
        reader = csv.reader(io.StringIO(text))
        try:
            return next(reader)
        except StopIteration:
            return []

    def write_csv(self, filename: str, rows: list[dict[str, Any]], headers: list[str] | None = None) -> None:
        path = self.paths.runtime_data / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        if headers is None:
            headers = list(rows[0].keys()) if rows else self.read_csv_headers(filename)
        with path.open("w", newline="", encoding="utf-8-sig") as fh:
            writer = csv.DictWriter(fh, fieldnames=headers)
            writer.writeheader()
            for row in rows:
                normalized = {h: row.get(h, "") for h in headers}
                writer.writerow(normalized)

    def append_csv_row(self, filename: str, row: dict[str, Any], headers: list[str]) -> None:
        path = self.paths.runtime_data / filename
        exists = path.exists()
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", newline="", encoding="utf-8" if exists else "utf-8-sig") as fh:
            writer = csv.DictWriter(fh, fieldnames=headers)
            if not exists:
                writer.writeheader()
            writer.writerow({h: row.get(h, "") for h in headers})

    def _read_csv_text(self, path: Path) -> str:
        raw = path.read_bytes()
        if not raw:
            return ""
        for encoding in ("utf-8-sig", "utf-8", "cp949", "euc-kr"):
            try:
                return raw.decode(encoding)
            except UnicodeDecodeError:
                continue
        return raw.decode("utf-8", errors="replace")

    def read_json(self, filename: str) -> dict[str, Any]:
        path = self.paths.runtime_data / filename
        if not path.exists():
            return {}
        with path.open("r", encoding="utf-8-sig") as fh:
            return json.load(fh)

    def write_json(self, filename: str, payload: dict[str, Any]) -> None:
        path = self.paths.runtime_data / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)

    def read_session_state(self) -> dict[str, Any]:
        if not self.paths.session_state.exists():
            return {}
        with self.paths.session_state.open("r", encoding="utf-8") as fh:
            return json.load(fh)

    def write_session_state(self, state: dict[str, Any]) -> None:
        with self.paths.session_state.open("w", encoding="utf-8") as fh:
            json.dump(state, fh, ensure_ascii=False, indent=2)

    def clear_session_state(self) -> None:
        if self.paths.session_state.exists():
            self.paths.session_state.unlink()

    def reset_progress_only(self) -> None:
        """Reset XP progress while keeping master catalogs and user media."""
        self.write_csv("events.csv", [], headers=EVENT_HEADERS)
        self.clear_session_state()

        quests = self.read_csv("quests.csv")
        if quests:
            for row in quests:
                if (row.get("status") or "").lower() in {"claimed", "expired"}:
                    row["status"] = "Active"
            self.write_csv("quests.csv", quests, headers=self.read_csv_headers("quests.csv"))

    def reset_all_runtime(self) -> None:
        """Reset runtime to first-launch state."""
        if self.paths.runtime_data.exists():
            shutil.rmtree(self.paths.runtime_data, ignore_errors=True)
        if self.paths.runtime_media.exists():
            shutil.rmtree(self.paths.runtime_media, ignore_errors=True)
        if self.paths.backups.exists():
            shutil.rmtree(self.paths.backups, ignore_errors=True)
        if self.paths.exports.exists():
            shutil.rmtree(self.paths.exports, ignore_errors=True)
        if self.paths.session_state.exists():
            self.paths.session_state.unlink(missing_ok=True)
        self.seed_runtime_data()
        self.migrate_files()

    def migrate_files(self) -> None:
        self._migrate_achievements()
        self._migrate_quests()
        self._migrate_settings()
        self._migrate_events_header()
        self._migrate_song_library()
        self._migrate_drill_library()
        self._migrate_backing_tracks()
        self._migrate_records()
        self._normalize_csv_encodings()

    def _migrate_events_header(self) -> None:
        rows = self.read_csv("events.csv")
        self.write_csv("events.csv", rows, headers=EVENT_HEADERS)

    def _migrate_achievements(self) -> None:
        rows = self.read_csv("achievements_master.csv")
        if not rows:
            return
        headers = self.read_csv_headers("achievements_master.csv")
        if not headers:
            headers = ACHIEVEMENT_HEADERS.copy()
        for key in ACHIEVEMENT_HEADERS:
            if key not in headers:
                headers.append(key)
        for extra in ACHIEVEMENT_EXTRA_HEADERS:
            if extra not in headers:
                headers.append(extra)

        for row in rows:
            for key in ACHIEVEMENT_HEADERS:
                row.setdefault(key, "")
            row.setdefault("is_hidden", "false")
            row.setdefault("hint", "")
            row.setdefault("auto_grant", "false" if row.get("rule_type") == "manual" else "true")
            row.setdefault("ui_badge_style", "default")
            row.setdefault("icon_path", "")
            row.setdefault("icon_url", "")

            raw_filter = row.get("rule_filter", "")
            if raw_filter:
                try:
                    parsed = json.loads(raw_filter)
                except json.JSONDecodeError:
                    parsed = {}
                if isinstance(parsed, dict) and str(parsed.get("event_type", "")).upper() == "LONG_GOAL_CLEAR":
                    parsed["event_type"] = "LONG_GOAL_CLEAR"
                    row["rule_filter"] = json.dumps(parsed, ensure_ascii=False)
        self.write_csv("achievements_master.csv", rows, headers=headers)

    def _migrate_quests(self) -> None:
        rows = self.read_csv("quests.csv")
        if not rows:
            return

        def _normalize_period(raw: Any) -> str:
            token = str(raw or "").strip().lower()
            if token in {"short", "mid", "long"}:
                return token
            return "mid"

        def _normalize_difficulty(raw: Any, xp_reward: int) -> str:
            token = str(raw or "").strip().lower()
            if token in {"low", "mid", "high"}:
                return token
            if xp_reward >= 20:
                return "high"
            if xp_reward >= 12:
                return "mid"
            return "low"

        def _normalize_priority(raw: Any) -> str:
            token = str(raw or "").strip().lower()
            if token in {"low", "normal", "urgent"}:
                return token
            return "normal"

        def _to_bool_text(raw: Any) -> str:
            token = str(raw or "").strip().lower()
            if token in {"1", "true", "yes", "on"}:
                return "true"
            return "false"

        def _list_text(raw: Any) -> str:
            if isinstance(raw, list):
                values = [str(item or "").strip() for item in raw]
                return json.dumps([item for item in values if item], ensure_ascii=False)
            text = str(raw or "").strip()
            if not text:
                return "[]"
            if text.startswith("[") and text.endswith("]"):
                try:
                    parsed = json.loads(text)
                except json.JSONDecodeError:
                    parsed = []
                if isinstance(parsed, list):
                    values = [str(item or "").strip() for item in parsed if str(item or "").strip()]
                    return json.dumps(values, ensure_ascii=False)
            values = [item.strip() for item in text.replace(";", ",").split(",") if item.strip()]
            return json.dumps(values, ensure_ascii=False)

        normalized_rows: list[dict[str, str]] = []
        today = date.today().isoformat()
        for row in rows:
            xp_reward = max(0, to_int(row.get("xp_reward"), 0))
            period_class = _normalize_period(row.get("period_class"))
            rule_filter = row.get("rule_filter", "")
            try:
                parsed_filter = json.loads(rule_filter) if str(rule_filter).strip() else {}
            except json.JSONDecodeError:
                parsed_filter = {}
            if not isinstance(parsed_filter, dict):
                parsed_filter = {}
            if str(parsed_filter.get("event_type", "")).upper() == "LONG_GOAL_CLEAR":
                parsed_filter = {
                    "event_type": "LONG_GOAL_CLEAR",
                }
            normalized_rows.append(
                {
                    "quest_id": str(row.get("quest_id") or f"QX_{uuid.uuid4().hex[:8].upper()}"),
                    "title": str(row.get("title") or "퀘스트"),
                    "emoji": str(row.get("emoji") or ""),
                    "description": str(row.get("description") or ""),
                    "status": str(row.get("status") or "Active"),
                    "xp_reward": str(xp_reward),
                    "start_date": str(row.get("start_date") or today),
                    "due_date": str(row.get("due_date") or today),
                    "period_class": period_class,
                    "difficulty": _normalize_difficulty(row.get("difficulty"), xp_reward),
                    "priority": _normalize_priority(row.get("priority")),
                    "auto_generated": _to_bool_text(row.get("auto_generated")),
                    "resolved_at": str(row.get("resolved_at") or ""),
                    "genre_tags": _list_text(row.get("genre_tags")),
                    "linked_song_ids": _list_text(row.get("linked_song_ids")),
                    "linked_drill_ids": _list_text(row.get("linked_drill_ids")),
                    "rule_type": str(row.get("rule_type") or "count_events"),
                    "rule_filter": json.dumps(parsed_filter, ensure_ascii=False),
                    "target": str(max(1, to_int(row.get("target"), 1))),
                    "source": str(row.get("source") or "seed"),
                }
            )
        self.write_csv("quests.csv", normalized_rows, headers=QUEST_HEADERS)

    def _merge_defaults(self, base: dict[str, Any], defaults: dict[str, Any]) -> dict[str, Any]:
        merged: dict[str, Any] = dict(base)
        for key, value in defaults.items():
            if isinstance(value, dict):
                current = merged.get(key)
                if not isinstance(current, dict):
                    merged[key] = value
                else:
                    merged[key] = self._merge_defaults(current, value)
            else:
                merged.setdefault(key, value)
        return merged

    def _normalize_dashboard_layout(
        self, raw: Any, defaults: dict[str, dict[str, Any]]
    ) -> dict[str, dict[str, Any]]:
        source = raw if isinstance(raw, dict) else {}
        out: dict[str, dict[str, Any]] = {}
        for key, fallback in defaults.items():
            row = source.get(key, {})
            if not isinstance(row, dict):
                row = {}
            out[key] = {
                "x": max(1, min(3, to_int(row.get("x"), to_int(fallback.get("x"), 1)))),
                "y": max(1, min(4, to_int(row.get("y"), to_int(fallback.get("y"), 1)))),
                "w": max(1, min(3, to_int(row.get("w"), to_int(fallback.get("w"), 1)))),
                "h": max(1, min(3, to_int(row.get("h"), to_int(fallback.get("h"), 1)))),
                "visible": bool(row.get("visible")) if "visible" in row else bool(fallback.get("visible", True)),
            }
        return out

    def _normalize_layout_snapshot(self, raw: Any) -> dict[str, dict[str, Any]]:
        source = raw if isinstance(raw, dict) else {}
        out: dict[str, dict[str, Any]] = {}
        for key, row in source.items():
            if not isinstance(row, dict):
                continue
            out[str(key)] = {
                "x": to_int(row.get("x"), 0),
                "y": to_int(row.get("y"), 0),
                "w": to_int(row.get("w"), 0),
                "h": to_int(row.get("h"), 0),
                "visible": bool(row.get("visible")),
            }
        return out

    def _is_focus_layout_previous_default(self, layout: Any) -> bool:
        normalized = self._normalize_layout_snapshot(layout)
        for expected_layout in _FOCUS_LAYOUT_PREVIOUS_DEFAULTS:
            if set(normalized.keys()) != set(expected_layout.keys()):
                continue
            matches = True
            for key, expected in expected_layout.items():
                row = normalized.get(key)
                if not isinstance(row, dict):
                    matches = False
                    break
                if row.get("x") != expected["x"]:
                    matches = False
                    break
                if row.get("y") != expected["y"]:
                    matches = False
                    break
                if row.get("w") != expected["w"]:
                    matches = False
                    break
                if row.get("h") != expected["h"]:
                    matches = False
                    break
                if bool(row.get("visible")) != bool(expected["visible"]):
                    matches = False
                    break
            if matches:
                return True
        return False

    def _normalize_keyboard_shortcut_binding(
        self, raw: Any, fallback: dict[str, Any] | None
    ) -> dict[str, Any] | None:
        if not isinstance(raw, dict):
            return dict(fallback) if isinstance(fallback, dict) else None
        code = str(raw.get("code") or "").strip()
        if not code or code in _SHORTCUT_MODIFIER_CODES or code not in _SHORTCUT_SUPPORTED_CODES:
            return dict(fallback) if isinstance(fallback, dict) else None
        return {
            "code": code,
            "ctrl": bool(raw.get("ctrl")),
            "alt": bool(raw.get("alt")),
            "shift": bool(raw.get("shift")),
        }

    def _shortcut_binding_matches(self, raw: Any, expected: dict[str, Any] | None) -> bool:
        if not isinstance(raw, dict) or not isinstance(expected, dict):
            return False
        return (
            str(raw.get("code") or "").strip() == str(expected.get("code") or "").strip()
            and bool(raw.get("ctrl")) == bool(expected.get("ctrl"))
            and bool(raw.get("alt")) == bool(expected.get("alt"))
            and bool(raw.get("shift")) == bool(expected.get("shift"))
        )

    def _normalize_keyboard_shortcuts(self, raw: Any) -> dict[str, Any]:
        default_shortcuts = SETTINGS_DEFAULTS["ui"]["keyboard_shortcuts"]
        default_bindings = default_shortcuts.get("bindings", {})
        source_bindings = raw.get("bindings", {}) if isinstance(raw, dict) else {}
        normalized_bindings: dict[str, Any] = {}
        for action_id, fallback in default_bindings.items():
            normalized_bindings[action_id] = self._normalize_keyboard_shortcut_binding(
                source_bindings.get(action_id),
                fallback if isinstance(fallback, dict) else None,
            )
        return {"bindings": normalized_bindings}

    def normalize_settings(
        self,
        settings: dict[str, Any],
        *,
        source_settings: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        merged = self._merge_defaults(settings, SETTINGS_DEFAULTS)
        source = source_settings if isinstance(source_settings, dict) else settings

        def _apply_level_curve_defaults(level_curve: dict[str, Any], *, overwrite: bool = False) -> None:
            curve_type = str(level_curve.get("type") or LEVEL_BALANCE_V2.get("type", "decade_linear")).strip().lower()
            if overwrite:
                curve_type = str(LEVEL_BALANCE_V2.get("type", "decade_linear")).strip().lower()

            if curve_type == "quadratic":
                level_curve["type"] = "quadratic"
                for key, fallback in (("a", 230.0), ("b", 13.0), ("c", 1.1)):
                    if overwrite or key not in level_curve:
                        level_curve[key] = fallback
            else:
                level_curve["type"] = "decade_linear"
                for key in ("base", "slope", "step_10", "step_20", "step_30", "step_40"):
                    if overwrite or key not in level_curve:
                        level_curve[key] = LEVEL_BALANCE_V2[key]

            if overwrite or "max_level" not in level_curve:
                level_curve["max_level"] = LEVEL_BALANCE_V2.get("max_level", 50)

        merged["policy_version"] = SETTINGS_DEFAULTS["policy_version"]
        merged.setdefault("critical", {}).setdefault("quest_xp_multiplier", SETTINGS_DEFAULTS["critical"]["quest_xp_multiplier"])
        merged.setdefault("critical", {}).setdefault(
            "achievement_xp_multiplier", SETTINGS_DEFAULTS["critical"]["achievement_xp_multiplier"]
        )
        merged.setdefault("critical", {}).setdefault(
            "daily_session_xp_cap", SETTINGS_DEFAULTS["critical"]["daily_session_xp_cap"]
        )
        level_curve = merged.setdefault("level_curve", {})
        _apply_level_curve_defaults(level_curve, overwrite=False)
        merged.setdefault("ui", {}).setdefault("song_genres", SETTINGS_DEFAULTS["ui"]["song_genres"])

        if "xp" in merged:
            merged.setdefault("xp", {}).setdefault("backfill_multiplier", 0.5)
            merged["xp"]["backfill_multiplier"] = float(
                merged["critical"].get("backfill_multiplier_default", merged["xp"]["backfill_multiplier"])
            )
            merged["xp"].setdefault("display_scale", int(XP_BALANCE_V2.get("display_scale", 50)))

        profile = merged.setdefault("profile", {})
        profile.setdefault("guide_finisher_unlocked", False)
        profile.setdefault("quest_settings", dict(SETTINGS_DEFAULTS["profile"]["quest_settings"]))
        quest_settings = profile.get("quest_settings")
        if not isinstance(quest_settings, dict):
            quest_settings = {}
        quest_defaults = SETTINGS_DEFAULTS["profile"]["quest_settings"]
        quest_settings = self._merge_defaults(quest_settings, quest_defaults)
        period_days = quest_settings.get("period_days", {})
        if not isinstance(period_days, dict):
            period_days = {}
        for key in ("short", "mid", "long"):
            try:
                period_days[key] = max(1, int(period_days.get(key, quest_defaults["period_days"][key])))
            except (TypeError, ValueError):
                period_days[key] = int(quest_defaults["period_days"][key])
        quest_settings["period_days"] = period_days

        for key, default_map in (
            ("auto_enabled_by_period", quest_defaults["auto_enabled_by_period"]),
            ("auto_target_minutes_by_period", quest_defaults["auto_target_minutes_by_period"]),
            ("auto_priority_by_period", quest_defaults["auto_priority_by_period"]),
            ("auto_difficulty_by_period", quest_defaults["auto_difficulty_by_period"]),
        ):
            raw_map = quest_settings.get(key)
            if not isinstance(raw_map, dict):
                raw_map = {}
            merged_map: dict[str, Any] = {}
            for period in ("short", "mid", "long"):
                raw_value = raw_map.get(period, default_map[period])
                if key == "auto_enabled_by_period":
                    if isinstance(raw_value, str):
                        merged_map[period] = raw_value.strip().lower() in {"1", "true", "yes", "on"}
                    else:
                        merged_map[period] = bool(raw_value)
                elif key == "auto_target_minutes_by_period":
                    try:
                        merged_map[period] = max(1, int(raw_value))
                    except (TypeError, ValueError):
                        merged_map[period] = int(default_map[period])
                elif key == "auto_priority_by_period":
                    token = str(raw_value or "").strip().lower()
                    merged_map[period] = token if token in {"low", "normal", "urgent"} else default_map[period]
                elif key == "auto_difficulty_by_period":
                    token = str(raw_value or "").strip().lower()
                    merged_map[period] = token if token in {"low", "mid", "high"} else default_map[period]
            quest_settings[key] = merged_map

        ui_style_defaults = quest_defaults.get("ui_style", {})
        raw_ui_style = quest_settings.get("ui_style")
        if not isinstance(raw_ui_style, dict):
            raw_ui_style = {}

        def _normalize_hex(raw: Any, fallback: str) -> str:
            token = str(raw or "").strip()
            if len(token) == 7 and token.startswith("#"):
                if all(ch in "0123456789abcdefABCDEF" for ch in token[1:]):
                    return token
            return fallback

        merged_ui_style: dict[str, Any] = {}
        for key, default_map in (
            ("period_border", ui_style_defaults.get("period_border", {})),
            ("period_fill", ui_style_defaults.get("period_fill", {})),
            ("priority_border", ui_style_defaults.get("priority_border", {})),
            ("difficulty_fill", ui_style_defaults.get("difficulty_fill", {})),
        ):
            raw_map = raw_ui_style.get(key)
            if not isinstance(raw_map, dict):
                raw_map = {}
            merged_map: dict[str, str] = {}
            for tone_key, default_value in default_map.items():
                merged_map[tone_key] = _normalize_hex(raw_map.get(tone_key), str(default_value))
            merged_ui_style[key] = merged_map
        quest_settings["ui_style"] = merged_ui_style
        profile["quest_settings"] = quest_settings
        profile["journal_tag_catalog"] = _normalize_journal_tag_catalog(profile.get("journal_tag_catalog"))
        header_catalog = _normalize_journal_header_catalog(profile.get("journal_header_catalog"))
        profile["journal_header_catalog"] = header_catalog
        profile.pop("journal_status_catalog", None)
        profile["journal_template_catalog"] = _normalize_journal_template_catalog(
            profile.get("journal_template_catalog"),
            header_catalog,
        )

        ui = merged.setdefault("ui", {})
        raw_ui = source.get("ui")
        if not isinstance(raw_ui, dict):
            raw_ui = {}
        ui_defaults = SETTINGS_DEFAULTS["ui"]
        for key in (
            "practice_video_pip_mode",
            "practice_video_tab_switch_playback",
            "notify_level_up",
            "notify_achievement_unlock",
            "notify_quest_complete",
            "fx_achievement_unlock",
            "fx_quest_complete",
            "fx_session_complete_normal",
            "fx_session_complete_quick",
            "fx_claim_achievement",
            "fx_claim_quest",
        ):
            ui.setdefault(key, ui_defaults[key])
        if "fx_level_up_overlay" in raw_ui:
            ui["fx_level_up_overlay"] = bool(raw_ui.get("fx_level_up_overlay"))
        elif "enable_confetti" in raw_ui:
            ui["fx_level_up_overlay"] = bool(raw_ui.get("enable_confetti"))
        else:
            ui["fx_level_up_overlay"] = bool(ui.get("fx_level_up_overlay", ui_defaults["enable_confetti"]))
        ui["fx_level_up_overlay"] = bool(ui.get("fx_level_up_overlay"))
        ui["enable_confetti"] = bool(ui["fx_level_up_overlay"])
        if str(ui.get("practice_video_pip_mode") or "").strip().lower() not in {"mini", "none"}:
            ui["practice_video_pip_mode"] = ui_defaults["practice_video_pip_mode"]
        if str(ui.get("practice_video_tab_switch_playback") or "").strip().lower() not in {"continue", "pause", "pip_only"}:
            ui["practice_video_tab_switch_playback"] = ui_defaults["practice_video_tab_switch_playback"]
        ui["dashboard_layout_legacy"] = self._normalize_dashboard_layout(
            ui.get("dashboard_layout_legacy"), DASHBOARD_LAYOUT_LEGACY_DEFAULT
        )
        ui["dashboard_layout_focus"] = self._normalize_dashboard_layout(
            ui.get("dashboard_layout_focus"), DASHBOARD_LAYOUT_FOCUS_DEFAULT
        )
        focus_layout = ui.get("dashboard_layout_focus")
        if isinstance(focus_layout, dict):
            if self._is_focus_layout_previous_default(focus_layout):
                focus_layout = self._normalize_dashboard_layout({}, DASHBOARD_LAYOUT_FOCUS_DEFAULT)
            next_win = focus_layout.get("nextWin")
            if isinstance(next_win, dict):
                next_win["h"] = 1
                focus_layout["nextWin"] = next_win
            ui["dashboard_layout_focus"] = focus_layout
        dashboard_version = str(ui.get("dashboard_version") or "").strip().lower()
        if dashboard_version not in {"legacy", "focus"}:
            dashboard_version = "legacy" if bool(profile.get("onboarded")) else "focus"
        ui["dashboard_version"] = dashboard_version
        source_keyboard_shortcuts = raw_ui.get("keyboard_shortcuts") if "keyboard_shortcuts" in raw_ui else ui.get("keyboard_shortcuts")
        ui["keyboard_shortcuts"] = self._normalize_keyboard_shortcuts(source_keyboard_shortcuts)
        ui.pop("dashboard_bg_mode", None)
        ui.pop("dashboard_live_motion", None)
        ui.pop("dashboard_layout", None)
        profile.pop("dashboard_photo_fit", None)
        profile.pop("dashboard_todo", None)
        profile.pop("dashboard_todo_items", None)

        tutorial_defaults = SETTINGS_DEFAULTS["profile"]["tutorial_state"]
        tutorial_state = profile.get("tutorial_state")
        if not isinstance(tutorial_state, dict):
            tutorial_state = {}
        for key, default in tutorial_defaults.items():
            if isinstance(default, list):
                existing = tutorial_state.get(key)
                if isinstance(existing, list):
                    tutorial_state[key] = [str(item) for item in existing if str(item)]
                else:
                    tutorial_state[key] = list(default)
            elif isinstance(default, int):
                try:
                    tutorial_state[key] = int(tutorial_state.get(key))
                except (TypeError, ValueError):
                    tutorial_state[key] = default
            else:
                tutorial_state[key] = str(tutorial_state.get(key) or default)
        profile["tutorial_state"] = tutorial_state

        return merged

    def _migrate_settings(self) -> None:
        settings = self.read_json("settings.json")
        source_settings = json.loads(json.dumps(settings, ensure_ascii=False))
        current_version = int(settings.get("policy_version", 1))
        merged = self._merge_defaults(settings, SETTINGS_DEFAULTS)

        def _apply_level_curve_defaults(level_curve: dict[str, Any], *, overwrite: bool = False) -> None:
            curve_type = str(level_curve.get("type") or LEVEL_BALANCE_V2.get("type", "decade_linear")).strip().lower()
            if overwrite:
                curve_type = str(LEVEL_BALANCE_V2.get("type", "decade_linear")).strip().lower()

            if curve_type == "quadratic":
                level_curve["type"] = "quadratic"
                for key, fallback in (("a", 230.0), ("b", 13.0), ("c", 1.1)):
                    if overwrite or key not in level_curve:
                        level_curve[key] = fallback
            else:
                level_curve["type"] = "decade_linear"
                for key in ("base", "slope", "step_10", "step_20", "step_30", "step_40"):
                    if overwrite or key not in level_curve:
                        level_curve[key] = LEVEL_BALANCE_V2[key]

            if overwrite or "max_level" not in level_curve:
                level_curve["max_level"] = LEVEL_BALANCE_V2.get("max_level", 50)

        if current_version < 2:
            xp = merged.setdefault("xp", {})
            xp["session"] = dict(XP_BALANCE_V2["session"])
            xp["bonus"] = dict(XP_BALANCE_V2["bonus"])
            xp["weekly_chest"] = dict(XP_BALANCE_V2["weekly_chest"])
            xp["monthly_long_goal"] = dict(XP_BALANCE_V2["monthly_long_goal"])
            xp["rehearsal_bonus"] = XP_BALANCE_V2["rehearsal_bonus"]
            xp["performance_bonus"] = XP_BALANCE_V2["performance_bonus"]
            xp["backfill_multiplier"] = XP_BALANCE_V2["backfill_multiplier"]
            level_curve = merged.setdefault("level_curve", {})
            _apply_level_curve_defaults(level_curve, overwrite=True)
            merged["policy_version"] = 2
        if current_version < 3 and "xp" in merged:
            xp = merged.setdefault("xp", {})
            xp["session"] = dict(XP_BALANCE_V2["session"])
            xp["bonus"] = dict(XP_BALANCE_V2["bonus"])
            xp["weekly_chest"] = dict(XP_BALANCE_V2["weekly_chest"])
            xp["monthly_long_goal"] = dict(XP_BALANCE_V2["monthly_long_goal"])
            xp["rehearsal_bonus"] = XP_BALANCE_V2["rehearsal_bonus"]
            xp["performance_bonus"] = XP_BALANCE_V2["performance_bonus"]
            xp["backfill_multiplier"] = XP_BALANCE_V2["backfill_multiplier"]
            merged.setdefault("critical", {})["quest_xp_multiplier"] = SETTINGS_DEFAULTS["critical"]["quest_xp_multiplier"]
            merged["policy_version"] = 3
        if current_version < 4 and "xp" in merged:
            level_curve = merged.setdefault("level_curve", {})
            _apply_level_curve_defaults(level_curve, overwrite=True)
            critical = merged.setdefault("critical", {})
            critical["achievement_xp_multiplier"] = SETTINGS_DEFAULTS["critical"]["achievement_xp_multiplier"]
            merged.setdefault("ui", {}).setdefault("song_genres", SETTINGS_DEFAULTS["ui"]["song_genres"])
            merged["policy_version"] = 4
        if current_version < 5 and "xp" in merged:
            xp = merged.setdefault("xp", {})
            xp["session"] = dict(XP_BALANCE_V2["session"])
            xp["bonus"] = dict(XP_BALANCE_V2["bonus"])
            xp["weekly_chest"] = dict(XP_BALANCE_V2["weekly_chest"])
            xp["monthly_long_goal"] = dict(XP_BALANCE_V2["monthly_long_goal"])
            xp["rehearsal_bonus"] = XP_BALANCE_V2["rehearsal_bonus"]
            xp["performance_bonus"] = XP_BALANCE_V2["performance_bonus"]
            xp["backfill_multiplier"] = XP_BALANCE_V2["backfill_multiplier"]
            level_curve = merged.setdefault("level_curve", {})
            _apply_level_curve_defaults(level_curve, overwrite=True)
            critical = merged.setdefault("critical", {})
            critical["daily_session_xp_cap"] = SETTINGS_DEFAULTS["critical"]["daily_session_xp_cap"]
            merged["policy_version"] = 5
        if current_version < 6:
            merged.setdefault("profile", {}).setdefault("guide_finisher_unlocked", False)
            merged.setdefault("profile", {}).setdefault("tutorial_state", dict(SETTINGS_DEFAULTS["profile"]["tutorial_state"]))
            merged["policy_version"] = 6
        if current_version < 7 and "xp" in merged:
            xp = merged.setdefault("xp", {})
            xp["session"] = dict(XP_BALANCE_V2["session"])
            xp["bonus"] = dict(XP_BALANCE_V2["bonus"])
            xp["weekly_chest"] = dict(XP_BALANCE_V2["weekly_chest"])
            xp["monthly_long_goal"] = dict(XP_BALANCE_V2["monthly_long_goal"])
            xp["rehearsal_bonus"] = XP_BALANCE_V2["rehearsal_bonus"]
            xp["performance_bonus"] = XP_BALANCE_V2["performance_bonus"]
            xp["backfill_multiplier"] = XP_BALANCE_V2["backfill_multiplier"]
            level_curve = merged.setdefault("level_curve", {})
            _apply_level_curve_defaults(level_curve, overwrite=True)
            critical = merged.setdefault("critical", {})
            critical["daily_session_xp_cap"] = SETTINGS_DEFAULTS["critical"]["daily_session_xp_cap"]
            merged["policy_version"] = 7
        if current_version < 8 and "xp" in merged:
            xp = merged.setdefault("xp", {})
            xp["session"] = dict(XP_BALANCE_V2["session"])
            xp["bonus"] = dict(XP_BALANCE_V2["bonus"])
            xp["weekly_chest"] = dict(XP_BALANCE_V2["weekly_chest"])
            xp["monthly_long_goal"] = dict(XP_BALANCE_V2["monthly_long_goal"])
            xp["rehearsal_bonus"] = XP_BALANCE_V2["rehearsal_bonus"]
            xp["performance_bonus"] = XP_BALANCE_V2["performance_bonus"]
            xp["backfill_multiplier"] = XP_BALANCE_V2["backfill_multiplier"]
            level_curve = merged.setdefault("level_curve", {})
            _apply_level_curve_defaults(level_curve, overwrite=True)
            critical = merged.setdefault("critical", {})
            critical["daily_session_xp_cap"] = SETTINGS_DEFAULTS["critical"]["daily_session_xp_cap"]
            critical["achievement_xp_multiplier"] = SETTINGS_DEFAULTS["critical"]["achievement_xp_multiplier"]
            critical["quest_xp_multiplier"] = SETTINGS_DEFAULTS["critical"]["quest_xp_multiplier"]
            merged["policy_version"] = 8
        if current_version < 9 and "xp" in merged:
            xp = merged.setdefault("xp", {})
            xp["session"] = dict(XP_BALANCE_V2["session"])
            xp["bonus"] = dict(XP_BALANCE_V2["bonus"])
            xp["weekly_chest"] = dict(XP_BALANCE_V2["weekly_chest"])
            xp["monthly_long_goal"] = dict(XP_BALANCE_V2["monthly_long_goal"])
            xp["rehearsal_bonus"] = XP_BALANCE_V2["rehearsal_bonus"]
            xp["performance_bonus"] = XP_BALANCE_V2["performance_bonus"]
            xp["backfill_multiplier"] = XP_BALANCE_V2["backfill_multiplier"]
            level_curve = merged.setdefault("level_curve", {})
            _apply_level_curve_defaults(level_curve, overwrite=True)
            critical = merged.setdefault("critical", {})
            critical["daily_session_xp_cap"] = SETTINGS_DEFAULTS["critical"]["daily_session_xp_cap"]
            critical["achievement_xp_multiplier"] = SETTINGS_DEFAULTS["critical"]["achievement_xp_multiplier"]
            critical["quest_xp_multiplier"] = SETTINGS_DEFAULTS["critical"]["quest_xp_multiplier"]
            merged["policy_version"] = 9
        if current_version < 10:
            profile = merged.setdefault("profile", {})
            quest_defaults = SETTINGS_DEFAULTS["profile"]["quest_settings"]
            existing = profile.get("quest_settings")
            if not isinstance(existing, dict):
                existing = {}
            merged_qs = self._merge_defaults(existing, quest_defaults)
            profile["quest_settings"] = merged_qs
            merged["policy_version"] = 10
        if current_version < 11:
            profile = merged.setdefault("profile", {})
            ui = merged.setdefault("ui", {})
            raw_ui = settings.get("ui")
            if not isinstance(raw_ui, dict):
                raw_ui = {}

            legacy_source = ui.get("dashboard_layout")
            if not isinstance(legacy_source, dict):
                legacy_source = ui.get("dashboard_layout_legacy")
            ui["dashboard_layout_legacy"] = self._normalize_dashboard_layout(
                legacy_source, DASHBOARD_LAYOUT_LEGACY_DEFAULT
            )
            ui["dashboard_layout_focus"] = self._normalize_dashboard_layout(
                ui.get("dashboard_layout_focus"), DASHBOARD_LAYOUT_FOCUS_DEFAULT
            )
            focus_layout = ui.get("dashboard_layout_focus")
            if isinstance(focus_layout, dict):
                if self._is_focus_layout_previous_default(focus_layout):
                    focus_layout = self._normalize_dashboard_layout({}, DASHBOARD_LAYOUT_FOCUS_DEFAULT)
                next_win = focus_layout.get("nextWin")
                if isinstance(next_win, dict):
                    next_win["h"] = 1
                    focus_layout["nextWin"] = next_win
                ui["dashboard_layout_focus"] = focus_layout
            onboarded = bool(profile.get("onboarded"))
            dashboard_version = str(raw_ui.get("dashboard_version") or "").strip().lower()
            if dashboard_version not in {"legacy", "focus"}:
                dashboard_version = "legacy" if onboarded else "focus"
            ui["dashboard_version"] = dashboard_version

            for key in ("dashboard_bg_mode", "dashboard_live_motion", "dashboard_layout"):
                ui.pop(key, None)
            for key in ("dashboard_photo_fit", "dashboard_todo", "dashboard_todo_items"):
                profile.pop(key, None)
            merged["policy_version"] = 11

        if current_version < 12:
            critical = merged.setdefault("critical", {})
            critical["daily_session_xp_cap"] = SETTINGS_DEFAULTS["critical"]["daily_session_xp_cap"]
            critical["quest_xp_multiplier"] = SETTINGS_DEFAULTS["critical"]["quest_xp_multiplier"]
            xp = merged.setdefault("xp", {})
            xp["session"] = dict(XP_BALANCE_V2["session"])
            xp["display_scale"] = int(XP_BALANCE_V2.get("display_scale", 50))
            level_curve = merged.setdefault("level_curve", {})
            _apply_level_curve_defaults(level_curve, overwrite=True)
            merged["policy_version"] = 12

        if current_version < 13:
            xp = merged.setdefault("xp", {})
            xp["display_scale"] = int(XP_BALANCE_V2.get("display_scale", 50))
            level_curve = merged.setdefault("level_curve", {})
            _apply_level_curve_defaults(level_curve, overwrite=True)
            merged["policy_version"] = 13

        if current_version < 14:
            merged["policy_version"] = 14

        if current_version < 15:
            ui = merged.setdefault("ui", {})
            shortcuts = ui.get("keyboard_shortcuts")
            if isinstance(shortcuts, dict):
                bindings = shortcuts.get("bindings")
                if isinstance(bindings, dict):
                    source_ui = source_settings.setdefault("ui", {})
                    if not isinstance(source_ui, dict):
                        source_ui = {}
                        source_settings["ui"] = source_ui
                    source_shortcuts = source_ui.setdefault("keyboard_shortcuts", {})
                    if not isinstance(source_shortcuts, dict):
                        source_shortcuts = {}
                        source_ui["keyboard_shortcuts"] = source_shortcuts
                    source_bindings = source_shortcuts.setdefault("bindings", {})
                    if not isinstance(source_bindings, dict):
                        source_bindings = {}
                        source_shortcuts["bindings"] = source_bindings
                    default_bindings = SETTINGS_DEFAULTS["ui"]["keyboard_shortcuts"]["bindings"]
                    for action_id, previous_default in _PREVIOUS_PIN_SHORTCUT_DEFAULTS.items():
                        current_binding = source_bindings.get(action_id, bindings.get(action_id))
                        if self._shortcut_binding_matches(current_binding, previous_default):
                            next_binding = default_bindings.get(action_id)
                            bindings[action_id] = dict(next_binding) if isinstance(next_binding, dict) else next_binding
                            source_bindings[action_id] = dict(next_binding) if isinstance(next_binding, dict) else next_binding
            merged["policy_version"] = 15

        if current_version < 16:
            ui = merged.setdefault("ui", {})
            shortcuts = ui.get("keyboard_shortcuts")
            if isinstance(shortcuts, dict):
                bindings = shortcuts.get("bindings")
                if isinstance(bindings, dict):
                    source_ui = source_settings.setdefault("ui", {})
                    if not isinstance(source_ui, dict):
                        source_ui = {}
                        source_settings["ui"] = source_ui
                    source_shortcuts = source_ui.setdefault("keyboard_shortcuts", {})
                    if not isinstance(source_shortcuts, dict):
                        source_shortcuts = {}
                        source_ui["keyboard_shortcuts"] = source_shortcuts
                    source_bindings = source_shortcuts.setdefault("bindings", {})
                    if not isinstance(source_bindings, dict):
                        source_bindings = {}
                        source_shortcuts["bindings"] = source_bindings
                    current_binding = source_bindings.get("video_pin_jump", bindings.get("video_pin_jump"))
                    if self._shortcut_binding_matches(current_binding, _PREVIOUS_PIN_JUMP_SHORTCUT_DEFAULT):
                        next_binding = SETTINGS_DEFAULTS["ui"]["keyboard_shortcuts"]["bindings"].get("video_pin_jump")
                        bindings["video_pin_jump"] = dict(next_binding) if isinstance(next_binding, dict) else next_binding
                        source_bindings["video_pin_jump"] = dict(next_binding) if isinstance(next_binding, dict) else next_binding
            merged["policy_version"] = 16

        if current_version < 17:
            profile = merged.setdefault("profile", {})
            profile.setdefault("journal_tag_catalog", [])
            profile.setdefault("journal_header_catalog", _deep_copy_json(JOURNAL_HEADER_CATALOG_DEFAULTS))
            profile.setdefault("journal_template_catalog", _deep_copy_json(JOURNAL_TEMPLATE_CATALOG_DEFAULTS))
            merged["policy_version"] = 17

        merged = self.normalize_settings(merged, source_settings=source_settings)

        self.write_json("settings.json", merged)

    def _normalize_drill_tag(self, raw: str | None) -> str:
        token = str(raw or "").strip()
        if not token:
            return ""
        if token in _DRILL_TAG_CANONICAL_SET:
            return token
        mapped = _DRILL_TAG_ALIAS.get(_drill_tag_key(token), "")
        if mapped in _DRILL_TAG_CANONICAL_SET:
            return mapped
        return ""

    def _normalize_drill_tags_csv(self, raw: str | None) -> str:
        raw_text = str(raw or "")
        tokens = [
            self._normalize_drill_tag(item)
            for item in raw_text.replace("|", ";").replace(",", ";").split(";")
        ]
        return self._join_list([item for item in tokens if item])

    def _migrate_drill_library(self) -> None:
        drill_lib = self.paths.runtime_data / "drill_library.csv"
        if drill_lib.exists():
            rows = self.read_csv("drill_library.csv")
            for row in rows:
                for key in DRILL_LIBRARY_HEADERS:
                    row.setdefault(key, "")
                if not row.get("image_paths") and row.get("image_path"):
                    row["image_paths"] = str(row.get("image_path", "")).strip()
                row["tags"] = self._normalize_drill_tags_csv(row.get("tags", ""))
            self.write_csv("drill_library.csv", rows, headers=DRILL_LIBRARY_HEADERS)
            return

        catalog = self.read_csv("drill_catalog.csv")
        if not catalog:
            self.write_csv("drill_library.csv", [], headers=DRILL_LIBRARY_HEADERS)
            return
        rows: list[dict[str, Any]] = []
        for item in catalog:
            rows.append(
                {
                    "drill_id": item.get("drill_id", ""),
                    "name": item.get("name", ""),
                    "description": item.get("description", ""),
                    "area": item.get("area", ""),
                    "favorite": "false",
                    "tags": self._normalize_drill_tags_csv(item.get("tags", "")),
                    "bpm_min": "",
                    "bpm_max": "",
                    "bpm_step": "5",
                    "default_backing_id": "",
                    "image_path": "",
                    "image_paths": "",
                    "image_url": "",
                    "resource": item.get("resource", ""),
                    "notes": "",
                    "created_at": "",
                    "last_used_at": "",
                }
            )
        self.write_csv("drill_library.csv", rows, headers=DRILL_LIBRARY_HEADERS)

    def _migrate_song_library(self) -> None:
        rows = self.read_csv("song_library.csv")
        headers = self.read_csv_headers("song_library.csv")
        if not headers:
            return
        for row in rows:
            for key in SONG_LIBRARY_HEADERS:
                row.setdefault(key, "")
        self.write_csv("song_library.csv", rows, headers=SONG_LIBRARY_HEADERS)

    def _migrate_backing_tracks(self) -> None:
        rows = self.read_csv("backing_tracks.csv")
        headers = self.read_csv_headers("backing_tracks.csv")
        if not headers:
            self.write_csv("backing_tracks.csv", [], headers=BACKING_TRACK_HEADERS)
            return
        for row in rows:
            for key in BACKING_TRACK_HEADERS:
                row.setdefault(key, "")
        self.write_csv("backing_tracks.csv", rows, headers=BACKING_TRACK_HEADERS)

    def _split_list(self, raw: str | None) -> list[str]:
        if not raw:
            return []
        items = [item.strip() for item in str(raw).split(";")]
        return [item for item in items if item]

    def _join_list(self, values: list[str]) -> str:
        seen: set[str] = set()
        ordered: list[str] = []
        for value in values:
            token = str(value).strip()
            if not token or token in seen:
                continue
            seen.add(token)
            ordered.append(token)
        return ";".join(ordered)

    def _infer_media_type(self, evidence_type: str, path: str, url: str) -> str:
        normalized = (evidence_type or "").lower().strip()
        if normalized in {"image", "video", "audio"}:
            return normalized

        ref = (path or url or "").lower()
        if any(ref.endswith(ext) for ext in [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]):
            return "image"
        if any(ref.endswith(ext) for ext in [".mp4", ".mov", ".webm", ".avi", ".mkv"]):
            return "video"
        if any(ref.endswith(ext) for ext in [".mp3", ".wav", ".ogg", ".m4a", ".flac"]):
            return "audio"
        return "image"

    def _sanitize_legacy_tags(self, raw_tags: str, media_type: str) -> list[str]:
        blocked_exact = {
            "GALLERY",
            "MEDIA_UPLOAD",
            "SONG_MEDIA",
            "DRILL_MEDIA",
            "IMAGE",
            "VIDEO",
            "AUDIO",
            media_type.upper(),
        }
        out: list[str] = []
        for token in self._split_list(raw_tags):
            normalized = token.upper()
            if normalized in blocked_exact:
                continue
            if normalized.startswith("SONG_") or normalized.startswith("DRILL_"):
                continue
            out.append(token)
        return out

    def _migrate_records(self) -> None:
        post_headers = self.read_csv_headers("record_posts.csv")
        att_headers = self.read_csv_headers("record_attachments.csv")
        comment_headers = self.read_csv_headers("record_comments.csv")
        posts = self.read_csv("record_posts.csv")
        attachments = self.read_csv("record_attachments.csv")
        comments = self.read_csv("record_comments.csv")
        if post_headers != RECORD_POST_HEADERS:
            self.write_csv("record_posts.csv", posts, headers=RECORD_POST_HEADERS)
            posts = self.read_csv("record_posts.csv")
        if att_headers != RECORD_ATTACHMENT_HEADERS:
            self.write_csv("record_attachments.csv", attachments, headers=RECORD_ATTACHMENT_HEADERS)
            attachments = self.read_csv("record_attachments.csv")
        if comment_headers != RECORD_COMMENT_HEADERS:
            self.write_csv("record_comments.csv", comments, headers=RECORD_COMMENT_HEADERS)
            comments = self.read_csv("record_comments.csv")

        settings = self.read_json("settings.json")
        profile = settings.setdefault("profile", {})
        header_catalog = _normalize_journal_header_catalog(profile.get("journal_header_catalog"))
        header_ids = {str(item.get("id") or "") for item in header_catalog}
        header_labels = {str(item.get("label") or "").strip().lower(): str(item.get("id") or "") for item in header_catalog}
        catalog_changed = False

        def ensure_header(label: str, preferred_id: str = "") -> str:
            nonlocal catalog_changed
            normalized_label = str(label or "").strip() or "자유기록"
            lowered = normalized_label.lower()
            if preferred_id and preferred_id in header_ids:
                header_labels[lowered] = preferred_id
                return preferred_id
            if lowered in header_labels:
                return header_labels[lowered]
            entry_id = str(preferred_id or _catalog_slug(normalized_label, "header", len(header_catalog))).strip()
            base_id = entry_id
            suffix = 1
            while entry_id in header_ids:
                suffix += 1
                entry_id = f"{base_id}_{suffix}"
            header_catalog.append(
                {
                    "id": entry_id,
                    "label": normalized_label,
                    "color": "#5c6e7c",
                    "active": True,
                    "order": len(header_catalog),
                }
            )
            header_ids.add(entry_id)
            header_labels[lowered] = entry_id
            catalog_changed = True
            return entry_id

        post_rows_changed = False
        for row in posts:
            label = str(row.get("post_type") or "").strip() or "자유기록"
            if row.get("post_type") != label:
                row["post_type"] = label
                post_rows_changed = True
            current_header_id = str(row.get("header_id") or "").strip()
            resolved_header_id = ensure_header(label, current_header_id)
            if row.get("header_id") != resolved_header_id:
                row["header_id"] = resolved_header_id
                post_rows_changed = True
            template_id = str(row.get("template_id") or "").strip()
            if row.get("template_id") != template_id:
                row["template_id"] = template_id
                post_rows_changed = True
            raw_meta = str(row.get("meta_json") or "").strip()
            next_meta = "{}"
            if raw_meta:
                try:
                    decoded_meta = json.loads(raw_meta)
                    if isinstance(decoded_meta, dict):
                        next_meta = json.dumps(decoded_meta, ensure_ascii=False)
                except json.JSONDecodeError:
                    next_meta = "{}"
            if row.get("meta_json") != next_meta:
                row["meta_json"] = next_meta
                post_rows_changed = True

        events = self.read_csv("events.csv")
        changed = post_rows_changed
        if events:
            existing_legacy_ids = {row.get("legacy_event_id", "") for row in posts if row.get("legacy_event_id")}
            for event in events:
                event_id = event.get("event_id", "")
                if not event_id or event_id in existing_legacy_ids:
                    continue
                event_type = (event.get("event_type") or "").upper()
                has_media = bool(event.get("evidence_path") or event.get("evidence_url"))
                if event_type not in {"GALLERY_UPLOAD", "SESSION"}:
                    continue
                if not has_media:
                    continue

                meta = {}
                raw_meta = event.get("meta_json") or ""
                if raw_meta:
                    try:
                        decoded = json.loads(raw_meta)
                        if isinstance(decoded, dict):
                            meta = decoded
                    except json.JSONDecodeError:
                        meta = {}

                media_type = self._infer_media_type(
                    event.get("evidence_type", ""),
                    event.get("evidence_path", ""),
                    event.get("evidence_url", ""),
                )
                manual_tags = [str(item).strip() for item in meta.get("manual_tags", []) if str(item).strip()]
                tags = manual_tags + self._sanitize_legacy_tags(event.get("tags", ""), media_type)
                post_type = "영상회고" if media_type == "video" else "일일연습"
                header_id = ensure_header(post_type)
                created_at = event.get("created_at", "")
                post_id = f"POST_{uuid.uuid4().hex[:12]}"

                posts.append(
                    {
                        "post_id": post_id,
                        "created_at": created_at,
                        "updated_at": created_at,
                        "title": event.get("title", "") or post_type,
                        "body": event.get("notes", ""),
                        "post_type": post_type,
                        "header_id": header_id,
                        "template_id": "",
                        "meta_json": "{}",
                        "tags": self._join_list(tags),
                        "linked_song_ids": self._join_list([event.get("song_library_id", "")]),
                        "linked_drill_ids": self._join_list([event.get("drill_id", "")]),
                        "free_targets": "",
                        "source_context": str(meta.get("source_context", "") or event.get("activity", "")),
                        "legacy_event_id": event_id,
                        "source": "migration",
                    }
                )
                attachments.append(
                    {
                        "attachment_id": f"ATT_{uuid.uuid4().hex[:12]}",
                        "post_id": post_id,
                        "created_at": created_at,
                        "media_type": media_type,
                        "path": event.get("evidence_path", ""),
                        "url": event.get("evidence_url", ""),
                        "title": event.get("title", ""),
                        "notes": event.get("notes", ""),
                        "sort_order": "1",
                    }
                )
                existing_legacy_ids.add(event_id)
                changed = True

        if catalog_changed:
            profile["journal_header_catalog"] = header_catalog
            self.write_json("settings.json", self.normalize_settings(settings, source_settings=settings))
        if changed:
            self.write_csv("record_posts.csv", posts, headers=RECORD_POST_HEADERS)
        self.write_csv("record_attachments.csv", attachments, headers=RECORD_ATTACHMENT_HEADERS)
        self.write_csv("record_comments.csv", comments, headers=RECORD_COMMENT_HEADERS)

    def _normalize_csv_encodings(self) -> None:
        for path in sorted(self.paths.runtime_data.glob("*.csv"), key=lambda item: item.name.lower()):
            if not path.is_file():
                continue
            raw = path.read_bytes()
            if not raw:
                continue
            if raw.startswith(b"\xef\xbb\xbf"):
                continue
            headers = self.read_csv_headers(path.name)
            rows = self.read_csv(path.name)
            if headers:
                self.write_csv(path.name, rows, headers=headers)

    def save_uploaded_file(self, source_path: Path, media_kind: str) -> str:
        ext = source_path.suffix.lower()
        if media_kind == "video":
            safe_kind = "video"
        elif media_kind == "image":
            safe_kind = "image"
        else:
            safe_kind = "audio"
        dest_dir = self.paths.runtime_media / "evidence" / safe_kind
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_name = f"{uuid.uuid4().hex}{ext}"
        dest = dest_dir / dest_name
        shutil.copy2(source_path, dest)
        return f"evidence/{safe_kind}/{dest_name}"
