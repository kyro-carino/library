#!/usr/bin/env python3
"""Stage 8 API smoke test. Repeatable: creates its own books/patrons ("SMOKE ..."), restores settings,
and removes the temporary staff accounts it adds. Python 3 standard library only.

  BASE=http://localhost/library ADMIN_PW=... python3 tests/smoke_api_test.py

Optional (enables extra checks, otherwise they are reported as SKIP):
  MYSQL_CLI="mysql -u root -P 3306 -h 127.0.0.1"   needs the `mysql` client and `php` on PATH
Run against a DEVELOPMENT database only. Soft-deleted fixture rows remain (history is kept)."""
import glob, json, os, random, shlex, subprocess, sys, tempfile, time, urllib.request, urllib.error, http.cookiejar
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

BASE = os.environ.get("BASE", "http://127.0.0.1:8081").rstrip("/")
PW = os.environ["ADMIN_PW"]
MYSQL = shlex.split(os.environ.get("MYSQL_CLI", "mysql -N -B")) + [os.environ.get("DB_NAME", "feu_library")]
RUN = "%06d" % random.randint(0, 999999)
passed = failed = skipped = 0


def check(name, cond, extra=""):
    global passed, failed
    passed += bool(cond); failed += (not cond)
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"   <-- {extra}"))


def skip(name, why):
    global skipped
    skipped += 1
    print(f"SKIP {name} ({why})")


