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
  media/
    ... referenced images / pdf / attachments / icons
```

`data/` is still the CSV root.

`media/` is now part of the exported dataset. Keep the whole dataset folder together when copying or sharing it.

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

In `설정 > 테스트용 모의 데이터셋`, use:

- `현재 상태를 샌드박스로 저장 (+60일 세션 + 미디어)`

This exports the current runtime state as a self-contained dataset:

- current CSV data
- generated 60-day session history
- referenced media copied into `media/`

Saved path:

- Source run: `designPack/mock_datasets/<dataset_id>/`
- EXE run: `dist/BASSOS/bassos/_internal/designPack/mock_datasets/<dataset_id>/`

If you exported while using EXE and want that dataset in the next source build, copy the entire dataset folder into project `designPack/mock_datasets/`.

## Promote as Default Mock

The maintained source-of-truth dataset is:

- `designPack/mock_datasets/<dataset_id>/`

Do not use `app/profiles/mock/<dataset_id>/` as the authored source. That folder is runtime output.

If you want to replace the shipped default curated mock:

1. Export or prepare a complete dataset folder.
2. Copy the whole folder contents into `designPack/mock_datasets/realistic_mix_8w/`.
3. Rebuild the app.

That is the dataset that should be treated as the default curated mock going forward.
