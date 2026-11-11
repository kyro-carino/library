#!/usr/bin/env python3
"""Static consistency checks (no server needed): PHP/JS syntax, local asset references, and that every
element id / view / settings pane that script.js uses exists in index.html. Run from the project root."""
import glob, os, re, subprocess, sys
fails = 0
def check(name, ok, extra=""):
    global fails
    fails += (not ok); print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"   <-- {extra}"))
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."); os.chdir(root)
html = open("index.html", encoding="utf8").read(); js = open("script.js", encoding="utf8").read()

php = [f for f in glob.glob("**/*.php", recursive=True) if "node_modules" not in f]
try:
    bad = [f for f in php if subprocess.run(["php", "-l", f], capture_output=True, text=True).returncode]
    check(f"php -l passes for all {len(php)} PHP files", not bad, bad)
except FileNotFoundError:
    print("SKIP php -l (php not on PATH)")
try:
    check("node --check script.js", subprocess.run(["node", "--check", "script.js"], capture_output=True).returncode == 0)
except FileNotFoundError:
    print("SKIP node --check (node not on PATH)")

refs = re.findall(r'(?:src|href)="([^"#?]+)', html)
local = [r for r in refs if not re.match(r"(https?:|mailto:|//|data:)", r)]
check("local src/href targets exist", all(os.path.exists(r) for r in local), [r for r in local if not os.path.exists(r)])
ids = re.findall(r'\bid="([^"]+)"', html)
check("no duplicate element ids in index.html", len(ids) == len(set(ids)), sorted({i for i in ids if ids.count(i) > 1}))

used = set(re.findall(r"""\$\(\s*["']#([A-Za-z][\w-]*)["']""", js)) | set(re.findall(r"""getElementById\(\s*["']([\w-]+)["']""", js))
dynamic = set(re.findall(r'\bid="([\w-]+)"', js)) | set(re.findall(r"\bid=\\?['\"]([\w-]+)", js))
missing = sorted(i for i in used if i not in ids and i not in dynamic and not i.endswith('-'))  # trailing '-' = id built as prefix + variable
check("every #id script.js looks up exists (static or created by a template)", not missing, missing)

views = set(re.findall(r'<section class="view[^"]*" id="view-([\w-]+)"', html))
targets = set(re.findall(r'data-view="([\w-]+)"', html)) | set(re.findall(r'goToView\("([\w-]+)"', js))
check("every data-view / goToView target has a view section", targets <= views, sorted(targets - views))
panes = set(re.findall(r'id="settings-pane-([\w-]+)"', html))
navs = set(re.findall(r'data-settings="([\w-]+)"', html))
check("every settings tab has a pane", navs <= panes and panes <= navs, (navs ^ panes))
anchors = set(re.findall(r'data-anchor="([\w-]+)"', html))
check("every data-anchor target exists", anchors <= set(ids), sorted(anchors - set(ids)))
labels = re.findall(r'<label[^>]*\bfor="([^"]+)"', html)
check("every <label for> points at an element", all(l in ids for l in labels), [l for l in labels if l not in ids])
check("exactly one <main> and one skip link", html.count("<main ") == 1 and "skip-link" in html)
check("no inline event-handler attributes in index.html", not re.search(r"\son(click|load|error)=", html))
sql = [f for f in subprocess.run(["git", "ls-files"], capture_output=True, text=True).stdout.split() if re.search(r"\.(sql|env|dump|bak|gz)$|^\.env", f) and f not in ("schema.sql",)] if os.path.isdir(".git") else []
check("git tracks no secrets/dumps (only schema.sql allowed)", not [f for f in sql if f != ".env.example"], sql)
# ---- Drift checks: the same list lives in PHP, JS and HTML. Fail loudly if they ever disagree. ----
vp = open("includes/validation.php", encoding="utf8").read(); sp = open("api/settings.php", encoding="utf8").read()
def php_strs(name):
    m = re.search(r"const %s = \[(.*?)\];" % name, vp, re.S); return re.findall(r"'([^']*)'", m.group(1))
def php_ints(name):
    m = re.search(r"const %s = \[(.*?)\];" % name, vp, re.S); return re.findall(r"\d+", m.group(1))
def select_values(sid):
    m = re.search(r'<select id="%s"[^>]*>(.*?)</select>' % sid, html, re.S); return re.findall(r'value="([^"]*)"', m.group(1)) if m else []
def js_list(name):
    m = re.search(r"const %s = \[(.*?)\];" % name, js, re.S); return re.findall(r'"([^"]*)"', m.group(1)) if m else []
