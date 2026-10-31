"""Serve only the playable game folder, with local-network addresses for an iPad."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import socket
import subprocess

ROOT = Path(__file__).resolve().parent
PORT = 5173

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

addresses = set()
for interface in ('en0', 'en1'):
    try:
        address = subprocess.check_output(['ipconfig', 'getifaddr', interface], stderr=subprocess.DEVNULL, text=True).strip()
        if address:
            addresses.add(address)
    except (OSError, subprocess.CalledProcessError):
        pass
if not addresses:
    try:
        addresses.update(a[4][0] for a in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET) if not a[4][0].startswith('127.'))
    except OSError:
        pass

with ThreadingHTTPServer(('0.0.0.0', PORT), Handler) as server:
    print(f'电脑打开：http://localhost:{PORT}', flush=True)
    for address in sorted(addresses):
        print(f'iPad 同一 Wi-Fi 打开：http://{address}:{PORT}', flush=True)
    print('保持此窗口开启，按 Ctrl+C 停止。', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n游戏服务已停止。', flush=True)
