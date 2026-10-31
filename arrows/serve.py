"""Local iPad preview. Only the playable Arrows directory is served."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent
PORT = 5174


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


with ThreadingHTTPServer(('0.0.0.0', PORT), Handler) as server:
    print(f'Local: http://localhost:{PORT}', flush=True)
    for interface in ('en0', 'en1'):
        try:
            address = subprocess.check_output(['ipconfig', 'getifaddr', interface], text=True, stderr=subprocess.DEVNULL).strip()
            if address:
                print(f'iPad 同一 Wi-Fi: http://{address}:{PORT}', flush=True)
        except (OSError, subprocess.CalledProcessError):
            pass
    print('保持窗口开启；按 Ctrl+C 停止。', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
