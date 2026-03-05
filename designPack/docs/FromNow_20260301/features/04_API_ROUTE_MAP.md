# API 라우트 맵

## 세션/통계
- `POST /api/session/start`
- `POST /api/session/discard`
- `POST /api/session/stop`
- `POST /api/session/quick-log`
- `GET /api/sessions`
- `PUT /api/sessions/{event_id}`
- `DELETE /api/sessions/{event_id}`
- `GET /api/hud/summary`
- `GET /api/stats/overview`
- `GET /api/player/xp`

## 퀘스트/업적/해금
- `GET /api/quests/current`
- `POST /api/quests`
- `POST /api/quests/{quest_id}/claim`
- `POST /api/quests/{quest_id}/fail`
- `GET /api/achievements`
- `GET /api/achievements/recent`
- `POST /api/achievements/{achievement_id}/claim`
- `GET /api/unlockables`

## 카탈로그/라이브러리
- `GET /api/catalogs`
- Song library
  - `GET /api/song-library`
  - `POST /api/song-library`
  - `PUT /api/song-library/{library_id}`
  - `DELETE /api/song-library/{library_id}`
  - `POST /api/song-library/{library_id}/boss-clear`
- Drill library
  - `GET /api/drill-library`
  - `POST /api/drill-library`
  - `PUT /api/drill-library/{drill_id}`
  - `DELETE /api/drill-library/{drill_id}`
- Backing tracks
  - `GET /api/backing-tracks`
  - `POST /api/backing-tracks`
  - `PUT /api/backing-tracks/{backing_id}`
  - `DELETE /api/backing-tracks/{backing_id}`

## 기록장/갤러리/미디어
- Records
  - `GET /api/records/list`
  - `POST /api/records` (multipart)
  - `PUT /api/records/{post_id}`
  - `DELETE /api/records/{post_id}`
  - `PUT /api/records/{post_id}/attachments/{attachment_id}`
  - `DELETE /api/records/{post_id}/attachments/{attachment_id}`
- Gallery legacy
  - `GET /api/gallery/list`
  - `POST /api/gallery/upload`
  - `PUT /api/gallery/{event_id}`
  - `DELETE /api/gallery/{event_id}`
- Media legacy
  - `POST /api/media/upload`
  - `GET /api/media/list`

## 설정/백업/관리
- `GET /api/settings`
- `PUT /api/settings/basic`
- `PUT /api/settings/critical`
- `GET /api/tutorial/state`
- `POST /api/tutorial/start`
- `POST /api/tutorial/progress`
- `POST /api/tutorial/banner-seen`
- `POST /api/tutorial/complete`
- `POST /api/export`
- `GET /api/export/{name}`
- `GET /api/backup/list`
- `POST /api/backup/restore`
- `POST /api/system/pre-exit`
- `POST /api/admin/grant-xp`
- `POST /api/admin/reset-progress`
- `POST /api/admin/reset-all`
- `GET /api/admin/mock-data/datasets`
- `GET /api/admin/mock-data/status`
- `POST /api/admin/mock-data/activate`
- `POST /api/admin/mock-data/deactivate`
- `POST /api/admin/mock-data/export-current`

## 기타
- `GET /api/health`
- `POST /api/onboarding/complete`
