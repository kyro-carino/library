#!/usr/bin/env python3
"""Phase 3A test: circulation policy (overdue block, unpaid fines, reservations) and fine payments.
  BASE=http://127.0.0.1:8081 ADMIN_PW=... MYSQL_CLI="mysql -uroot -N -B" python3 tests/phase3a_policy_test.py
Needs MYSQL_CLI (to backdate loans). DEVELOPMENT database only; fixtures are tagged and removed; settings restored."""
import json, os, random, shlex, subprocess, sys, urllib.request, urllib.error, http.cookiejar
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
BASE = os.environ.get("BASE", "http://127.0.0.1:8081").rstrip("/"); PW = os.environ["ADMIN_PW"]
MYSQL = shlex.split(os.environ.get("MYSQL_CLI", "mysql -N -B")) + [os.environ.get("DB_NAME", "feu_library")]
RUN = "%05d" % random.randint(0, 99999); TAG = f"P3A{RUN}"
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
call(admin, "settings.php", "PUT", {"overdueFinesEnabled": True, "gracePeriodDays": 1, "finePerDay": 10, "maxBooksPerUser": 5, "loanDays": 7})
books, users = [], []
def mkb(n): b = call(admin, "books.php", "POST", {"title": f"{TAG} {n}", "author": "T"})[1]["book"]["id"]; books.append(b); return b
def mku(n): u = call(admin, "users.php", "POST", {"lastName": "Policy", "firstName": f"{TAG}{n}", "contact": f"{TAG.lower()}.{n}@example.invalid"})[1]["user"]["id"]; users.append(u); return u
issue = lambda b, u: call(admin, "transactions.php", "POST", {"type": "issue", "bookId": b, "userId": u})
ret = lambda b: call(admin, "transactions.php", "POST", {"type": "return", "bookId": b})
pay = lambda u: call(admin, "transactions.php", "POST", {"type": "pay_fine", "userId": u})
user = lambda u: call(admin, f"users.php?id={u}")[1]["user"]
def backdate(b, tx, days_overdue):
    sql(f"update transactions set issue_date='{ago(days_overdue + 7)}', due_date='{ago(days_overdue)}' where id='{tx}'")
    sql(f"update books set issue_date='{ago(days_overdue + 7)}', due_date='{ago(days_overdue)}' where id='{b}'")
