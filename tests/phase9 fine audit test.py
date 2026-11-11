#!/usr/bin/env python3
"""Phase 9 test: the audit trail records fines correctly (assessed on return, paid on payment) and can be filtered.
  BASE=http://localhost/library ADMIN_PW=... MYSQL_CLI="mysql -uroot -N -B" python3 tests/phase9_fine_audit_test.py   (py on Windows)
Needs MYSQL_CLI (to backdate a loan). DEVELOPMENT database only; fixtures are tagged and removed; settings restored."""
import json, os, random, shlex, subprocess, sys, urllib.request, urllib.error, http.cookiejar
from datetime import datetime, timedelta, timezone
BASE = os.environ.get("BASE", "http://127.0.0.1:8081").rstrip("/"); PW = os.environ["ADMIN_PW"]
MYSQL = shlex.split(os.environ.get("MYSQL_CLI", "mysql -N -B")) + [os.environ.get("DB_NAME", "feu_library")]
RUN = "%05d" % random.randint(0, 99999); TAG = f"P9{RUN}"
manila = datetime.now(timezone(timedelta(hours=8))).date(); ago = lambda n: (manila - timedelta(days=n)).isoformat()
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
if sql("select 1") != "1": print("MYSQL_CLI is required for this test"); sys.exit(2)

admin = client(); call(admin, "auth.php", "POST", {"action": "login", "username": "admin", "password": PW})
orig = call(admin, "settings.php")[1]["settings"]
call(admin, "settings.php", "PUT", {"overdueFinesEnabled": True, "gracePeriodDays": 1, "finePerDay": 10, "loanDays": 7})
book = user = None
def entries(**f):
    q = "&".join(f"{k}={v}" for k, v in f.items()); s, r = call(admin, f"audit.php?limit=200&{q}"); assert s == 200, (s, r); return r["entries"]
try:
    book = call(admin, "books.php", "POST", {"title": f"{TAG} book", "author": "T"})[1]["book"]["id"]
    user = call(admin, "users.php", "POST", {"lastName": "Fine", "firstName": TAG, "contact": f"{TAG.lower()}@example.invalid"})[1]["user"]["id"]
    s, r = call(admin, "transactions.php", "POST", {"type": "issue", "bookId": book, "userId": user}); tx = r["transaction"]["id"]
    sql(f"update transactions set issue_date='{ago(12)}', due_date='{ago(5)}' where id='{tx}'"); sql(f"update books set issue_date='{ago(12)}', due_date='{ago(5)}' where id='{book}'")

    s, r = call(admin, "transactions.php", "POST", {"type": "return", "bookId": book}); check("late return assesses (5-1) x 10 = 40", s == 200 and r["fine"] == 40.0, (s, r))
    a = entries(action="fine.assess", entity_id=user)
    check("fine.assess logged once against the patron", len(a) == 1, a)
    d = a[0]["details"] if a else {}
    check("fine.assess carries amount, loan id, title, patron name and days late", d.get("amount") == 40.0 and d.get("txId") == tx and d.get("title") == f"{TAG} book" and TAG in d.get("patron", "") and d.get("daysOverdue") == 5, d)
    ret = entries(action="loan.return", entity_id=book)
    check("loan.return still records the same fine and now the patron name", ret and ret[0]["details"].get("fine") == 40.0 and TAG in ret[0]["details"].get("patron", ""), ret)

    s, r = call(admin, "transactions.php", "POST", {"type": "pay_fine", "userId": user}); check("payment recorded", s == 200 and r["amount"] == 40.0 and r["loans"] == 1, (s, r))
    p = entries(action="fine.pay", entity_id=user)
    check("fine.pay logged once", len(p) == 1, p)
    d = p[0]["details"] if p else {}
    check("fine.pay carries amount, loan count, patron name and the settled loan ids", d.get("amount") == 40.0 and d.get("loans") == 1 and d.get("txIds") == [tx] and TAG in d.get("patron", ""), d)
    check("assessed amount equals paid amount for this patron", sum(x["details"]["amount"] for x in a) == sum(x["details"]["amount"] for x in p))
    s, r = call(admin, "transactions.php", "POST", {"type": "pay_fine", "userId": user}); n = len(entries(action="fine.pay", entity_id=user))
    check("a second payment is refused (409) and not logged", s == 409 and n == 1, (s, n))

    both = entries(action="fine.assess,fine.pay", entity_id=user)
    check("comma-separated action filter returns both fine events", {x["action"] for x in both} == {"fine.assess", "fine.pay"}, both)
    check("fine events are newest first (payment before assessment)", [x["action"] for x in both] == ["fine.pay", "fine.assess"], [x["action"] for x in both])

    # on-time return: no fine.assess entry
    s, r = call(admin, "transactions.php", "POST", {"type": "issue", "bookId": book, "userId": user}); call(admin, "transactions.php", "POST", {"type": "return", "bookId": book})
    check("an on-time return writes no fine.assess entry", len(entries(action="fine.assess", entity_id=user)) == 1)

    for bad in ("fine.pay,", "a,b,Bad%20One", ",fine.pay", ",".join(["x"] * 16)):
        check(f"bad action list {bad[:20]} -> 422", call(admin, "audit.php?action=" + bad)[0] == 422)
finally:
    if book: call(admin, "transactions.php", "POST", {"type": "return", "bookId": book}); call(admin, f"books.php?id={book}", "DELETE")
    if user: call(admin, f"users.php?id={user}", "DELETE")
    call(admin, "settings.php", "PUT", {k: v for k, v in orig.items()})
    check("settings restored", call(admin, "settings.php")[1]["settings"] == orig)
print(f"\n{passed} passed, {failed} failed"); sys.exit(1 if failed else 0)