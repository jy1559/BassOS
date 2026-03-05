# 기본 업적 레시피 표 (2026-03-01)

## 구성
- 티어형: 18개 그룹 x 6티어 = 108행
- 일회성: 12행
- 히든: 6행
- 총계: 126행

## 티어형 그룹 레시피 (6티어 공통)
| 그룹 ID Prefix | 이름 | rule_type | 핵심 rule_filter |
|---|---|---|---|
| `ACH_TIER_SESSION_ROUTINE` | 세션 루틴 | `count_events` | `event_type=SESSION`, `min_duration>=10` |
| `ACH_TIER_DEEP_FOCUS` | 딥 포커스 | `count_events` | `event_type=SESSION`, `min_duration>=30` |
| `ACH_TIER_LONG_FOCUS` | 롱폼 집중 | `count_events` | `event_type=SESSION`, `min_duration>=50` |
| `ACH_TIER_DURATION_SUM` | 누적 시간 | `sum_duration` | `event_type=SESSION` |
| `ACH_TIER_XP_STACK` | XP 축적 | `sum_xp` | `all_events=true` |
| `ACH_TIER_LEVEL_CLIMB` | 레벨 등반 | `level_reach` | `{}` |
| `ACH_TIER_SONG_PRACTICE` | 곡 연습 루틴 | `count_events` | `event_type=SESSION`, `tags_any=[SONG_PRACTICE]` |
| `ACH_TIER_REPERTOIRE_DISTINCT` | 레퍼토리 확장 | `distinct_count` | `event_type=SESSION`, `field=song_library_id` |
| `ACH_TIER_DRILL_DISTINCT` | 드릴 다양화 | `distinct_count` | `event_type=SESSION`, `field=drill_id` |
| `ACH_TIER_CORE_WEEKLY` | 코어 연속 루틴 | `streak_weekly` | `min_sessions=3`, `min_core_sessions=2`, `tag_core=CORE` |
| `ACH_TIER_MONTHLY_PACE` | 월간 페이스 | `streak_monthly` | `min_sessions_per_month=8` |
| `ACH_TIER_SLAP_MASTERY` | 슬랩 마스터리 | `count_events` | `event_type=SESSION`, `tags_any=[SLAP]` |
| `ACH_TIER_THEORY_EAR` | 이론/귀카피 탐구 | `count_events` | `event_type=SESSION`, `condition_tree: OR(tags contains THEORY, tags contains EAR_COPY)` |
| `ACH_TIER_ARCHIVE_RECORD` | 기록 아카이브 | `count_events` | `event_type=SESSION`, `tags_any=[RECORDING_AUDIO,RECORDING_VIDEO]` |
| `ACH_TIER_VIDEO_REVIEW` | 영상 리뷰 | `count_events` | `event_type=SESSION`, `tags_all=[RECORDING_VIDEO,AB_COMPARE]` |
| `ACH_TIER_BAND_FLOW` | 합주/무대 흐름 | `count_events` | `event_type=SESSION`, `condition_tree: AND(duration>=20, OR(tags contains BAND, tags contains PERFORMANCE))` |
| `ACH_TIER_COMMUNITY` | 커뮤니티 챌린지 | `count_events` | `event_type=SESSION`, `tags_any=[COMMUNITY]` |
| `ACH_TIER_BOSS_SONG_HUNTER` | 보스 송 헌터 | `boss_monthly` | `event_type=LONG_GOAL_CLEAR`, `boss_type=SONG_FULLTAKE` |

## 티어별 목표값 기본 패턴
- 티어명: Bronze / Silver / Gold / Platinum / Diamond / Master
- 예시(세션 루틴): `8, 24, 60, 140, 280, 520`
- 예시(누적 시간): `300, 1200, 3600, 9000, 18000, 30000`
- 예시(레벨 등반): `8, 15, 25, 35, 45, 50`

## 일회성 12개 레시피
| achievement_id | 이름 | rule_type | 핵심 조건 |
|---|---|---|---|
| `ACH_ONE_FIRST_SESSION` | 첫 세션 | `count_events` | `event_type=SESSION` |
| `ACH_ONE_FIRST_FOCUS_30` | 첫 30분 집중 | `count_events` | `event_type=SESSION`, `min_duration>=30` |
| `ACH_ONE_FIRST_AUDIO_LOG` | 첫 오디오 로그 | `count_events` | `event_type=SESSION`, `tags_any=[RECORDING_AUDIO]` |
| `ACH_ONE_FIRST_VIDEO_REVIEW` | 첫 영상 리뷰 | `count_events` | `event_type=SESSION`, `tags_all=[RECORDING_VIDEO,AB_COMPARE]` |
| `ACH_ONE_FIRST_BAND_STAGE` | 첫 합주/무대 | `count_events` | `event_type=SESSION`, `tags_any=[BAND,PERFORMANCE]` |
| `ACH_ONE_FIRST_COMMUNITY` | 첫 커뮤니티 | `count_events` | `event_type=SESSION`, `tags_any=[COMMUNITY]` |
| `ACH_ONE_FIRST_BOSS_CLEAR` | 첫 보스 클리어 | `count_events` | `event_type=LONG_GOAL_CLEAR` |
| `ACH_ONE_FIRST_EARCOPY_BOSS` | 첫 귀카피 보스 | `count_events` | `event_type=LONG_GOAL_CLEAR`, `boss_type=EARCOPY_FULL` |
| `ACH_ONE_WEEK_KEEPER_2W` | 2주 지킴이 | `streak_weekly` | `min_sessions=4`, `min_core_sessions=1`, `tag_core=CORE`, `target=2` |
| `ACH_ONE_MONTH_KEEPER_2M` | 2개월 지킴이 | `streak_monthly` | `min_sessions_per_month=10`, `target=2` |
| `ACH_ONE_STYLE_SWITCHER` | 스타일 스위처 | `manual` | 수동 체크(권장 증빙 가이드 제공) |
| `ACH_ONE_STAGE_DEBUT` | 무대 데뷔 | `manual` | 수동 체크(권장 증빙 가이드 제공) |

## 히든 6개 레시피
| achievement_id | 이름 | rule_type | 핵심 조건 |
|---|---|---|---|
| `ACH_HID_QUIET_ENGINE` | 고요한 엔진 | `count_events` | `event_type=SESSION`, `tags_all=[METRO_ONEBAR,CLEAN_MUTE]` |
| `ACH_HID_DOUBLE_ARCHIVE` | 더블 아카이브 | `count_events` | `event_type=SESSION`, `tags_all=[RECORDING_AUDIO,RECORDING_VIDEO]` |
| `ACH_HID_IRON_STREAK` | 아이언 스트릭 | `streak_weekly` | `min_sessions=5`, `min_core_sessions=3`, `target=3` |
| `ACH_HID_NIGHT_OWL` | 심야 집중 모드 | `count_events` | `condition_tree: event.hour_local>=22 AND duration_min>=40` |
| `ACH_HID_BOSS_CYCLE` | 보스 순환자 | `boss_monthly` | `event_type=LONG_GOAL_CLEAR`, `target=4` |
| `ACH_HID_REPERTOIRE_MASTER` | 숨은 레퍼토리 장인 | `distinct_count` | `event_type=SESSION`, `field=song_library_id`, `target=30` |

## 관리 페이지에서 규칙 해석 확인 방법
- 업적 편집기 우측 도움말 패널의 `현재 규칙 요약`
- `/api/admin/achievements/master` 응답의 `_rule_summary_ko`, `_rule_steps_ko`
