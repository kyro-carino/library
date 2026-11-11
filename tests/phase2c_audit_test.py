#!/usr/bin/env python3
"""Phase 2C test: the audit trail records who did what, atomically, without secrets.
  BASE=http://127.0.0.1:8081 ADMIN_PW=... [MYSQL_CLI="mysql -uroot -N -B"] python3 tests/phase2c_audit_test.py
DEVELOPMENT database only. Creates tagged fixtures and removes them; restores settings."""
import json, os, random, shlex, subprocess, sys, urllib.request, urllib.error, http.cookiejar
BASE = os.environ.get("BASE", "http://127.0.0.1:8081").rstrip("/"); PW = os.environ["ADMIN_PW"]
MYSQL = shlex.split(os.environ.get("MYSQL_CLI", "mysql -N -B")) + [os.environ.get("DB_NAME", "feu_library")]
RUN = "%05d" % random.randint(0, 99999); TAG = f"P2C{RUN}"
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

# --- access control
s, _ = call(client(), "audit.php"); check("anonymous GET audit.php -> 401", s == 401, s)
admin = client()
WRONG = f"WRONGPW-{RUN}"; GHOST = f"nobody_{RUN}"
call(client(), "auth.php", "POST", {"action": "login", "username": "admin", "password": WRONG})
call(client(), "auth.php", "POST", {"action": "login", "username": GHOST, "password": WRONG})
check("login", call(admin, "auth.php", "POST", {"action": "login", "username": "admin", "password": PW})[0] == 200)
s, _ = call(admin, "audit.php", "POST", {}); check("audit.php is read-only (POST -> 405)", s == 405, s)
s, _ = call(admin, "audit.php", "DELETE"); check("audit.php is read-only (DELETE -> 405)", s == 405, s)
for q in ["action=Bad Action!", "actor_id=abc", "from=yesterday", "entity_type=a;b"]:
    s, _ = call(admin, "audit.php?" + q.replace(" ", "%20")); check(f"bad filter {q} -> 422", s == 422, s)
check("array filter is ignored, not a 500", call(admin, "audit.php?action[]=x")[0] == 200)

def entries(**f):
    q = "&".join(f"{k}={v}" for k, v in f.items())
    s, r = call(admin, f"audit.php?limit=200&{q}"); assert s == 200, (s, r); return r["entries"]
def last(action, entity_id=None):
    e = [x for x in entries(action=action) if entity_id is None or x["entityId"] == entity_id]; return e[0] if e else None
def total(): return call(admin, "audit.php?limit=1")[1]["total"]

# --- auth events
e = last("auth.login"); check("login is logged with actor and IP", e and e["actorName"] and e["actorId"] and e["ip"], e)
fails = entries(action="auth.login_failed")[:2]
check("failed logins are logged without an actor", len(fails) == 2 and all(x["actorId"] is None for x in fails), fails)
check("failed login records only whether the account exists", {x["details"]["accountExists"] for x in fails} == {True, False}, fails)

# --- books
s, r = call(admin, "books.php", "POST", {"title": f"{TAG} book", "author": "T"}); book = r["book"]["id"]
e = last("book.create", book); check("book.create logged", e and e["details"]["title"] == f"{TAG} book" and e["actorName"], e)
call(admin, f"books.php?id={book}", "PUT", {"description": "x", "format": "Paperback"})
e = last("book.update", book); check("book.update logs which fields changed", e and set(e["details"]["fields"]) == {"description", "format"}, e)

# --- patron + circulation
s, r = call(admin, "users.php", "POST", {"lastName": "Audit", "firstName": TAG, "contact": f"{TAG.lower()}@example.invalid"}); user = r["user"]["id"]
check("user.create logged", (last("user.create", user) or {}).get("details", {}).get("name", "").startswith("Audit, " + TAG))
call(admin, f"users.php?id={user}", "PUT", {"program": "BSIT"}); check("user.update logged", last("user.update", user) is not None)

