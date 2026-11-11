#!/usr/bin/env python3
"""Stage 2 integration test: circulation integrity against a real MySQL/MariaDB.
Usage: BASE=http://127.0.0.1:8081 ADMIN_PW=... python3 tests/stage2_transactions_test.py
Requires the dev seed (APP_ENV=development) and the `mysql` CLI on PATH for invariant checks."""
import json, os, subprocess, sys, threading, urllib.request, urllib.error, http.cookiejar
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

BASE = os.environ.get("BASE", "http://127.0.0.1:8081")
PW = os.environ["ADMIN_PW"]
passed = failed = 0

def check(name, cond, extra=""):
    global passed, failed
    if cond: passed += 1
    else: failed += 1
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"   <-- {extra}"))

def make_client():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def call(op, path, method="GET", body=None):
    req = urllib.request.Request(f"{BASE}/api/{path}", method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"})
    try:
        with op.open(req) as r: return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}

def sql(q):
    return subprocess.run(["mysql", "-N", "-B", "feu_library", "-e", q], capture_output=True, text=True).stdout.strip()

admin = make_client()
s, _ = call(admin, "auth.php", "POST", {"action": "login", "username": "admin", "password": PW})
check("login", s == 200, s)
# Policy (Phase 3): unpaid fines block new loans. Seed history contains fines, so mark them paid for this suite.
sql("update transactions set fine_paid_at=now() where fine>0 and fine_paid_at is null")
manila = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d")
utc = datetime.now(timezone.utc).strftime("%Y-%m-%d")
print(f"   (Manila today={manila}, UTC today={utc})")

def issue(book, user, **kw): return call(admin, "transactions.php", "POST", {"type": "issue", "bookId": book, "userId": user, **kw})
def ret(book, **kw): return call(admin, "transactions.php", "POST", {"type": "return", "bookId": book, **kw})
def renew(book): return call(admin, "transactions.php", "POST", {"type": "renew", "bookId": book})

# --- auth + validation
s, _ = call(make_client(), "transactions.php", "POST", {"type": "issue", "bookId": "SEED-B03", "userId": "SEED-U07"})
check("unauthenticated issue -> 401", s == 401, s)
s, _ = call(admin, "transactions.php", "POST", {"type": "bogus"}); check("invalid type -> 400", s == 400, s)
s, _ = call(admin, "transactions.php", "POST", {"type": "issue"}); check("missing bookId -> 422", s == 422, s)
s, _ = issue("SEED-B03", "SEED-U07", dueDate="garbage"); check("garbage due date -> 422", s == 422, s)
s, _ = issue("SEED-B03", "SEED-U07", dueDate="2020-01-01"); check("past due date -> 422", s == 422, s)
s, _ = issue("SEED-B03", "SEED-U07", dueDate="2099-01-01"); check("due date beyond loan period -> 422", s == 422, s)
check("failed validation left book Available", sql("select status from books where id='SEED-B03'") == "Available")
s, _ = issue("NOPE", "SEED-U07"); check("unknown book -> 404", s == 404, s)
s, _ = issue("SEED-B03", "NOPE"); check("unknown patron -> 404", s == 404, s)
s, _ = issue("SEED-B03", "SEED-U10"); check("inactive patron -> 409", s == 409, s)
check("failed issues left no transaction", sql("select count(*) from transactions where book_id='SEED-B03'") == "0")

# --- issue ignores client dates
s, r = issue("SEED-B03", "SEED-U07", issueDate="2020-01-01")
check("issue ok 201", s == 201, (s, r))
tx = r.get("transaction", {})
check("issue date forced to server Manila today", tx.get("issueDate") == manila, tx.get("issueDate"))
check("default due date = today + loan_days", sql("select datediff(due_date,issue_date) from transactions where book_id='SEED-B03'") == "7")
s, _ = issue("SEED-B03", "SEED-U07"); check("duplicate issue same book -> 409", s == 409, s)
s, _ = issue("SEED-B03", "SEED-U09"); check("issue same book other patron -> 409", s == 409, s)

# --- concurrent issue of the SAME book to different patrons
users = [f"SEED-U{n:02d}" for n in (1, 2, 4, 5, 6, 8, 9, 11, 12, 14)]
def race_issue(u):
    return issue("SEED-B04", u)[0]
with ThreadPoolExecutor(10) as ex: codes = list(ex.map(race_issue, users))
check("parallel issue same book: exactly one 201", codes.count(201) == 1 and codes.count(409) == 9, codes)
check("exactly one open loan for that book", sql("select count(*) from transactions where book_id='SEED-B04' and return_date is null") == "1")

