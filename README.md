# FEU Roosevelt Library

Library administration dashboard: vanilla HTML/CSS/JavaScript frontend, PHP API, MySQL/MariaDB database.
Staff (admin/librarian accounts) manage the catalog, patrons, loans, returns, fines and reports.

## 1. Run it locally (XAMPP on Windows)

Paths below assume `C:\xampp` and the project in `C:\xampp\htdocs\library`. Open it through Apache
(`http://localhost/library/`), never by double-clicking `index.html`.

1. **Start Apache and MySQL** in the XAMPP Control Panel.
2. **Create `.env`**: copy `.env.example` to `.env` (same folder) and set at least `DB_PORT` (3306 by default; your
   install may use 3307) and `DEV_ADMIN_PASSWORD` (12+ characters, must not contain "admin", "password" or "12345").
   Keep `APP_ENV=development` for local work. `.env` is private and git-ignored.
3. **Import the schema once**: phpMyAdmin → Import → `schema.sql`. Never re-import over a database that holds records.
4. **Apply the managed schema steps** (back up the database first):
   ```
   C:\xampp\php\php.exe tools\migrate.php --dry-run     (preview, changes nothing)
   C:\xampp\php\php.exe tools\migrate.php --yes         (apply)
   ```
   Until this is done every API call answers `503`. Migrations are repeatable; running them again is a no-op.
5. **Create the first administrator** (development): `C:\xampp\php\php.exe tools\seed_admin.php` creates `admin` from
   `DEV_ADMIN_PASSWORD`, only when no staff account exists. Or run `tools\create_admin.php` to choose your own username.
   More accounts: `tools\add_admin.php`. Forgotten password: `tools\reset_password.php <username>`. No web request ever
   creates or resets an account. Then sign in at `http://localhost/library/`. The first API request still adds a fictional
   sample catalog (rows named `SEED-…` / `[DEV SEED]`).

## 2. Circulation rules (enforced by the server)

* The issue date is always today (Asia/Manila). Due date defaults to today + the loan period and can never be later.
* A patron can hold at most *Maximum books* titles, and only while **Active**.
* **No new loan** while the patron has an **overdue book** or **unpaid fines**, or if another patron is first in the
  reservation queue for that title.
* Fine = (days late − grace days) × rate, calculated on return by the server. Fines start **unpaid**; record payment
  under *Users → patron → Record payment*. Unpaid fines are listed in Reports.
* Overdue loans cannot be renewed; renewals stop at *Maximum renewals* or when another patron has reserved the title.
* Every change is written to an **audit trail** (who, what, when, from which IP). Read it with
  `GET /api/audit.php` (filters: `action`, `entity_type`, `entity_id`, `actor_id`, `from`, `to`; paged).

## 3. Tests and checks

Run from the project folder against a **development** database. `py` is the Windows Python launcher.

```
set BASE=http://localhost/library
set ADMIN_PW=your-DEV_ADMIN_PASSWORD
set MYSQL_CLI=C:\xampp\mysql\bin\mysql.exe -u root -P 3306 -h 127.0.0.1 -N -B

py tests\static_check.py                      (syntax, markup, and PHP/JS/HTML consistency checks)
C:\xampp\php\php.exe tests\stage1_auth_test.php
py tests\smoke_api_test.py                    (needs MYSQL_CLI for the authorization/fine checks)
py tests\phase1_session_test.py               (password change signs out other devices)
py tests\phase2b_input_test.py                (odd input, limits, delete-vs-issue races)
py tests\phase2c_audit_test.py                (audit trail)
py tests\phase3a_policy_test.py               (overdue/fine/reservation rules, fine payments)
py tests\phase4_perf_test.py                  (report numbers, single-record reads, avatar handling)
py tests\phase5a_test.py                      (password quality rules)
py tests\stage3_api_test.py
py tests\web_exposure_check.py                (sensitive files must answer 403/404)
node tests\stage7_ui_smoke.js                 (after: npm i --no-save jsdom)
```
`tests\run_all.sh` runs the list (bash/Git Bash). `tests\stage2_transactions_test.py` assumes a freshly seeded
database and is not part of `run_all.sh`.

Data health check (read-only, safe on production): `C:\xampp\php\php.exe tools\check_integrity.php`

## 4. Production checklist