try:
    P, Q, R, S = mku("p"), mku("q"), mku("r"), mku("s"); b1, b2, b3, b4, b5 = [mkb(i) for i in range(5)]

    # ---- overdue block
    s, r = issue(b1, P); check("clean patron can borrow", s == 201, (s, r)); backdate(b1, r["transaction"]["id"], 5)
    u = user(P); check("patron record shows 1 overdue loan", u["overdueLoans"] == 1 and u["unpaidFines"] == 0, u)
    s, r = issue(b2, P); check("overdue patron cannot borrow -> 409 (overdue)", s == 409 and "overdue" in r["error"], (s, r))
    check("blocked issue left the book Available", call(admin, f"books.php?id={b2}")[1]["book"]["status"] == "Available")

    # ---- unpaid fine block
    s, r = ret(b1); fine = r["fine"]; check("late return assesses a fine ((5-1) x 10 = 40)", s == 200 and fine == 40.0, (s, r))
    u = user(P); check("patron record shows the unpaid fine, no overdue", u["unpaidFines"] == 40.0 and u["overdueLoans"] == 0, u)
    s, r = issue(b2, P); check("patron with unpaid fine cannot borrow -> 409 (fines)", s == 409 and "unpaid fines" in r["error"] and "40.00" in r["error"], (s, r))
    tx = call(admin, f"transactions.php?user_id={P}&status=Returned")[1]["transactions"]
    check("returned loan is reported as not paid", tx and tx[0]["fine"] == 40.0 and tx[0]["finePaid"] is False, tx)
    rep0 = call(admin, "reports.php")[1]["totals"]["finesUnpaid"]

    # ---- recording payment
    check("pay_fine for unknown patron -> 404", pay("NOPE")[0] == 404)
    check("pay_fine with array userId -> 422", call(admin, "transactions.php", "POST", {"type": "pay_fine", "userId": ["x"]})[0] == 422)
    check("pay_fine for patron without fines -> 409", pay(Q)[0] == 409)
    s, r = pay(P); check("pay_fine records the server-computed amount", s == 200 and r["amount"] == 40.0 and r["loans"] == 1, (s, r))
    check("second pay_fine -> 409 (nothing left)", pay(P)[0] == 409)
    check("patron record: no unpaid fines", user(P)["unpaidFines"] == 0)
    tx = call(admin, f"transactions.php?user_id={P}&status=Returned")[1]["transactions"]; check("returned loan now reported as paid", tx[0]["finePaid"] is True, tx)
    check("reports.totals.finesUnpaid dropped by the amount paid", round(rep0 - call(admin, "reports.php")[1]["totals"]["finesUnpaid"], 2) == 40.0)
    s, r = issue(b2, P); check("after payment the patron can borrow again", s == 201, (s, r))
    a = call(admin, "audit.php?action=fine.pay&entity_id=" + P)[1]["entries"]
    check("fine.pay is audit-logged with amount and actor", a and a[0]["details"]["amount"] == 40.0 and a[0]["actorName"], a)

    # ---- zero-fine / on-time return never blocks
    s, r = ret(b2); check("on-time return, fine 0", s == 200 and r["fine"] == 0)
    s, r = issue(b2, P); check("on-time history does not block", s == 201, (s, r)); ret(b2)

    # ---- parallel payments: exactly one wins
    s, r = issue(b3, S); backdate(b3, r["transaction"]["id"], 4); ret(b3)
    clients = [client() for _ in range(6)]
    for c in clients: call(c, "auth.php", "POST", {"action": "login", "username": "admin", "password": PW})
    with ThreadPoolExecutor(6) as ex: codes = list(ex.map(lambda c: call(c, "transactions.php", "POST", {"type": "pay_fine", "userId": S})[0], clients))
    check("6 parallel payments: exactly one 200, five 409", codes.count(200) == 1 and codes.count(409) == 5, codes)
    check("patron S was only credited once in the audit log", len(call(admin, "audit.php?action=fine.pay&entity_id=" + S)[1]["entries"]) == 1)

    # ---- reservations are honoured
    s, r = issue(b4, Q); check("Q borrows b4", s == 201, (s, r))
    check("R reserves b4", call(admin, "reservations.php", "POST", {"bookId": b4, "userId": R})[0] == 201)
    s, r = call(admin, "transactions.php", "POST", {"type": "renew", "bookId": b4}); check("renewal blocked while another patron waits -> 409", s == 409 and "reserved" in r["error"], (s, r))
    ret(b4)
    s, r = issue(b4, P); check("returned title is held for R: issuing to someone else -> 409", s == 409 and "reserved" in r["error"], (s, r))
    s, r = issue(b4, R); check("the reserving patron can borrow it", s == 201, (s, r))
    check("reservation marked fulfilled", call(admin, f"reservations.php?user_id={R}")[1]["reservations"] == [])
    ret(b4)
    s, r = issue(b4, P); check("once fulfilled the title is open to everyone again", s == 201, (s, r)); ret(b4)
    # a reservation held by an INACTIVE patron must not block the queue forever
    s, r = issue(b5, P); check("P borrows b5", s == 201, (s, r))
    check("Q reserves b5", call(admin, "reservations.php", "POST", {"bookId": b5, "userId": Q})[0] == 201)
    call(admin, f"users.php?id={Q}", "PUT", {"status": "Inactive"}); ret(b5)
    s, r = issue(b5, R); check("an inactive patron's reservation does not block others", s == 201, (s, r)); ret(b5)
    call(admin, f"users.php?id={Q}", "PUT", {"status": "Active"})

    # ---- deleting a patron or a book cancels its active reservations (no dangling queue entries)
    b6, b7 = mkb("6"), mkb("7"); T, V = mku("t"), mku("v")
    issue(b6, P); call(admin, "reservations.php", "POST", {"bookId": b6, "userId": T}); ret(b6)       # b6 Available again, T still waiting
    issue(b7, P); call(admin, "reservations.php", "POST", {"bookId": b7, "userId": V})                 # b7 on loan, V waiting
    call(admin, f"users.php?id={V}", "DELETE")
    check("deleting a patron cancels their reservations", sql(f"select count(*) from reservations where user_id='{V}' and status='active'") == "0" and sql(f"select count(*) from reservations where user_id='{V}' and status='cancelled'") == "1")
    ret(b7); call(admin, f"books.php?id={b6}", "DELETE")
    check("deleting a book cancels its waiting list", sql(f"select count(*) from reservations where book_id='{b6}' and status='active'") == "0" and sql(f"select count(*) from reservations where book_id='{b6}' and status='cancelled'") == "1")
    e = call(admin, f"audit.php?action=book.delete&entity_id={b6}")[1]["entries"]
    check("the cancellation is recorded in the audit entry", e and e[0]["details"]["cancelledReservations"] == 1, e)
finally:
    for b in books: ret(b); call(admin, f"books.php?id={b}", "DELETE")
    for u in users: call(admin, f"users.php?id={u}", "DELETE")
    call(admin, "settings.php", "PUT", {k: v for k, v in orig.items()})
    check("settings restored", call(admin, "settings.php")[1]["settings"] == orig)
print(f"\n{passed} passed, {failed} failed"); sys.exit(1 if failed else 0)
