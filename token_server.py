#!/usr/bin/env python3
"""
Local GEE token server — serves a fresh access token to the Sentinel-2 Explorer browser app.

Usage:
    python token_server.py

Then click "Get Token" in the GEE Asset Overlay panel.
Keep this running while using the overlay; tokens are refreshed on every click.

Requirements:
    gcloud CLI authenticated:  gcloud auth login
    OR earthengine CLI:        earthengine authenticate
"""

import json
import subprocess
import http.server

PORT   = 8765
ORIGIN = "http://localhost:5173"


def get_token():
    """Try gcloud first, fall back to earthengine credentials file."""
    # 1. gcloud auth print-access-token (most reliable, always fresh)
    try:
        token = subprocess.check_output(
            ["gcloud", "auth", "print-access-token"],
            stderr=subprocess.DEVNULL,
        ).decode().strip()
        if token:
            return token
    except Exception:
        pass

    # 2. earthengine credentials file fallback
    import os, time
    cred_path = os.path.expanduser("~/.config/earthengine/credentials")
    if os.path.exists(cred_path):
        try:
            import google.oauth2.credentials
            import google.auth.transport.requests
            with open(cred_path) as f:
                creds_data = json.load(f)
            creds = google.oauth2.credentials.Credentials(
                token=creds_data.get("access_token"),
                refresh_token=creds_data.get("refresh_token"),
                token_uri="https://oauth2.googleapis.com/token",
                client_id=creds_data.get("client_id"),
                client_secret=creds_data.get("client_secret"),
            )
            creds.refresh(google.auth.transport.requests.Request())
            return creds.token
        except Exception:
            pass

    return None


class TokenHandler(http.server.BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self._cors()
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.end_headers()

    def do_GET(self):
        if self.path != "/token":
            self.send_response(404)
            self._cors()
            self.end_headers()
            return

        token = get_token()
        if token:
            body = json.dumps({"token": token}).encode()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            err = json.dumps({"error": "Could not retrieve token. Run: gcloud auth login"}).encode()
            self.send_response(500)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(err)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", ORIGIN)

    def log_message(self, fmt, *args):
        print(f"  {self.address_string()} — {fmt % args}")


if __name__ == "__main__":
    server = http.server.HTTPServer(("localhost", PORT), TokenHandler)
    print(f"✓  Token server running at http://localhost:{PORT}/token")
    print(f"   Serving tokens to {ORIGIN}")
    print(f"   Press Ctrl+C to stop.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
