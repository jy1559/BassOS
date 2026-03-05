from __future__ import annotations

import os

from bassos.app_factory import create_app


app = create_app()


if __name__ == "__main__":
    host = os.getenv("BASSOS_HOST", "127.0.0.1")
    port = int(os.getenv("BASSOS_PORT", "5000"))
    app.run(host=host, port=port, debug=False)
