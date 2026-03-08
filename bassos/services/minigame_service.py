from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from bassos.minigame_defaults import (
    ALLOWED_GAMES,
    ALLOWED_MODE,
    GAME_IMAGE_FILENAMES,
    MINIGAME_RECORD_HEADERS,
    normalize_minigame_config,
    normalize_minigame_user_settings,
    seed_payload,
)
from bassos.services.storage import Storage


class MinigameService:
    def __init__(self, storage: Storage) -> None:
        self.storage = storage

    def now_iso(self) -> str:
        return datetime.now().replace(microsecond=0).isoformat()

    def _settings(self) -> dict[str, Any]:
        return self.storage.read_json("settings.json")

    def config(self) -> dict[str, Any]:
        settings = self._settings()
        practice_tools = settings.get("practice_tools", {}) if isinstance(settings.get("practice_tools"), dict) else {}
        raw_config = practice_tools.get("minigame_config", {})
        config = normalize_minigame_config(raw_config)
        return {
            "challenge_seconds": int(config.get("challenge_seconds", 120)),
            "tick": config.get("tick", {"beat": 48, "measure": 192}),
            "fretboard": config.get("fretboard", {"max_visible_fret": 21}),
            "difficulties": config.get("difficulties", {}),
            "rhythm_windows_ms": config.get("rhythm_windows_ms", {}),
            "rhythm": config.get("rhythm", {}),
            "rhythm_templates": self.storage.read_data_json("minigame_rhythm_templates.json"),
            "scale_rules": self.storage.read_data_json("minigame_scale_rules.json"),
            "chord_qualities": self.storage.read_data_json("minigame_chord_qualities.json"),
        }

    def user_settings(self) -> dict[str, Any]:
        settings = self._settings()
        practice_tools = settings.get("practice_tools", {}) if isinstance(settings.get("practice_tools"), dict) else {}
        return normalize_minigame_user_settings(practice_tools.get("minigame_user_settings"))

    def update_user_settings(self, raw: Any) -> dict[str, Any]:
        if not isinstance(raw, dict):
            raise ValueError("user settings payload must be object")
        settings = self._settings()
        practice_tools = settings.setdefault("practice_tools", {})
        if not isinstance(practice_tools, dict):
            practice_tools = {}
            settings["practice_tools"] = practice_tools
        practice_tools["minigame_user_settings"] = normalize_minigame_user_settings(raw)
        normalized = self.storage.normalize_settings(settings, source_settings=settings)
        self.storage.write_json("settings.json", normalized)
        saved_practice_tools = normalized.get("practice_tools", {})
        if not isinstance(saved_practice_tools, dict):
            return normalize_minigame_user_settings({})
        return normalize_minigame_user_settings(saved_practice_tools.get("minigame_user_settings"))

    def seed(self, date_text: str | None) -> dict[str, Any]:
        return seed_payload(date_text)

    def _to_int(self, value: Any, default: int = 0) -> int:
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return default

    def _to_float(self, value: Any, default: float = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def _normalize_period(self, period: str | None) -> str:
        value = str(period or "").strip().upper()
        return value if value in {"ALL", "D30", "TODAY"} else "ALL"

    def _parse_created_at(self, value: str | None) -> datetime | None:
        text = str(value or "").strip()
        if not text:
            return None
        try:
            return datetime.fromisoformat(text)
        except ValueError:
            return None

    def _passes_period_filter(self, created_at: str, period: str) -> bool:
        normalized = self._normalize_period(period)
        if normalized == "ALL":
            return True
        created = self._parse_created_at(created_at)
        if created is None:
            return False
        now = datetime.now()
        if normalized == "TODAY":
            return created.date() == now.date()
        return created >= now - timedelta(days=30)

    def _parse_detail_json(self, raw: str) -> dict[str, Any]:
        text = str(raw or "").strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}

    def list_records(
        self,
        *,
        game: str = "",
        difficulty: str = "",
        limit: int = 30,
        period: str = "ALL",
    ) -> list[dict[str, Any]]:
        rows = self.storage.read_csv("minigame_records.csv")
        normalized_diff = difficulty.upper()
        normalized_period = self._normalize_period(period)
        items: list[dict[str, Any]] = []
        for row in rows:
            if game and row.get("game", "").upper() != game.upper():
                continue
            if normalized_diff and normalized_diff != "ALL" and row.get("difficulty", "").upper() != normalized_diff:
                continue
            if not self._passes_period_filter(row.get("created_at", ""), normalized_period):
                continue
            items.append(
                {
                    "record_id": row.get("record_id", ""),
                    "created_at": row.get("created_at", ""),
                    "game": row.get("game", ""),
                    "mode": row.get("mode", ""),
                    "difficulty": row.get("difficulty", ""),
                    "score": self._to_int(row.get("score"), 0),
                    "accuracy": self._to_float(row.get("accuracy"), 0.0),
                    "seed": row.get("seed", ""),
                    "duration_sec": self._to_int(row.get("duration_sec"), 120),
                    "share_text": row.get("share_text", ""),
                    "detail_json": self._parse_detail_json(row.get("detail_json", "")),
                    "source": row.get("source", "app"),
                }
            )
        items.sort(key=lambda item: item.get("created_at", ""), reverse=True)
        return items[: max(1, limit)]

    def leaderboard(
        self,
        *,
        game: str = "",
        difficulty: str = "",
        limit: int = 10,
        period: str = "ALL",
    ) -> list[dict[str, Any]]:
        rows = self.list_records(game=game, difficulty=difficulty, limit=100000, period=period)
        rows.sort(key=lambda item: (-self._to_int(item.get("score"), 0), item.get("created_at", "")))
        return rows[: max(1, limit)]

    def _validate_record_payload(self, payload: dict[str, Any]) -> tuple[bool, str]:
        game = str(payload.get("game", "")).upper()
        mode = str(payload.get("mode", "")).upper()
        diff = str(payload.get("difficulty", "")).strip()
        score = payload.get("score")
        share = str(payload.get("share_text", "")).strip()
        seed = str(payload.get("seed", "")).strip()
        duration = self._to_int(payload.get("duration_sec"), 120)

        if game not in ALLOWED_GAMES:
            return False, "game must be one of FBH, RC, LM"
        if mode not in ALLOWED_MODE:
            return False, "mode must be CHALLENGE"
        if not diff:
            return False, "difficulty is required"
        try:
            float(score)
        except (TypeError, ValueError):
            return False, "score must be numeric"
        if not seed:
            return False, "seed is required"
        if not share:
            return False, "share_text is required"
        if duration <= 0:
            return False, "duration_sec must be positive"
        return True, ""

    def create_record(self, payload: dict[str, Any]) -> tuple[bool, str, dict[str, Any] | None]:
        ok, message = self._validate_record_payload(payload)
        if not ok:
            return False, message, None

        detail = payload.get("detail_json", {})
        if detail is None:
            detail = {}
        if not isinstance(detail, dict):
            return False, "detail_json must be object", None

        record = {
            "record_id": f"MR_{uuid.uuid4().hex[:12]}",
            "created_at": self.now_iso(),
            "game": str(payload.get("game", "")).upper(),
            "mode": "CHALLENGE",
            "difficulty": str(payload.get("difficulty", "")).upper(),
            "score": str(self._to_int(payload.get("score"), 0)),
            "accuracy": str(round(self._to_float(payload.get("accuracy"), 0.0), 2)),
            "seed": str(payload.get("seed", "")).strip(),
            "duration_sec": str(self._to_int(payload.get("duration_sec"), 120)),
            "share_text": str(payload.get("share_text", "")).strip(),
            "detail_json": json.dumps(detail, ensure_ascii=False),
            "source": str(payload.get("source", "app")),
        }
        self.storage.append_csv_row("minigame_records.csv", record, MINIGAME_RECORD_HEADERS)
        return True, "", {
            "record_id": record["record_id"],
            "created_at": record["created_at"],
            "game": record["game"],
            "mode": record["mode"],
            "difficulty": record["difficulty"],
            "score": self._to_int(record["score"], 0),
            "accuracy": self._to_float(record["accuracy"], 0.0),
            "seed": record["seed"],
            "duration_sec": self._to_int(record["duration_sec"], 120),
            "share_text": record["share_text"],
            "detail_json": detail,
            "source": record["source"],
        }

    def delete_record(self, record_id: str) -> tuple[bool, str]:
        rid = str(record_id or "").strip()
        if not rid:
            return False, "record_id is required"
        rows = self.storage.read_csv("minigame_records.csv")
        if not rows:
            return False, "record not found"
        kept: list[dict[str, Any]] = []
        removed = False
        for row in rows:
            if str(row.get("record_id", "")).strip() == rid:
                removed = True
                continue
            kept.append(row)
        if not removed:
            return False, "record not found"
        self.storage.write_csv("minigame_records.csv", kept, headers=MINIGAME_RECORD_HEADERS)
        return True, ""

    def stats(self, *, game: str = "", difficulty: str = "", period: str = "ALL") -> dict[str, Any]:
        rows = self.list_records(game=game, difficulty=difficulty, limit=100000, period=period)
        plays = len(rows)
        if not rows:
            return {
                "summary": {
                    "plays": 0,
                    "avg_score": 0.0,
                    "best_score": 0,
                    "avg_accuracy": 0.0,
                    "avg_duration_sec": 0.0,
                },
                "trend": [],
                "detail": {},
            }

        score_sum = sum(self._to_int(item.get("score"), 0) for item in rows)
        best_score = max(self._to_int(item.get("score"), 0) for item in rows)
        acc_sum = sum(self._to_float(item.get("accuracy"), 0.0) for item in rows)
        duration_sum = sum(self._to_int(item.get("duration_sec"), 0) for item in rows)

        sorted_oldest = sorted(rows, key=lambda item: item.get("created_at", ""))
        trend = [
            {
                "record_id": item.get("record_id", ""),
                "created_at": item.get("created_at", ""),
                "score": self._to_int(item.get("score"), 0),
                "difficulty": item.get("difficulty", ""),
            }
            for item in sorted_oldest
        ]

        detail: dict[str, Any] = {}
        game_key = game.upper()
        if game_key == "FBH":
            judge_counts: dict[str, int] = {}
            total_correct = 0
            total_wrong = 0
            for item in rows:
                payload = item.get("detail_json", {})
                if not isinstance(payload, dict):
                    continue
                judge = str(payload.get("judge", "")).strip()
                if judge:
                    judge_counts[judge] = judge_counts.get(judge, 0) + 1
                total_correct += self._to_int(payload.get("correct", payload.get("hits", 0)), 0)
                total_wrong += self._to_int(payload.get("wrong", 0), 0)
            detail = {
                "judge_counts": judge_counts,
                "total_correct": total_correct,
                "total_wrong": total_wrong,
            }
        elif game_key == "RC":
            total_perfect = 0
            total_good = 0
            total_miss = 0
            avg_abs_acc = 0.0
            avg_abs_count = 0
            note_acc_sum = 0.0
            note_acc_count = 0
            timing_acc_sum = 0.0
            timing_acc_count = 0
            total_stray_inputs = 0
            for item in rows:
                payload = item.get("detail_json", {})
                if not isinstance(payload, dict):
                    continue
                total_perfect += self._to_int(payload.get("perfect", 0), 0)
                total_good += self._to_int(payload.get("good", 0), 0)
                total_miss += self._to_int(payload.get("miss", 0), 0)
                total_stray_inputs += self._to_int(payload.get("stray_inputs", 0), 0)
                avg_abs = payload.get("avg_abs_ms")
                if avg_abs is not None:
                    avg_abs_acc += self._to_float(avg_abs, 0.0)
                    avg_abs_count += 1
                note_acc = payload.get("note_accuracy")
                if note_acc is not None:
                    note_acc_sum += self._to_float(note_acc, 0.0)
                    note_acc_count += 1
                timing_acc = payload.get("timing_accuracy")
                if timing_acc is not None:
                    timing_acc_sum += self._to_float(timing_acc, 0.0)
                    timing_acc_count += 1
            detail = {
                "total_perfect": total_perfect,
                "total_good": total_good,
                "total_miss": total_miss,
                "avg_abs_ms": round(avg_abs_acc / avg_abs_count, 2) if avg_abs_count else 0.0,
                "avg_note_accuracy": round(note_acc_sum / note_acc_count, 2) if note_acc_count else 0.0,
                "avg_timing_accuracy": round(timing_acc_sum / timing_acc_count, 2) if timing_acc_count else 0.0,
                "total_stray_inputs": total_stray_inputs,
            }
        elif game_key == "LM":
            total_correct = 0
            total_wrong = 0
            stage_counts: dict[str, int] = {}
            error_type_counts: dict[str, int] = {}
            target_degree_counts: dict[str, int] = {}
            for item in rows:
                payload = item.get("detail_json", {})
                if not isinstance(payload, dict):
                    continue
                total_correct += self._to_int(payload.get("correct", 0), 0)
                total_wrong += self._to_int(payload.get("wrong", 0), 0)
                stage_map = payload.get("stage_counts", {})
                if isinstance(stage_map, dict):
                    for key, value in stage_map.items():
                        stage = str(key).strip().upper()
                        if stage:
                            stage_counts[stage] = stage_counts.get(stage, 0) + self._to_int(value, 0)
                error_map = payload.get("error_type_counts", {})
                if isinstance(error_map, dict):
                    for key, value in error_map.items():
                        error_type = str(key).strip().upper()
                        if error_type:
                            error_type_counts[error_type] = error_type_counts.get(error_type, 0) + self._to_int(value, 0)
                target_map = payload.get("target_degree_counts", {})
                if isinstance(target_map, dict):
                    for key, value in target_map.items():
                        degree = str(key).strip()
                        if degree:
                            target_degree_counts[degree] = target_degree_counts.get(degree, 0) + self._to_int(value, 0)
            detail = {
                "total_correct": total_correct,
                "total_wrong": total_wrong,
                "stage_counts": stage_counts,
                "error_type_counts": error_type_counts,
                "target_degree_counts": target_degree_counts,
            }

        return {
            "summary": {
                "plays": plays,
                "avg_score": round(score_sum / plays, 2),
                "best_score": best_score,
                "avg_accuracy": round(acc_sum / plays, 2),
                "avg_duration_sec": round(duration_sum / plays, 2),
            },
            "trend": trend,
            "detail": detail,
        }

    def game_image_path(self, game: str) -> Path | None:
        filename = GAME_IMAGE_FILENAMES.get(str(game or "").strip().upper())
        if not filename:
            return None
        return self.storage.find_data_file(f"game_image/{filename}")
