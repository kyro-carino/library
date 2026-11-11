#!/usr/bin/env python3
"""Phase 6 test: rename/profile/password flows keep the account intact and nothing recreates 'admin'.
  BASE=http://localhost/library ADMIN_PW=... MYSQL_CLI="mysql -uroot -P3307 -h127.0.0.1 -N -B" python3 tests/phase6_account_test.py
Needs MYSQL_CLI and php on PATH. DEVELOPMENT database only. Renames the admin temporarily and restores it."""
import json, os, random, shlex, subprocess, sys, urllib.request, urllib.error, http.cookiejar
BASE = os.environ.get("BASE", "http://127.0.0.1:8081").rstrip("/"); PW = os.environ["ADMIN_PW"]
MYSQL = shlex.split(os.environ.get("MYSQL_CLI", "mysql -N -B")) + [os.environ.get("DB_NAME", "feu_library")]
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
RUN = "%05d" % random.randint(0, 99999)
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
def sql(q):
    r = subprocess.run(MYSQL + ["-e", q], capture_output=True, text=True, timeout=30); return r.stdout.strip() if r.returncode == 0 else None
if sql("select 1") != "1": print("MYSQL_CLI is required"); sys.exit(2)
login = lambda u, p: call(client(), "auth.php", "POST", {"action": "login", "username": u, "password": p})[0]

op = client(); check("admin login", call(op, "auth.php", "POST", {"action": "login", "username": "admin", "password": PW})[0] == 200)
orig = call(op, "account.php")[1]["account"]; ID = orig["id"]
fp = lambda: sql(f"select sha2(password_hash,256) from auth_users where id={ID}")   # fingerprint only; the hash is never printed
h0, n0 = fp(), sql("select count(*) from auth_users")
user, mail, newpw, pw_changed = f"ren{RUN}", f"ren{RUN}@example.invalid", f"Zebra-Lantern-{RUN}-Orbit", False
try:
    s, r = call(op, "account.php", "PUT", {"username": user, "email": mail, "displayName": "Renamed Admin"})
    check("rename username + email -> 200", s == 200 and r["account"]["username"] == user, (s, r))
    check("password hash unchanged by the rename", fp() == h0)
    check("login with the NEW username and the ORIGINAL password works", login(user, PW) == 200)
    check("the old username no longer signs in", login(orig["username"], PW) == 401)
    for p in ("auth.php?action=status", "books.php?limit=1", "settings.php"): call(client(), p)   # anonymous requests also run config.php
    call(op, "books.php?limit=1")
    check("no account was created by ordinary requests", sql("select count(*) from auth_users") == n0)
    check("the old username was not recreated", sql(f"select count(*) from auth_users where username='{orig['username']}'") == "0")
    check("session still valid after the rename", call(op, "auth.php?action=status")[1].get("authenticated") is True)
    s, _ = call(op, "account.php", "PUT", {"displayName": "Renamed Admin 2"}); check("profile edit without a password -> 200", s == 200)
    check("hash unchanged by a profile edit", fp() == h0)
    s, r = call(op, "auth.php", "POST", {"action": "password", "currentPassword": PW, "newPassword": newpw, "confirmPassword": newpw}); pw_changed = s == 200
    check("intentional password change -> 200", s == 200, (s, r))
    check("hash changed only now", fp() != h0)
    check("new password works, old one is rejected", login(user, newpw) == 200 and login(user, PW) == 401)
    check("wrong password -> 401", login(user, "definitely-wrong-pass-1") == 401)
    check("anonymous account update -> 401", call(client(), "account.php", "PUT", {"displayName": "x"})[0] == 401)
    check("accounts cannot be deleted through the API (405)", call(op, "account.php", "DELETE")[0] == 405)
    hn = fp()
    if subprocess.run(["php", "-v"], capture_output=True).returncode == 0:
        p = subprocess.run(["php", "tools/seed_admin.php"], cwd=ROOT, capture_output=True, text=True)
        check("seed_admin refuses when staff exist and changes nothing", p.returncode == 1 and fp() == hn and sql("select count(*) from auth_users") == n0, p.stderr)
    else: print("SKIP seed_admin check (php not on PATH)")
finally:
    if pw_changed: call(op, "auth.php", "POST", {"action": "password", "currentPassword": newpw, "newPassword": PW, "confirmPassword": PW})
    call(op, "account.php", "PUT", {"username": orig["username"], "email": orig["email"], "displayName": orig["displayName"]})
    check("restored: original username signs in with the original password", login(orig["username"], PW) == 200)
print(f"\n{passed} passed, {failed} failed"); sys.exit(1 if failed else 0)
