# BassOS v1

Flask + React + PyWebView 기반의 로컬 베이스 연습 앱입니다.

## 주요 구현 상태
- Session Start/Stop/Quick Log + `events.csv` 저장
- HUD(총 XP/레벨/랭크/다음 해금/오늘·주간 XP)
- 주간/월간 퀘스트 자동 생성(월요일/매월 1일) + Claim
- 업적 엔진(rule_type 9종) + 자동 지급(`auto_grant`) + 수동 Claim
- 해금 목록 계산
- 미디어 업로드(로컬 경로 복사) + URL 병행
- Song Library CRUD + Boss Clear
- 백업 스냅샷(최대 3개) + Export ZIP
- 3분 온보딩 + 기본 설정 + 한/영 전환
- PyWebView 데스크톱 실행 진입점 + PyInstaller 빌드 스크립트

## 프로젝트 구조
```
app.py                  # Flask 서버 실행
desktop.py              # 데스크톱 셸 실행(PyWebView)
bassos/                 # 백엔드 패키지
frontend/               # React(Vite) 프론트
app/data                # 런타임 CSV/JSON 데이터
designPack/data         # 원본 템플릿 데이터(보존)
tests/                  # pytest
build_exe.ps1           # exe 빌드 스크립트
```

## 개발 실행
1. Python 의존성 설치
```powershell
python -m pip install -r requirements.txt
```
2. 프론트 설치/빌드
```powershell
cd frontend
npm.cmd install
npm.cmd run build
cd ..
```
3. 서버 실행
```powershell
python app.py
```
4. 데스크톱 앱 실행
```powershell
python desktop.py
```

## 테스트
```powershell
pytest -q
```

## exe 빌드
```powershell
./build_exe.ps1
```

## 참고
- 런타임 데이터는 `app/data`에 저장됩니다.
- 최초 실행 시 `designPack/data`를 `app/data`로 시드합니다.
- 백업/내보내기 파일은 `app/backups`, `app/exports`에 생성됩니다.
