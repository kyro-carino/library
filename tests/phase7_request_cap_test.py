#!/usr/bin/env python3
"""Phase 7 test: a reader (or staff acting for a patron) cannot hold more than 5 active borrow requests.
  BASE=http://localhost/library/library ADMIN_PW=... python3 tests/phase7_request_cap_test.py      (py on Windows)
DEVELOPMENT database only (reader sign-up is not throttled there). Fixtures are tagged and removed; the reader
login accounts it creates stay in the dev database (the API cannot delete accounts), their patron records are deleted."""
import json, os, random, sys, urllib.request, urllib.error, http.cookiejar
from concurrent.futures import ThreadPoolExecutor
BASE = os.environ.get("BASE", "http://127.0.0.1:8081").rstrip("/"); PW = os.environ["ADMIN_PW"]
RUN = "%05d" % random.randint(0, 99999); TAG = f"P7{RUN}"; CAP = 5
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
books, patrons, readers = [], [], []
def mk_book(i): b = call(admin, "books.php", "POST", {"title": f"{TAG} book {i}", "author": "T"})[1]["book"]["id"]; books.append(b); return b
def signup(tag):
    op = client(); pw = f"Zebra-Lantern-{RUN}-{tag}"
    s, r = call(op, "user_auth.php", "POST", {"action": "signup", "firstName": f"{TAG}{tag}", "lastName": "Reader", "email": f"{TAG.lower()}.{tag}@example.invalid", "username": f"{TAG.lower()}{tag}", "password": pw})
    assert s == 201, (s, r); pid = r["user"]["patronId"]; patrons.append(pid); readers.append((op, pw, f"{TAG.lower()}{tag}")); return op, pid
reserve = lambda op, b: call(op, "reader.php", "POST", {"action": "reserve", "bookId": b})
active = lambda pid: len(call(admin, f"reservations.php?user_id={pid}")[1]["reservations"])
try:
    bk = [mk_book(i) for i in range(14)]
    A, pidA = signup("a")

    # ---- the cap
    codes = [reserve(A, b)[0] for b in bk[:CAP]]
    check(f"reader can place {CAP} requests", codes == [201] * CAP, codes)
    s, r = reserve(A, bk[CAP]); check(f"request number {CAP + 1} is refused with 409", s == 409 and "request" in r.get("error", "").lower(), (s, r))
    check("refused request was not stored", active(pidA) == CAP)
    s, r = reserve(A, bk[0]); check("repeating an existing request still says 409", s == 409, (s, r))
    s, r = call(admin, "reservations.php", "POST", {"bookId": bk[CAP], "userId": pidA})
    check("staff creating a 6th request for that patron is refused too (409)", s == 409, (s, r))
    check("still exactly 5 active", active(pidA) == CAP)

    # ---- cancelling frees a slot
    rid = call(A, "reader.php?view=reservations")[1]["reservations"][0]["id"]
    check("reader cancels a request", call(A, "reader.php", "POST", {"action": "cancel_reservation", "reservationId": rid})[0] == 200)
    check("a slot is free again", reserve(A, bk[CAP])[0] == 201)
    check("and the cap holds again", reserve(A, bk[CAP + 1])[0] == 409)

    # ---- parallel requests from one reader cannot slip past the cap
    B, pidB = signup("b")
    ops = []
    for _ in range(8):
        o = client(); call(o, "user_auth.php", "POST", {"action": "login", "username": readers[-1][2], "password": readers[-1][1]}); ops.append(o)
    with ThreadPoolExecutor(8) as ex: codes = list(ex.map(lambda i: reserve(ops[i], bk[i])[0], range(8)))
    check("8 parallel requests: exactly 5 accepted, 3 refused", codes.count(201) == CAP and codes.count(409) == 8 - CAP and max(codes) < 500, codes)
    check("database holds exactly 5 active for that reader", active(pidB) == CAP)

    # ---- the cap is per patron
    C, pidC = signup("c"); check("a different reader is unaffected", reserve(C, bk[13])[0] == 201)

    # ---- a title held by a request is released when the request is cancelled
    other = call(admin, "users.php", "POST", {"lastName": "Desk", "firstName": TAG, "contact": f"{TAG.lower()}.desk@example.invalid"})[1]["user"]["id"]; patrons.append(other)
    held = bk[13]
    s, r = call(admin, "transactions.php", "POST", {"type": "issue", "bookId": held, "userId": other}); check("title requested by someone else cannot be issued to another patron (409)", s == 409, (s, r))
    rid = call(C, "reader.php?view=reservations")[1]["reservations"][0]["id"]
    call(C, "reader.php", "POST", {"action": "cancel_reservation", "reservationId": rid})
    s, r = call(admin, "transactions.php", "POST", {"type": "issue", "bookId": held, "userId": other}); check("after the request is cancelled the title can be issued", s == 201, (s, r))
    call(admin, "transactions.php", "POST", {"type": "return", "bookId": held})
finally:
    for p in patrons: call(admin, f"users.php?id={p}", "DELETE")
    for b in books: call(admin, f"books.php?id={b}", "DELETE")
print(f"\n{passed} passed, {failed} failed"); sys.exit(1 if failed else 0)