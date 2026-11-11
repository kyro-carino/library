# Implementation Progress

Last updated: 2026-10-04 (Stage 4 check + Stage 7 second batch). Status legend: DONE (verified) / DRAFTED (written, not yet verified) / OPEN.

## Stage status

| Stage | Status |
|---|---|
| 0 Audit completion | DONE (static review of provided files; see findings) |
| 1 Security/environment | CODE DONE, user steps pending (see Stage 1) |
| 2 Transactions | CODE DONE; verified on MariaDB 10.11 via API tests, UI not browser-tested |
| 3 Real data | CODE DONE; frontend smoke-tested in jsdom; PHP/SQL changes NOT executed yet (run `tests/stage3_api_test.py`) |
| 4 Correctness | DONE for the items tracked in this file (see Stage 4 note) |
| 5 DB/migrations | DONE (applied to live DB after rehearsal on a restored copy; see Stage 5) |
| 6 Accessibility/UI | CODE DONE; behavior tested in jsdom (32/32); real-browser layout/keyboard/screen-reader pass pending (see Stage 6) |
| 7 Cleanup | DONE (code level); real-browser visual check of the CSS merge pending (see Stage 7 third batch) |
| 8 Tests/docs | OPEN |

## Stage 0 — new findings and corrections to AUDIT.md

Corrections
- AUDIT "Critical: none" is wrong: no `.htaccess` exists, so `.env`, `schema.sql`, `README.md`, `AUDIT.md`, `includes/` are web-served under XAMPP. `.env` holds a weak, shared dev password.
- LIKE wildcard escaping is already correct in `books.php`/`users.php` (`likeTerm()` + `ESCAPE`).
- Server already computes fines on return and ignores client fine/title/name fields. Grace period and max renewals are enforced server-side; the UI has no renew control.
- DB "preserved records" are dev seed only; original DB had 0 application rows.

Confirmed bugs (file: issue)
- `script.js`: `refreshUsers()` calls `users.php` with no limit, server default is 25 → only 25 patrons load (issue/return wizards break for others; `findUser()` undefined crash in return confirm). Books capped at 100, transactions at 50.
- `script.js`: `isoDaysAgo()/isoDaysFromNow()` use `toISOString()` (UTC) → wrong date 00:00–08:00 Manila.
- `script.js`: `renderReports` uses fake `ACTIVITY_SERIES`/`MOST_BORROWED`; `api/reports.php` is never called.
- `script.js`: settings reset overwrites the real admin account (username/email/display name) with defaults; server already has `action:"reset"` for settings only.
- `script.js`: `saveBookForm` saves fabricated description, cycled format, guessed cover URL.
- `script.js`: `CATEGORIES` (8) vs server `BOOK_CATEGORIES` (12): editing a Computer Science/Math/Education/Social Sciences book silently recategorizes to Literature. `PROGRAMS` list likewise rewrites seed patrons' programs on edit.
- `script.js`: Borrow/Reserve/Save mock actions mutate local state only; hardcoded fake notification items; inert footer/Help; invented library hours in Services.
- `script.js`: `updateReturnCalc`/overdue report read the unsaved `#settings-fine-rate` input and ignore grace period (server uses grace).
- `script.js`: `applyTheme` re-renders reports to "borrowing" (resets overdue tab).
- `script.js`: top-level `gsap.defaults()` throws if gsap fails to load → login and app both dead.
- `script.js`: `api()` has no 401 handling; password meter says 8 chars, rule is 10.
- `style.css`: closed mobile menubar only translated off-screen (still focusable); GSAP ignores `prefers-reduced-motion`; `--ink-muted` ≈3.0:1 and `--brass` text ≈2.1:1 on paper (estimates; verify with a checker).
- `api/transactions.php`: issue/return dates are client-supplied; no check that return ≥ issue date or ≤ today; issue date can be backdated/future.
- `api/auth.php` / `includes/auth.php`: no login throttling; role/status cached in session for 8h (deactivation not enforced mid-session); first-run `setup` check not serialized.
- `api/reports.php`: "finesCollected" is fines assessed; no payment tracking exists.
- `api/account.php`: `avatarPreset` unvalidated (>50 chars → SQL error).
- `includes/schema_guard.php`: ~15 schema/information_schema queries and counter upserts on every request.
- `includes/bootstrap.php`: error handler converts all notices/deprecations to exceptions (fragile on newer PHP).
- Missing indexes: `transactions(issue_date)`, `(return_date)`, `(return_date, due_date)`.
- Do NOT delete `.dash-*`, `.overdue-*`, `.rank-*`, `.shelf-bar*`, `.panel-frontdesk` CSS in Stage 7: needed for the operational dashboard (Stage 3).

