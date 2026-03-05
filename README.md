# BassOS

BassOS is a desktop app built with Flask + React + PyWebView.

## Install For End Users (Recommended)
Use a prebuilt release instead of building from source.

1. Open GitHub `Releases`:
   `https://github.com/jy1559/BassOS/releases`
2. Download the latest Windows asset (zip).
3. Unzip and run `BassOS.exe`.

This is the simplest path for non-developers.

## Run From Source (Developers)
From project root:

```powershell
./run_dev.ps1
```

`run_dev.ps1` does:
- install Python dependencies
- install/build frontend
- launch desktop app (`desktop.py`)

If you only want API server:

```powershell
./run_dev.ps1 -ApiOnly
```

## Manual Dev Commands (Fallback)

```powershell
python -m pip install -r requirements.txt
cd frontend
npm.cmd ci
npm.cmd run build
cd ..
python desktop.py
```

## Build EXE

```powershell
./build_exe.ps1
```

Build output:
- `dist/BassOS/BassOS.exe`

## Publishing EXE On GitHub
Possible and common. Recommended method:
- do not commit `.exe` into repository history
- upload zip/exe as a Release asset

Reason:
- cleaner git history
- large binaries are hard to version in git
- GitHub file size limits apply (100MB per file in normal git push)
