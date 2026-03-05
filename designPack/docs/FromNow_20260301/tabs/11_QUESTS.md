# 퀘스트 탭 상세

## 역할
- 자동/주기 퀘스트 + 수동 TODO형 퀘스트를 분리 관리

## 섹션
1. 자동/주기 퀘스트
- Weekly/Monthly 생성형
- 반복 규칙(repeat_rule) 기반

2. 수동/깜짝 퀘스트
- 사용자 직접 추가
- 낮은 XP 보상(기본 0~40)

3. 퀘스트 추가
- 제목/설명/XP 입력 후 생성

## 액션
- 수령(claim)
- 실패(fail)

## 표시 정보
- 제목, 진행도(progress/target)
- XP 보상
- 상태(Active/Claimed/Failed)
- 설명

## 용어 정책
- `보스` 용어는 화면에서 `장기 목표` 계열로 정규화

## 관련 API
- `GET /api/quests/current`
- `POST /api/quests` (manual)
- `POST /api/quests/{quest_id}/claim`
- `POST /api/quests/{quest_id}/fail`

## 현재 제약/주의
- 수동 퀘스트 템플릿/유형 분류는 단순
- 세부 우선순위/반복 수동 설정은 아직 제한적