## Stage 1 — security and environment
Verified by user: `.htaccess` (their edited version is the one delivered) returns 403 for `.env`, `schema.sql`, `README.md`, `includes/bootstrap.php`, `tools/seed_admin.php`.
Code changes (PHP 8.3 syntax-checked; `tests/stage1_auth_test.php` 20/20 pass with stubs + in-memory SQLite; NOT yet run on XAMPP/MySQL):
- `includes/auth.php`: `requireAuth()` re-checks role/status in DB each request (deactivation/demotion immediate, 401 + logout); `session.gc_maxlifetime` set to 8h (PHP default ~24 min expired sessions early); file-based login throttle (5 fails/15 min per ip+username, 30 per ip, 429 + `Retry-After`); `assertSameOrigin()` blocks cross-site POST/PUT/DELETE.
- `api/auth.php`: throttled login with constant-time unknown-user check; password-change throttled; setup serialized with `GET_LOCK`; passwords capped at 72 chars (bcrypt); `status` revalidates against DB.
- `includes/bootstrap.php`: unknown `APP_ENV` → production; production refuses `root`/empty `DB_PASS`; notices/deprecations are logged instead of thrown.
- `includes/dev_seed.php` / `schema_guard.php`: dev admin password must be ≥12 chars and not contain admin/password/12345; a failed seed is logged, not a 500 on every request.
User steps pending: rotate `DEV_ADMIN_PASSWORD` (the old one is now rejected by the seeder; existing `admin` hash is unchanged until `php tools/seed_admin.php`); create least-privilege DB user; confirm login/throttle behavior in the browser.
Known gaps: throttle store is the PHP temp dir (fine for single XAMPP host); no CSP on `index.html` yet (needs inline-script hash, Stage 6); frontend 401 redirect is Stage 4; README still says 10-char dev password (Stage 8).

## Stage 2 — transaction integrity
Stage 1 confirmed by user in the browser.
Changes:
- `api/transactions.php`: all POST types staff-only. Issue date is always server today (Asia/Manila); due date defaults to today + loan_days and must be between today and today + loan_days. Return date defaults to today, must be valid, not in the future, not before the issue date. Fine always computed server-side; client fine/status/title/name fields ignored. Row locks always book -> patron (no deadlocks); patron row lock makes the loan-limit check race-safe. State conflicts return 409, validation 422. Overdue loans cannot be renewed (previously renewing wiped the fine). Lock-wait/deadlock errors return a friendly 409.
- `includes/domain.php`: added `addDaysIso()`.
- `script.js`: Manila-based date helpers (replaces UTC `toISOString` today/due logic); issue date read-only; due date input bounded; issue/return send only IDs + dates; double-click guard; return uses the server's fine; return preview uses the saved fine rate; return flow no longer crashes when the patron is not in the loaded list.
Verification (`tests/stage2_transactions_test.py`, real MariaDB 10.11 + PHP 8.3 server, 8 workers): 43/43 pass, including 10 parallel issues of one book (1 wins), 10 parallel issues to one patron vs limit 5 (exactly 5), 10 parallel returns (1 wins), forged fine/dates, invalid dates, wrong patron, renew limits, and SQL invariants (no double open loans, no Available book with an open loan, no over-limit patron). Run against the original `transactions.php` the same suite had 22 failures (e.g. due date in 2099 accepted, future return date accepted, overdue renewal accepted). Frontend date helper: 8/8 in four browser timezones. `node --check script.js` OK.
Not verified: browser UI flows; server clock around Manila midnight; XAMPP's MariaDB 10.4.32 (tested on 10.11); ISBN/other Stage 3+ items.
Open: no DB-level unique guard for open loans (row locks only; needs Stage 5 approval); reservations are not enforced at issue time; no renew button in UI; patron list still capped at 25 (Stage 4).

