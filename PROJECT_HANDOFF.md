# FEU Roosevelt Library — Project Handoff

Prepared: 20 October 2026  
Purpose: explain the current admin and reader systems, the changes made, removed prototype code, and how to open the site or handle database setup safely.

> This handoff intentionally does not include passwords. The current `README.md` contains an old plaintext test-account credential block; do not forward that file or the whole project folder until those credentials have been rotated and that block removed. Keep `.env` private as well.

## 1. What the system does

The project is a PHP/MySQL library application with two browser entry points:

- **Staff / admin dashboard:** `http://localhost/library/`
- **Reader / student portal:** `http://localhost/library/users.php`

Staff accounts (`admin` or `librarian`) manage books, patron records, checkout, returns, fines, reports, and settings. Reader accounts (`patron`) browse the collection, view their own loans and account details, and submit or cancel borrowing requests. A reader request is not an automatic checkout: a staff member completes checkout in the Issue screen.

Open these URLs through Apache in a browser. Do not open `index.html` or `users.php` by double-clicking the files; PHP, API calls, sessions, and database access require the web server.

## 2. Reader sign-up, sign-in, and privacy boundaries

The reader portal is a separate page and uses its own reader navigation while sharing the project’s existing design system.

- A visitor can create a reader account from **Create account** at `/users.php`.
- Sign-up validates the required name, email, username, and password fields; usernames and emails must be unique.
- The server creates both a linked library patron row in `users` and an authentication row in `auth_users`, with role `patron`. It uses a database transaction so the account is not left half-created.
- Passwords are stored as password hashes. The reader password rule is at least 12 characters, subject to the server’s password-quality checks.
- A successful sign-up signs the reader in. Returning readers can sign in with their username or email and password.
- Reader sessions cannot enter staff-only pages or use staff-only API actions.
- The reader can view only their own account, loans, and requests. The reader catalog uses a privacy-filtered API response.
- Reader navigation: **Discover**, **Collection**, **My Loans**, **My Requests**, and **Account**.

## 3. Borrow-request workflow

Borrow requests use the existing `reservations` table; the feature did not add a table or require an SQL import.

1. The reader opens **Collection** and chooses **Request to borrow** on a title.
2. The server writes an active reservation/request linked to the reader’s patron ID and book ID. A duplicate active request for the same title is rejected.
3. The reader sees the title as **Pending** under **My Requests** and may cancel it while it is pending.
4. In the staff dashboard, open **Issue** and select the student. The Book picker filters to that student’s pending requested titles and changes its search prompt to say it is searching requested titles.
5. Requested titles that are on loan remain visible with their status. The **Available only** filter can narrow a request list to titles that can be checked out now.
6. Staff choose an available title and confirm the checkout. The existing server-side loan rules still apply: patron must be active, below the loan limit, and have no overdue loans or unpaid fines; a reservation queue for another reader is honored.
7. After staff issue the book to the requester, the reservation is marked fulfilled and the loan appears in **My Loans**. If staff cannot complete the request yet, it stays pending until canceled or fulfilled.

The staff student list refreshes when Issue opens and periodically while Issue remains open so new requests can appear without signing out. If a browser has an old cached dashboard script, reload the staff page once; the asset version query was updated to force the latest script and style to load.

## 4. Changes and additions

### Reader portal and reader APIs

- Added `users.php`, `users.js`, and `users.css` for the separate reader page, sign-up/sign-in forms, dashboard, collection, loans, requests, account page, responsive navigation, and feedback states.
- Added `api/user_auth.php` for reader registration, login, session status, and logout. Reader registration creates a linked patron profile and `patron` authentication account.
- Added `api/reader.php` for reader-only views and actions. It scopes requests and loans to the signed-in patron and returns a sanitized catalog without other patrons’ identities or loan details.
- Reader catalog cards display availability and request state. **My Requests** shows pending, cancelled, and fulfilled entries and allows cancellation while pending.
- Reader authentication uses the application’s existing session/auth infrastructure. No reader passwords are embedded in frontend files.

### Staff integration for requests

- `api/reservations.php` and `api/reader.php` now allow a reader to request an available title as well as an on-loan title. The request is still only a request; staff must perform checkout.
- `api/users.php` returns active requested title IDs, names, and availability to authorized staff responses.
- `includes/domain.php` maps requested books into the staff patron data model.
- `script.js` filters the Issue screen’s Book picker to the selected student’s active requested titles; it shows availability and does not silently pick a title.
- `script.js` refreshes staff users/books when Issue opens and while the view is visible. `index.html` adds a cache-busting query to the staff script and style so browsers fetch the current versions.
- `style.css` styles the request label shown under a student in the Issue flow.

