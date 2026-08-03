#!/usr/bin/env python3
"""本地预览服务器（no-store，避免缓存旧 JS/CSS）
提供 /api/proxy 路由，解决浏览器端请求千问/DeepSeek 时的 CORS 限制。"""
import http.server, socketserver, sys, json, urllib.request, urllib.error, ssl

PORT = 8765
DIR = "www"

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format, *args):
        # 只打印 API 代理日志，静态资源太嘈杂
        if self.path == '/api/proxy':
            print(f"[proxy] {format % args}")

    def do_OPTIONS(self):
        if self.path == '/api/proxy':
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            return
        super().do_OPTIONS()

    def do_POST(self):
        if self.path == '/api/proxy':
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length).decode('utf-8')
                req = json.loads(body)
                target_url = req.get('url')
                headers = req.get('headers', {})
                payload = json.dumps(req.get('body', {}), ensure_ascii=False).encode('utf-8')

                if not target_url:
                    self.send_json(400, {'error': 'missing url'})
                    return

                request = urllib.request.Request(
                    target_url,
                    data=payload,
                    headers={**headers, 'Content-Type': 'application/json'},
                    method='POST'
                )
                ctx = ssl.create_default_context()
                try:
                    with urllib.request.urlopen(request, timeout=90, context=ctx) as resp:
                        data = resp.read()
                        self.send_response(resp.status)
                        self.send_header("Content-Type", "application/json")
                        self.send_header("Access-Control-Allow-Origin", "*")
                        self.end_headers()
                        self.wfile.write(data)
                except urllib.error.HTTPError as e:
                    body = e.read()
                    self.send_response(e.code)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    self.wfile.write(body)
            except Exception as e:
                self.send_json(500, {'error': str(e)})
            return
        super().do_POST()

    def send_json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

class ThreadingTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True

if __name__ == "__main__":
    with ThreadingTCPServer(("127.0.0.1", PORT), NoCacheHandler) as httpd:
        print(f"Serving {DIR}/ at http://localhost:{PORT} (no-store)")
        print(f"API proxy ready at http://localhost:{PORT}/api/proxy")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