## Stage 3 — real data and functionality
Changes:
- `api/reports.php`: (dashboard consumer removed; fields kept for reports/future use) added `collection` (titles/available/onLoan/overdue/activePatrons), `dueToday` (+`totals.dueTodayCount`); `finesCollected` renamed `finesAssessed` (no payment tracking exists, so "collected" was wrong).
- `api/books.php` + `includes/domain.php`: list returns `borrowCount` (real count from `transactions`); cover must be empty or a valid http(s) URL (422 otherwise).
- `index.html`: **revised after review:** Discover is the original editorial homepage again (hero, featured collection, photo, services, statement, footer) — the operational dashboard was removed at the owner's request; its data still lives in Reports. Only invented facts changed: the "Library hours" card is now "Visit us" (address/phone/email from saved settings), Borrowing text and footer Visit column also read saved settings, and Featured shows real catalog titles (empty-state text if none). Fake notification items, Help item, profile "password" field, Language select removed; prototype/localStorage claims in Settings and Reports ("Demo data") corrected; 4 missing category pills added; Borrow/Reserve/Save buttons replaced by "Issue this book" (opens the Issue wizard with the book preselected).
- `script.js`: both reports now read `api/reports.php` (loading/error+retry/empty states); removed `ACTIVITY_SERIES`, `MOST_BORROWED`, `BOOK_SEED`, `BOOK_BLURBS`, `STUDENT_SEED`, `COVER_OVERRIDES`, saved/reserved mock state; "Most popular" sort uses `borrowCount`; book form saves only entered values (description, format, cover now real optional fields; no cycled format/guessed cover/generated blurb); `CATEGORIES` now matches the server's 12; patron edit no longer rewrites unknown program/year (shows current value or "Not specified"); settings reset now calls `settings.php {action:"reset"}` and no longer touches the admin account; notifications menu reads `api/notifs.php`; password meter threshold 10; report type survives theme switch; null guards for year/ISBN/category/borrower.
- `style.css`: removed the rule that hid the notification button; homepage full-bleed margins kept; dark-mode badge colors fixed (Returned/Available labels were invisible: text and background were both #123A25, contrast 1.0:1; now ≥6.4:1).
Verification: `node --check script.js` OK; jsdom smoke (mocked API): homepage hero/featured/settings-driven text, hero search routing, borrowing-report badge labels, notification dot/items, overdue report, theme switch keeps report, collection + popular sort, book details (overdue borrower, null year), Issue preselect, book edit PUT body (no fabricated fields), patron edit keeps "Not specified", settings reset makes 1 settings call and 0 account writes, no JS errors.
NOT verified: PHP syntax/queries (no PHP/MySQL in the review sandbox), real browser rendering/layout of the new dashboard, `tests/stage3_api_test.py` (written, not run).
Open / deferred: no Renew control in UI (Max renewals setting only enforced by API); `api/reservations.php` is a patron-facing API with no UI (kept, documented in Stage 8); patron/book lists still capped by API limits (Stage 4); `.explore-*` and unused dashboard CSS (`.dash-hero`, `.shelf-bar*`, `.rank-*`, `.overdue-*`) to review in Stage 7; Reservations and Digital resources service cards are original marketing copy, not backed by UI (decide in Stage 6); loader tagline "There is always something worth discovering" and Collection hero copy are still public-style (Stage 6 copy pass); `reports.php` `recent` returns 20 rows, dashboard shows 6.

## Stage 5 — database architecture and migrations
Approved and applied by the owner after a backup (`backups/feu_library_pre_stage5.sql`, git-ignored) and a rehearsal on a restored copy.
Changes:
- `tools/migrate.php` (new, CLI-only): `--dry-run` (read-only report, incl. duplicate ISBNs and stale loans), `--yes` (apply; refuses without it). Set `DB_NAME` in the environment to target a copy. Progress is recorded in `schema_migrations`.
- `includes/migrations.php` (new): repeatable steps, each with a preflight that blocks (without changing data) on bad data. 001 baseline (old `ensureSchema` body), 002 missing foreign keys, 003 indexes (`transactions.issue_date`, `.return_date`, `(type, return_date, due_date)`, non-unique `books.isbn`), 004 CHECK constraints (fine/renewals >= 0, settings minimums), 005 `transactions.open_book_id` virtual column + unique `uk_tx_open_book` (DB-level one open loan per book).
- `includes/schema_guard.php`: `ensureSchema()` replaced by `ensureBaselineSchema()` (migrate tool only) and `ensureDevSeeds()` (dev only, no DDL).
- `config.php`: requests no longer create/alter schema or reseed counters; one `schema_migrations` lookup, 503 with instructions if migrations are pending; dev seeds only when `APP_ENV=development`.
- `api/transactions.php`: duplicate-key on `uk_tx_open_book` returns 409.
- `schema.sql`: header/comments only (import, then run `tools/migrate.php --yes`).
Decisions: stored `Overdue` status left as is (already derived from `due_date` everywhere); ISBN index is non-unique (rows are physical copies; no duplicates existed).
Verification: sandbox MariaDB 10.11 + PHP 8.3 (fresh import, repeat run no-op, guard/CHECK rejections, blocked-data case with rows intact, normal request = 0 DDL statements); owner's MariaDB 10.4.32: live dry-run clean, rehearsal on restored copy applied 5/5 and re-ran as no-op, then applied to live; owner reports login, issue/return and reports working afterwards.
Not verified: `tests/stage2_transactions_test.py` and `tests/stage3_api_test.py` not confirmed run after migration; MySQL 8 not tested; HTTP-level 409 for the duplicate-key path only tested as a PDO error.
Open: README still describes the old setup flow (Stage 8); a production migration user needs ALTER rights while the app user should not (run migrate with separate credentials); `DB_PORT` 3306 vs 3307 mismatch in README/AUDIT; scratch DB `feu_library_migtest` to drop.

## Stage 6 — accessibility, responsiveness, UI/UX
Files: `index.html`, `style.css`, `script.js` (design direction unchanged; no new pages/components).
Changes:
- Contrast (computed, WCAG): light `--ink-soft` 4.43 -> 5.8:1, `--ink-muted` 2.99 -> 5.0:1 on paper; new `--brass-text` (5.7-6.3:1) replaces brass for text on light surfaces (eyebrows, call numbers, categories, borrowed badge); dark-mode text on green buttons 4.35 -> 5.27:1; footer secondary text 4.27 -> 7.2:1; focus ring `--focus` (12.5:1 light, brass in dark; light ring on green/footer/mobile menu). Smallest text (9-9.5px) raised to 10-10.5px.
- Semantics: skip link + `#main-content` target; one `h1` per view (was `h2` on 6 views); `scope="col"` on table headers; labels tied to controls (return dates, profile role/status, read-only modal fields, header search `aria-label`); `aria-pressed` (filter chips, category pills, theme cards), `aria-current` (settings tabs, wizard steps), `aria-expanded` on nav dropdowns; error toasts use `role="alert"`; `<noscript>` message.
- Keyboard/focus: closed mobile menu is `visibility:hidden` (not tabbable); open menu traps Tab, Escape closes and returns focus to the hamburger; Escape closes popovers/dropdowns/mobile search and returns focus to the trigger; dropdowns close when focus leaves; modals/confirm dialogs trap Tab, make `#app` inert, and restore focus to the opener; view changes move focus to the new `h1` and update `document.title`; sign-in focuses the username field; `/` shortcut ignored in modals, inputs, selects and on the sign-in screen, and opens the search field on narrow screens; Enter on a row's inner button no longer also opens the row.
- Motion/offline: GSAP stand-in jumps to end states if GSAP fails to load (no blank app); `prefers-reduced-motion` speeds GSAP up 100x and skips the loader; loader shortened (~2.6s -> ~1.4s); broken Unsplash images hide and show a tinted background.
- Forms: inline, specific messages with `aria-invalid`/`aria-describedby` and focus on the first bad field (book and patron forms); server 422 field errors are shown next to the field (`api()` now exposes `err.fields`); invalid red border no longer lost after blur.
- Consistency/controls: book card colour derived from the book id (same book, same colour in every list); notification "due" items open the Borrowing report; "Items per page" relabelled "Users per page" (it only drives the Users list).
Verification: `node --check script.js`; CSS braces balanced; contrast ratios computed for both themes; jsdom suite (mocked API) 32/32: no-GSAP boot, reduced-motion boot, real-GSAP boot (no JS errors), focus to h1, single h1 per view, modal trap/restore/inert, validation messages, `/` shortcut rules, popover/dropdown Escape focus return, mobile menu focus management, server field errors, stable colours.
NOT verified: real browser rendering (responsive layout at 320/768/1024, sticky header, mobile menu animation), true keyboard-only and screen-reader walkthrough, offline test in a real browser (Google Fonts/Unsplash blocked), Safari focus behaviour on dropdown focusout. `js/vendor/gsap.min.js` path must exist on the host.
Open / owner decisions: Services cards "Reservations", "Research assistance", "Digital resources" are marketing copy with no backing UI/data (remove or keep?); no Renew control, so Max renewals only matters to the API; no CSP on `index.html` (needs inline-script hash/nonce for the theme script); `setTimeout(...,420)` timing hacks in search routing and goToView (Stage 7).

## Stage 4 — correctness (verified against the supplied code)
Already present in the provided `script.js`: all pages of books/patrons are loaded (`fetchAllPages`, 200 per request) and a 401 on any API call returns to the sign-in screen once (`handleSessionExpired`). Fixed now: `api/account.php` rejects an `avatarPreset` that is not a `#RRGGBB` colour (previously >50 chars caused a SQL error); verified with `php -l` and the regex on 6 inputs only (endpoint not executed). Still open by decision: reservations are not enforced at issue time (no reservation UI exists); no Renew control.

## Stage 7 — cleanup (first batch)
- `script.js`: removed dead code confirmed by reference count (`refreshTransactions`, `mapTx`, `TRANSACTIONS`, client-side id counters and `makeBookId/makeUserId/makeTxId`, `syncIdCounters` and its calls, `animateCounters`, `drawCircle`); replaced the 420/460 ms timing hacks (hero search, header search, "Add" menu items, Services/About anchors) with a `goToView(..., {after})` callback; toasts now use `textContent` (server messages and titles can no longer inject HTML; callers no longer pre-escape); ids/status/year interpolated into markup are escaped; stale "prototype/localStorage only" comment fixed. Remaining `setTimeout`s are focus delays tied to animations and the GSAP stand-in.
- `style.css`: removed 87 rules/selectors whose classes appear nowhere in `index.html` or `script.js` (old operational-dashboard, explore chips, library-photo badge/dots, mini lists, rank lists, overdue panel, `.modal-lg`, etc.; ~7.7 KB). Kept `.sr-only`, `toast-*`, `badge-*`. Backup copies used during the work were not delivered.
- Not done: consolidating duplicate `@media` blocks (moving rules changes the cascade and cannot be verified without a browser); splitting `script.js` into modules; replacing remaining template `innerHTML` renderers (all interpolations of user text go through `esc()`).
Verification: `node --check`; CSS braces balanced; jsdom suite 42/42 (adds hero/header search routing, Add-book via menu, toast with HTML payload, removed helpers undefined, full issue wizard with no JS errors). Not verified: real browser visual check for removed CSS (look for unstyled elements on every page in both themes), return wizard and reports in jsdom.

## Stage 7 — second batch
- Finding: the `index.html` supplied for this batch did NOT contain the Stage 6 markup recorded above (no skip link/`#main-content`, 6 views used `h2`, two `<main>` elements, no `<noscript>`, no `scope="col"`, unlabeled return/profile fields, "Items per page"). `script.js`/`style.css` already expected it (focus-to-h1, `.skip-link`). Re-applied minimal markup only: skip link + `main#main-content`, login `main` -> `section`, `h2` -> `h1` on 6 views, noscript, `scope="col"`, `for=` labels, header search `aria-label`, "Users per page". Confirm your working copy is not an older `index.html`.
- `script.js`: escaped two unescaped interpolations (borrowed-book titles in the user modal's `value="..."`, initials in the issue patron list); `renderConfirm` now escapes `body` itself (callers pass plain text); avatar `url("...")` quoted; removed dead `.stat-card` selector, unused `defaultBookStatus`, stale `state.ret.txId`, no-op ternary in `[data-go]` handler.
- `style.css`: removed duplicate comment, unused `.toast.warn`, redundant `.search-global` rule (900px block already covers it), merged the two adjacent 520px blocks, collapsed blank runs/empty banners. Diff vs previous reviewed: only these changes. Braces balanced (620/620).
- Not done (by design): merging non-adjacent `@media` blocks (640px x3, 520px x2, 860px x2, 900px x2) because moving rules alters the cascade and needs a real-browser check; splitting `script.js` into modules; remaining `setTimeout`s are animation-tied focus delays.
- Verification: `node --check script.js`; `tests/stage7_ui_smoke.js` (jsdom, mocked API) 28/28, no JS errors: boot, every view activates and focuses its single `h1`, one visible `<main>`, hostile patron/book names do not inject nodes in the user modal, issue list or confirm dialog. The escaping check fails against the pre-fix line (verified). Not verified: real-browser visuals (look for unstyled elements in both themes), return wizard end-to-end, live PHP.

## Stage 7 — third batch (completes Stage 7)
- `style.css`: consolidated duplicate `@media` blocks with a cascade-safety check (a block moves only if no rule between its old and new position shares a selector token and a property with it). Merged: 640px x3 -> 1, 860px x2 -> 1, 520px x3 -> 2. Left as is because merging would change which rule wins: 900px (`#featured-collection-grid` is overridden by the 640px rule in between) and the early 520px block (`.form-grid .name-row` vs the 1000px `.form-grid` rule). Rule set unchanged: 606 rules before and after, same (condition, selector, declarations) multiset; braces 616/616.
- `script.js`: last timing hacks removed. Modal/confirm focus now runs from the open animation's completion callback (was a fixed 380 ms guess); search-toggle and profile-edit focus run immediately (50/60 ms delays were not needed). Only `setTimeout` left is the GSAP stand-in's `delay` support. Modals now focus their first enabled form field (previously the close button); read-only modals still focus a button. Removed unused `crumb` from `VIEW_META`; home tab title is "Discover", Collection title "Collection".
- Audited every template interpolation in `script.js`: all user-controlled values go through `esc()` or `textContent`; no further unsafe `innerHTML` found.
- Naming/separation: no further refactor. `renderDashboard()` still renders the Discover homepage (view id `dashboard` is used by routing/settings); renaming touches many call sites for no behavior gain.
- Verification: `node --check script.js`; `tests/stage7_ui_smoke.js` 31/31, no JS errors (adds modal and confirm focus checks). Not verified: real-browser rendering of the merged media queries (check 320/640/860/900/1000 px widths in both themes), return wizard end to end.

## Dependency map
- Auth/session: `api/auth.php` → `includes/auth.php`, `includes/bootstrap.php`, `config.php`; UI: login form + `api()` in `script.js`.
- Circulation: `api/transactions.php` → `includes/domain.php` (fines, ids, mappers), `settings` row; UI: issue/return wizards.
- Catalog/patrons: `api/books.php`, `api/users.php` → `validation.php`, `domain.php`.
- Reports/notifications: `api/reports.php`, `api/notifs.php` (UI currently unused).
- Startup: `config.php` → `bootstrap.php` + `migrations.php` (version gate) → (dev) `ensureDevSeeds` → `dev_seed.php`; CLI `tools/migrate.php`, `tools/seed_admin.php`.

## Not inspected (not provided)
`.env.example`, `js/vendor/gsap.min.js`, `backups/`, `tests/`, live Apache/MySQL behavior.

## Pending approvals / user actions
- Rotate `DEV_ADMIN_PASSWORD`; create least-privilege MySQL user; confirm `.htaccess` returns 403 (see Stage 1 verification).
- Product rule: server-authoritative issue date (= today) and bounded due date?

## Changed files
- `.htaccess` (new)
- `includes/auth.php`, `includes/bootstrap.php`, `includes/dev_seed.php`, `includes/schema_guard.php`, `api/auth.php` (modified)
- `tests/stage1_auth_test.php` (new)
- `api/transactions.php`, `includes/domain.php`, `script.js` (modified, Stage 2); `tests/stage2_transactions_test.py` (new)
- `api/reports.php`, `api/books.php`, `includes/domain.php`, `index.html`, `style.css`, `script.js` (modified, Stage 3); `tests/stage3_api_test.py` (new)
- `tools/migrate.php`, `includes/migrations.php` (new); `config.php`, `includes/schema_guard.php`, `api/transactions.php`, `schema.sql` (modified, Stage 5)
- `index.html`, `style.css`, `script.js` (modified, Stage 6); `style.css`, `script.js`, `api/account.php` (modified, Stage 4/7)
- `index.html`, `script.js`, `style.css`, `tests/stage7_ui_smoke.js` (new) (Stage 7, second batch)
- `IMPLEMENTATION_PROGRESS.md` (new)

## Security audit remediation (October 2026)

Source: read-only audit of 39 files (see `AUDIT.md`, "October 2026 security audit: status"). Each batch was
verified in a sandbox with PHP 8.3 + MariaDB 10.11 (+ Apache 2.4.58 for `.htaccess`). NOT verified: XAMPP/Windows
(MariaDB 10.4.32), a real browser, a real TLS certificate.

| Batch | Scope | Migration | Tests added |
|---|---|---|---|
| Phase 1 | F-01 setup token + `tools/create_admin.php`; F-02 session revocation and 12 h cap; F-09 inert UI | none | `phase1_session_test.py`, extended `stage1_auth_test.php`, `stage7_ui_smoke.js` |
| 2A | F-04 fail-closed `.htaccess`; F-05 HTTPS/HSTS/`TRUSTED_PROXIES`; L-08 generic production errors | none | `web_exposure_check.py` |
| 2B | L-01 to L-05 input robustness, limits, duplicate-key and delete races | none | `phase2b_input_test.py` |
| 2C | F-07 audit trail, `api/audit.php` | 006_audit_log | `phase2c_audit_test.py` |
| 3A | F-08 overdue/unpaid-fine/reservation rules, `pay_fine`, UI for holds and payment | 007_fine_payments | `phase3a_policy_test.py` |
| 3B | R3 `tools/check_integrity.php`; R4 drop redundant indexes; R5-R7 drift checks; R16 unused state; docs | 008_drop_redundant_indexes | drift checks in `static_check.py` |
| 5A | F-06 Content-Security-Policy (report-only first) and CSP-compatible markup; self-hosted fonts (`fonts/`); password quality rules | none | `phase5a_test.py`; CSP/fonts checks in `static_check.py`; header check in `web_exposure_check.py` |
| 4 | Performance: session lock released on read-only requests; one auth lookup per write; avatar out of the session; 14 report queries -> 2; reservations list bounded; browser refreshes only touched records; debounced search | none | `phase4_perf_test.py`, extended `stage1_auth_test.php` and `stage7_ui_smoke.js` |

Behaviour changes worth knowing
* Existing fines start **unpaid** after migration 007 and block new loans until payment is recorded (Users → patron).
* Overdue patrons cannot borrow. A title whose first active reservation belongs to someone else cannot be issued or renewed.
* `stage3_api_test.py` now compares against the Manila calendar date (it failed when UTC and Manila dates differed).
* `smoke_api_test.py` records a fine payment before re-issuing to the same patron (policy change).
* `stage2_transactions_test.py` marks seeded fines paid first; it is not part of `run_all.sh`.

Phase 4 measurements (sandbox: 1 CPU core, so CPU-bound endpoints cannot gain from parallelism)
* 16 parallel requests sharing one session, each waiting 100 ms in the database: **1,646 ms before -> 226 ms after**
  (8 requests: 821 -> 219 ms). Ordinary endpoints showed no change here because they are CPU-bound on one core.
* A rare side effect to know: after a GET passes authentication the session is read-only for that request, so GET
  handlers must never write to `$_SESSION` (none do today).

Deliberately not changed (decisions, with reasons)
* R1 `transactions.type='return'` never written: harmless enum value, removing it needs an ALTER with no benefit.
* R2 stored `Overdue` status: already derived from `due_date` everywhere; left as is.
* R9 unused `reports.php` fields: used by tests and kept for future dashboards.
* R10 unused `transactions` GET / `auth?action=me`: used by tests.
* R11 double auth lookup on writes, R12 repeated overdue SQL: low value; Phase 4 (performance).
* R8 patron stack and `reservations.php` without a screen: kept for a possible patron portal.
* L-06 unique `users.contact` (conflicts with soft delete), L-07 throttle store behind proxies, L-09 re-auth for
  username/email change, L-10 CSRF token, L-11 third-party fonts/images, L-12 PII retention, L-15 runtime upgrades.

Still open
* Server-side search and pagination in the browser. The catalog and patron lists are still loaded in full (200 rows
  per request) and filtered in the browser; fine for a few thousand records, revisit beyond ~5,000 books.
  Other staff members' changes appear only after a reload (the browser now re-reads just the records it changed).
* Phase 5 hardening: Content-Security-Policy, self-hosted fonts/images, MFA, breached-password check.
* A screen for the audit trail and for reservations (API exists).
* Phase 5B: two-factor login (needs a database column and new login/settings screens), self-hosting the six Unsplash photos.
* Enforce the Content-Security-Policy: it ships as `Content-Security-Policy-Report-Only`; after a clean DevTools-console
  pass over every page in both themes, rename the header in `.htaccess` to `Content-Security-Policy`.
* Check the self-hosted Fraunces headings look right: the old Google file was a variable font with an optical-size axis; the
  self-hosted one is the static family at four weights.