### Existing staff system and backend improvements recorded in the project

- Staff sign-in is session-aware. Unauthenticated visitors see sign-in instead of loading dashboard data; sign-out and password-change actions call the server.
- Staff role and active status are rechecked against the database. Session idle and absolute lifetimes are enforced; password changes invalidate other sessions.
- First-admin setup is not openly available over the web. CLI tools create, add, or reset staff accounts.
- Catalog, patron, transaction, settings, reporting, and audit data use the PHP/MySQL APIs instead of fabricated browser-only data.
- Circulation dates and fines are calculated/validated server-side. The server enforces loan limits, overdue and unpaid-fine blocks, renewal policy, reservation priority, row locking, and duplicate open-loan protection.
- Added audit logging for important account, catalog, settings, reservation, and circulation changes.
- Added input validation, pagination limits, duplicate-race handling, safer JSON/error handling, and staff-only authorization on write actions.
- `.htaccess` protects environment/configuration and non-web files, disables directory listings, blocks version-control folders, and adds security headers. Production configuration requires HTTPS and does not allow the database root account.
- Fonts are self-hosted. The app uses the bundled local GSAP file instead of loading that library from a public CDN.
- UI changes include better keyboard/focus behavior, accessible labels and headings, responsive navigation, contrast improvements, reduced-motion support, and field-level validation feedback.

## 5. What was removed or replaced

The following prototype or stale behavior was removed or replaced as part of the documented project work:

- Removed browser-only mock collections and state such as hardcoded book/patron seed arrays, fake borrow counts, fake covers, generated descriptions, and saved/reserved mock state. Actual data comes from the API; fictional development seed data is restricted to development mode.
- Replaced mock borrow/reserve/save controls with real navigation or API-backed behavior. Reader requests now write to SQL; staff checkout writes the actual loan.
- Replaced fake report metrics and notification items with API data and real empty/error states.
- Removed invented library profile values and personal identity defaults from the static frontend. Library contact details are read from saved settings.
- Removed the fake profile password field and nonfunctional language control; account/password work is handled by the supported account/auth flows.
- Settings reset now resets library settings only; it no longer overwrites the administrator’s profile.
- Book editing no longer invents a description, format, or cover URL. Patron editing preserves program/year values the UI does not recognize rather than rewriting them.
- Replaced outdated claims that settings/reports are only local or demo data.
- Removed unused JavaScript helpers/state and dead CSS selectors; removed fixed-delay UI timing hacks where event callbacks/focus handling can be used.
- Removed duplicate CSS media-query blocks only where cascade checks showed the move was safe. The main staff design direction was retained.
- Request handling reuses the existing reservation queue and statuses (`active`, `cancelled`, `fulfilled`); no reservation table or migration was removed for this feature.

## 6. Database and import guidance

### Current local database status

A read-only migration dry-run was run against the current local `feu_library` database on 20 October 2026. It reported MariaDB 10.4.32 and migrations `001_baseline` through `009_drop_book_isbn` as already applied, with **no pending migrations**. Therefore the current reader portal and borrow-request changes do **not** need a new SQL import or migration.

The dry-run also reported four returned loans with fines that are considered unpaid by the fine-payment migration. Staff should check whether those payments were actually collected and record payment in the system where appropriate.

### Important caution about migration 009

Migration `009_drop_book_isbn` permanently drops the `books.isbn` column and all ISBN values stored in it. The current database marks it as applied. If setting up a different or older database where this migration is pending, do not run `--yes` until the owner has reviewed that data-loss effect and made a backup/export of any ISBN values they need.

### What to do after ordinary code updates

- Copy/update the application code and open the normal URLs. **Do not import `schema.sql` just because PHP/JS/CSS files changed.**
- For the reader portal, sign-up, and borrow requests described here, there is no new table: no import or migration is required.
- If the application returns `503` saying migrations are pending, first make a database backup and run the dry-run command below. Review every pending migration, especially `009_drop_book_isbn`, before applying anything.
- Never re-import `schema.sql` into a populated database. It is a one-time baseline schema import for a newly created empty database. Re-importing can fail on existing constraints or damage/conflict with existing records.

### Fresh database setup only

These steps are for a genuinely new/empty database or a separate test copy—not the existing working database.

