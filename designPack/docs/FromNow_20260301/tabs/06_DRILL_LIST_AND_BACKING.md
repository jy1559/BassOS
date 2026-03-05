# 드릴 리스트 + 배킹트랙 탭 상세

## 역할
- 드릴 라이브러리(연습 패턴)와 배킹트랙 라이브러리를 함께 관리
- 드릴 이미지/리소스, BPM 범위, 태그, 기본 배킹 연결까지 운영

## 드릴 필드
- `drill_id`, `name`, `description`, `area`, `favorite`
- `tags`, `bpm_min`, `bpm_max`, `bpm_step`
- `default_backing_id`
- `image_path`, `image_url`, `resource`, `notes`
- `created_at`, `last_used_at`

## 배킹트랙 필드
- `backing_id`, `title`, `description`, `genre`, `favorite`
- `chords`, `bpm`, `youtube_url`
- `drill_id`(연결 드릴)
- `tags`, `notes`
- `created_at`, `last_used_at`

## 드릴 분류/태그
- area 기본: `기본기`, `톤/그루브`, `이론/리딩`, `슬랩`, `퍼포먼스`, `기타`
- 태그는 한글 매핑 테이블로 표시(`TAG_KO`)
- 필터: 영역, 태그, 즐겨찾기, 검색
- 그룹: 없음 / 영역 / 태그

## 배킹트랙 필터
- 장르
- 태그
- BPM 범위(min/max)
- 즐겨찾기
- 그룹: 없음 / 장르 / 태그

## 이미지 업로드
- 드릴 생성/수정에서 이미지 파일 업로드
- 클립보드 이미지 붙여넣기 지원

## 확장 패널
- 각 드릴 row 확장 시
  - 누적 세션수, 누적 분, 누적 XP
  - 첫 연습/최근 연습
  - 최근 로그 일부

## 관련 API
- Drill
  - `GET/POST /api/drill-library`
  - `PUT/DELETE /api/drill-library/{drill_id}`
- Backing
  - `GET/POST /api/backing-tracks`
  - `PUT/DELETE /api/backing-tracks/{backing_id}`

## 현재 제약/주의
- 배킹트랙 라이브러리는 접기/펼치기 구조라 정보 밀도 조절 필요
- 태그 체계가 사용자 입력 혼합이라 장기적으로 표준화/추천 입력 필요
