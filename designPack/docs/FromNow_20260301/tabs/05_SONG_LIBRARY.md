# 곡 라이브러리 탭 상세

## 역할
- 실제 연습 대상 곡을 관리하는 개인 DB
- 상태/장르/목적/즐겨찾기 중심으로 현재 연습 포트폴리오를 운영

## 곡 데이터 필드
- 식별: `library_id`, `song_id`
- 기본: `title`, `artist`
- 분류: `status`, `purpose`, `genre`, `tags`, `favorite`
- 목표/참고: `focus_section`, `goal_bpm`, `key`, `original_url`
- 미디어: `cover_path`, `cover_url`, `best_take_path`, `best_take_url`
- 메모: `notes`
- 시점: `created_at`, `last_practiced_at`

## 상태 체계(현재 코드 기준)
- 시작 전: `목표`, `예정`, `카피중`
- 진행 중: `시작`, `루프 연습`, `연습 중`
- 완료: `마무리`, `공연완료`, `포기`

## 목적(purpose) 옵션
- `실력 향상`
- `합주 및 공연`
- `좋아하는 노래`
- `카피 연습`
- `기타`

## 장르 입력/선택
- 리스트 기반 다중 선택(그룹형)
- 사용자 장르 풀: `settings.ui.song_genres`
- 추천곡/라이브러리 장르를 합쳐 통합 풀 생성
- 저장 포맷: `|` 구분 문자열

## 앨범 커버
- 파일 업로드 지원
- 클립보드 이미지 붙여넣기 지원
- 활용 위치
  - 곡 라이브러리 카드 썸네일
  - 연습 스튜디오 배경/참고
  - 대시보드 곡 바로가기 카드

## 보기/탐색
- 보기 모드: `gallery` / `list`
- 필터: 상태, 장르, 검색, 즐겨찾기만
- 정렬: 추가일/최근연습/제목/아티스트/상태 + ASC/DESC
- 그룹: 없음/상태/장르

## 상단 통계 카드
- 전체 곡 수
- 즐겨찾기 수
- 완료 곡 수
- 한 번 이상 연습한 곡 수
- 상태 파이(시작 전/진행 중/완료)

## 관련 API
- `POST /api/song-library`
- `PUT /api/song-library/{library_id}`
- `DELETE /api/song-library/{library_id}`
- `POST /api/song-library/{library_id}/boss-clear` (Long Goal Clear)

## 현재 제약/주의
- song_library가 비어 있으면 추천곡 의존도가 높아짐
- cover_path/cover_url 혼용 정책을 더 명확히 정리할 필요
