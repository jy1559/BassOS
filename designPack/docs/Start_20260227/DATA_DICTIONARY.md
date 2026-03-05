# 데이터 사전(Data Dictionary)

이 프로젝트는 로컬 CSV 파일을 DB처럼 사용합니다.

## events.csv (XP 장부)
- **목적:** 모든 XP의 원천. 세션/퀘스트/업적/보스 등 모든 행동을 ‘이벤트 1줄’로 기록.
- **팁:** `tags`에 세미콜론으로 태그를 남기면 업적/필터링이 쉬워집니다.
- **권장 태그:** CORE, FUNKJAZZ, THEORY, SLAP, SONG_COPY, SONG_PRACTICE, BAND, PERFORMANCE,
  METRO_24, METRO_ONEBAR, CLEAN_MUTE, EAR_COPY, RECORDING_AUDIO, RECORDING_VIDEO, AB_COMPARE 등

## achievements_master.csv
- **목적:** 업적 정의. 티어별로 한 줄.
- **중요:** 실제 “획득”은 events.csv에 ACHIEVEMENT_CLAIM 이벤트를 남겨서 중복을 막습니다.

## song_ladder.csv / song_library.csv
- Ladder: 추천곡 카탈로그(대량)
- Library: 내가 실제로 연습하는 곡(목적/상태/원곡 링크/내 테이크)

## drill_catalog.csv
- 기본기/펑크&재즈/이론/슬랩 등 드릴 목록
- drill_id를 세션에 연결하면 “드릴 수집가” 같은 업적이 자동으로 굴러갑니다.

## quests.csv
- 주간/월간 과제. 완료 버튼을 누르면 QUEST_CLAIM 이벤트로 XP 지급.

## unlockables.csv
- 레벨에 따라 테마/기능/칭호 해금.