* `APP_ENV=production`. Unknown values are treated as production. Development seeds and the default admin do not exist.
* **HTTPS only.** Plain HTTP is refused (`ALLOW_INSECURE_HTTP=1` overrides, not recommended). Behind a reverse proxy set
  `TRUSTED_PROXIES=<proxy ip>`; `X-Forwarded-Proto` is believed only from those addresses. Enable the commented
  HTTP→HTTPS redirect in `.htaccess`.
* **Database user:** a dedicated least-privilege account (never `root`, password required). Give `ALTER/CREATE/INDEX`
  only to a separate account used for `tools\migrate.php`. Ideally grant the app user only `INSERT, SELECT` on `audit_log`.
* **First administrator:** `php tools\create_admin.php` (works only while no admin exists). Web setup stays disabled
  unless `SETUP_TOKEN` (24+ characters) is set; remove it after use.
* **Keep out of the web root / repository:** `.env`, SQL dumps, backups. Do not upload `.env` anywhere.
* **Content-Security-Policy:** `.htaccess` sends it in report-only mode. Open every page (both themes) with DevTools →
  Console open; when no `[Report Only]` messages appear, rename the header to `Content-Security-Policy` to enforce it.
* **Fonts** are self-hosted in `fonts/` (SIL OFL 1.1, licences included); the app makes no calls to Google. Home-page
  photos and staff-entered book-cover URLs are still loaded from their own hosts.
* After every deployment run `py tests\web_exposure_check.py` against the live URL. `.htaccess` only works when Apache
  has `AllowOverride All` for this folder.
* Back up before every migration. Review `php tools\migrate.php --dry-run` first.

## 5. API reference

All endpoints return JSON and need a staff session from `api/auth.php` unless noted.

| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/auth.php` | GET, POST | `status`, `login`, `logout`, `password`; `setup` (token-gated, see above) |
| `/api/books.php` | GET, POST, PUT, DELETE | Catalog; `?id=` selects a book; `search`, `category`, `status`, `sort` filters |
| `/api/users.php` | GET, POST, PUT, DELETE | Patrons, including `unpaidFines` and `overdueLoans` |
| `/api/transactions.php` | GET, POST | POST `type`: `issue`, `return`, `renew`, `pay_fine` |
| `/api/reservations.php` | GET, POST | Create/cancel reservations (no screen yet) |
| `/api/reports.php` | GET | Borrowing/overdue figures, fines assessed and unpaid |
| `/api/audit.php` | GET | Read-only audit trail |
| `/api/settings.php` | GET, PUT | Library rules and display preferences |
| `/api/account.php` | GET, PUT | Own profile |
| `/api/notifs.php` | GET, PUT | Notification preferences |

Status codes: `401` not signed in, `403` not allowed / HTTPS required, `409` the action conflicts with current
data (book already on loan, patron blocked…), `422` invalid input (field messages in `errors`), `503` migrations pending
or database unavailable.

## 6. Troubleshooting

* **`503` on every call:** migrations are pending (step 4) or MySQL is not reachable (check `DB_HOST/DB_PORT`).
* **`401` right after signing in:** the session expired (8 h idle / 12 h absolute) or the password was changed elsewhere.
* **`could not find driver`:** enable `pdo_mysql` in `C:\xampp\php\php.ini`, restart Apache.
* **MariaDB will not start (InnoDB log errors):** stop retrying, copy the whole data directory first, never delete
  `ibdata1` or `ib_logfile*`. See `AUDIT.md` for the recovery record.
* **Import reports a duplicate constraint:** stop; do not recreate a database that holds records. Use `tools\migrate.php`.

## 7. Staff accounts (no passwords are stored in this file)

Never write a username with its password in the README, a chat, a screenshot or a commit. Keep real passwords in a
password manager. Each command below runs from the project folder.

* **Add a staff account:** `C:\xampp\php\php.exe tools\add_admin.php` (add `--role=librarian` for a librarian).
* **Reset a forgotten password:** `C:\xampp\php\php.exe tools\reset_password.php <username>`.
  In the XAMPP Shell the prompt may not wait for typing; set the password first, run the script, then clear it:
  `set NEW_PASSWORD=<12+ characters, letters and digits>`, then the command above, then `set NEW_PASSWORD=` and `cls`.
* **Locked out after too many attempts:** wait 15 minutes, or delete `feu_throttle_*.json` from PHP's temp folder
  (`C:\xampp\tmp` on XAMPP).
* **Database dumps** (`*.sql` other than `schema.sql`) hold patron names, emails and password hashes. Keep them outside
  the project folder and never upload or commit them.