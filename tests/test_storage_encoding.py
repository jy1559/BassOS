from __future__ import annotations

from pathlib import Path

from bassos.services.storage import Storage


def _build_storage(tmp_path: Path) -> Storage:
    root = tmp_path
    (root / "designPack" / "data").mkdir(parents=True, exist_ok=True)
    storage = Storage(root, app_root=root / "app", seed_data_sources=[root / "designPack" / "data"])
    storage.ensure_directories()
    return storage


def test_storage_reads_cp949_csv_and_rewrites_utf8_bom(tmp_path: Path):
    storage = _build_storage(tmp_path)
    target = storage.paths.runtime_data / "song_library.csv"
    target.write_bytes("library_id,title\nLIB1,한글곡\n".encode("cp949"))

    rows = storage.read_csv("song_library.csv")
    assert rows[0]["title"] == "한글곡"

    storage.write_csv("song_library.csv", rows, headers=["library_id", "title"])
    rewritten = target.read_bytes()
    assert rewritten.startswith(b"\xef\xbb\xbf")


def test_append_csv_row_keeps_single_bom(tmp_path: Path):
    storage = _build_storage(tmp_path)
    headers = ["event_id", "title"]
    storage.write_csv("events.csv", [{"event_id": "E1", "title": "first"}], headers=headers)
    storage.append_csv_row("events.csv", {"event_id": "E2", "title": "second"}, headers=headers)

    raw = (storage.paths.runtime_data / "events.csv").read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf")
    assert raw.count(b"\xef\xbb\xbf") == 1
