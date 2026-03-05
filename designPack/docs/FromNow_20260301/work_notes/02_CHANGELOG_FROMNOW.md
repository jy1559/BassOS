# 변경 이력 (FromNow 2026-03-01)

## 규칙
- 한 줄 요약 + 영향 범위 + 검증 방법을 남긴다.
- 형식: `[날짜] [영역] 변경 요약 (검증)`

## 로그
- [2026-03-01] [docs] FromNow 문서 체계 생성: 탭별/기능별/개선 제안/작업 메모 폴더 신설 (파일 생성 확인)
- [2026-03-01] [tutorial] 선택형 튜토리얼 시스템 추가: 코어/딥다이브 가이드, 설정/상단 진입, 1회 보상(+60XP), 상태 API 도입 (pytest + e2e + exe 빌드)
- [2026-03-01] [tutorial+mock+encoding+dashboard] 코어 가이드 대시보드 5단계 세분화, 탭별 딥다이브 상세화(곡 추가 예시 포함), 샌드박스 샘플 `starter_demo_v1` 추가, CSV UTF-8 BOM 정책 고정, 대시보드 세로 이미지 높이 상한 적용 (pytest + e2e + exe 빌드)
- [2026-03-01] [mock-export] 현재 runtime 상태를 `designPack/mock_datasets/<dataset_id>/data`로 내보내는 API/설정 UI 추가, 60일 세션 히스토리 자동 생성 기능 도입, mock status에 실제 경로 노출 (pytest + e2e + exe 빌드)
