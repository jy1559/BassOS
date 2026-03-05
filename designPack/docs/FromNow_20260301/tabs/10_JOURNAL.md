# 기록장 탭 상세

## 역할
- 기존 갤러리/미디어를 통합한 개인 커뮤니티형 기록 피드
- 글(제목/본문) + 다중 첨부 + 곡/드릴 연결 + 태그 기반 검색

## 데이터 모델
1. Post (`record_posts.csv`)
- `post_id`, `created_at`, `updated_at`
- `title`, `body`, `post_type`
- `tags[]`, `linked_song_ids[]`, `linked_drill_ids[]`, `free_targets[]`
- `source_context`, `legacy_event_id`, `source`

2. Attachment (`record_attachments.csv`)
- `attachment_id`, `post_id`, `created_at`
- `media_type(image/video/audio)`
- `path/url`, `title`, `notes`, `sort_order`

## 상단 바
- 검색
- 기간(주/월/연/선택)
- 필터(미디어 타입, 연결 곡/드릴)
- 보기 모드(list/gallery)
- 글쓰기
- 보기 모드는 localStorage 기억

## 글쓰기(Composer)
- 제목, 본문(큰 textarea)
- Context: practice/review/performance/archive
- 커스텀 태그(쉼표)
- 자유 대상(쉼표)
- 연결 곡/드릴 다중 선택
  - 검색
  - 그룹화
  - 즐겨찾기 그룹 우선
- 첨부
  - image/video/audio 혼합
  - 최대 8개
  - 클립보드 이미지 추가 지원

## 피드 카드
- 작성일, 제목, 본문 요약
- inline 미디어(이미지/영상/오디오)
- 연결 곡/드릴 표시
- 태그 chips
- 첨부 개수

## 편집/삭제
- 게시글 수정/삭제
- 첨부 개별 메타(제목/노트/정렬) 수정
- 첨부 개별 삭제

## 관련 API
- `GET /api/records/list`
- `POST /api/records` (multipart)
- `PUT /api/records/{post_id}`
- `DELETE /api/records/{post_id}`
- `PUT/DELETE /api/records/{post_id}/attachments/{attachment_id}`

## 현재 제약/주의
- 편집 모드에서 새 첨부 추가는 현재 제한(신규 글 작성 흐름 권장)
- post_type은 현재 UI에서 고정값(`기록`) 사용
