"""Runtime profile manager for real/mock data switching."""

from __future__ import annotations

import csv
import json
import random
import re
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from bassos.constants import ACHIEVEMENT_HEADERS, EVENT_HEADERS
from bassos.services.backups import maybe_create_backup
from bassos.services.data_bootstrap import ensure_bootstrap_data, initialize_quest_templates
from bassos.services.events import create_event_row
from bassos.services.storage import Storage
from bassos.utils.time_utils import now_local


def _to_iso(ts: float) -> str:
    return datetime.fromtimestamp(ts).isoformat(timespec="seconds")


class RuntimeProfileManager:
    def __init__(self, project_root: Path, real_storage: Storage) -> None:
        self.project_root = project_root
        self.real_storage = real_storage
        self.active_profile = "real"
        self.active_dataset_id = ""

    @property
    def datasets_root(self) -> Path:
        return self.project_root / "designPack" / "mock_datasets"

    @property
    def mock_runtime_root(self) -> Path:
        return self.project_root / "app" / "profiles" / "mock"

    def _dataset_dir(self, dataset_id: str) -> Path:
        return self.datasets_root / dataset_id

    def _dataset_data_dir(self, dataset_id: str) -> Path:
        dataset_dir = self._dataset_dir(dataset_id)
        preferred = dataset_dir / "data"
        if preferred.exists() and self._list_csv_files(preferred):
            return preferred
        if self._list_csv_files(dataset_dir):
            return dataset_dir
        return preferred if preferred.exists() else dataset_dir

    def _sanitize_dataset_id(self, dataset_id: str) -> str:
        candidate = str(dataset_id or "").strip().lower().replace(" ", "_")
        if not candidate:
            raise ValueError("dataset_id is required")
        if not re.fullmatch(r"[a-z0-9_-]{3,64}", candidate):
            raise ValueError("dataset_id must match [a-z0-9_-]{3,64}")
        return candidate

    def _list_csv_files(self, directory: Path) -> list[Path]:
        if not directory.exists() or not directory.is_dir():
            return []
        return sorted(
            [item for item in directory.iterdir() if item.is_file() and item.suffix.lower() == ".csv"],
            key=lambda item: item.name.lower(),
        )

    def _write_dataset_csv(self, path: Path, rows: list[dict[str, str]], headers: list[str]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="", encoding="utf-8-sig") as fh:
            writer = csv.DictWriter(fh, fieldnames=headers)
            writer.writeheader()
            for row in rows:
                writer.writerow({header: row.get(header, "") for header in headers})

    def _read_text_with_fallback(self, path: Path) -> str:
        raw = path.read_bytes()
        if not raw:
            return ""
        for encoding in ("utf-8-sig", "utf-8", "cp949", "euc-kr"):
            try:
                return raw.decode(encoding)
            except UnicodeDecodeError:
                continue
        return raw.decode("utf-8", errors="replace")

    def _normalize_relative_media_path(self, raw: Any) -> str:
        token = str(raw or "").strip().replace("\\", "/")
        if not token:
            return ""
        path = Path(token)
        if path.is_absolute() or ".." in path.parts:
            return ""
        return path.as_posix()

    def _add_media_value(self, raw: Any, out: set[str]) -> None:
        if isinstance(raw, list):
            for item in raw:
                self._add_media_value(item, out)
            return
        text = str(raw or "").strip()
        if not text:
            return
        for chunk in text.replace("\n", ";").split(";"):
            rel = self._normalize_relative_media_path(chunk)
            if rel:
                out.add(rel)

    def _collect_meta_media_paths(self, raw: Any, out: set[str]) -> None:
        if isinstance(raw, dict):
            for key, value in raw.items():
                lowered = str(key or "").strip().lower()
                if lowered == "path" or lowered.endswith("_path") or lowered.endswith("_paths"):
                    self._add_media_value(value, out)
                self._collect_meta_media_paths(value, out)
            return
        if isinstance(raw, list):
            for item in raw:
                self._collect_meta_media_paths(item, out)

    def _collect_export_media_paths(self, storage: Storage) -> list[str]:
        out: set[str] = set()

        for row in storage.read_csv("song_library.csv"):
            self._add_media_value(row.get("cover_path"), out)
            self._add_media_value(row.get("score_pdf_path"), out)
            self._add_media_value(row.get("score_image_paths"), out)
            self._add_media_value(row.get("best_take_path"), out)

        for row in storage.read_csv("drill_library.csv"):
            self._add_media_value(row.get("image_path"), out)
            self._add_media_value(row.get("image_paths"), out)

        for row in storage.read_csv("events.csv"):
            self._add_media_value(row.get("evidence_path"), out)
            raw_meta = str(row.get("meta_json") or "").strip()
            if raw_meta:
                try:
                    parsed_meta = json.loads(raw_meta)
                except json.JSONDecodeError:
                    parsed_meta = {}
                self._collect_meta_media_paths(parsed_meta, out)

        for row in storage.read_csv("record_attachments.csv"):
            self._add_media_value(row.get("path"), out)

        for row in storage.read_csv("achievements_master.csv"):
            self._add_media_value(row.get("icon_path"), out)

        return sorted(out)

    def _to_int(self, value: str | int | float, default: int = 0) -> int:
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return default

    def _choose_song_sub_activity(self, rng: random.Random) -> str:
        roll = rng.random()
        if roll < 0.62:
            return "SongPractice"
        if roll < 0.84:
            return "SongLearn"
        return "SongCopy"

    def _choose_drill_sub_activity(self, rng: random.Random, area: str) -> str:
        area_text = (area or "").strip().lower()
        if "slap" in area_text:
            return "Slap"
        if "theory" in area_text or "이론" in area_text:
            return "Theory"
        if "funk" in area_text or "jazz" in area_text or "펑크" in area_text:
            return "Funk"
        roll = rng.random()
        if roll < 0.62:
            return "Core"
        if roll < 0.77:
            return "Funk"
        if roll < 0.89:
            return "Theory"
        return "Slap"

    def _sub_tag(self, sub_activity: str) -> str:
        mapping = {
            "SongPractice": "SONG_PRACTICE",
            "SongLearn": "SONG_LEARN",
            "SongCopy": "SONG_COPY",
            "Core": "CORE",
            "Funk": "FUNK",
            "Slap": "SLAP",
            "Theory": "THEORY",
            "Etc": "ETC",
        }
        return mapping.get(sub_activity, sub_activity.upper())

    def _generate_two_month_sessions(self, storage: Storage, days: int = 60) -> list[dict[str, str]]:
        span_days = max(14, min(90, int(days)))
        songs = [
            {
                "library_id": str(row.get("library_id") or ""),
                "title": str(row.get("title") or "").strip(),
                "genre": str(row.get("genre") or "").strip(),
            }
            for row in storage.read_csv("song_library.csv")
            if str(row.get("library_id") or "").strip()
        ]
        drills = [
            {
                "drill_id": str(row.get("drill_id") or ""),
                "name": str(row.get("name") or "").strip(),
                "area": str(row.get("area") or "").strip(),
            }
            for row in storage.read_csv("drill_library.csv")
            if str(row.get("drill_id") or "").strip()
        ]
        backings = [
            {
                "backing_id": str(row.get("backing_id") or ""),
                "title": str(row.get("title") or "").strip(),
                "genre": str(row.get("genre") or "").strip(),
                "drill_id": str(row.get("drill_id") or "").strip(),
                "bpm": self._to_int(row.get("bpm"), 100),
            }
            for row in storage.read_csv("backing_tracks.csv")
            if str(row.get("backing_id") or "").strip()
        ]

        seed = 20260301 + span_days + len(songs) * 31 + len(drills) * 19 + len(backings) * 11
        rng = random.Random(seed)
        base_day = (now_local() - timedelta(days=span_days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
        feelings_pool = ["집중됨", "탄력있음", "손풀림", "차분함", "재도전"]

        rows: list[dict[str, str]] = []
        for day_index in range(span_days):
            day = base_day + timedelta(days=day_index)
            weekend = day.weekday() >= 5
            force_day = day_index in {0, span_days // 2, span_days - 1}
            active_probability = 0.78 if not weekend else 0.66
            if not force_day and rng.random() > active_probability:
                continue

            sessions_today = 1
            if rng.random() < 0.44:
                sessions_today += 1
            if rng.random() < 0.14:
                sessions_today += 1

            for _ in range(sessions_today):
                start_hour = rng.randint(19, 22)
                if weekend and rng.random() < 0.2:
                    start_hour = rng.randint(14, 18)
                start_minute = rng.choice([0, 10, 20, 30, 40, 50])
                start = day.replace(hour=start_hour, minute=start_minute)

                if songs and drills:
                    activity = "Song" if rng.random() < 0.58 else "Drill"
                elif songs:
                    activity = "Song"
                elif drills:
                    activity = "Drill"
                else:
                    activity = "Etc"

                song = rng.choice(songs) if activity == "Song" and songs else None
                drill = rng.choice(drills) if activity == "Drill" and drills else None
                sub_activity = (
                    self._choose_song_sub_activity(rng)
                    if activity == "Song"
                    else self._choose_drill_sub_activity(rng, drill["area"] if drill else "")
                    if activity == "Drill"
                    else "Etc"
                )

                duration = (
                    max(14, int(round(rng.triangular(20, 56, 33))))
                    if activity == "Song"
                    else max(12, int(round(rng.triangular(14, 46, 27))))
                )
                end = start + timedelta(minutes=duration)

                backing_candidates = []
                if drill:
                    backing_candidates = [item for item in backings if item["drill_id"] and item["drill_id"] == drill["drill_id"]]
                if not backing_candidates and song:
                    song_genre = song["genre"].lower()
                    backing_candidates = [
                        item for item in backings if item["genre"] and item["genre"].lower() and item["genre"].lower() in song_genre
                    ]
                if not backing_candidates:
                    backing_candidates = backings
                backing = rng.choice(backing_candidates) if backing_candidates and rng.random() < 0.46 else None

                tags = ["SESSION", "MOCK", "EXPORT", activity.upper(), self._sub_tag(sub_activity)]
                bonus_xp = 0

                if backing:
                    tags.append("BACKING")
                if rng.random() < 0.42:
                    tags.append("METRO_24")
                    bonus_xp += 8
                if rng.random() < 0.16:
                    tags.append("METRO_ONEBAR")
                    bonus_xp += 16
                if activity == "Song" and rng.random() < 0.14:
                    tags.append("AB_COMPARE")
                    bonus_xp += 18
                if activity == "Drill" and rng.random() < 0.18:
                    tags.append("CLEAN_MUTE")
                    bonus_xp += 10
                if activity == "Song" and rng.random() < 0.07:
                    tags.append("RECORDING_AUDIO")
                    bonus_xp += 20

                base_xp = min(120, 24 + 16 * (duration // 10))
                xp = max(40, min(260, base_xp + bonus_xp + rng.randint(-6, 10)))

                song_id = song["library_id"] if song else ""
                drill_id = drill["drill_id"] if drill else ""
                song_title = song["title"] if song and song["title"] else song_id
                drill_name = drill["name"] if drill and drill["name"] else drill_id
                focus_label = song_title if song_id else drill_name if drill_id else "자유 연습"
                title = f"세션 · {('곡 연습' if activity == 'Song' else '드릴' if activity == 'Drill' else '자유')} · {focus_label}"

                notes_parts = []
                if backing:
                    notes_parts.append(f"백킹: {backing['title'] or backing['backing_id']}")
                if activity == "Song":
                    notes_parts.append("구간 반복 + 연결 안정화")
                elif activity == "Drill":
                    notes_parts.append("정확도 우선, 속도는 마지막 10분")
                notes = " / ".join(notes_parts) if notes_parts else "루틴 유지"

                meta = {
                    "sub_activity": sub_activity,
                    "is_backfill": False,
                    "is_quick_log": False,
                    "feelings": [rng.choice(feelings_pool)],
                    "xp_breakdown": {
                        "base_xp": base_xp,
                        "bonus_xp": bonus_xp,
                        "bonus_breakdown": {},
                        "pre_cap_total_xp": xp,
                        "daily_cap_reduced": 0,
                    },
                    "song_speed": {"mode": "single", "single": rng.choice([75, 80, 85, 90, 95, 100])} if activity == "Song" else {},
                    "drill_bpm": {"mode": "single", "single": backing["bpm"] if backing else rng.choice([80, 90, 100, 110])}
                    if activity == "Drill"
                    else {},
                }
                if backing:
                    meta["backing_id"] = backing["backing_id"]

                rows.append(
                    create_event_row(
                        created_at=end,
                        start_at=start,
                        end_at=end,
                        duration_min=duration,
                        event_type="SESSION",
                        activity=activity,
                        xp=xp,
                        title=title,
                        notes=notes,
                        song_library_id=song_id,
                        drill_id=drill_id,
                        tags=sorted(set(tags)),
                        meta=meta,
                        source="mock-export",
                    )
                )

        rows.sort(key=lambda item: item.get("created_at", ""))
        return rows

    def _build_mock_storage(self, dataset_id: str, reset: bool) -> Storage:
        dataset_dir = self._dataset_dir(dataset_id)
        if not dataset_dir.exists() or not dataset_dir.is_dir():
            raise ValueError(f"Mock dataset not found: {dataset_id}")

        data_dir = self._dataset_data_dir(dataset_id)
        if not self._list_csv_files(data_dir):
            raise ValueError(f"Mock dataset has no CSV files: {dataset_id}")

        runtime_root = self.mock_runtime_root / dataset_id
        if reset and runtime_root.exists():
            shutil.rmtree(runtime_root, ignore_errors=True)

        return Storage(
            self.project_root,
            app_root=runtime_root,
            seed_data_sources=[data_dir, self.project_root / "designPack" / "data"],
        )

    def _copy_dataset_media_to_runtime(self, dataset_id: str, storage: Storage) -> int:
        dataset_dir = self._dataset_dir(dataset_id)
        src_media = dataset_dir / "media"
        if not src_media.exists() or not src_media.is_dir():
            return 0
        storage.ensure_directories()
        copied = 0
        for source in sorted(src_media.rglob("*"), key=lambda item: item.as_posix().lower()):
            if not source.is_file():
                continue
            rel = source.relative_to(src_media)
            target = storage.paths.runtime_media / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            copied += 1
        return copied

    def _bootstrap(self, storage: Storage, backup_trigger: str = "startup") -> None:
        storage.seed_runtime_data()
        storage.migrate_files()
        initialize_quest_templates(storage)
        ensure_bootstrap_data(storage)
        maybe_create_backup(storage, storage.read_json("settings.json"), trigger=backup_trigger)

    def list_datasets(self) -> list[dict[str, Any]]:
        root = self.datasets_root
        if not root.exists():
            return []

        out: list[dict[str, Any]] = []
        for directory in sorted(root.iterdir(), key=lambda item: item.name.lower()):
            if not directory.is_dir():
                continue
            dataset_id = directory.name
            data_dir = self._dataset_data_dir(dataset_id)
            csv_files = self._list_csv_files(data_dir)
            if not csv_files:
                continue

            meta_path = directory / "dataset.json"
            meta: dict[str, Any] = {}
            if meta_path.exists() and meta_path.is_file():
                try:
                    loaded = json.loads(meta_path.read_text(encoding="utf-8-sig"))
                    if isinstance(loaded, dict):
                        meta = loaded
                except json.JSONDecodeError:
                    meta = {}

            latest_mtime = max([item.stat().st_mtime for item in csv_files] + [directory.stat().st_mtime])
            out.append(
                {
                    "id": dataset_id,
                    "name": str(meta.get("name") or dataset_id),
                    "description": str(meta.get("description") or ""),
                    "updated_at": _to_iso(latest_mtime),
                    "file_count": len(csv_files),
                }
            )
        return out

    def status(self) -> dict[str, Any]:
        if self.active_profile == "mock" and self.active_dataset_id:
            active_data_path = str((self.mock_runtime_root / self.active_dataset_id / "data"))
        else:
            active_data_path = str(self.real_storage.paths.runtime_data)
        return {
            "active": self.active_profile == "mock",
            "profile": self.active_profile,
            "dataset_id": self.active_dataset_id or None,
            "active_data_path": active_data_path,
            "real_data_path": str(self.real_storage.paths.runtime_data),
            "datasets_root": str(self.datasets_root),
        }

    def activate_mock(self, dataset_id: str, reset: bool = False) -> Storage:
        storage = self._build_mock_storage(dataset_id, reset=reset)
        self._bootstrap(storage, backup_trigger="mock-activate")
        self._copy_dataset_media_to_runtime(dataset_id, storage)
        self.active_profile = "mock"
        self.active_dataset_id = dataset_id
        return storage

    def deactivate_mock(self) -> Storage:
        self._bootstrap(self.real_storage, backup_trigger="real-reactivate")
        self.active_profile = "real"
        self.active_dataset_id = ""
        return self.real_storage

    def export_current_as_dataset(
        self,
        source_storage: Storage,
        *,
        dataset_id: str,
        name: str = "",
        description: str = "",
        generate_sessions: bool = True,
        session_days: int = 60,
    ) -> dict[str, Any]:
        safe_dataset_id = self._sanitize_dataset_id(dataset_id)
        dataset_dir = self._dataset_dir(safe_dataset_id)
        data_dir = dataset_dir / "data"
        media_dir = dataset_dir / "media"
        data_dir.mkdir(parents=True, exist_ok=True)
        media_dir.mkdir(parents=True, exist_ok=True)

        copied = 0
        for src in sorted(source_storage.paths.runtime_data.glob("*.csv"), key=lambda item: item.name.lower()):
            if not src.is_file():
                continue
            text = self._read_text_with_fallback(src)
            (data_dir / src.name).write_text(text, encoding="utf-8-sig")
            copied += 1

        generated_count = 0
        if generate_sessions:
            generated_rows = self._generate_two_month_sessions(source_storage, days=session_days)
            base_events = source_storage.read_csv("events.csv")
            keep_rows = [row for row in base_events if (row.get("event_type") or "").upper() != "SESSION"]
            merged_rows = keep_rows + generated_rows
            merged_rows.sort(key=lambda item: item.get("created_at", ""))
            self._write_dataset_csv(data_dir / "events.csv", merged_rows, headers=EVENT_HEADERS)
            generated_count = len(generated_rows)

        copied_media = 0
        for rel in self._collect_export_media_paths(source_storage):
            source = source_storage.paths.runtime_media / rel
            if not source.exists() or not source.is_file():
                continue
            target = media_dir / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            copied_media += 1

        meta = {
            "name": name.strip() or safe_dataset_id,
            "description": description.strip() or "Exported from current BassOS runtime data",
            "source_profile": self.active_profile,
            "source_dataset_id": self.active_dataset_id or "",
            "generated_sessions": generated_count,
            "generated_session_days": max(14, min(90, int(session_days))),
            "media_file_count": copied_media,
            "updated_at": now_local().isoformat(timespec="seconds"),
        }
        (dataset_dir / "dataset.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2),
            encoding="utf-8-sig",
        )
        csv_files = self._list_csv_files(data_dir)
        return {
            "dataset_id": safe_dataset_id,
            "dataset_path": str(dataset_dir),
            "data_path": str(data_dir),
            "media_path": str(media_dir),
            "file_count": len(csv_files),
            "copied_csv_count": copied,
            "generated_sessions": generated_count,
            "media_file_count": copied_media,
        }

    def export_achievement_pack(
        self,
        source_storage: Storage,
        *,
        dataset_id: str,
        name: str = "",
        description: str = "",
    ) -> dict[str, Any]:
        safe_dataset_id = self._sanitize_dataset_id(dataset_id)
        dataset_dir = self._dataset_dir(safe_dataset_id)
        data_dir = dataset_dir / "data"
        media_dir = dataset_dir / "media"
        data_dir.mkdir(parents=True, exist_ok=True)
        media_dir.mkdir(parents=True, exist_ok=True)

        rows = source_storage.read_csv("achievements_master.csv")
        headers = source_storage.read_csv_headers("achievements_master.csv") or ACHIEVEMENT_HEADERS
        self._write_dataset_csv(data_dir / "achievements_master.csv", rows, headers=headers)

        copied_icons = 0
        for row in rows:
            icon_path = str(row.get("icon_path") or "").strip()
            if not icon_path:
                continue
            rel = Path(icon_path)
            if rel.is_absolute() or ".." in rel.parts:
                continue
            source = source_storage.paths.runtime_media / rel
            if not source.exists() or not source.is_file():
                continue
            target = media_dir / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            copied_icons += 1

        meta = {
            "name": name.strip() or safe_dataset_id,
            "description": description.strip() or "BassOS achievements pack export",
            "kind": "achievement-pack",
            "source_profile": self.active_profile,
            "source_dataset_id": self.active_dataset_id or "",
            "icon_file_count": copied_icons,
            "updated_at": now_local().isoformat(timespec="seconds"),
        }
        (dataset_dir / "dataset.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2),
            encoding="utf-8-sig",
        )
        return {
            "dataset_id": safe_dataset_id,
            "dataset_path": str(dataset_dir),
            "data_path": str(data_dir),
            "media_path": str(media_dir),
            "achievement_count": len(rows),
            "icon_file_count": copied_icons,
        }
