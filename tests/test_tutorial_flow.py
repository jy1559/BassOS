from __future__ import annotations

import shutil
from pathlib import Path

from bassos.app_factory import create_app


def _prepare_temp_root(tmp_path: Path) -> Path:
    src_designpack = Path(__file__).resolve().parents[1] / "designPack"
    dst_designpack = tmp_path / "designPack"
    shutil.copytree(src_designpack, dst_designpack)
    return tmp_path


def test_tutorial_state_defaults(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    res = client.get("/api/tutorial/state")
    assert res.status_code == 200
    payload = res.get_json()
    assert payload["campaign_id"] == "core_v1"
    assert payload["completed"] is False
    assert payload["reward_claimed"] is False
    assert payload["banner_seen"] is False
    assert payload["resume_step_index"] == 0
    assert payload["total_steps"] == 11
    assert payload["guide_finisher_unlocked"] is False


def test_tutorial_progress_and_resume(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    start_res = client.post("/api/tutorial/start", json={"campaign_id": "core_v1"})
    assert start_res.status_code == 200
    assert start_res.get_json()["resume_step_index"] == 0

    progress_res = client.post("/api/tutorial/progress", json={"campaign_id": "core_v1", "step_index": 3})
    assert progress_res.status_code == 200
    assert progress_res.get_json()["resume_step_index"] == 3

    state_res = client.get("/api/tutorial/state?campaign_id=core_v1")
    assert state_res.status_code == 200
    assert state_res.get_json()["resume_step_index"] == 3

    start_again = client.post("/api/tutorial/start", json={"campaign_id": "core_v1"})
    assert start_again.status_code == 200
    assert start_again.get_json()["resume_step_index"] == 3


def test_tutorial_banner_seen_is_idempotent(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    first = client.post("/api/tutorial/banner-seen", json={"campaign_id": "core_v1"})
    assert first.status_code == 200
    assert first.get_json()["banner_seen"] is True

    second = client.post("/api/tutorial/banner-seen", json={"campaign_id": "core_v1"})
    assert second.status_code == 200
    assert second.get_json()["banner_seen"] is True

    settings = client.get("/api/settings").get_json()["settings"]
    seen = settings["profile"]["tutorial_state"]["banner_seen_campaigns"]
    assert seen.count("core_v1") == 1


def test_tutorial_complete_reward_once(tmp_path: Path):
    root = _prepare_temp_root(tmp_path)
    app = create_app(root)
    client = app.test_client()

    reset = client.post("/api/admin/reset-progress", json={})
    assert reset.status_code == 200

    before = client.get("/api/hud/summary").get_json()["summary"]["total_xp"]

    first = client.post("/api/tutorial/complete", json={"campaign_id": "core_v1"})
    assert first.status_code == 200
    first_payload = first.get_json()
    assert first_payload["completed"] is True
    assert first_payload["reward_granted"] is True
    assert first_payload["xp_granted"] == 60
    assert first_payload["title_unlocked"] == "guide_finisher"
    assert first_payload["guide_finisher_unlocked"] is True

    after_first = client.get("/api/hud/summary").get_json()["summary"]["total_xp"]
    assert after_first - before == 60

    second = client.post("/api/tutorial/complete", json={"campaign_id": "core_v1"})
    assert second.status_code == 200
    second_payload = second.get_json()
    assert second_payload["completed"] is True
    assert second_payload["reward_granted"] is False
    assert second_payload["xp_granted"] == 0
    assert second_payload["guide_finisher_unlocked"] is True

    after_second = client.get("/api/hud/summary").get_json()["summary"]["total_xp"]
    assert after_second == after_first
