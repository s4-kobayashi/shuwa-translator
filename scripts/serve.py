"""Local static server for development and E2E tests.

Usage:  uv run scripts/serve.py [port] [directory] [--prefix /repo-name]

Why not `python -m http.server`: on Windows the mimetypes module reads the
registry (HKCR), where .js is often text/plain and .wasm is missing, which
breaks ES-module imports and WebAssembly.instantiateStreaming. MIME types are
pinned here. `--prefix` serves the site under a sub-path, the same way GitHub
Pages serves a project site at https://<user>.github.io/<repo>/.
"""

import functools
import http.server
import sys

MIME = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".html": "text/html; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
    ".task": "application/octet-stream",
    ".woff2": "font/woff2",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **MIME}
    prefix = ""

    def translate_path(self, path):
        if self.prefix:
            if not path.startswith(self.prefix + "/") and path != self.prefix:
                return "/nonexistent-outside-prefix"
            path = path[len(self.prefix):] or "/"
        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "404" in (fmt % args):
            sys.stderr.write("404 " + (fmt % args) + "\n")


def main():
    args = [a for a in sys.argv[1:]]
    prefix = ""
    if "--prefix" in args:
        i = args.index("--prefix")
        prefix = "/" + args[i + 1].strip("/")
        del args[i : i + 2]
    port = int(args[0]) if args else 8099
    directory = args[1] if len(args) > 1 else "."
    Handler.prefix = prefix
    # On Windows SO_REUSEADDR lets a second server bind the same port silently;
    # fail loudly instead so a stale server is never tested by mistake.
    http.server.ThreadingHTTPServer.allow_reuse_address = False
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", port), functools.partial(Handler, directory=directory)
    )
    print(f"serving {directory} at http://127.0.0.1:{port}{prefix}/", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
