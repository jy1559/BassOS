# Codex 전달용 구현 브리프 (로컬 웹앱 + CSV DB)

아래 요구사항대로 “Bass Practice Game” 로컬 웹앱을 구현해줘.  
나는 웹을 잘 모르고, 파이썬은 익숙하다.  
**목표:** 버튼 2번으로 기록이 끝나는 UX + 화려한 레벨업/업적/해금 UI + 로컬 CSV 저장.

---

## 1) 기술 스택(권장)
- Python 백엔드: **Flask** (단순, 로컬 개발 쉬움)
- 프론트: **Vanilla HTML/CSS/JS** (프레임워크 없이인데, 무조건 바닐라일 필요는 없음. 초보한테 적절히)
- 데이터 저장: `BASSOS/designPack/data/*.csv` 및 `BASSOS/designPack/data/settings.json`
- 미디어: `BASSOS/designPack/media/` 폴더(내 녹음 mp3/mp4 저장), 원곡은 유튜브 링크 사용

> 중요: 브라우저 단독으로는 파일 쓰기가 까다로우니, Flask로 CSV read/write API를 제공해줘.

---

## 2) 프로젝트 구조(제안)
```
bass-practice-game/
  app.py
  data/
    settings.json
    events.csv
    achievements_master.csv
    unlockables.csv
    quests.csv
    drill_catalog.csv
    song_ladder.csv
    song_library.csv
  media/
  static/
    index.html
    styles.css
    app.js
    assets/
      icons/...
      sfx/levelup.mp3 (옵션)
```

---

## 3) 핵심 UI/UX(최우선)
### Home(Dashboard) – 단 3구역만 크게
1) **PLAYER HUD**
- Total XP, Level, Rank
- Progress bar (다음 레벨까지 %)
- “다음 해금(레벨/이름)” 미리보기
- 최근 획득 XP(오늘/이번 주)

2) **SESSION TIMER (가장 크게)**
- [Start Session] 버튼
- 세션 진행 중: 큰 타이머 표시 + [Stop Session]
- Stop 누르면 “짧은 입력 모달”:
  - Activity(드롭다운): Core / Funk&Jazz / Theory / Slap / SongCopy / SongPractice / Band / Performance / Community / Gear
  - Song 선택(옵션): Song Library 항목
  - Drill 선택(옵션): Drill Catalog
  - 체크박스: METRO_24, METRO_ONEBAR, CLEAN_MUTE, EAR_COPY, RECORDING_AUDIO, RECORDING_VIDEO, AB_COMPARE
  - 증거: 파일 업로드(옵션) 또는 URL(옵션)
  - Notes(옵션)
  - 저장(=events.csv에 기록 + XP 계산)

3) **TODO(Quests)**
- 이번 주 퀘스트 2개 + 월간 보스 1개만
- 완료 버튼 누르면 QUEST_CLAIM 이벤트를 events.csv에 추가

### 보조 페이지(탭/사이드바)
- Achievements(업적): 카드/그리드, 티어 진행바, “Claim” 버튼
- Song Ladder(추천곡): 필터(난이도/에너지/태그)
- My Song Library: 내가 연습하는 곡 관리 + 보스(완주) 버튼
- Media: 곡별 내 테이크 재생 + (해금 시) A/B 플레이어
- Drill Catalog: 연습 메뉴(빠른 선택)

---

## 4) 데이터 모델(필수)
### events.csv (XP 장부, 단일 소스)
컬럼(순서 고정):
- event_id, created_at, start_at, end_at, duration_min,
  event_type, activity, xp, title, notes,
  song_library_id, drill_id, quest_id, achievement_id,
  tags, evidence_type, evidence_path, evidence_url, meta_json, source

event_type 예:
- SESSION
- QUEST_CLAIM
- ACHIEVEMENT_CLAIM
- BOSS_CLEAR
- COMMUNITY
- GEAR
- ADJUSTMENT

tags: 세미콜론 구분 문자열 (예: CORE;METRO_24;RECORDING_AUDIO)

### achievements_master.csv
- achievement_id, group_id, name, tier, tier_name, category, rarity,
  rule_type, rule_filter, target, xp_reward, description, evidence_hint

rule_type 최소 지원:
- count_events / sum_duration / sum_xp / distinct_count / streak_weekly / streak_monthly / boss_monthly / level_reach / manual

### song_library.csv
- library_id, song_id, title, artist, purpose, status, focus_section, goal_bpm, key,
  original_url, best_take_path, best_take_url, tags, notes, created_at, last_practiced_at

### settings.json
- XP 계산 파라미터
- 레벨 커브(a,b,c)
- 랭크 기준

---

## 5) XP 계산 로직(Stop Session 시)
settings.json을 읽어서:
- base_xp = min(max_base_xp, start_bonus + per_10min * floor(duration/10))
- 체크박스 보너스를 합산
- events.csv에 최소 1줄 기록(SESSION)
  - xp 컬럼에 총합을 기록해도 되고,
  - “base/bonus를 분리 이벤트로 2줄 이상” 기록해도 된다(권장: 투명함).

---

## 6) 업적(Claim) 흐름
- 앱은 events.csv를 기반으로 각 업적의 progress를 계산
- 조건을 만족하면 “UNLOCKED” 상태로 표시
- 사용자가 Claim 누르면:
  - events.csv에 ACHIEVEMENT_CLAIM 이벤트 추가(xp= xp_reward)
  - 중복 Claim 방지(achievement_id 이미 claim되었으면 불가)

---

## 7) 해금(Unlockables) 흐름
- 현재 Level을 계산한 후 unlockables.csv의 level_required와 비교
- 해금된 항목을 UI에서 활성화
- 해금 시 토스트/애니메이션 표시(게임 느낌)

---

## 8) 미디어 재생
- 로컬 mp3/mp4: Flask static으로 제공해서 `<audio>`/`<video>`로 재생
- 유튜브: iframe embed
- 곡 페이지에서 원곡 + 내 테이크를 나란히 보여주기
- (옵션) 반복/구간 루프 UI 제공

---

## 9) 구현 우선순위(이 순서로 완성도 높이기)
1) Session Start/Stop + events.csv 저장 + HUD 업데이트
2) Level/Ranks/Progress bar + 레벨업 애니메이션
3) Quests 완료(버튼) + XP 적립
4) Achievements progress 계산 + Claim
5) My Song Library CRUD + Boss Clear 버튼
6) 미디어(YouTube/Audio) 재생 + A/B 플레이어
7) Unlockables(테마/기능) 적용

---

## 10) 실행 방법(개발자용)
- `python app.py` 실행 후 `http://localhost:5000` 접속
- data 폴더가 없으면 자동 생성, events.csv 헤더가 없으면 자동 초기화
- 간단하게 실행할 수 있도록 .exe같은거 있으면 좋을 것 같음
