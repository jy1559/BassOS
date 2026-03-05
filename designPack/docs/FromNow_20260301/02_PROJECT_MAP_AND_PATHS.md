# 프로젝트 구조/경로 정리 (2026-03-01 기준)

## 1) 루트 주요 경로
- `app.py`
  - 로컬 서버 진입점
- `desktop.py`
  - PyWebView 데스크톱 실행 진입점
- `build_exe.ps1`
  - Windows exe 빌드 스크립트
- `BassOS.spec`
  - PyInstaller 설정

## 2) 백엔드
- `bassos/api.py`
  - Flask API 엔드포인트
- `bassos/services/`
  - 도메인 로직(XP, 업적, 퀘스트, 라이브러리, 기록장 등)
- `bassos/constants.py`
  - CSV 헤더/상수/기본값
- `bassos/utils/`
  - 공통 유틸

## 3) 프론트엔드
- `frontend/src/App.tsx`
  - 메인 레이아웃/탭 네비게이션
- `frontend/src/api.ts`
  - 백엔드 통신 레이어
- `frontend/src/styles.css`
  - 전역 스타일/테마
- `frontend/src/metronome.tsx`
  - 메트로놈 컴포넌트
- `frontend/src/pages/`
  - 페이지 단위 UI
  - 예: `DashboardPage.tsx`, `PracticeStudioPage.tsx`, `SongsPage.tsx`, `DrillLibraryPage.tsx`, `GalleryPage.tsx`, `SessionsPage.tsx`, `ReviewPage.tsx`, `XPPage.tsx`, `AchievementsPage.tsx`, `QuestsPage.tsx`, `SettingsPage.tsx`

## 4) 데이터 경로(런타임)
- `app/data/`
  - 실행 데이터 저장 위치(실사용)
  - 주요 파일:
    - `events.csv`
    - `settings.json`
    - `song_library.csv`
    - `drill_library.csv`
    - `backing_tracks.csv`
    - `achievements_master.csv`
    - `quests.csv`
    - `unlockables.csv`
    - `record_posts.csv`
    - `record_attachments.csv`
    - `song_ladder.csv`, `song_ladderv2.csv`
- `app/media/`
  - 업로드/첨부 미디어 저장 위치

## 5) 기획 문서 경로
- `designPack/docs/Start_20260227/`
  - 초기 문서 아카이브
- `designPack/docs/FromNow_20260301/`
  - 현재 기준 운영 문서

## 6) 설계상 중요 규칙
- `designPack` 데이터는 원본 템플릿/기획 자료 성격
- 실제 앱 동작 데이터는 `app/data`를 기준으로 누적
- CSV/JSON 변경 시:
  1. 헤더 상수(`constants.py`) 반영
  2. 스토리지 초기화/마이그레이션 로직 반영
  3. API/프론트 타입 동기화

