from __future__ import annotations

from flask import Blueprint, Response, current_app, jsonify, request, send_file

from bassos.services.minigame_service import MinigameService

minigame_bp = Blueprint("minigame_api", __name__, url_prefix="/api/minigame")


def _game() -> MinigameService:
    return current_app.config["minigame_service"]


def _to_int(value: str | None, default: int) -> int:
    try:
        return int(float(value or default))
    except (TypeError, ValueError):
        return default


@minigame_bp.get("/config")
def minigame_config_get() -> Response:
    return jsonify({"ok": True, "config": _game().config()})


@minigame_bp.get("/seed")
def minigame_seed_get() -> Response:
    date_text = request.args.get("date", "")
    return jsonify({"ok": True, **_game().seed(date_text)})


@minigame_bp.get("/records")
def minigame_records_get() -> Response:
    game = (request.args.get("game") or "").strip().upper()
    diff = (request.args.get("difficulty") or "").strip().upper()
    period = (request.args.get("period") or "ALL").strip().upper()
    limit = max(1, min(500, _to_int(request.args.get("limit"), 30)))
    return jsonify(
        {
            "ok": True,
            "items": _game().list_records(game=game, difficulty=diff, limit=limit, period=period),
        }
    )


@minigame_bp.post("/records")
def minigame_records_post() -> Response:
    payload = request.get_json(silent=True) or {}
    ok, message, item = _game().create_record(payload)
    if not ok:
        return jsonify({"ok": False, "message": message}), 400
    return jsonify({"ok": True, "item": item})


@minigame_bp.delete("/records/<record_id>")
def minigame_records_delete(record_id: str) -> Response:
    ok, message = _game().delete_record(record_id)
    if not ok:
        status = 404 if message == "record not found" else 400
        return jsonify({"ok": False, "message": message}), status
    return jsonify({"ok": True, "record_id": record_id})


@minigame_bp.get("/leaderboard")
def minigame_leaderboard_get() -> Response:
    game = (request.args.get("game") or "").strip().upper()
    diff = (request.args.get("difficulty") or "").strip().upper()
    period = (request.args.get("period") or "ALL").strip().upper()
    limit = max(1, min(500, _to_int(request.args.get("limit"), 10)))
    return jsonify(
        {
            "ok": True,
            "items": _game().leaderboard(game=game, difficulty=diff, limit=limit, period=period),
        }
    )


@minigame_bp.get("/stats")
def minigame_stats_get() -> Response:
    game = (request.args.get("game") or "").strip().upper()
    diff = (request.args.get("difficulty") or "").strip().upper()
    period = (request.args.get("period") or "ALL").strip().upper()
    return jsonify({"ok": True, **_game().stats(game=game, difficulty=diff, period=period)})


@minigame_bp.get("/game-image/<game>")
def minigame_game_image_get(game: str) -> Response:
    path = _game().game_image_path(game)
    if path is None:
        return jsonify({"ok": False, "message": "game image not found"}), 404
    return send_file(path)


@minigame_bp.get("/user-settings")
def minigame_user_settings_get() -> Response:
    return jsonify({"ok": True, "settings": _game().user_settings()})


@minigame_bp.put("/user-settings")
def minigame_user_settings_put() -> Response:
    payload = request.get_json(silent=True) or {}
    raw_settings = payload.get("settings", payload)
    try:
        saved = _game().update_user_settings(raw_settings)
    except ValueError as exc:
        return jsonify({"ok": False, "message": str(exc)}), 400
    return jsonify({"ok": True, "settings": saved})
