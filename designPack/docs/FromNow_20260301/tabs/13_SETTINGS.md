# 설정 탭 상세 (v11)

## 역할
- 기본 UI/프로필 설정
- Critical 밸런스 파라미터 조정
- 테스트/관리자 액션
- 해금 목록 확인

## 기본 설정
- 닉네임
- 사운드 on/off
- 테마 선택(레벨 해금 조건)
  - studio, dark, jazz, neon, sunset, forest, ocean, midnight, candy, volcanic
- 대시보드 버전 전환
  - `legacy` / `focus`
- 대시보드 글라스 카드 on/off
- 대시보드 배치(고급)
  - 현재 `dashboard_version` 대상 레이아웃 편집(X/Y/W/H/Visible)
  - `hud/timer` 표시 고정, Focus `nextWin.h=1` 고정
  - 사진 카드는 `h=3`까지 확장 가능
  - Reset/Save 즉시 `/api/settings` 반영
- 공유 카드 이미지 생성(해금 필요)

## 대시보드 관련 설정 키
- 유지
  - `ui.dashboard_version`
  - `ui.dashboard_layout_legacy`
  - `ui.dashboard_layout_focus`
  - `ui.dashboard_glass_cards`
  - `profile.dashboard_photo_items`
  - `profile.dashboard_featured_photo_id`
  - `profile.dashboard_photo_anchor`
  - `profile.song_shortcuts`
- 제거
  - `ui.dashboard_bg_mode`
  - `ui.dashboard_live_motion`
  - `ui.dashboard_layout`
  - `profile.dashboard_photo_fit`
  - `profile.dashboard_todo`
  - `profile.dashboard_todo_items`

## Critical Settings
- XP(session)
  - `start_bonus`, `per_10min`, `max_base_xp`
- Critical
  - `backfill_multiplier_default`
  - `achievement_xp_multiplier`
  - `quest_xp_multiplier`
- Level Curve
  - `a`, `b`, `c`, `max_level`

## 테스트/초기화
- 다음 레벨까지 필요한 XP 자동 지급(Test Level Up)
- 진행도 초기화(XP/레벨)
- 전체 초기화(런타임 데이터/미디어 포함)

## 튜토리얼
- 코어 튜토리얼 시작/이어하기
- 딥다이브 가이드 선택 시작
- 코어 가이드 완주 1회 보상(+60XP)
- 대시보드 자동 배너는 비활성화, Help 버튼/설정 탭에서 수동 시작만 지원

## 관련 API
- `GET /api/settings`
- `PUT /api/settings/basic`
- `PUT /api/settings/critical`
- `GET /api/tutorial/state`
- `POST /api/tutorial/start`
- `POST /api/tutorial/progress`
- `POST /api/tutorial/banner-seen`
- `POST /api/tutorial/complete`
- `POST /api/admin/grant-xp`
- `POST /api/admin/reset-progress`
- `POST /api/admin/reset-all`
