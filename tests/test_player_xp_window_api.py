from __future__ import annotations

import shutil
from datetime import timedelta
from pathlib import Path

from bassos.app_factory import create_app
from bassos.utils.time_utils import now_local


def _prepare_temp_root(tmp_path: Path) -> Path:
  src_designpack = Path(__file__).resolve().parents[1] / "designPack"
  dst_designpack = tmp_path / "designPack"
  shutil.copytree(src_designpack, dst_designpack)
  return tmp_path


def _seed_sessions(client, day_offsets: list[int]) -> None:
  today = now_local().date()
  for offset in day_offsets:
    day = today - timedelta(days=offset)
    start_at = f"{day.isoformat()}T09:00:00"
    end_at = f"{day.isoformat()}T09:30:00"
    res = client.post(
      "/api/session/quick-log",
      json={
        "activity": "Song",
        "sub_activity": "SongPractice",
        "tags": ["SONG"],
        "start_at": start_at,
        "end_at": end_at,
        "duration_min": 30,
      },
    )
    assert res.status_code == 200


def test_player_xp_window_scope_all_period_recent(tmp_path):
  root = _prepare_temp_root(tmp_path)
  app = create_app(root)
  client = app.test_client()

  _seed_sessions(client, [0, 1, 3, 8, 20, 35, 120, 220])

  all_res = client.get("/api/player/xp-window?scope=all")
  assert all_res.status_code == 200
  all_data = all_res.get_json()["window"]
  assert all_data["window"]["scope"] == "all"
  assert all_data["window"]["start_key"] <= all_data["window"]["end_key"]
  assert "summary" in all_data
  assert "charts" in all_data
  assert "level_progress" in all_data

  anchor = now_local().date().isoformat()
  week_res = client.get(f"/api/player/xp-window?scope=period&period_unit=week&anchor={anchor}")
  assert week_res.status_code == 200
  week_data = week_res.get_json()["window"]
  assert week_data["window"]["scope"] == "period"
  assert week_data["window"]["period_unit"] == "week"
  assert week_data["window"]["start_key"] <= week_data["window"]["end_key"]
  assert week_data["window"]["prev_start_key"] is not None
  assert week_data["window"]["prev_end_key"] is not None

  month_res = client.get(f"/api/player/xp-window?scope=period&period_unit=month&anchor={anchor}")
  assert month_res.status_code == 200
  assert month_res.get_json()["window"]["window"]["period_unit"] == "month"

  year_res = client.get(f"/api/player/xp-window?scope=period&period_unit=year&anchor={anchor}")
  assert year_res.status_code == 200
  assert year_res.get_json()["window"]["window"]["period_unit"] == "year"

  recent_7 = client.get("/api/player/xp-window?scope=recent&recent_days=7")
  recent_30 = client.get("/api/player/xp-window?scope=recent&recent_days=30")
  recent_90 = client.get("/api/player/xp-window?scope=recent&recent_days=90")
  assert recent_7.status_code == 200
  assert recent_30.status_code == 200
  assert recent_90.status_code == 200

  for response, days in [(recent_7, 7), (recent_30, 30), (recent_90, 90)]:
    payload = response.get_json()["window"]
    assert payload["window"]["scope"] == "recent"
    assert payload["window"]["recent_days"] == days
    assert len(payload["charts"]["day"]) == days


def test_player_xp_window_invalid_query_returns_400(tmp_path):
  root = _prepare_temp_root(tmp_path)
  app = create_app(root)
  client = app.test_client()

  bad_scope = client.get("/api/player/xp-window?scope=bad")
  assert bad_scope.status_code == 400

  bad_period = client.get("/api/player/xp-window?scope=period&period_unit=bad")
  assert bad_period.status_code == 400

  bad_recent = client.get("/api/player/xp-window?scope=recent&recent_days=5")
  assert bad_recent.status_code == 400

  bad_anchor = client.get("/api/player/xp-window?scope=period&period_unit=week&anchor=2026-99-99")
  assert bad_anchor.status_code == 400


def test_player_xp_window_includes_minigame_source(tmp_path):
  root = _prepare_temp_root(tmp_path)
  app = create_app(root)
  client = app.test_client()

  create = client.post(
    "/api/minigame/records",
    json={
      "game": "LM",
      "mode": "PRACTICE",
      "difficulty": "EASY",
      "score": 8,
      "accuracy": 71.4,
      "seed": "2026-03-01",
      "duration_sec": 55,
      "share_text": "LM|PRACTICE|EASY|CORRECT=5|SEED=2026-03-01",
      "detail_json": {"attempts": 7, "correct": 5, "wrong": 2},
    },
  )
  assert create.status_code == 200
  assert create.get_json()["xp_awarded"] == 3

  res = client.get("/api/player/xp-window?scope=recent&recent_days=7")
  assert res.status_code == 200
  payload = res.get_json()["window"]
  source_keys = {str(row.get("key") or "").lower() for row in payload["xp_sources"]}
  assert "minigame" in source_keys
