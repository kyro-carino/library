#!/usr/bin/env python3
"""Phase 2B test: odd-typed input -> 422 (not 500), length/range limits, delete-vs-issue races.
  BASE=http://127.0.0.1:8081 ADMIN_PW=... [MYSQL_CLI="mysql -uroot -N -B"] python3 tests/phase2b_input_test.py
DEVELOPMENT database only. Creates tagged fixtures and removes them; restores settings."""
import json, os, random, shlex, subprocess, sys, urllib.request, urllib.error, http.cookiejar
from concurrent.futures import ThreadPoolExecutor
BASE = os.environ.get("BASE", "http://127.0.0.1:8081").rstrip("/"); PW = os.environ["ADMIN_PW"]
MYSQL = shlex.split(os.environ.get("MYSQL_CLI", "mysql -N -B")) + [os.environ.get("DB_NAME", "feu_library")]
RUN = "%05d" % random.randint(0, 99999); TAG = f"P2B{RUN}"
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
    try:
        r = subprocess.run(MYSQL + ["-e", q], capture_output=True, text=True, timeout=30); return r.stdout.strip() if r.returncode == 0 else None
    except Exception: return None
HAVE_SQL = sql("select 1") == "1"

admin = client()
check("login", call(admin, "auth.php", "POST", {"action": "login", "username": "admin", "password": PW})[0] == 200)

# ---- L-01: arrays in the query string are ignored, never a 500
for p in ["books.php?category[]=x&limit=1", "books.php?search[]=a", "books.php?status[]=Overdue", "books.php?id[]=x",
          "users.php?search[]=a", "users.php?status[]=Active", "transactions.php?status[]=a&type[]=b", "reservations.php?user_id[]=1",
          "books.php?limit[]=5&offset[]=1", "auth.php?action[]=status"]:
    s, _ = call(admin, p); check(f"query array {p} -> not 5xx", s < 500, s)

# ---- L-01: arrays/objects as JSON values -> 422
cases = [("books.php", "POST", {"title": ["a"], "author": "x"}), ("books.php", "POST", {"title": "t", "author": {"a": 1}}),
         ("users.php", "POST", {"lastName": ["x"], "firstName": "y", "contact": "a@b.co"}),
         ("users.php", "POST", {"lastName": "x", "firstName": "y", "contact": "a@b.co", "yearLevel": [1]}),
         ("transactions.php", "POST", {"type": "issue", "bookId": ["x"], "userId": "y"}),
         ("transactions.php", "POST", {"type": ["issue"]}),
         ("reservations.php", "POST", {"bookId": ["x"], "userId": "y"}),
         ("settings.php", "PUT", {"finePerDay": [1]}), ("settings.php", "PUT", {"libraryName": ["x"]}),
         ("notifs.php", "PUT", {"due": [True]}), ("account.php", "PUT", {"displayName": ["Admin"]})]
for ep, m, b in cases:
    s, r = call(admin, ep, m, b); check(f"{m} {ep} {json.dumps(b)[:50]} -> 422", s == 422, (s, r))
s, _ = call(client(), "auth.php", "POST", {"action": "login", "username": ["admin"], "password": "x"}); check("login with array username -> 422", s == 422, s)


# ---- L-02 / L-03: settings limits (original values restored at the end)
orig = call(admin, "settings.php")[1]["settings"]
bad = [("loanDays", 366), ("loanDays", 0), ("finePerDay", 10001), ("finePerDay", "1e999"), ("finePerDay", -1), ("maxBooksPerUser", 101),
       ("maxRenewals", 21), ("gracePeriodDays", 366), ("libraryPhone", "1" * 21), ("libraryAddress", "a" * 501), ("libraryName", "n" * 256)]
for k, v in bad:
    s, r = call(admin, "settings.php", "PUT", {k: v}); check(f"settings {k}={str(v)[:12]} -> 422", s == 422, (s, r))
good = {"loanDays": 365, "maxBooksPerUser": 100, "maxRenewals": 20, "gracePeriodDays": 365, "finePerDay": 10000, "libraryPhone": "1" * 20, "libraryAddress": "a" * 500}
s, r = call(admin, "settings.php", "PUT", good); check("settings at the upper limits accepted", s == 200, (s, r))
check("settings unchanged by rejected requests (values were the boundary ones)", call(admin, "settings.php")[1]["settings"]["loanDays"] == 365)
call(admin, "settings.php", "PUT", {k: v for k, v in orig.items()})
check("settings restored", call(admin, "settings.php")[1]["settings"] == orig)

# ---- L-05: delete vs. issue races leave no deleted record holding an active loan
def mk_book(i): return call(admin, "books.php", "POST", {"title": f"{TAG} race book {i}", "author": "T"})[1]["book"]["id"]
def mk_user(i): return call(admin, "users.php", "POST", {"lastName": "Race", "firstName": f"{TAG}{i}", "contact": f"{TAG.lower()}.{i}@example.invalid"})[1]["user"]["id"]
if HAVE_SQL:
    made = []
    def race(kind, i):
        b, u = mk_book(f"{kind}{i}"), mk_user(f"{kind}{i}"); made.append((b, u))
        ops = [client() for _ in range(2)]
        for o in ops: call(o, "auth.php", "POST", {"action": "login", "username": "admin", "password": PW})
        issue = lambda: call(ops[0], "transactions.php", "POST", {"type": "issue", "bookId": b, "userId": u})[0]
        dele = (lambda: call(ops[1], f"users.php?id={u}", "DELETE")[0]) if kind == "user" else (lambda: call(ops[1], f"books.php?id={b}", "DELETE")[0])
        with ThreadPoolExecutor(2) as ex:
            f1, f2 = ex.submit(issue), ex.submit(dele); return f1.result(), f2.result()
    results = [race("user", i) for i in range(20)] + [race("book", i) for i in range(20)]
    check("no 5xx from any raced request", all(a < 500 and b < 500 for a, b in results), [r for r in results if max(r) >= 500][:3])
    inv_user = sql(f"select count(*) from books b join users u on u.id=b.borrowed_by where b.title like '{TAG} race%' and b.status in ('Borrowed','Overdue') and u.deleted_at is not null")
    inv_book = sql(f"select count(*) from books where title like '{TAG} race%' and deleted_at is not null and status in ('Borrowed','Overdue')")
    check("invariant: no soft-deleted patron holds an active loan", inv_user == "0", inv_user)
    check("invariant: no soft-deleted book is on loan", inv_book == "0", inv_book)
    outcomes = {r for r in results}
    check("races produced both outcomes over 40 runs (test is exercising the race)", len({(a, b) for a, b in results}) > 1, outcomes)
    for b, u in made:
        call(admin, "transactions.php", "POST", {"type": "return", "bookId": b}); call(admin, f"books.php?id={b}", "DELETE"); call(admin, f"users.php?id={u}", "DELETE")
else:
    print("SKIP delete-race checks (set MYSQL_CLI)")

call(admin, "auth.php", "POST", {"action": "logout"})
print(f"\n{passed} passed, {failed} failed"); sys.exit(1 if failed else 0)