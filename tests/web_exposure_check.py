#!/usr/bin/env python3
"""Proves sensitive paths are NOT served. Run against the real host after every deployment.
  BASE=http://localhost/library py tests/web_exposure_check.py
Each path must answer 403 or 404 (anything else, especially 200, is a FAIL). Python standard library only."""
import os, sys, urllib.request, urllib.error
BASE = os.environ.get("BASE", "http://localhost/library").rstrip("/")
PATHS = [".env", ".env.example", ".git/config", ".htaccess", "schema.sql", "feu_library.sql", "feu_library_pre_stage5.sql",
         "README.md", "AUDIT.md", "IMPLEMENTATION_PROGRESS.md", "config.php", "includes/bootstrap.php", "includes/auth.php",
         "includes/migrations.php", "includes/dev_seed.php", "tools/migrate.php", "tools/seed_admin.php", "tools/create_admin.php",
         "tests/run_all.sh", "tests/smoke_api_test.py", "backups/schema.sql.bak", "includes/", "tools/", "tests/", "backups/"]
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
op = urllib.request.build_opener(NoRedirect)
bad = 0
for p in PATHS:
    try:
        with op.open(urllib.request.Request(f"{BASE}/{p}"), timeout=15) as r: code = r.status
    except urllib.error.HTTPError as e: code = e.code
    except Exception as e: code = f"ERR {e}"
    ok = code in (403, 404)
    bad += (not ok); print(("PASS " if ok else "FAIL ") + f"{p} -> {code}")
for p in ("index.html", "script.js", "style.css", "js/theme-init.js", "fonts/fonts.css", "fonts/inter-latin-400-normal.woff2"):
    try:
        with op.open(urllib.request.Request(f"{BASE}/{p}"), timeout=15) as r: ok = r.status == 200
    except Exception: ok = False
    bad += (not ok); print(("PASS " if ok else "FAIL ") + f"{p} is served (200)")
try:
    with op.open(urllib.request.Request(f"{BASE}/"), timeout=15) as r: hdr = {k.lower(): v for k, v in r.headers.items()}
except Exception as e: hdr = {}
mode = "enforced" if "content-security-policy" in hdr else ("REPORT-ONLY" if "content-security-policy-report-only" in hdr else None)
ok = mode is not None; bad += (not ok)
print(("PASS " if ok else "FAIL ") + f"Content-Security-Policy header on the app page ({mode or 'missing: is mod_headers enabled?'})")
for h in ("x-frame-options", "x-content-type-options"):
    ok = h in hdr; bad += (not ok); print(("PASS " if ok else "FAIL ") + f"{h} header on the app page")
if mode == "REPORT-ONLY": print("NOTE the policy only REPORTS violations. Once the DevTools console shows no '[Report Only]' messages, enforce it (see .htaccess).")
print("\nall protections live" if not bad else f"\n{bad} problem(s): sensitive files may be reachable. Check AllowOverride All and the .htaccess files.")
sys.exit(1 if bad else 0)