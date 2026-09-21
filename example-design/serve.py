#!/usr/bin/env python3
"""
Static file server for the example-design pages.

Why this exists instead of `python3 -m http.server`: SimpleHTTP sends
`Last-Modified` but no `Cache-Control` and no `ETag`, so Chrome applies
heuristic freshness (10% of the file's age) and silently serves a cached
copy of lib/engine.js and the themes for minutes after an edit. During
design iteration that reads as "my fix did nothing", which is exactly the
bug it cost an hour to find. Every response here is no-store, so a reload
always reflects what is on disk.

    python3 example-design/serve.py [port] [root]
"""

import functools
import http.server
import os
import socketserver
import sys


class NoStoreHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        # The browser may still hold entries cached by an earlier server that
        # sent validators. Those entries revalidate with If-Modified-Since, and
        # SimpleHTTP would answer 304 -- which is exactly the stale-file
        # behaviour this server exists to prevent. Drop the conditionals so
        # every request gets a full 200.
        for name in ("If-Modified-Since", "If-None-Match"):
            while name in self.headers:
                del self.headers[name]
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_header(self, keyword, value):
        # Drop the conditional-request plumbing entirely: with no-store the
        # client never holds a validator, and a stray 304 here would resurrect
        # the stale-file behaviour this server exists to prevent.
        if keyword.lower() in ("last-modified", "etag"):
            return
        super().send_header(keyword, value)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    root = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()
    handler = functools.partial(NoStoreHandler, directory=root)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", port), handler) as httpd:
        print("serving %s at http://127.0.0.1:%d/ (no-store)" % (root, port), flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
