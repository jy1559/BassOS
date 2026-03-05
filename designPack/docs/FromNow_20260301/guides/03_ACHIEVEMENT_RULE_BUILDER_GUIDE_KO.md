# 업적 규칙 빌더 가이드 (KOR)

## 1) 빌더 사용 순서
1. 기본 정보 입력: 업적 이름/설명/보상/표시 순서
2. 진행 계산 선택: `rule_type`, `target`, 기본 필터(`event_type`, `tags_any/all`, `min_*`, `field`, `boss_type`)
3. 조건 트리 구성: 그룹(AND/OR) + 조건(필드/연산자/값)
4. 고급(JSON): 필요할 때만 열어서 직접 수정

## 2) rule_type 뜻
- `count_events`: 조건 만족 이벤트 개수 누적
- `sum_duration`: `duration_min` 합계(분)
- `sum_xp`: XP 합계
- `level_reach`: 플레이어 레벨 도달
- `distinct_count`: 특정 필드의 고유값 개수
- `streak_weekly`: 주간 연속 달성
- `streak_monthly`: 월간 연속 달성
- `boss_monthly`: 보스 클리어 발생 월 수
- `manual`: 수동 체크 업적

## 3) 주요 필드 사전 (한글 + 원문)
- 이벤트 종류 (`event_type`): SESSION / LONG_GOAL_CLEAR 등
- 활동 (`activity`), 세부활동 (`sub_activity`)
- 세션 길이(분) (`duration_min`)
- 이벤트 XP (`xp`)
- 태그 목록 (`tags`)
- 기록 출처 (`source`)
- 곡 장르 (`song.genre`), 곡 상태 (`song.status`), 아티스트 (`song.artist`), 곡 제목 (`song.title`), 곡 무드 (`song.mood`)
- 드릴 영역 (`drill.area`), 드릴 이름 (`drill.name`)
- 이벤트 시각(시) (`event.hour_local`)
- 요일 번호 (`event.weekday`, 월=0 ~ 일=6)
- 월 (`event.month`)
- 주말 여부 (`event.is_weekend`)

## 4) 연산자
- `eq`: 같다
- `ne`: 다르다
- `gt` / `gte`: 초과 / 이상
- `lt` / `lte`: 미만 / 이하
- `contains`: 포함
- `in` / `not_in`: 목록 중 하나 / 목록 외
- `exists` / `not_exists`: 값 있음 / 없음

## 5) 조건 트리 예시
### 예시 A: 합주/무대 + 20분 이상
- 루트 그룹: ALL
- 조건 1: `duration_min >= 20`
- 하위 그룹(ANY)
- 조건 2: `tags contains BAND`
- 조건 3: `tags contains PERFORMANCE`

### 예시 B: 심야 집중
- 루트 그룹: ALL
- 조건 1: `event.hour_local >= 22`
- 조건 2: `duration_min >= 40`

## 6) 작성 팁
- 범위 필터는 먼저 `event_type`/`min_duration`으로 좁히고, 세부 분기는 `condition_tree`에서 처리
- enum 필드는 드롭다운 선택 우선, 예외 값만 직접 입력
- 복잡해지면 하위 그룹을 만들어 AND/OR를 분리
- `manual` 업적은 실제 현장 경험(무대 데뷔, 스타일 전환) 같은 자동 추적 어려운 경우에만 사용
