#!/usr/bin/env python3
"""Phase 5A test: password quality rules over HTTP (change-password and first-run setup paths).
  BASE=http://127.0.0.1:8081 ADMIN_PW=... python3 tests/phase5a_test.py
DEVELOPMENT database only. Changes the admin password temporarily and restores it."""
import json, os, sys, urllib.request, urllib.error, http.cookiejar
BASE = os.environ.get("BASE", "http://127.0.0.1:8081").rstrip("/"); PW = os.environ["ADMIN_PW"]
passed = failed = 0
def check(n, c, x=""):
    global passed, failed
    passed += bool(c); failed += (not c); print(("PASS " if c else "FAIL ") + n + ("" if c else f"   <-- {x}"))
def client(): return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def call(op, path, method="GET", body=None):
    req = urllib.request.Request(f"{BASE}/api/{path}", method=method, data=json.dumps(body).encode() if body is not None else None, headers={"Content-Type": "application/json"})
    try:
        with op.open(req, timeout=30) as r: return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}
op = client(); check("login", call(op, "auth.php", "POST", {"action": "login", "username": "admin", "password": PW})[0] == 200)
chg = lambda new, cur=PW, conf=None: call(op, "auth.php", "POST", {"action": "password", "currentPassword": cur, "newPassword": new, "confirmPassword": new if conf is None else conf})
for label, pw in [("a common password", "Password12345"), ("a look-alike of a common password", "P@ssw0rd2026!"), ("digits only", "1029384756"),
                  ("a repeated character", "aaaaaaaaaaaa"), ("one containing the username", "my-admin-secret-2026")]:
    s, r = chg(pw); check(f"change to {label} -> 422 on newPassword", s == 422 and "newPassword" in r.get("errors", {}), (s, r))
s, r = chg(PW); check("new password equal to the current one -> 422", s == 422 and "different" in r["errors"]["newPassword"], (s, r))
check("rejected changes did not alter the password", call(client(), "auth.php", "POST", {"action": "login", "username": "admin", "password": PW})[0] == 200)
good = "Zebra-Lantern-Orbit-2048"
try:
    s, r = chg(good); check("a strong passphrase is accepted", s == 200, (s, r))
    check("it really changed", call(client(), "auth.php", "POST", {"action": "login", "username": "admin", "password": good})[0] == 200)
finally:
    s, r = chg(PW, cur=good); check("password restored", s == 200 and call(client(), "auth.php", "POST", {"action": "login", "username": "admin", "password": PW})[0] == 200, (s, r))
s, _ = call(client(), "auth.php", "POST", {"action": "setup", "username": "x", "email": "x@y.zz", "password": "Password12345", "displayName": "X"})
check("setup path still answers 409 once an admin exists (policy never reached)", s == 409, s)
print(f"\n{passed} passed, {failed} failed"); sys.exit(1 if failed else 0)
