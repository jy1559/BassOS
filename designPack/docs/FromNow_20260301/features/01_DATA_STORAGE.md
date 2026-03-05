# 데이터/스토리지 상세

## 런타임 원칙
- 원본 템플릿: `designPack/data`
- 실사용 데이터: `app/data`
- 앱 미디어: `app/media`

## 핵심 파일
1. 세션/XP 로그
- `events.csv`
- 모든 XP 이벤트의 원장

2. 설정
- `settings.json`
- UI/오디오/프로필/Critical/레벨 커브

3. 라이브러리
- `song_library.csv`
- `drill_library.csv`
- `backing_tracks.csv`

4. 도전
- `quests.csv`
- `achievements_master.csv`
- `unlockables.csv`

5. 기록장
- `record_posts.csv`
- `record_attachments.csv`

6. 추천곡
- `song_ladder.csv`, `song_ladderv2.csv`

## 미디어 폴더
- `app/media/evidence/{audio,video,image}`
- `app/media/gallery/{audio,video,image}`
- `app/media/records/{audio,video,image}`

## 앱 시작 시 처리
1. 런타임 데이터 시드
2. CSV 헤더/컬럼 마이그레이션
3. 퀘스트 템플릿 초기화
4. 부트스트랩 데이터 보정
5. 시작 시점 백업 체크

## 백업/복구
- `app/backups`
- `app/exports`
- pre-exit 훅에서 백업 트리거

## 리셋 범위
- 진행도 리셋: events/세션상태 중심
- 전체 리셋: runtime_data/runtime_media/backups/exports 재생성
