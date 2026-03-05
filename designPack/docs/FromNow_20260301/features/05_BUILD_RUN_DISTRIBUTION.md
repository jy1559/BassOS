# 실행/빌드/배포

## 로컬 개발 실행
1. Python 의존성 설치
```powershell
python -m pip install -r requirements.txt
```
2. 프론트 빌드
```powershell
cd frontend
npm.cmd install
npm.cmd run build
cd ..
```
3. 웹 실행
```powershell
python app.py
```
4. 데스크톱 실행
```powershell
python desktop.py
```

## exe 빌드
```powershell
powershell -ExecutionPolicy Bypass -File ./build_exe.ps1
```

## build_exe.ps1 핵심
- Python requirements 설치
- frontend 최신 빌드 확인(stale 체크)
- `designPack/icon.png`가 있으면 `designPack/icon.ico` 자동 변환
- pyinstaller로 `dist/BassOS/BassOS.exe` 생성

## PyWebView 실행 규칙
- Flask를 내부 스레드로 띄움
- health check 성공 후 창 생성
- 종료 직전 `POST /api/system/pre-exit` 호출(백업 트리거)

## 배포 체크리스트
1. `frontend/dist/index.html` 최신 여부
2. `app/data` 마이그레이션 정상 적용
3. 시작/종료/삭제/수정/복구 플로우 점검
4. 다크/네온 등 테마 가독성 점검
5. 작은 창(최소 크기) 반응형 점검
