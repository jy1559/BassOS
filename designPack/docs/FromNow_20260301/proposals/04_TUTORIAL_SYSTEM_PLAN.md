# 선택형 튜토리얼 시스템 계획 (2026-03-01)

## 목적
- 강제 온보딩이 아닌 "필요할 때 다시 보는" 가이드 제공
- 코어 동선(대시보드/연습/기록장/세션/설정) 학습 속도 향상
- 완주 보상으로 동기부여 강화(+60XP, 칭호)

## UX 방향
- 방식: 스포트라이트 가이드(실제 화면 요소 강조)
- 진입:
  - 상단 `? 가이드` 버튼
  - 설정 탭 튜토리얼 카드(코어 시작/이어하기/딥다이브)
- 자동 노출:
  - 코어 캠페인 미완료 사용자에게 대시보드 1회 추천 배너
  - 배너 노출 기록은 캠페인 단위로 저장

## 캠페인 구성
- 코어: `core_v1` (8 steps)
  - Dashboard HUD
  - Dashboard Next Win
  - Practice stepper
  - Practice start CTA
  - Journal composer
  - Sessions list
  - Settings mock status
  - Settings tutorial controls
- 딥다이브(각 1 step)
  - `deep_review`, `deep_xp`, `deep_songs`, `deep_drills`
  - `deep_quests`, `deep_achievements`, `deep_recommend`, `deep_tools`

## 데이터/상태 모델
- `settings.profile.tutorial_state`
  - `campaign_id`
  - `banner_seen_campaigns[]`
  - `completed_campaigns[]`
  - `reward_claimed_campaigns[]`
  - `resume_campaign_id`
  - `resume_step_index`
  - `last_started_at`
  - `last_completed_at`
- `settings.profile.guide_finisher_unlocked: bool`

## 보상 규칙
- 대상: 코어 캠페인 `core_v1` 완주 시
- 조건: 1회만 지급(idempotent)
- 결과:
  - `events.csv`에 `event_type=TUTORIAL_REWARD` append
  - XP +60
  - 칭호 플래그 `guide_finisher_unlocked=true`

## API
- `GET /api/tutorial/state`
- `POST /api/tutorial/start`
- `POST /api/tutorial/progress`
- `POST /api/tutorial/banner-seen`
- `POST /api/tutorial/complete`

## 검증 항목
- 상태 기본값/배너 1회/진행 저장/재개 동작
- 코어 완주 보상 1회성(+60XP)
- 탭 자동 이동 + 앵커 강조 fallback
- 최소 창(1000x700)에서 오버레이 가시성 유지
