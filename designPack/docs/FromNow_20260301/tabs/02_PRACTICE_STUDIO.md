# 연습 스튜디오 탭 상세

## 역할
- 곡 연습/드릴 연습의 실제 실행 공간
- 선택 대상의 참고 자료(영상/이미지/배킹)와 대상별 히스토리를 같이 제공

## 기본 흐름
1. 연습 유형 선택
- `곡 연습` 또는 `드릴 연습`

2. 대상 검색/선택
- 즐겨찾기 우선 + 최근 사용량 기반 정렬
- 그룹형 select(optgroup)
  - 곡: 즐겨찾기 + 상태 그룹
  - 드릴: 즐겨찾기 + 영역 그룹

3. 빠른 선택 UI
- 곡: 앨범 커버 빠른 선택 카드
- 드릴: 빠른 선택 pill

4. 대상 세션 시작
- 곡이면 `Song + SongPractice`
- 드릴이면 `Drill + drillSubActivity(area 기반)`

## 곡 연습 상세
- 곡 링크는 `original_url`, `best_take_url`에서 수집
- 유튜브 링크는 embed URL로 변환하여 iframe 표시
- 링크가 여러 개면 선택 가능(기본 첫 링크)
- 곡 커버가 있으면 스튜디오 배경으로 사용 가능

## 드릴 연습 상세
- 드릴 이미지(`image_url`/`image_path`)를 중앙 참고로 사용
- 배킹트랙 사용 여부 토글
- 배킹트랙 선택 필터
  - 검색어
  - 장르
  - BPM 최소/최대
- 드릴별 기본 배킹트랙(`default_backing_id`) 자동 우선
- 배킹트랙 유튜브 링크 iframe 재생

## 연습 기록 보기
- 선택한 대상(곡 또는 드릴) 기준 최근 로그 30개
- 요약: 세션 수, 총 분, 총 XP, 첫 기록/최근 기록
- 로그에는 날짜/시간, 분, 속도/BPM, 노트 중심 표시

## 관련 데이터
- Song: `song_library.csv`
- Drill: `drill_library.csv + drill_catalog.csv`
- Backing: `backing_tracks.csv`
- Session history: `events.csv`

## 현재 제약/주의
- 곡/드릴 전환 시 설정 패널 상태가 많아 UI 밀도가 높음
- iframe/참고패널의 공간 배분이 창 크기에 따라 불균형해질 수 있음
- 선택 필터가 많아도 키보드 중심 탐색 UX는 아직 약함
