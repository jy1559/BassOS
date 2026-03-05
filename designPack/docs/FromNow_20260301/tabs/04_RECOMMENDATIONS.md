# 추천곡 탭 상세

## 역할
- `song_ladderv2.csv` 기반 추천곡 큐레이션
- 라이브러리로 가져오기(import) 전 탐색/선별

## 데이터 원본
- `app/data/song_ladderv2.csv`
- 주요 컬럼
  - `ID`, `곡`, `아티스트`, `예상 난이도`, `장르`, `분위기 유형`, `핵심 테크닉 태그`, `설명 feature`, `상태`

## 기능
- 보기 필터
  - `추천 목록(active)`
  - `보관(archived)`
  - `라이브러리 반영(imported)`
  - `전체`
- 조건 필터
  - 난이도
  - 장르
  - 분위기
  - 검색(제목/아티스트/태그)
- 행 액션
  - 보관/복원
  - 라이브러리로 추가(createSong)
  - 유튜브 링크 열기

## 장르/분위기 처리
- 장르: 표준화(normalize) + 그룹화(buildGenreGroups)
- `Korea`/`Japan` 같은 표기는 `K-POP`/`J-POP`으로 정규화 로직 존재
- 분위기: CSV 값을 그대로 다중 필터 키로 사용

## 현재 제약/주의
- 상태(active/archived/imported)는 localStorage 기반이라 사용자/머신 종속
- 추천 설명이 긴 경우 행 높이가 커질 수 있음
- 장르 분류가 데이터 품질에 따라 다소 불균일할 수 있어 정제 정책 필요
