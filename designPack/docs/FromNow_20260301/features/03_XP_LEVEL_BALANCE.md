# XP/레벨 밸런스 상세

## 현재 설정(실행 데이터 기준)
- 세션 기본식
  - start_bonus: 38
  - per_10min: 26
  - max_base_xp: 210
- 체크 보너스
  - core_warmup 10
  - metronome_24 8
  - metronome_onebar 16
  - recording_audio 20
  - recording_video 24
  - earcopy 18
  - theory 12
  - slap 14
  - clean_mute 10
  - ab_compare 18
- weekly_chest: 420
- monthly_long_goal: 1600/2200
- daily_session_xp_cap: 420
- quest_xp_multiplier: 0.06
- achievement_xp_multiplier: 1.0

## 레벨 커브
- type: quadratic
- `xp_to_next(L) = a + b*(L-1) + c*(L-1)^2`
- a=600, b=20, c=1
- max_level=50

## 랭크 구간
- Bronze: Lv1+
- Silver: Lv10+
- Gold: Lv20+
- Platinum: Lv30+
- Diamond: Lv40+
- Challenger: Lv50

## 설계 의도
- 50레벨 장기 성장
- 세션/퀘스트/업적의 XP 기여 비율을 분리 제어
- 일일 세션 XP 캡으로 급격한 폭주 완화

## 운영 체크 포인트
1. 10분/30분/60분 세션의 체감 보상
2. 퀘스트 XP가 너무 약하거나 강하지 않은지
3. 업적 XP와 세션 XP 간 상대 비율
4. 삭제/수정 시 XP 역반영 정확도
5. 2년 플랜 대비 만렙 도달 속도

## 권장 계측
- 주별 평균 세션XP
- 주별 퀘스트/업적 기여 비중
- 레벨 구간별 체류 주차
- 일일 캡 도달 빈도
