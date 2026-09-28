"""Static dev server that never lets the browser cache anything.

`python -m http.server` sends Last-Modified and no Cache-Control, so browsers
happily reuse ES modules across reloads. With a module graph this size that
means an edit to one file can silently fail to load while its neighbours update
-- which looks exactly like a bug in the game. Everything here is no-store.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # the request spam is not useful here


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    print(f"bullet heaven: http://localhost:{port} (no-store)")
    ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()