def client():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def call(op, path, method="GET", body=None, headers=None, raw=None, base=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    h = {"Content-Type": "application/json"}; h.update(headers or {})
    req = urllib.request.Request(f"{base or BASE}/api/{path}", method=method, data=data, headers=h)
    try:
        with op.open(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw_body = e.read()
        try:
            return e.code, json.loads(raw_body or b"{}")
        except Exception:
            return e.code, {"_raw": raw_body.decode("utf8", "replace")[:300]}


def sql(q):
    try:
        r = subprocess.run(MYSQL + ["-e", q], capture_output=True, text=True, timeout=30)
        return r.stdout.strip() if r.returncode == 0 else None
    except Exception:
        return None


HAVE_SQL = sql("select 1") == "1"
manila = datetime.now(timezone(timedelta(hours=8))).date()
iso = lambda d: d.isoformat()
today = iso(manila)

# best-effort: clear leftover login-throttle files so repeated runs do not hit the per-IP limit
def clear_throttle():
    for f in glob.glob(os.path.join(tempfile.gettempdir(), "feu_throttle_*.json")):
        try: os.unlink(f)
        except OSError: pass

clear_throttle()
admin = client()
cleanup = {"books": [], "patrons": [], "auth": []}

# ======================= AUTHENTICATION =======================
anon = client()
for ep in ["books.php", "users.php", "transactions.php", "reports.php", "settings.php", "account.php", "notifs.php", "reservations.php"]:
    s, _ = call(anon, ep); check(f"anonymous GET {ep} -> 401", s == 401, s)
s, r = call(anon, "auth.php?action=status")
check("status: unauthenticated, no user leaked", s == 200 and r.get("authenticated") is False and r.get("user") is None, r)
s, _ = call(anon, "auth.php", "POST", {"action": "login"}); check("login without fields -> 422", s == 422, s)
s, r1 = call(anon, "auth.php", "POST", {"action": "login", "username": "admin", "password": "wrong-password-x"})
s2, r2 = call(anon, "auth.php", "POST", {"action": "login", "username": "no_such_" + RUN, "password": "wrong-password-x"})
check("wrong password and unknown user give the same 401 message", s == 401 and s2 == 401 and r1 == r2, (r1, r2))
s, _ = call(anon, "auth.php", "PATCH", {}); check("auth.php unsupported method -> 405", s == 405, s)
s, _ = call(anon, "auth.php", "POST", {"action": "nope"}); check("unknown auth action -> 400", s == 400, s)
s, _ = call(anon, "auth.php", "POST", {"action": "setup", "username": "x", "email": "x@y.zz", "password": "longenough-pw", "displayName": "X"})
check("first-run setup refused once an admin exists -> 409", s == 409, s)

s, r = call(admin, "auth.php", "POST", {"action": "login", "username": "admin", "password": PW})
check("admin login ok", s == 200 and r["user"]["role"] == "admin", (s, r))
check("login payload has no password hash", "password" not in json.dumps(r).lower(), r)
s, r = call(admin, "auth.php?action=status"); check("status: authenticated", r.get("authenticated") is True, r)
s, r = call(admin, "books.php", "POST", {"title": "SMOKE cross-site", "author": "X"}, headers={"Origin": "http://evil.example"})
check("cross-site POST blocked -> 403", s == 403, (s, r))
s, _ = call(admin, "auth.php", "POST", {"action": "password", "currentPassword": "x", "newPassword": "short", "confirmPassword": "short"})
check("password change: too short -> 422", s == 422, s)
s, _ = call(admin, "auth.php", "POST", {"action": "password", "currentPassword": "x" * 12, "newPassword": "a-long-new-password", "confirmPassword": "different-password"})
check("password change: mismatch -> 422", s == 422, s)
s, _ = call(admin, "auth.php", "POST", {"action": "password", "currentPassword": "not-the-password", "newPassword": "a-long-new-password", "confirmPassword": "a-long-new-password"})
check("password change: wrong current -> 400", s == 400, s)

# session expiry: after logout the old session must be rejected everywhere
tmp = client(); call(tmp, "auth.php", "POST", {"action": "login", "username": "admin", "password": PW})
check("temp session works", call(tmp, "books.php?limit=1")[0] == 200)
call(tmp, "auth.php", "POST", {"action": "logout"})
check("after logout -> 401", call(tmp, "books.php?limit=1")[0] == 401)

# throttling (random username so the real admin is never locked out)
u = "thr_" + RUN; codes = [call(client(), "auth.php", "POST", {"action": "login", "username": u, "password": "bad-pass-1234"})[0] for _ in range(6)]
check("login throttle: 5 failures then 429", codes[:5] == [401] * 5 and codes[5] == 429, codes)
clear_throttle()

# ======================= AUTHORIZATION (needs SQL) =======================
def add_staff(role, status="Active"):
    name = f"smoke_{role}_{status.lower()}_{RUN}"
    h = subprocess.run(["php", "-r", "echo password_hash('Smoke-Pw-12345', PASSWORD_DEFAULT);"], capture_output=True, text=True).stdout
    if not h or sql(f"insert into auth_users(username,email,password_hash,display_name,role,status) values('{name}','{name}@example.invalid','{h}','Smoke {role}','{role}','{status}')") is None:
        return None
    cleanup["auth"].append(name); return name

if HAVE_SQL:
    pat = add_staff("patron"); ina = add_staff("librarian", "Inactive"); lib = add_staff("librarian")
    s, _ = call(client(), "auth.php", "POST", {"action": "login", "username": pat, "password": "Smoke-Pw-12345"})
    check("patron account cannot sign in to the portal -> 403", s == 403, s)
    s, _ = call(client(), "auth.php", "POST", {"action": "login", "username": ina, "password": "Smoke-Pw-12345"})
    check("inactive account cannot sign in -> 403", s == 403, s)
    lc = client(); s, _ = call(lc, "auth.php", "POST", {"action": "login", "username": lib, "password": "Smoke-Pw-12345"})
    check("librarian can sign in", s == 200, s)
    check("librarian can read books", call(lc, "books.php?limit=1")[0] == 200)
    sql(f"update auth_users set role='patron' where username='{lib}'")
    check("role demoted in DB -> 403 on next request", call(lc, "books.php", "POST", {"title": "SMOKE x", "author": "x"})[0] == 403)
    sql(f"update auth_users set role='librarian', status='Inactive' where username='{lib}'")
    check("deactivated in DB -> 401 on next request", call(lc, "books.php?limit=1")[0] == 401)
else:
    skip("authorization (patron/inactive/demoted accounts)", "set MYSQL_CLI and make php available")

# ======================= BOOKS =======================
mk = lambda t, **kw: call(admin, "books.php", "POST", {"title": t, "author": "Smoke Tester", **kw})
for label, body in [("missing title", {"author": "A"}), 
                    ("bad year", {"title": "T", "author": "A", "year": -9999}), ("bad category", {"title": "T", "author": "A", "category": "Nope"}),
                    ("javascript: cover", {"title": "T", "author": "A", "cover": "javascript:alert(1)"}),
                    ("title over 255 chars", {"title": "T" * 256, "author": "A"}), ("empty body", {})]:
    s, _ = call(admin, "books.php", "POST", body); check(f"book create rejects {label} -> 422", s == 422, s)
s, _ = call(admin, "books.php", "POST", raw=b"{not json"); check("malformed JSON body -> 422 (no crash)", s == 422, s)
s, _ = call(admin, "books.php", "POST", raw=b'{"title":"' + b"x" * 2_100_000 + b'"}'); check("oversized payload -> 413", s == 413, s)
s, _ = call(admin, "books.php", "PATCH", {}); check("books unsupported method -> 405", s == 405, s)

TOKEN = f"SMK{RUN}"
s, r = mk(f"{TOKEN} 50% off_sale", category="Science")
check("book create -> 201", s == 201, (s, r)); b0 = r["book"]; cleanup["books"].append(b0["id"])
check("no fabricated description/format/cover", b0["description"] is None and b0["format"] is None and b0["cover"] is None, b0)
check("new book is Available with 0 borrows", b0["status"] == "Available" and b0["borrowCount"] == 0, b0)
check("books no longer carry an ISBN", "isbn" not in b0, b0)
s, r = call(admin, f"books.php?id={b0['id']}"); check("get by id", s == 200 and r["book"]["title"].startswith(TOKEN), (s, r))
check("unknown book id -> 404", call(admin, "books.php?id=NOPE-000")[0] == 404)
s, r = call(admin, f"books.php?id={b0['id']}", "PUT", {"description": "note", "format": "Paperback", "cover": "https://example.org/c.jpg"})
check("book edit persists", s == 200 and r["book"]["description"] == "note" and r["book"]["format"] == "Paperback", (s, r))
check("empty cover clears", call(admin, f"books.php?id={b0['id']}", "PUT", {"cover": ""})[1]["book"]["cover"] is None)
check("edit with no fields -> 400", call(admin, f"books.php?id={b0['id']}", "PUT", {})[0] == 400)
check("edit unknown book -> 404", call(admin, "books.php?id=NOPE-000", "PUT", {"title": "x"})[0] == 404)

# SQL LIKE wildcards are literal
tot = lambda q: call(admin, "books.php?limit=1&search=" + urllib.request.quote(q))[1].get("total")
check("search '%' matches only titles containing a literal %", tot("%") == 1, tot("%"))
check("search '_' matches only titles containing a literal _", tot("_") == 1, tot("_"))
check("search by token finds the fixture", tot(TOKEN) == 1, tot(TOKEN))
check("search is case-insensitive", tot(TOKEN.lower()) == 1, tot(TOKEN.lower()))

# pagination
s, a = call(admin, "books.php?limit=5&offset=0"); s2, bb = call(admin, "books.php?limit=5&offset=5")
ids_a = [x["id"] for x in a["books"]]; ids_b = [x["id"] for x in bb["books"]]
check("pagination: pages are disjoint and sized", len(ids_a) == 5 and len(ids_b) == 5 and not set(ids_a) & set(ids_b), (ids_a, ids_b))
check("pagination: total is stable across pages", a["total"] == bb["total"] and a["total"] >= 41, (a["total"], bb["total"]))
check("pagination: offset past end -> empty list, 200", call(admin, "books.php?limit=5&offset=100000")[1]["books"] == [])
check("pagination: limit capped at 200", call(admin, "books.php?limit=100000")[1]["limit"] == 200)
check("pagination: limit 0 raised to 1", call(admin, "books.php?limit=0")[1]["limit"] == 1)
check("pagination: junk limit/negative offset fall back safely", (lambda r: r["limit"] == 100 and r["offset"] == 0)(call(admin, "books.php?limit=abc&offset=-5")[1]))
check("category filter", all(x["category"] == "Science" for x in call(admin, "books.php?category=Science&limit=200")[1]["books"]))

# ======================= PATRONS =======================
mail = lambda tag: f"smoke.{tag}.{RUN}@example.invalid"
mp = lambda tag, **kw: call(admin, "users.php", "POST", {"lastName": "Smoke", "firstName": tag, "contact": mail(tag), **kw})
for label, body in [("missing names", {"contact": mail("x")}), ("bad email", {"lastName": "S", "firstName": "T", "contact": "nope"}),
                    ("year level 9", {"lastName": "S", "firstName": "T", "contact": mail("y"), "yearLevel": 9}),
                    ("bad status", {"lastName": "S", "firstName": "T", "contact": mail("z"), "status": "Banned"})]:
    s, _ = call(admin, "users.php", "POST", body); check(f"patron create rejects {label} -> 422", s == 422, s)
s, r = mp("Alpha", middleInitial="q9", yearLevel=2, program="BSIT"); check("patron create -> 201", s == 201, (s, r))
p1 = r["user"]; cleanup["patrons"].append(p1["id"]); check("middle initial sanitized to one letter", p1["middleInitial"] == "Q", p1)
check("duplicate email -> 422", mp("Alpha")[0] == 422)
s, r = mp("Beta"); p2 = r["user"]; cleanup["patrons"].append(p2["id"])
s, r = mp("Gamma", status="Inactive"); p3 = r["user"]; cleanup["patrons"].append(p3["id"])
s, r = call(admin, f"users.php?id={p1['id']}", "PUT", {"program": "BS Nursing", "yearLevel": 3}); check("patron edit persists", s == 200 and r["user"]["yearLevel"] == 3, (s, r))
check("patron edit to a taken email -> 422", call(admin, f"users.php?id={p1['id']}", "PUT", {"contact": mail("Beta")})[0] == 422)
check("patron search finds fixture", call(admin, f"users.php?search=Alpha&limit=200")[1]["total"] >= 1)
check("patron search '%' is literal", call(admin, "users.php?search=%25&limit=1")[1]["total"] == 0)
check("patron pagination limit capped at 200", call(admin, "users.php?limit=99999")[1]["limit"] == 200)
check("status filter", all(u["status"] == "Inactive" for u in call(admin, "users.php?status=Inactive&limit=200")[1]["users"]))
check("unknown patron -> 404", call(admin, "users.php?id=NOPE-1")[0] == 404)

# ======================= SETTINGS / NOTIFICATIONS / ACCOUNT =======================
s, st = call(admin, "settings.php"); orig = st["settings"]
for label, body in [("negative fine", {"finePerDay": -1}), ("loanDays 0", {"loanDays": 0}), ("page size 7", {"pageSize": 7}), ("bad email", {"libraryEmail": "x"}), ("bad landing page", {"landingPage": "nope"})]:
    s, _ = call(admin, "settings.php", "PUT", body); check(f"settings reject {label} -> 422", s == 422, s)
check("settings empty update -> 400", call(admin, "settings.php", "PUT", {})[0] == 400)
s, n = call(admin, "notifs.php"); np = n["prefs"]
s, n2 = call(admin, "notifs.php", "PUT", {"newUser": not np["newUser"]}); check("notification pref persists", s == 200 and n2["prefs"]["newUser"] == (not np["newUser"]), n2)
call(admin, "notifs.php", "PUT", {"newUser": np["newUser"]})
check("notifs empty update -> 400", call(admin, "notifs.php", "PUT", {})[0] == 400)
check("account: bad avatar colour -> 422", call(admin, "account.php", "PUT", {"avatarPreset": "x" * 80})[0] == 422)
check("account: bad username -> 422", call(admin, "account.php", "PUT", {"username": "a b"})[0] == 422)
check("account: bad email -> 422", call(admin, "account.php", "PUT", {"email": "nope"})[0] == 422)
check("account: no fields -> 400", call(admin, "account.php", "PUT", {})[0] == 400)
check("account GET has no hash", "password" not in json.dumps(call(admin, "account.php")[1]).lower())

# ======================= CIRCULATION =======================
loan_days = orig["loanDays"]; max_books = orig["maxBooksPerUser"]; max_ren = orig["maxRenewals"]
call(admin, "settings.php", "PUT", {"overdueFinesEnabled": True, "finePerDay": 10, "gracePeriodDays": 1})
issue = lambda op, b, u, **kw: call(op, "transactions.php", "POST", {"type": "issue", "bookId": b, "userId": u, **kw})
ret = lambda op, b, **kw: call(op, "transactions.php", "POST", {"type": "return", "bookId": b, **kw})
renew = lambda b: call(admin, "transactions.php", "POST", {"type": "renew", "bookId": b})
bk = lambda n: mk(f"{TOKEN} circ {n}")[1]["book"]["id"]
books = [bk(i) for i in range(max_books + 2)]; cleanup["books"] += books

check("transactions: invalid type -> 400", call(admin, "transactions.php", "POST", {"type": "x"})[0] == 400)
check("transactions: missing bookId -> 422", call(admin, "transactions.php", "POST", {"type": "issue"})[0] == 422)
check("transactions: unsupported method -> 405", call(admin, "transactions.php", "DELETE")[0] == 405)
check("issue: unknown book -> 404", issue(admin, "NOPE", p1["id"])[0] == 404)
check("issue: unknown patron -> 404", issue(admin, books[0], "NOPE")[0] == 404)
check("issue: inactive patron -> 409", issue(admin, books[0], p3["id"])[0] == 409)
check("issue: garbage due date -> 422", issue(admin, books[0], p1["id"], dueDate="garbage")[0] == 422)
check("issue: past due date -> 422", issue(admin, books[0], p1["id"], dueDate="2020-01-01")[0] == 422)
check("issue: due date beyond loan period -> 422", issue(admin, books[0], p1["id"], dueDate=iso(manila + timedelta(days=loan_days + 1)))[0] == 422)
check("failed issues left the book Available", call(admin, f"books.php?id={books[0]}")[1]["book"]["status"] == "Available")

s, r = issue(admin, books[0], p1["id"], issueDate="2020-01-01")
check("issue ok -> 201, client issue date ignored", s == 201 and r["transaction"]["issueDate"] == today, (s, r))
check("default due date = today + loan days", r["transaction"]["dueDate"] == iso(manila + timedelta(days=loan_days)), r["transaction"])
check("duplicate issue of same book/patron -> 409", issue(admin, books[0], p1["id"])[0] == 409)
check("issue same book to another patron -> 409", issue(admin, books[0], p2["id"])[0] == 409)

# duplicate submissions racing from separate sessions: exactly one wins
clients = [client() for _ in range(6)]
for c in clients: call(c, "auth.php", "POST", {"action": "login", "username": "admin", "password": PW})
with ThreadPoolExecutor(6) as ex: codes = list(ex.map(lambda c: issue(c, books[1], p2["id"])[0], clients))
check("6 parallel issues of one book: exactly one 201", codes.count(201) == 1 and codes.count(409) == 5, codes)
with ThreadPoolExecutor(6) as ex: codes = list(ex.map(lambda c: ret(c, books[1])[0], clients))
check("6 parallel returns: exactly one 200", codes.count(200) == 1 and codes.count(409) == 5, codes)

# loan limit (patron p1 already holds books[0])
codes = [issue(admin, books[i], p1["id"])[0] for i in range(1, max_books + 1)]
check(f"loan limit enforced at {max_books} books", codes[:max_books - 1] == [201] * (max_books - 1) and codes[max_books - 1] == 409, codes)

# returns
check("return: future date -> 422", ret(admin, books[0], returnDate=iso(manila + timedelta(days=2)))[0] == 422)
check("return: before issue date -> 422", ret(admin, books[0], returnDate="2020-01-01")[0] == 422)
check("return: garbage date -> 422", ret(admin, books[0], returnDate="nonsense")[0] == 422)
check("return: wrong patron -> 409", ret(admin, books[0], userId=p2["id"])[0] == 409)
check("failed returns left the loan open", call(admin, f"transactions.php?book_id={books[0]}&status=open")[1]["total"] == 1)
s, r = ret(admin, books[0], fine=9999, bookTitle="HACK", userName="HACK", status="Returned")
check("on-time return: forged fine/title/name ignored", s == 200 and r["fine"] == 0 and r["transaction"]["bookTitle"] != "HACK", (s, r))
check("second return of same loan -> 409", ret(admin, books[0])[0] == 409)

# renewals (settings.maxRenewals)
codes = [renew(books[2])[0] for _ in range(max_ren + 1)]
check(f"renewals: {max_ren} allowed then 409", codes == [200] * max_ren + [409], codes)
check("renew of a book that is not on loan -> 409", renew(books[max_books + 1])[0] == 409)
check("renew naming the wrong patron -> 409", call(admin, "transactions.php", "POST", {"type": "renew", "bookId": books[2], "userId": p2["id"]})[0] == 409)

# reservations
check("reserve an available title -> 400", call(admin, "reservations.php", "POST", {"bookId": books[max_books + 1], "userId": p2["id"]})[0] == 400)
s, r = call(admin, "reservations.php", "POST", {"bookId": books[2], "userId": p2["id"]}); check("reserve a borrowed title -> 201", s == 201, (s, r))
check("duplicate reservation -> 409", call(admin, "reservations.php", "POST", {"bookId": books[2], "userId": p2["id"]})[0] == 409)
check("reservation listed", len(call(admin, f"reservations.php?user_id={p2['id']}")[1]["reservations"]) == 1)
call(admin, "reservations.php", "POST", {"action": "cancel", "bookId": books[2], "userId": p2["id"]})
check("reservation cancelled", call(admin, f"reservations.php?user_id={p2['id']}")[1]["reservations"] == [])

# delete rules
check("cannot delete a book on loan -> 400", call(admin, f"books.php?id={books[2]}", "DELETE")[0] == 400)
check("cannot delete a patron with active loans -> 400", call(admin, f"users.php?id={p1['id']}", "DELETE")[0] == 400)

# fines (needs SQL to backdate a loan: the API refuses past due dates by design)
def backdated_return(grace, expect_days=3):
    call(admin, "settings.php", "PUT", {"gracePeriodDays": grace})
    call(admin, "transactions.php", "POST", {"type": "pay_fine", "userId": p2["id"]})  # policy: unpaid fines block new loans (409 if none owed is fine)
    b = books[max_books + 1]; s, r = issue(admin, b, p2["id"]); txid = r["transaction"]["id"]
    sql(f"update transactions set issue_date='{iso(manila - timedelta(days=10))}', due_date='{iso(manila - timedelta(days=expect_days))}' where id='{txid}'")
    sql(f"update books set issue_date='{iso(manila - timedelta(days=10))}', due_date='{iso(manila - timedelta(days=expect_days))}' where id='{b}'")
    return b
if HAVE_SQL:
    b = backdated_return(1)
    rep = call(admin, "reports.php")[1]; row = [o for o in rep["overdue"] if o["bookId"] == b]
    check("overdue report lists the backdated loan with server-computed days and fine", len(row) == 1 and row[0]["daysLate"] == 3 and row[0]["estimatedFine"] == 20.0, row)
    check("overdue loan cannot be renewed -> 409", renew(b)[0] == 409)
    s, r = ret(admin, b, fine=1)
    check("fine = (3 days late - 1 grace) x 10, forged fine ignored", s == 200 and r["fine"] == 20.0 and r["daysOverdue"] == 3, (s, r))
    b = backdated_return(0)
    s, r = ret(admin, b)
    check("grace period 0 -> fine = 3 x 10 (setting is honoured)", s == 200 and r["fine"] == 30.0, (s, r))
    call(admin, "settings.php", "PUT", {"overdueFinesEnabled": False}); b = backdated_return(1)
    s, r = ret(admin, b); check("fines disabled -> fine 0", s == 200 and r["fine"] == 0, (s, r))
else:
    skip("overdue fine / grace period / fines-disabled checks", "need MYSQL_CLI to backdate a loan")

# ======================= REPORTS =======================
call(admin, "settings.php", "PUT", {"overdueFinesEnabled": True})
for i in range(1, max_books + 1): ret(admin, books[i])  # return everything we still hold
rep = call(admin, "reports.php")[1]; c, t = rep["collection"], rep["totals"]
check("reports: available + onLoan + overdue == titles", c["available"] + c["onLoan"] + c["overdue"] == c["titles"], c)
check("reports: 7 activity days ending today", len(rep["activity"]) == 7 and rep["activity"][-1]["date"] == today and rep["asOf"] == today)
check("reports: overdue list size == totals.overdueCount", len(rep["overdue"]) == t["overdueCount"])
check("reports: openLoans == transactions?status=open total", t["openLoans"] == call(admin, "transactions.php?status=open&limit=1")[1]["total"], (t, ))
check("reports: patron-facing filters work", call(admin, f"transactions.php?user_id={p1['id']}")[1]["total"] >= max_books)
check("notifications items reflect overdue loans", isinstance(call(admin, "notifs.php")[1]["items"], list))

# ======================= DATABASE ERRORS =======================
env = dict(os.environ, DB_PORT="1", PHP_CLI_SERVER_WORKERS="1")
srv = subprocess.Popen(["php", "-S", "127.0.0.1:8099", "-t", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(1.2); s, r = call(client(), "books.php", base="http://127.0.0.1:8099")
    txt = json.dumps(r)
    check("database unreachable -> clean 5xx JSON, no stack trace or credentials", s in (500, 503) and "error" in r and not any(k in txt for k in ("PDOException", "Stack trace", ".php:", "password", PW)), (s, r))
except Exception as e:
    skip("database-unreachable check", f"could not start PHP: {e}")
finally:
    srv.terminate()

# ======================= CLEANUP =======================
call(admin, "settings.php", "PUT", {k: v for k, v in orig.items()})
check("settings restored", {k: call(admin, "settings.php")[1]["settings"][k] for k in orig} == orig)
for b in cleanup["books"]:
    ret(admin, b); call(admin, f"books.php?id={b}", "DELETE")
for p in cleanup["patrons"]: call(admin, f"users.php?id={p}", "DELETE")
if HAVE_SQL:
    for n in cleanup["auth"]: sql(f"delete from auth_users where username='{n}'")
check("fixture books removed from the catalog", call(admin, "books.php?limit=1&search=" + TOKEN)[1]["total"] == 0)
check("fixture patrons removed", call(admin, f"users.php?search=smoke.&limit=200")[1]["total"] == 0 or all(RUN not in u["contact"] for u in call(admin, "users.php?search=smoke.&limit=200")[1]["users"]))
call(admin, "auth.php", "POST", {"action": "logout"}); clear_throttle()

print(f"\n{passed} passed, {failed} failed, {skipped} skipped")
sys.exit(1 if failed else 0)