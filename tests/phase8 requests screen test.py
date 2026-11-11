#!/usr/bin/env python3
"""Phase 8 test: the staff "Borrow Requests" list (reservations.php?details=1) and cancelling a request.
  BASE=http://localhost/library/library ADMIN_PW=... python3 tests/phase8_requests_screen_test.py      (py on Windows)
DEVELOPMENT database only (reader sign-up is not throttled there). Fixtures are tagged and removed; the reader login
accounts it creates stay in the dev database (the API cannot delete accounts), their patron records are deleted."""
import json, os, random, sys, urllib.request, urllib.error, http.cookiejar
BASE = os.environ.get("BASE", "http://127.0.0.1:8081").rstrip("/"); PW = os.environ["ADMIN_PW"]
RUN = "%05d" % random.randint(0, 99999); TAG = f"P8{RUN}"
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

admin = client(); check("staff login", call(admin, "auth.php", "POST", {"action": "login", "username": "admin", "password": PW})[0] == 200)
books, patrons = [], []
def mk_book(n): b = call(admin, "books.php", "POST", {"title": f"{TAG} {n}", "author": "Tester"})[1]["book"]["id"]; books.append(b); return b
def signup(tag):
    op = client(); pw = f"Zebra-Lantern-{RUN}-{tag}"
    s, r = call(op, "user_auth.php", "POST", {"action": "signup", "firstName": f"{TAG}{tag}", "lastName": "Reader", "email": f"{TAG.lower()}.{tag}@example.invalid", "username": f"{TAG.lower()}{tag}", "password": pw})
    assert s == 201, (s, r); patrons.append(r["user"]["patronId"]); return op, r["user"]["patronId"]
reserve = lambda op, b: call(op, "reader.php", "POST", {"action": "reserve", "bookId": b})
def mine():
    s, r = call(admin, "reservations.php?details=1&limit=500"); assert s == 200, (s, r)
    return [x for x in r["reservations"] if x["bookTitle"].startswith(TAG)]
try:
    onloan, free = mk_book("on loan"), mk_book("free")
    desk = call(admin, "users.php", "POST", {"lastName": "Desk", "firstName": TAG, "contact": f"{TAG.lower()}.desk@example.invalid"})[1]["user"]["id"]; patrons.append(desk)
    check("a title goes on loan", call(admin, "transactions.php", "POST", {"type": "issue", "bookId": onloan, "userId": desk})[0] == 201)
    A, pidA = signup("a"); B, pidB = signup("b")
    check("reader A requests the borrowed title", reserve(A, onloan)[0] == 201)
    check("reader B requests the same title", reserve(B, onloan)[0] == 201)
    check("reader A also requests the free title", reserve(A, free)[0] == 201)

    rows = mine(); by = {(x["userId"], x["bookId"]): x for x in rows}
    check("staff list shows the 3 requests", len(rows) == 3, len(rows))
    a1, b1, a2 = by[(pidA, onloan)], by[(pidB, onloan)], by[(pidA, free)]
    check("each row has patron name, id, title, author and date", all(x["userName"].startswith("Reader, ") and x["userId"] and x["bookTitle"].startswith(TAG) and x["bookAuthor"] == "Tester" and x["createdAt"] for x in rows), rows[0])
    check("title status: borrowed vs available", a1["bookStatus"] in ("Borrowed", "Overdue") and a1["dueDate"] and a2["bookStatus"] == "Available", (a1, a2))
    check("queue position: A is 1st and B is 2nd for the borrowed title", a1["queuePosition"] == 1 and b1["queuePosition"] == 2, (a1["queuePosition"], b1["queuePosition"]))
    check("A is first in line for the free title", a2["queuePosition"] == 1)
    check("rows are oldest first", [x["createdAt"] for x in rows] == sorted(x["createdAt"] for x in rows))
    check("active patrons are marked as holding a place", all(x["patronActive"] for x in rows))

    # ---- who may use it
    s, r = call(client(), "reservations.php?details=1"); check("anonymous -> 401", s == 401, s)
    s, r = call(A, "reservations.php?details=1")
    check("a reader cannot get the staff details, only their own plain rows", s == 200 and all("bookTitle" not in x and x["userId"] == pidA for x in r["reservations"]) and len(r["reservations"]) == 2, (s, r))

    # ---- cancel
    def cancel_count(): return call(admin, f"audit.php?action=reservation.cancel&entity_id={onloan}")[1]["total"]
    n0 = cancel_count()
    s, r = call(admin, "reservations.php", "POST", {"action": "cancel", "bookId": onloan, "userId": pidA}); check("staff cancels A's request", s == 200, (s, r))
    check("cancellation is audit-logged once", cancel_count() == n0 + 1)
    rows = mine(); by = {(x["userId"], x["bookId"]): x for x in rows}
    check("A's request is gone from the list", (pidA, onloan) not in by and len(rows) == 2)
    check("B moves up to first in line", by[(pidB, onloan)]["queuePosition"] == 1)
    s, r = call(admin, "reservations.php", "POST", {"action": "cancel", "bookId": onloan, "userId": pidA}); check("cancelling it again -> 404", s == 404, (s, r))
    check("the repeat attempt was not logged", cancel_count() == n0 + 1)
    check("A can request the title again", reserve(A, onloan)[0] == 201)
    check("...and goes to the back of the line", {(x["userId"]): x["queuePosition"] for x in mine() if x["bookId"] == onloan} == {pidB: 1, pidA: 2})

    # ---- an inactive patron does not hold a place
    call(admin, f"users.php?id={pidB}", "PUT", {"status": "Inactive"})
    rows = mine(); by = {(x["userId"], x["bookId"]): x for x in rows}
    check("an inactive patron is flagged and no longer ahead in line", by[(pidB, onloan)]["patronActive"] is False and by[(pidA, onloan)]["queuePosition"] == 1, (by[(pidB, onloan)], by[(pidA, onloan)]))
    call(admin, f"users.php?id={pidB}", "PUT", {"status": "Active"})
finally:
    for b in books: call(admin, "transactions.php", "POST", {"type": "return", "bookId": b})
    for p in patrons: call(admin, f"users.php?id={p}", "DELETE")
    for b in books: call(admin, f"books.php?id={b}", "DELETE")
print(f"\n{passed} passed, {failed} failed"); sys.exit(1 if failed else 0)