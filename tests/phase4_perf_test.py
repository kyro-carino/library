#!/usr/bin/env python3
"""Phase 4 test: grouped report numbers, single-record reads carry borrowCount, bounded lists, avatar not held in the session.
  BASE=http://127.0.0.1:8081 ADMIN_PW=... MYSQL_CLI="mysql -uroot -N -B" python3 tests/phase4_perf_test.py
DEVELOPMENT database only; fixtures are tagged and removed."""
import base64, json, os, random, shlex, subprocess, sys, urllib.request, urllib.error, http.cookiejar
from datetime import datetime, timedelta, timezone
BASE = os.environ.get("BASE", "http://127.0.0.1:8081").rstrip("/"); PW = os.environ["ADMIN_PW"]
MYSQL = shlex.split(os.environ.get("MYSQL_CLI", "mysql -N -B")) + [os.environ.get("DB_NAME", "feu_library")]
TAG = "P4" + "%05d" % random.randint(0, 99999)
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
admin = client(); call(admin, "auth.php", "POST", {"action": "login", "username": "admin", "password": PW})
manila = datetime.now(timezone(timedelta(hours=8))).date()
book = user = None
try:
    book = call(admin, "books.php", "POST", {"title": f"{TAG} book", "author": "T"})[1]["book"]["id"]
    user = call(admin, "users.php", "POST", {"lastName": "Perf", "firstName": TAG, "contact": f"{TAG.lower()}@example.invalid"})[1]["user"]["id"]
    for _ in range(2):
        call(admin, "transactions.php", "POST", {"type": "issue", "bookId": book, "userId": user}); call(admin, "transactions.php", "POST", {"type": "return", "bookId": book})

    # ---- reports: grouped queries give the same numbers as counting each day directly
    act = call(admin, "reports.php")[1]["activity"]
    check("activity covers 7 consecutive days ending today (Manila)", [a["date"] for a in act] == [(manila - timedelta(days=i)).isoformat() for i in range(6, -1, -1)], [a["date"] for a in act])
    ok = True
    for a in act:
        i = sql(f"select count(*) from transactions where type='issue' and issue_date='{a['date']}'")
        r = sql(f"select count(*) from transactions where type='issue' and status='Returned' and return_date='{a['date']}'")
        ok &= (str(a["issued"]) == i and str(a["returned"]) == r)
        if not ok: print("   mismatch on", a, i, r); break
    check("every day's issued/returned equals a direct SQL count", ok)
    check("today shows our 2 issues and 2 returns at least", act[-1]["issued"] >= 2 and act[-1]["returned"] >= 2, act[-1])

    # ---- single-record reads carry borrowCount (the browser now refreshes single records)
    s, one = call(admin, f"books.php?id={book}"); check("GET book by id includes borrowCount", s == 200 and one["book"]["borrowCount"] == 2, one)
    lst = [b for b in call(admin, f"books.php?limit=200&search={TAG}")[1]["books"] if b["id"] == book]
    check("single read and list read agree on borrowCount", lst and lst[0]["borrowCount"] == one["book"]["borrowCount"], (lst, one))
    s, r = call(admin, f"books.php?id={book}", "PUT", {"description": "x"}); check("PUT response carries borrowCount", s == 200 and r["book"]["borrowCount"] == 2, r)
    s, r = call(admin, f"users.php?id={user}"); check("GET patron by id includes hold fields", s == 200 and "unpaidFines" in r["user"] and "overdueLoans" in r["user"], r)

    # ---- bounded list
    s, r = call(admin, "reservations.php?limit=99999"); check("reservations list is paged and capped at 500", s == 200 and r["limit"] == 500 and "total" in r and r["offset"] == 0, r)
    check("reservations junk limit falls back safely", call(admin, "reservations.php?limit=abc")[1]["limit"] == 200)

    # ---- the avatar is served from the database, not the session
    png = "data:image/png;base64," + base64.b64encode(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")).decode()
    s, r = call(admin, "account.php", "PUT", {"avatarDataUrl": png}); check("avatar saved", s == 200, (s, r))
    s, st = call(admin, "auth.php?action=status")
    check("status still returns the avatar (read from the database)", st["authenticated"] is True and st["user"]["avatarDataUrl"] == png, st)
    check("account GET returns the avatar", call(admin, "account.php")[1]["account"]["avatarDataUrl"] == png)
    s, r = call(admin, "books.php", "POST", {"title": f"{TAG} after-avatar", "author": "T"}); check("writes still work after the avatar change (session intact)", s == 201, (s, r))
    if s == 201: call(admin, f"books.php?id={r['id']}", "DELETE")
    call(admin, "account.php", "PUT", {"avatarDataUrl": None})
    check("avatar cleared", call(admin, "auth.php?action=status")[1]["user"]["avatarDataUrl"] is None)

    # ---- permission checks use the freshly read role (single lookup must not weaken them)
    check("anonymous write still 401", call(client(), "books.php", "POST", {"title": "x", "author": "y"})[0] == 401)
finally:
    if book: call(admin, f"books.php?id={book}", "DELETE")
    if user: call(admin, f"users.php?id={user}", "DELETE")
print(f"\n{passed} passed, {failed} failed"); sys.exit(1 if failed else 0)