1. Create an empty database named `feu_library` (or configure the intended name in `.env`).
2. Create the private `.env` file from the placeholder `env.example` in the project root. Set the database host, port, database name, user, and password to match the local database. Keep `.env` private and do not send it to anyone.
3. In phpMyAdmin, select the new empty database and import `schema.sql` once.
4. From the project folder, preview migrations:

   ```powershell
   D:\XAMPP\php\php.exe tools\migrate.php --dry-run
   ```

5. Back up the database, inspect the entire dry-run output, and only apply migrations whose effects are intended. Applying migrations uses:

   ```powershell
   D:\XAMPP\php\php.exe tools\migrate.php --yes
   ```

   Do not apply a pending destructive migration, including `009_drop_book_isbn`, without first preserving any data it removes.

6. If the database has no staff account, create the first administrator with `tools\create_admin.php` or the configured development seeder. The CLI asks for account details; keep those credentials private. Existing staff accounts should sign in with their privately provided credentials.
7. Open the staff or reader URL listed above. Readers can self-register from the reader sign-in screen.

## 7. Open the system: quick-use tutorial

Assuming the local web server and database are already running:

1. Open `http://localhost/library/` for the staff/admin sign-in.
2. Sign in with an existing staff account. Staff credentials are not included here; ask the project owner or use the approved CLI password-reset process if they are lost.
3. Open **Issue** to check out books, or **Users → patron** to review reader records and fines. Reports and settings are in the staff navigation.
4. Open `http://localhost/library/users.php` in another tab for the reader portal.
5. A new reader chooses **Create account**, completes the form, and is signed in. An existing reader chooses **Sign in**.
6. In **Collection**, the reader searches for a book and chooses **Request to borrow**. They can track or cancel pending requests in **My Requests**.
7. Staff open/reopen **Issue**, choose the student, and the Book side filters to that student’s requested titles. Select an available title and complete checkout. The reader then sees it under **My Loans**.

## 8. Troubleshooting

- **Staff page opens but reader cannot use staff tools:** expected; use the reader portal URL and a `patron` account.
- **A request is visible to the reader but not in the staff Book picker:** reopen Issue or wait for its refresh; if the page was open before the latest code change, reload the staff dashboard once. Check that the staff account is signed in as `admin`/`librarian` and that the request still says Pending.
- **“Migrations pending” / HTTP 503:** do not import `schema.sql` again. Back up, run `tools\migrate.php --dry-run`, review pending migrations and data effects, then apply only when approved.
- **A login fails:** verify the correct portal and account type. Staff sign in at `/`; readers sign in at `/users.php`. A patron account is not a staff account. Passwords are hashed and cannot be read back; an authorized reset is required if lost.
- **Signup reports duplicate username/email:** use a new username/email or sign in to the existing reader account.
- **Book request cannot be checked out:** confirm the title is available and the patron is active, below the loan cap, has no overdue books or unpaid fines, and is first in any reservation queue.
- **Database import reports duplicate constraints:** stop. Do not drop/recreate the working database or import over it. Preserve a backup and use the migration tool after reviewing its dry-run.

## 9. Verification and known limits

- The current local migration dry-run was read-only and found the database up to date.
- The borrow-request code reuses existing SQL rows and server-side issue checks; no new schema import was needed.
- The latest user-request filtering and refresh behavior should still be smoke-checked in the actual browser after reloading the staff page. No automated tests were run for the latest request-filter UI edits in this handoff turn.
- The reader portal does not issue books directly; staff checkout is required.
- The staff dashboard has no separate full-page request-approval queue. Requests are surfaced through the Issue flow’s student and book pickers.
- Two-factor login is not implemented. The staff CSP remains report-only pending browser console review as documented in `AUDIT.md`.

## 10. Key files

| File | Purpose |
|---|---|
| `index.html`, `script.js`, `style.css` | Staff dashboard structure, behavior, and design |
| `users.php`, `users.js`, `users.css` | Reader sign-up/sign-in and reader dashboard |
| `api/auth.php`, `api/user_auth.php` | Staff and reader authentication endpoints |
| `api/books.php`, `api/users.php`, `api/transactions.php` | Staff catalog, patron, and circulation APIs |
| `api/reader.php`, `api/reservations.php` | Reader-scoped catalog/loans/requests and reservation queue |
| `includes/auth.php`, `includes/domain.php`, `includes/migrations.php` | Session/role checks, shared mapping/policy, and database migrations |
| `schema.sql`, `tools/migrate.php` | Baseline schema and controlled migration runner |
| `.htaccess`, `.env` | Web exposure controls and private local configuration; `.env` must never be shared |
| `AUDIT.md`, `IMPLEMENTATION_PROGRESS.md` | Security findings and implementation history |

