# Email and Student Number Constraint Changes

This note records the email and student-number work added to the library project. The database schema migration is `011_patron_identity`.

## Database changes

File: [`schema.sql`](schema.sql), `users` table definition (around lines 36–54)

```sql
student_number VARCHAR(50),
active_contact VARCHAR(255) GENERATED ALWAYS AS (
  CASE
    WHEN deleted_at IS NULL AND contact IS NOT NULL AND TRIM(contact) <> ''
    THEN LOWER(TRIM(contact))
    ELSE NULL
  END
) VIRTUAL,
UNIQUE INDEX uk_users_student_number (student_number),
UNIQUE INDEX uk_users_active_contact (active_contact)
```

- `uk_users_student_number` prevents a student number from being assigned to two patron records. Its database collation makes comparisons case-insensitive. `NULL` is allowed for existing patrons who have not yet supplied a number.
- `uk_users_active_contact` prevents duplicate email addresses among patrons whose `deleted_at` is `NULL`. Deleted patrons produce a `NULL` generated value, so they do not reserve the active-patron email index.
- `uk` means **unique key**: a database index that rejects duplicate values.

## Migration

File: [`includes/migrations.php`](includes/migrations.php), migration list and `011_patron_identity` (around lines 8 and 250–284)

- Updated `MIGRATION_LATEST` to `011_patron_identity`.
- Added a preflight check for duplicate active patron emails, duplicate student numbers, and linked-account email conflicts before applying the new indexes.
- Added `student_number` and the generated `active_contact` column when missing, then created the two unique indexes.
- Normalized stored emails and synchronized each active linked patron's `users.contact` from its `auth_users.email`.
- Deactivated login accounts belonging to already soft-deleted patrons and replaced those account emails with an internal `deleted+<account-id>@invalid.local` value, freeing their former address.

The local database has migration `011_patron_identity` recorded in its existing `schema_migrations` table. No new database table was added. A pre-migration database dump was saved outside the web root at `D:\XAMPP\backups\feu_library_pre_011_patron_identity_20261102.sql`.

## Shared validation and concurrency helpers

File: [`includes/validation.php`](includes/validation.php), around lines 116–122

```php
function normalizeEmail(string $email): string {
    return strtolower(trim($email));
}

function validStudentNumber(string $number): bool {
    return strlen($number) >= 2 && strlen($number) <= 50
        && (bool)preg_match('/^[A-Za-z0-9][A-Za-z0-9._\/-]{1,49}$/', $number);
}
```

Student numbers accept 2–50 letters, numbers, dots, slashes, or dashes, starting with a letter or number.

File: [`includes/domain.php`](includes/domain.php), around lines 91–127

- `acquireEmailLocks()` uses MySQL named locks derived from normalized email addresses to serialize concurrent claims across the API endpoints.
- `emailInUse()` checks active patron contacts and login-account emails, while allowing the linked patron and account to share their own email.
- `mapUser()` includes the `studentNumber` field in API responses (around line 175).

## API and account behavior

- [`api/users.php`](api/users.php), `updateUser()` around lines 64–174 and patron creation around lines 200–282: staff add/edit validates student numbers, normalizes email, checks both tables, and synchronizes a linked account's email in the same database transaction. Patron creation requires a student number. Soft deletion deactivates the linked account and releases its old email (around line 312).
- [`api/account.php`](api/account.php), email update around lines 50–105: checks the patron table as well as login accounts, normalizes the email, and updates a linked active patron's contact in the same transaction.
- [`api/user_auth.php`](api/user_auth.php), reader signup around lines 60–145: requires a student number, normalizes email, checks for duplicates, and writes student number and email to the new patron and account records together.
- [`api/auth.php`](api/auth.php), first-run account setup around lines 72–105: normalizes and checks the email against patron records before creating an administrator account.
- [`tools/add_admin.php`](tools/add_admin.php), [`tools/create_admin.php`](tools/create_admin.php), and [`tools/seed_admin.php`](tools/seed_admin.php): normalize and check administrator emails against existing patron and account records before inserting them.

## User interface

- [`users.php`](users.php), reader signup form around line 48: added a required student-number input.
- [`script.js`](script.js), around lines 94, 1546, 1579, 1643–1735, and 1946–2022: maps student number data, adds the staff patron form field and validation, displays student number separately from Library ID, and includes it in patron search and issue selection.
- [`index.php`](index.php), around line 477: renamed the patron-list column to “Student number.”

## Scope

The changes address email and student-number constraints and the UI needed to enter and identify the student number. They do not add tables or constitute a broad database-security redesign. The database transaction change is limited to keeping linked patron/account email updates atomic; named locks and unique indexes address duplicate-claim races.
