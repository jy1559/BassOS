"""Flask application factory."""

from __future__ import annotations

from pathlib import Path

from flask import Flask, current_app, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

from bassos.api import api_bp
from bassos.constants import ACHIEVEMENT_HEADERS, QUEST_HEADERS
from bassos.minigame_api import minigame_bp
from bassos.services.backups import maybe_create_backup
from bassos.services.data_bootstrap import ensure_bootstrap_data, initialize_quest_templates
from bassos.services.game import GameService
from bassos.services.minigame_service import MinigameService
from bassos.services.runtime_profile import RuntimeProfileManager
from bassos.services.storage import Storage


def _startup_dataset_check(storage: Storage, app: Flask) -> None:
    quest_headers = storage.read_csv_headers("quests.csv")
    ach_headers = storage.read_csv_headers("achievements_master.csv")
    quest_rows = storage.read_csv("quests.csv")
    ach_rows = storage.read_csv("achievements_master.csv")
    missing_quest = [key for key in QUEST_HEADERS if key not in quest_headers]
    missing_ach = [key for key in ACHIEVEMENT_HEADERS if key not in ach_headers]
    app.logger.info(
        "startup dataset check: quests=%s rows, achievements=%s rows, quest_headers_ok=%s, achievement_headers_ok=%s",
        len(quest_rows),
        len(ach_rows),
        not missing_quest,
        not missing_ach,
    )
    if missing_quest:
        raise RuntimeError(f"quests.csv missing required headers: {missing_quest}")
    if missing_ach:
        raise RuntimeError(f"achievements_master.csv missing required headers: {missing_ach}")


def create_app(project_root: Path | None = None) -> Flask:
    root = project_root or Path(__file__).resolve().parents[1]
    static_dist = root / "frontend" / "dist"
    app = Flask(
        __name__,
        static_folder=str(static_dist) if static_dist.exists() else None,
        static_url_path="/",
    )

    storage = Storage(root)
    storage.seed_runtime_data()
    storage.migrate_files()
    initialize_quest_templates(storage)
    ensure_bootstrap_data(storage)
    _startup_dataset_check(storage, app)
    maybe_create_backup(storage, storage.read_json("settings.json"), trigger="startup")

    runtime_profiles = RuntimeProfileManager(root, storage)

    app.config["storage"] = storage
    app.config["game_service"] = GameService(storage)
    app.config["minigame_service"] = MinigameService(storage)
    app.config["runtime_profile_manager"] = runtime_profiles
    app.register_blueprint(api_bp)
    app.register_blueprint(minigame_bp)

    @app.errorhandler(HTTPException)
    def handle_http_exception(exc: HTTPException):
        if request.path.startswith("/api/"):
            message = str(exc.description or exc.name or "HTTP error")
            return jsonify({"ok": False, "message": message}), int(exc.code or 500)
        return exc

    @app.errorhandler(Exception)
    def handle_unexpected_exception(exc: Exception):
        if request.path.startswith("/api/"):
            app.logger.exception("Unhandled API exception")
            message = str(exc).strip() or "Internal server error"
            return jsonify({"ok": False, "message": message}), 500
        raise exc

    @app.get("/media/<path:subpath>")
    def media_static(subpath: str):
        storage = current_app.config["storage"]
        return send_from_directory(storage.paths.runtime_media, subpath, as_attachment=False)

    @app.get("/")
    def index():
        if static_dist.exists() and (static_dist / "index.html").exists():
            return send_from_directory(static_dist, "index.html")
        return jsonify(
            {
                "ok": False,
                "message": "Frontend build not found. Run npm install && npm run build in frontend/",
            }
        )

    @app.get("/<path:path>")
    def spa_fallback(path: str):
        if static_dist.exists():
            candidate = static_dist / path
            if candidate.exists() and candidate.is_file():
                return send_from_directory(static_dist, path)
            return send_from_directory(static_dist, "index.html")
        return jsonify({"ok": False, "message": "Frontend build missing"}), 404

    return app
