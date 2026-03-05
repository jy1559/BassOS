# 대시보드 탭 상세 (v11)

## 역할
- 앱 첫 화면에서 상태 확인(HUD), 세션 시작/종료, 퀘스트 처리, 진행률 확인, 곡 바로가기를 한 번에 제공
- 대시보드는 "실행 허브" 역할에 집중

## 버전 구조
- `legacy`: 기존 HUD 중심 흐름 복원용
- `focus`: 실행 집중형 기본 흐름
- 설정 탭에서 `dashboard_version` 즉시 전환(새로고침 불필요)
- Focus 기본 배치: `photo (x=3, y=1, h=3)`, `nextWin (x=3, y=4, h=1)`
- Focus 보조영역 순서: `곡 바로가기 -> 업적 스냅샷`

## 공통 핵심 위젯
1. HUD
- 닉네임, 레벨, 랭크, 배지
- 총 XP, 주간 XP, 다음 해금
- 총 연습시간

2. 세션 카드
- 메인 액션: `세션 시작`, `빠른 기록`
- 소형 모드 버튼(메인 액션 하단): `바로 시작 / 곡 선택 / 드릴 선택`
- 활성 세션 타이머
- 종료 시 세션 저장 모달

3. Quest Center (Next Win)
- 우선순위 정렬:
  - `수령가능`
  - `오늘 마감`
  - `7일 이내 마감(남은 기간 적은 순)`
  - `그 외(중요도 urgent>normal>low, 동률 시 남은 기간 적은 순)`
  - 최종 동률: `due_date asc -> xp desc -> quest_id`
- 카드 액션: `빠른 수령`, `퀘스트 탭 이동`
- Focus에서는 기본 1개 카드 + 요약(코치/다음 힌트) 표시
- 하단 요약: `오늘 마감 수 / 7일 이내 마감 수 / 전체 퀘스트 수`

4. 진행률
- 주간 세션 목표
- 주간/월간 시간 목표

5. 곡 바로가기
- 최대 8곡 고정 슬롯
- 클릭 시 해당 곡으로 즉시 세션 시작

6. 대시보드 사진
- 대시보드 전용 이미지 컬렉션
- 파일 업로드 + 클립보드 붙여넣기
- 앵커(중앙/상/하/좌/우)

7. 업적 스냅샷(옵션)
- 기본 숨김

## 제거된 위젯/로직
- TODO 위젯 제거
- 진행중 곡 위젯 제거
- 중복 퀘스트 위젯 제거 (Quest Center로 통합)

## 레이아웃/저장 키
- `settings.ui.dashboard_version`
- `settings.ui.dashboard_layout_legacy`
- `settings.ui.dashboard_layout_focus`
- `settings.profile.song_shortcuts`
- `settings.profile.dashboard_photo_items`
- `settings.profile.dashboard_featured_photo_id`
- `settings.profile.dashboard_photo_anchor`

## 튜토리얼 앵커
- `tutorial-dashboard-hud`
- `tutorial-dashboard-timer`
- `dashboard-next-win`
- `tutorial-dashboard-photo`
- `tutorial-dashboard-shortcuts`
- 상단 자동 튜토리얼 배너는 제거되며, 사이드바 Help 버튼으로만 코어 가이드 시작

## 반응형 원칙
- `<=1460px`에서 1열 강제 + 인라인 grid 위치 무효화
- 좁은 화면에서 카드 순서 보장: `HUD -> TIMER -> QUEST CENTER`
- 1000x700 환경에서 오버플로우 없이 동작하도록 카드/메뉴 최대 높이 제한
- 대형 화면(`>=1366x768`)은 대시보드 영역을 세로로 채우고, 중소형은 자동 높이+스크롤 우선
