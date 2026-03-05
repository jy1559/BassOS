"""Backup and export services."""

from __future__ import annotations

import json
import shutil
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from bassos.services.storage import Storage


def _ts() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _find_latest_backup(backups_dir: Path) -> Path | None:
    files = sorted(backups_dir.glob("backup_*.zip"), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0] if files else None


def maybe_create_backup(storage: Storage, settings: dict[str, Any], trigger: str = "startup") -> dict[str, Any]:
    cfg = settings.get("backup", {})
    if not cfg.get("enabled", True):
        return {"created": False, "reason": "backup_disabled"}
    min_hours = int(cfg.get("min_hours_between", settings.get("critical", {}).get("backup_min_hours", 12)))
    max_files = int(cfg.get("max_files", settings.get("critical", {}).get("max_backup_files", 3)))

    latest = _find_latest_backup(storage.paths.backups)
    if latest:
        age = datetime.now() - datetime.fromtimestamp(latest.stat().st_mtime)
        if age < timedelta(hours=min_hours):
            return {"created": False, "reason": "interval_not_reached", "latest": latest.name}

    name = f"backup_{_ts()}_{trigger}.zip"
    path = storage.paths.backups / name
    _write_snapshot_zip(path, storage.paths.runtime_data, {"trigger": trigger})
    _prune_backup_files(storage.paths.backups, max_files=max_files)
    return {"created": True, "file": name}


def _write_snapshot_zip(target_zip: Path, runtime_data: Path, metadata: dict[str, Any]) -> None:
    with zipfile.ZipFile(target_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps({"created_at": _ts(), **metadata}, ensure_ascii=False, indent=2))
        for file_path in runtime_data.glob("*"):
            if file_path.is_file():
                zf.write(file_path, arcname=f"data/{file_path.name}")
        runtime_media = runtime_data.parent / "media"
        if runtime_media.exists():
            for file_path in runtime_media.rglob("*"):
                if file_path.is_file():
                    relative = file_path.relative_to(runtime_media).as_posix()
                    zf.write(file_path, arcname=f"media/{relative}")


def _prune_backup_files(backups_dir: Path, max_files: int) -> None:
    files = sorted(backups_dir.glob("backup_*.zip"), key=lambda p: p.stat().st_mtime, reverse=True)
    for stale in files[max_files:]:
        stale.unlink(missing_ok=True)


def create_export_bundle(storage: Storage) -> Path:
    export_name = f"bassos_export_{_ts()}.zip"
    export_path = storage.paths.exports / export_name
    with zipfile.ZipFile(export_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "manifest.json",
            json.dumps(
                {
                    "created_at": _ts(),
                    "format": "bassos-export-v1",
                },
                ensure_ascii=False,
                indent=2,
            ),
        )
        for file_path in storage.paths.runtime_data.glob("*"):
            if file_path.is_file():
                zf.write(file_path, arcname=f"data/{file_path.name}")
        if storage.paths.runtime_media.exists():
            for file_path in storage.paths.runtime_media.rglob("*"):
                if file_path.is_file():
                    relative = file_path.relative_to(storage.paths.runtime_media).as_posix()
                    zf.write(file_path, arcname=f"media/{relative}")
    return export_path


def restore_from_backup(storage: Storage, backup_name: str) -> tuple[bool, str]:
    backup_path = storage.paths.backups / backup_name
    if not backup_path.exists():
        return False, "백업 파일이 없습니다."
    try:
        temp_dir = storage.paths.backups / f"restore_tmp_{_ts()}"
        temp_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(backup_path, "r") as zf:
            zf.extractall(temp_dir)
        data_dir = temp_dir / "data"
        if not data_dir.exists():
            shutil.rmtree(temp_dir, ignore_errors=True)
            return False, "백업 형식이 올바르지 않습니다."
        for csv_file in data_dir.glob("*"):
            if csv_file.is_file():
                shutil.copy2(csv_file, storage.paths.runtime_data / csv_file.name)
        media_dir = temp_dir / "media"
        if media_dir.exists():
            for media_file in media_dir.rglob("*"):
                if not media_file.is_file():
                    continue
                relative = media_file.relative_to(media_dir)
                target = storage.paths.runtime_media / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(media_file, target)
        shutil.rmtree(temp_dir, ignore_errors=True)
        return True, "백업을 복원했습니다."
    except Exception as exc:  # pragma: no cover - defensive path
        return False, f"복원 실패: {exc}"