check("categories: PHP BOOK_CATEGORIES == JS CATEGORIES", php_strs("BOOK_CATEGORIES") == js_list("CATEGORIES"), (php_strs("BOOK_CATEGORIES"), js_list("CATEGORIES")))
pills = re.findall(r'class="category-pill[^"]*" data-category="([^"]+)"', html)
check("categories: index.html subject pills == BOOK_CATEGORIES (plus 'all')", [p for p in pills if p != "all"] == php_strs("BOOK_CATEGORIES"), pills)
check("formats: PHP BOOK_FORMATS == JS FORMATS", php_strs("BOOK_FORMATS") == js_list("FORMATS"))
for const, sid in [("LANDING_PAGES", "sys-landing"), ("DATE_FORMATS", "sys-date-format"), ("TIME_FORMATS", "sys-time-format"), ("DENSITIES", "sys-density")]:
    check(f"settings: {const} == <select #{sid}> options", php_strs(const) == select_values(sid), (php_strs(const), select_values(sid)))
check("settings: PAGE_SIZES == <select #sys-page-size> options", php_ints("PAGE_SIZES") == select_values("sys-page-size"), (php_ints("PAGE_SIZES"), select_values("sys-page-size")))
def norm(v):
    v = v.strip().strip(",").strip()
    return {"true": True, "false": False}.get(v, v.strip("'\"") if not re.fullmatch(r"-?\d+(\.\d+)?", v) else float(v))
rm = re.search(r"\$data = \[(.*?)\];", sp, re.S); php_def = {k: norm(v) for k, v in re.findall(r"'(\w+)' => ([^,\n]+),", rm.group(1))}
jm = re.search(r"const DEFAULT_CONFIG = \{(.*?)\};", js, re.S); js_def = {k: norm(v) for k, v in re.findall(r"(\w+):\s*([^,\n]+),", jm.group(1))}
check("defaults: settings.php reset values == JS DEFAULT_CONFIG", php_def == js_def, {k: (php_def.get(k), js_def.get(k)) for k in set(php_def) | set(js_def) if php_def.get(k) != js_def.get(k)})
# ---- Content-Security-Policy compatibility: nothing the strict policy forbids may creep back in. ----
theme = open("js/theme-init.js", encoding="utf8").read(); fonts = open("fonts/fonts.css", encoding="utf8").read(); ht = open(".htaccess", encoding="utf8").read()
scripts = re.findall(r"<script\b([^>]*)>", html)
check("CSP: every <script> in index.html is an external local file (no inline script)", scripts and all(re.search(r'\bsrc="(?!https?:|//)[^"]+"', a) for a in scripts), scripts)
check("CSP: no external scripts, stylesheets or fonts in index.html", not re.search(r'<(?:script|link)\b[^>]*\b(?:src|href)="(?:https?:)?//', html))
check("CSP: no <style> elements or @import in index.html", "<style" not in html and "@import" not in html)
check("CSP: no inline event-handler attributes in script.js templates", not re.search(r"\son(error|load|click|change|input|submit|focus|blur|key\w+|mouse\w+)\s*=", js), re.findall(r"\son\w+\s*=", js)[:3])
check("CSP: no eval / new Function / string timers / javascript: URLs", not re.search(r"\beval\(|new Function\(|set(?:Timeout|Interval)\(\s*[\"']|javascript:", js + theme))
m = re.search(r'Content-Security-Policy(?:-Report-Only)?\s+"([^"]+)"', ht)
csp = {d.split()[0]: d.split()[1:] for d in (x.strip() for x in m.group(1).split(";")) if d} if m else {}
check(".htaccess sets a Content-Security-Policy (or Report-Only) header for HTML pages", bool(csp))
check("CSP: script-src is 'self' only (no unsafe-inline / unsafe-eval / remote hosts)", csp.get("script-src") == ["'self'"], csp.get("script-src"))
check("CSP: default-src 'self', object-src 'none', base-uri 'self', frame-ancestors 'none'", csp.get("default-src") == ["'self'"] and csp.get("object-src") == ["'none'"] and csp.get("base-uri") == ["'self'"] and csp.get("frame-ancestors") == ["'none'"], csp)
check("CSP: fonts and API calls are same-origin only", csp.get("font-src") == ["'self'"] and csp.get("connect-src") == ["'self'"], csp)
urls = re.findall(r"url\(([^)]+)\)", fonts)
check("fonts.css: every font file exists and is local", urls and all(os.path.exists(os.path.join("fonts", u.strip("'\" "))) and not re.match(r"https?:", u.strip("'\" ")) for u in urls), [u for u in urls if not os.path.exists(os.path.join("fonts", u.strip("'\" ")))][:3])
check("fonts.css: every @font-face has a unicode-range (so Latin Extended does not override Latin)", fonts.count("@font-face") == fonts.count("unicode-range") > 0, (fonts.count("@font-face"), fonts.count("unicode-range")))
css_text = open("style.css", encoding="utf8").read()
declared = set(re.findall(r"font-family:\s*'([^']+)'", fonts)); used = set(re.findall(r"--font-(?:display|body|mono):\s*'([^']+)'", css_text))
check("fonts: every named font style.css uses is self-hosted", used and used <= declared, used - declared)
print("\n%s" % ("all static checks passed" if not fails else f"{fails} failed")); sys.exit(1 if fails else 0)