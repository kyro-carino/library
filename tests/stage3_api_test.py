#!/usr/bin/env python3
"""Stage 3 API test: real report data, borrowCount, honest book saves, cover validation.
Usage: BASE=http://127.0.0.1/library ADMIN_PW=... python3 tests/stage3_api_test.py
Needs the dev seed and the `mysql` CLI on PATH (database feu_library)."""
import json, os, subprocess, sys, urllib.request, urllib.error, http.cookiejar
BASE = os.environ.get("BASE", "http://127.0.0.1:8081"); PW = os.environ["ADMIN_PW"]
passed = failed = 0
def check(name, cond, extra=""):
    global passed, failed
    passed += bool(cond); failed += (not cond)
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"   <-- {extra}"))
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def call(path, method="GET", body=None):
    req = urllib.request.Request(f"{BASE}/api/{path}", method=method,
        data=json.dumps(body).encode() if body is not None else None, headers={"Content-Type": "application/json"})
    try:
        with op.open(req) as r: return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}
# Manila (UTC+8) calendar date, matching the app; the mysql CLI session itself runs in server time.
def sql(q): return subprocess.run(["mysql","-N","-B","feu_library","-e",q],capture_output=True,text=True).stdout.strip()

check("login", call("auth.php","POST",{"action":"login","username":"admin","password":PW})[0]==200)
s, r = call("reports.php"); check("reports 200", s==200, s)
c, t = r["collection"], r["totals"]
check("titles matches DB", c["titles"]==int(sql("select count(*) from books where deleted_at is null")), c)
check("available matches DB", c["available"]==int(sql("select count(*) from books where deleted_at is null and status='Available'")), c)
check("overdue matches DB", c["overdue"]==int(sql("select count(*) from books where deleted_at is null and status in ('Borrowed','Overdue') and due_date<date(utc_timestamp() + interval 8 hour)")), c)
check("available+onLoan+overdue == titles", c["available"]+c["onLoan"]+c["overdue"]==c["titles"], c)
check("active patrons matches DB", c["activePatrons"]==int(sql("select count(*) from users where deleted_at is null and status='Active'")), c)
check("dueTodayCount matches DB", t["dueTodayCount"]==int(sql("select count(*) from transactions where type='issue' and return_date is null and status in ('Borrowed','Overdue') and due_date=date(utc_timestamp() + interval 8 hour)")), t)
check("overdue list size == totals.overdueCount", len(r["overdue"])==t["overdueCount"])
check("activity has 7 days", len(r["activity"])==7)
check("issued in activity == DB (today)", r["activity"][-1]["issued"]==int(sql("select count(*) from transactions where type='issue' and issue_date=date(utc_timestamp() + interval 8 hour)")))
check("full report recent page size is 10", r.get("recentPageSize")==10 and len(r.get("recent") or [])<=10, (r.get("recentPageSize"), len(r.get("recent") or [])))
s, led = call("reports.php?ledger=1&sort=newest&page=1")
check("ledger 200", s==200, s)
check("ledger page size is 10", led.get("recentPageSize")==10 and len(led.get("recent") or [])<=10, led)
check("ledger total is int", isinstance(led.get("recentTotal"), int), led)
s, bad = call("reports.php?ledger=1&sort=issue_date%20DESC&page=1")
check("invalid sort falls back to newest", s==200 and bad.get("recentSort")=="newest", bad.get("recentSort"))
s, az = call("reports.php?ledger=1&sort=title_az&page=1")
az_titles = [x.get("bookTitle") or "" for x in (az.get("recent") or [])]
check("title_az is nondecreasing on the page", all(az_titles[i].lower()<=az_titles[i+1].lower() for i in range(len(az_titles)-1)), az_titles)
s, nw = call("reports.php?ledger=1&sort=newest&page=1")
nw_dates = [x.get("issueDate") or "" for x in (nw.get("recent") or [])]
check("newest first is nonincreasing by issue date", all(nw_dates[i]>=nw_dates[i+1] for i in range(len(nw_dates)-1)), nw_dates)
if (led.get("recentTotal") or 0) > 10:
    s, p2 = call("reports.php?ledger=1&sort=newest&page=2")
    ids1 = [x.get("id") for x in (nw.get("recent") or [])]
    ids2 = [x.get("id") for x in (p2.get("recent") or [])]
    check("page 2 has no overlap with page 1", s==200 and ids2 and not set(ids1)&set(ids2), (ids1, ids2))
    check("page 2 length <= 10", len(ids2)<=10, len(ids2))
s, miss = call("reports.php?ledger=1&q=__no_such_borrowing_record__&sort=newest&page=1")
check("empty search is empty page", s==200 and miss.get("recentTotal")==0 and miss.get("recent")==[], miss)
s, b = call("books.php?limit=200"); check("books list has borrowCount", s==200 and all("borrowCount" in x for x in b["books"]))
if b["books"]:
    x = b["books"][0]; check("borrowCount matches DB", x["borrowCount"]==int(sql(f"select count(*) from transactions where type='issue' and book_id='{x['id']}'")), x)
s, _ = call("books.php","POST",{"title":"T3 bad cover","author":"X","cover":"ftp://nope"}); check("non-http cover -> 422", s==422, s)
s, _ = call("books.php","POST",{"title":"T3 bad cover","author":"X","cover":"javascript:alert(1)"}); check("javascript: cover -> 422", s==422, s)
s, r2 = call("books.php","POST",{"title":"T3 plain","author":"Tester"})
bk = r2.get("book", {})
check("create ok", s==201, (s, r2))
check("no fabricated description/format/cover", bk.get("description") is None and bk.get("format") is None and bk.get("cover") is None, bk)
s, r3 = call(f"books.php?id={bk.get('id')}","PUT",{"title":"T3 plain 2","description":"Real note","format":"Paperback","cover":"https://example.org/c.jpg"})
check("edit persists", s==200 and r3["book"]["description"]=="Real note" and r3["book"]["format"]=="Paperback", (s, r3))
s, r4 = call(f"books.php?id={bk.get('id')}","PUT",{"cover":""}); check("empty cover clears", s==200 and r4["book"]["cover"] is None, r4)
s, _ = call("settings.php","PUT",{"action":"reset"}); check("settings reset ok", s==200, s)
check("settings reset leaves admin account intact", sql("select count(*) from auth_users where username='admin' and role='admin'")=="1")
call(f"books.php?id={bk.get('id')}","DELETE")
print(f"\n{passed} passed, {failed} failed"); sys.exit(1 if failed else 0)