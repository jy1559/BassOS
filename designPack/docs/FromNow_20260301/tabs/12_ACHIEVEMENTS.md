# 업적 탭 상세

## 역할
- 연습 기록 기반 성과를 자동/수동 조건으로 추적하고 보상 지급

## 현재 규모(런타임 데이터 기준)
- 총 46개
- 카테고리: `곡`, `기록`, `단발`, `드릴`, `루틴`, `성장`, `이론`, `히든`
- rule_type: `count_events`, `distinct_count`, `level_reach`, `manual`, `streak_monthly`, `streak_weekly`, `sum_duration`, `sum_xp`
- 히든 업적 4개

## 필터
- 상태: 전체/달성 완료/미달성
- 유형: 전체/단발/티어형
- 카테고리
- 규칙 타입
- `다음 단계만 보기`

## 카드/행 구성
- 카테고리 아이콘
- 티어/카테고리 칩
- 진행 바
- 수치(progress/target, reward XP)
- 히든인 경우 힌트 기반 표시
- i(정보) hover로 상세 규칙/설명/힌트 표시

## 클레임
- auto_grant 업적은 세션/퀘스트 처리 시 자동 지급
- manual 업적은 수동 claim 버튼 사용
- claim 시 글로벌 토스트/celebration 연동

## 관련 API
- `GET /api/achievements`
- `GET /api/achievements/recent`
- `POST /api/achievements/{achievement_id}/claim`

## 현재 제약/주의
- 태그/용어가 데이터와 1:1 정합되지 않는 항목이 일부 남아 있을 수 있음
- 아이콘/색상 체계는 기능적으로는 동작하지만 시각 완성도 추가 개선 여지 큼
