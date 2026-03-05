from __future__ import annotations

import ctypes
import os
from pathlib import Path
import sys
import threading
import time
from urllib import request as urlrequest

from bassos.app_factory import create_app

HOST = "127.0.0.1"
PORT = int(os.getenv("BASSOS_PORT", "5000"))
BASE_URL = f"http://{HOST}:{PORT}"


def _runtime_root() -> Path:
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", "")
        if meipass:
            return Path(str(meipass))
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def _runtime_icon_path() -> Path | None:
    root = _runtime_root()
    candidate = root / "designPack" / "docs" / "icon.ico"
    if candidate.exists():
        return candidate
    return None


def _set_windows_app_id() -> None:
    if os.name != "nt":
        return
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("BassOS.Desktop")
    except Exception:
        pass

def run_flask() -> None:
    app = create_app()
    app.run(host=HOST, port=PORT, debug=False, use_reloader=False)


def wait_until_up(timeout_s: float = 12.0) -> bool:
    start = time.time()
    while time.time() - start < timeout_s:
        try:
            with urlrequest.urlopen(f"{BASE_URL}/api/health", timeout=1.0) as response:
                if response.status == 200:
                    return True
        except Exception:
            time.sleep(0.2)
    return False


def notify_pre_exit() -> None:
    try:
        req = urlrequest.Request(f"{BASE_URL}/api/system/pre-exit", method="POST")
        urlrequest.urlopen(req, timeout=2.0).read()
    except Exception:
        pass


if __name__ == "__main__":
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()
    if not wait_until_up():
        raise RuntimeError("Flask server did not start in time.")

    try:
        import webview
    except ImportError as exc:
        raise SystemExit("pywebview is required. Run: pip install pywebview") from exc

    _set_windows_app_id()

    window = webview.create_window(
        title="BassOS",
        url=BASE_URL,
        width=1400,
        height=940,
        min_size=(1000, 700),
        confirm_close=True,
    )

    def on_closing():
        notify_pre_exit()
        return True

    def apply_runtime_icon() -> None:
        if os.name != "nt":
            return
        icon_path = _runtime_icon_path()
        if not icon_path:
            return
        try:
            gui = getattr(window, "gui", None)
            browser_view = getattr(gui, "BrowserView", None)
            if not browser_view:
                return
            form = browser_view.instances.get(window.uid)
            if not form:
                return
            import clr  # type: ignore

            clr.AddReference("System.Drawing")
            from System.Drawing import Icon  # type: ignore

            form.Icon = Icon(str(icon_path))
        except Exception:
            pass

    window.events.closing += on_closing
    webview.start(func=apply_runtime_icon, debug=False)