before = total()
check("issue to unknown patron fails", call(admin, "transactions.php", "POST", {"type": "issue", "bookId": book, "userId": "NOPE"})[0] == 404)
check("rejected requests leave no audit entry", total() == before, (before, total()))
s, r = call(admin, "transactions.php", "POST", {"type": "issue", "bookId": book, "userId": user}); check("issue ok", s == 201, (s, r))
e = last("loan.issue", book); check("loan.issue logged (who, which patron, due date)", e and e["details"]["userId"] == user and e["details"]["dueDate"] and e["actorName"], e)
before = total(); call(admin, "transactions.php", "POST", {"type": "issue", "bookId": book, "userId": user})
check("duplicate issue (409) leaves no audit entry", total() == before)
call(admin, "transactions.php", "POST", {"type": "renew", "bookId": book}); check("loan.renew logged", (last("loan.renew", book) or {}).get("details", {}).get("renewals") == 1)
s, r = call(admin, "transactions.php", "POST", {"type": "return", "bookId": book})
e = last("loan.return", book); check("loan.return logged with fine", e and e["details"]["fine"] == 0 and e["details"]["userId"] == user, e)
call(admin, "reservations.php", "POST", {"bookId": book, "userId": user})  # available -> 400, nothing logged
check("reservation rejected -> not logged", last("reservation.create", book) is None)

# --- settings / notifications / account
orig = call(admin, "settings.php")[1]["settings"]
call(admin, "settings.php", "PUT", {"loanDays": 9, "finePerDay": 12.5})
e = last("settings.update"); check("settings.update logs old -> new values", e and e["details"]["changes"]["loanDays"] == [orig["loanDays"], 9], e)
before = total(); call(admin, "settings.php", "PUT", {"loanDays": 9}); check("no-op settings save is not logged", total() == before)
call(admin, "settings.php", "PUT", {k: v for k, v in orig.items()})
call(admin, "settings.php", "PUT", {"action": "reset"}); check("settings.reset logged", last("settings.reset") is not None)
call(admin, "settings.php", "PUT", {k: v for k, v in orig.items()})
n0 = call(admin, "notifs.php")[1]["prefs"]; call(admin, "notifs.php", "PUT", {"newUser": not n0["newUser"]})
check("notifs.update logged", last("notifs.update") is not None); call(admin, "notifs.php", "PUT", {"newUser": n0["newUser"]})
call(admin, "account.php", "PUT", {"avatarPreset": "#237A43"})
e = last("account.update"); check("account.update logged by field name only", e and "avatar_preset" in e["details"]["fields"] and "#237A43" not in json.dumps(e), e)

# --- deletes (history must outlive the deleted records)
call(admin, f"users.php?id={user}", "DELETE"); call(admin, f"books.php?id={book}", "DELETE")
check("user.delete logged", last("user.delete", user) is not None); check("book.delete logged", last("book.delete", book) is not None)
check("history of a deleted book is still readable", len(entries(entity_type="book", entity_id=book)) >= 5, len(entries(entity_type="book", entity_id=book)))

# --- filters + paging
check("filter by action", all(x["action"] == "loan.issue" for x in entries(action="loan.issue")))
check("filter by actor", all(x["actorId"] == e["actorId"] for x in entries(actor_id=e["actorId"])))
check("from/to date filter", entries(**{"from": "2000-01-01", "to": "2000-01-02"}) == [] and len(entries(**{"from": "2000-01-01"})) > 0)
s, a = call(admin, "audit.php?limit=3&offset=0"); s, b = call(admin, "audit.php?limit=3&offset=3")
check("paging: disjoint pages, newest first", not {x["id"] for x in a["entries"]} & {x["id"] for x in b["entries"]} and a["entries"][0]["id"] > a["entries"][-1]["id"])
check("limit capped at 200", call(admin, "audit.php?limit=99999")[1]["limit"] == 200)

# --- no secrets, ever
dump = json.dumps(entries())
check("no password, attempted username or token appears in the log", all(t not in dump for t in (PW, WRONG, GHOST, "password_hash", "$2y$")), "secret found")
if HAVE_SQL:
    check("DB: every row has a timestamp and an action", sql("select count(*) from audit_log where created_at is null or action=''") == "0")
call(admin, "auth.php", "POST", {"action": "logout"})
e = last("auth.logout") if False else None
admin2 = client(); call(admin2, "auth.php", "POST", {"action": "login", "username": "admin", "password": PW})
check("logout is logged", any(x["action"] == "auth.logout" for x in call(admin2, "audit.php?limit=200")[1]["entries"]))
call(admin2, "auth.php", "POST", {"action": "logout"})
print(f"\n{passed} passed, {failed} failed"); sys.exit(1 if failed else 0)
