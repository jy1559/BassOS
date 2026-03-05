# Mock Dataset Guide

## Folder Layout

Use this layout:

```text
designPack/mock_datasets/<dataset_id>/
  dataset.json
  data/
    events.csv
    song_library.csv
    ... (optional extra csv files)
```

`data/` is recommended. If `data/` is missing, the app also scans `<dataset_id>/` directly.

## Minimum CSV Set

At least one `.csv` file is required for dataset detection.

Recommended minimum:

1. `events.csv` for XP/session history
2. `song_library.csv` for song UI state

Missing files are automatically filled from `designPack/data` when mock profile is activated.

## Encoding Policy

Use `UTF-8 with BOM` (`utf-8-sig`) for all CSV files.

This avoids broken Korean text when opening raw CSV in Windows tools.

## Included Example

`starter_demo_v1` is included as a working reference dataset.

## Export from Current Runtime

In `설정 > 샌드박스 모의데이터`, use:

- `현재 상태를 샌드박스로 저장(+60일 세션)`

This exports current `곡/드릴/백킹` state and generates realistic 60-day sessions.

Saved path:

- Source run: `designPack/mock_datasets/<dataset_id>/data`
- EXE run: `dist/BassOS/_internal/designPack/mock_datasets/<dataset_id>/data`

If you exported while using EXE and want it in your next build, copy the dataset folder from EXE path to project `designPack/mock_datasets`.