# --- concurrent issues of different books to the SAME patron vs loan limit (5)
before = int(sql("select count(*) from books where borrowed_by='SEED-U11' and status in ('Borrowed','Overdue')"))
books = [f"SEED-B{n:02d}" for n in (5, 8, 9, 12, 13, 15, 16, 18, 19, 21)]
def race_limit(b): return issue(b, "SEED-U11")[0]
with ThreadPoolExecutor(10) as ex: codes = list(ex.map(race_limit, books))
after = int(sql("select count(*) from books where borrowed_by='SEED-U11' and status in ('Borrowed','Overdue')"))
check("parallel issues cannot exceed loan limit", after == 5 and codes.count(201) == 5 - before, (before, after, codes))

# --- returns
s, r = ret("SEED-B03", fine=9999, status="Returned", returnDate="2099-01-01"); check("future return date -> 422", s == 422, s)
s, r = ret("SEED-B03", returnDate="2020-01-01"); check("return before issue date -> 422", s == 422, s)
s, r = ret("SEED-B03", returnDate="nonsense"); check("garbage return date -> 422", s == 422, s)
check("failed returns left loan open", sql("select count(*) from transactions where book_id='SEED-B03' and return_date is null") == "1")
s, r = ret("SEED-B03", userId="SEED-U01"); check("wrong patron -> 409", s == 409, s)
s, r = ret("SEED-B03", fine=9999, bookTitle="HACK", userName="HACK")
check("on-time return ok, forged fine ignored", s == 200 and r.get("fine") == 0 and r["transaction"]["bookTitle"] != "HACK", (s, r))
check("book Available after return", sql("select status from books where id='SEED-B03'") == "Available")
s, _ = ret("SEED-B03"); check("second return -> 409", s == 409, s)

# --- concurrent double return
def race_ret(_): return ret("SEED-B04")[0]
with ThreadPoolExecutor(10) as ex: codes = list(ex.map(race_ret, range(10)))
check("parallel returns: exactly one 200", codes.count(200) == 1 and codes.count(409) == 9, codes)
check("returned exactly once", sql("select count(*) from transactions where book_id='SEED-B04' and status='Returned'") == "1")

# --- overdue fine computed on server (seed: SEED-B06 due 13 days ago; grace 1, 10/day)
s, r = ret("SEED-B06", fine=1)
check("overdue fine computed by server (12 billable days x 10)", s == 200 and r.get("fine") == 120.0, (s, r))
s, _ = renew("SEED-B07"); check("renew of non-open book -> 409", s == 409, s)
# --- renew rules
s, _ = renew("SEED-B24"); check("overdue loan cannot be renewed -> 409", s == 409, s)
s, r = renew("SEED-B02"); check("renew 1 ok", s == 200 and r["transaction"]["renewalCount"] == 1, (s, r))
s, r = renew("SEED-B02"); check("renew 2 ok", s == 200 and r["transaction"]["renewalCount"] == 2, (s, r))
s, _ = renew("SEED-B02"); check("renew 3 blocked by max_renewals -> 409", s == 409, s)

# --- backdated (late-logged) return inside [issue, today]
s, r = issue("SEED-B22", "SEED-U12"); check("issue for backdate test", s == 201, (s, r))
s, r = ret("SEED-B22", returnDate=manila); check("return dated today ok", s == 200, (s, r))

# --- global invariants
check("no book has >1 open loan", sql("select count(*) from (select book_id from transactions where return_date is null and status in ('Borrowed','Overdue') group by book_id having count(*)>1) x") == "0")
check("every Borrowed/Overdue book has exactly one matching open loan", sql("select count(*) from books b where b.deleted_at is null and b.status in ('Borrowed','Overdue') and (select count(*) from transactions t where t.book_id=b.id and t.return_date is null and t.user_id=b.borrowed_by)<>1") == "0")
check("no Available book has an open loan", sql("select count(*) from books b join transactions t on t.book_id=b.id and t.return_date is null where b.status='Available'") == "0")
check("no patron over loan limit", sql("select count(*) from (select borrowed_by from books where status in ('Borrowed','Overdue') group by borrowed_by having count(*)>5) x") == "0")
check("returned rows have return_date and fine>=0", sql("select count(*) from transactions where status='Returned' and (return_date is null or fine<0)") == "0")

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)