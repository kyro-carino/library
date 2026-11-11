<?php

declare(strict_types=1);

require_once __DIR__ . '/schema_guard.php';

/** Id of the newest migration. Requests refuse to run until this one is recorded. */
const MIGRATION_LATEST = '011_patron_identity';

function tableExists(PDO $pdo, string $table): bool {
    $s = $pdo->prepare('SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?');
    $s->execute([$table]);
    return (int)$s->fetchColumn() > 0;
}

function foreignKeyExists(PDO $pdo, string $name): bool {
    $s = $pdo->prepare('SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = ?');
    $s->execute([$name]);
    return (int)$s->fetchColumn() > 0;
}

function checkConstraintExists(PDO $pdo, string $name): bool {
    $s = $pdo->prepare('SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = ?');
    $s->execute([$name]);
    return (int)$s->fetchColumn() > 0;
}

/** Cheap per-request gate: one indexed lookup. */
function migrationsApplied(PDO $pdo): bool {
    try {
        $s = $pdo->prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
        $s->execute([MIGRATION_LATEST]);
        return (bool)$s->fetchColumn();
    } catch (Throwable $e) {
        return false;
    }
}

function migrationForeignKeys(): array {
    // [name, table, column, referenced table, ON DELETE action]
    return [
        ['fk_books_borrowed_by', 'books', 'borrowed_by', 'users', 'SET NULL'],
        ['fk_transactions_book', 'transactions', 'book_id', 'books', 'SET NULL'],
        ['fk_transactions_user', 'transactions', 'user_id', 'users', 'SET NULL'],
        ['fk_auth_patron', 'auth_users', 'patron_id', 'users', 'SET NULL'],
        ['fk_res_book', 'reservations', 'book_id', 'books', 'CASCADE'],
        ['fk_res_user', 'reservations', 'user_id', 'users', 'CASCADE'],
    ];
}

function migrationIndexes(): array {
    // [table, index name, columns]
    return [
        ['transactions', 'idx_tx_issue_date', 'issue_date'],
        ['transactions', 'idx_tx_return_date', 'return_date'],
        ['transactions', 'idx_tx_open', 'type, return_date, due_date'],
        ['books', 'idx_books_isbn', 'isbn'],
    ];
}

function migrationChecks(): array {
    // [constraint name, table, condition]
    return [
        ['chk_tx_nonneg', 'transactions', 'fine >= 0 AND renewal_count >= 0'],
        ['chk_books_renewals_nonneg', 'books', 'renewal_count >= 0'],
        ['chk_settings_limits', 'settings',
            'fine_per_day >= 0 AND loan_days >= 1 AND max_books_per_user >= 1 AND max_renewals >= 0 AND grace_period_days >= 0'],
    ];
}

function migrationList(): array {
    return [
        [
            'id' => '001_baseline',
            'title' => 'Baseline tables, columns, indexes, id counters (idempotent; no data removed)',
            'preflight' => function (PDO $pdo): array {
                $missing = [];
                foreach (['books', 'users', 'transactions', 'settings', 'notif_prefs'] as $t) {
                    if (!tableExists($pdo, $t)) {
                        $missing[] = "table `$t` is missing; import schema.sql first";
                    }
                }
                return $missing;
            },
            'apply' => function (PDO $pdo): void {
                ensureBaselineSchema($pdo);
            },
        ],
        [
            'id' => '002_foreign_keys',
            'title' => 'Add foreign keys that are not present yet',
            'preflight' => function (PDO $pdo): array {
                $problems = [];
                foreach (migrationForeignKeys() as [$name, $t, $col, $ref]) {
                    if (foreignKeyExists($pdo, $name)) {
                        continue;
                    }
                    $n = (int)$pdo->query("SELECT COUNT(*) FROM `$t` c LEFT JOIN `$ref` r ON r.id = c.`$col` WHERE c.`$col` IS NOT NULL AND r.id IS NULL")->fetchColumn();
                    if ($n > 0) {
                        $problems[] = "$name: $n row(s) in $t.$col point to a missing $ref record";
                    }
                }
                return $problems;
            },
            'apply' => function (PDO $pdo): void {
                foreach (migrationForeignKeys() as [$name, $t, $col, $ref, $onDelete]) {
                    if (!foreignKeyExists($pdo, $name)) {
                        $pdo->exec("ALTER TABLE `$t` ADD CONSTRAINT `$name` FOREIGN KEY (`$col`) REFERENCES `$ref`(id) ON DELETE $onDelete ON UPDATE CASCADE");
                    }
                }
            },
        ],
        [
            'id' => '003_indexes',
            'title' => 'Add indexes for reports/notifications (transactions dates, books.isbn; non-unique)',
            'preflight' => fn(PDO $pdo): array => [],
            'apply' => function (PDO $pdo): void {
                foreach (migrationIndexes() as [$t, $name, $cols]) {
                    if (!indexExists($pdo, $t, $name)) {
                        $pdo->exec("CREATE INDEX `$name` ON `$t` ($cols)");
                    }
                }
            },
        ],
        [
            'id' => '004_check_constraints',
            'title' => 'Add non-negative / minimum-value CHECK constraints',
            'preflight' => function (PDO $pdo): array {
                $problems = [];
                foreach (migrationChecks() as [$name, $t, $cond]) {
                    if (checkConstraintExists($pdo, $name)) {
                        continue;
                    }
                    $n = (int)$pdo->query("SELECT COUNT(*) FROM `$t` WHERE NOT ($cond)")->fetchColumn();
                    if ($n > 0) {
                        $problems[] = "$name: $n row(s) in $t violate ($cond)";
                    }
                }
                return $problems;
            },
            'apply' => function (PDO $pdo): void {
                foreach (migrationChecks() as [$name, $t, $cond]) {
                    if (!checkConstraintExists($pdo, $name)) {
                        $pdo->exec("ALTER TABLE `$t` ADD CONSTRAINT `$name` CHECK ($cond)");
                    }
                }
            },
        ],
        [
            'id' => '005_open_loan_guard',
            'title' => 'Database-enforced "one open loan per book" (virtual column + unique index)',
            'preflight' => function (PDO $pdo): array {
                $rows = $pdo->query("SELECT book_id, COUNT(*) c FROM transactions WHERE type = 'issue' AND return_date IS NULL AND status IN ('Borrowed','Overdue') GROUP BY book_id HAVING c > 1")->fetchAll();
                $problems = [];
                foreach ($rows as $r) {
                    $problems[] = "book {$r['book_id']} has {$r['c']} open loans; resolve before the unique guard can be added";
                }
                return $problems;
            },
            'apply' => function (PDO $pdo): void {
                if (!columnExists($pdo, 'transactions', 'open_book_id')) {
                    $pdo->exec("ALTER TABLE transactions ADD COLUMN open_book_id VARCHAR(20) GENERATED ALWAYS AS (IF(type = 'issue' AND return_date IS NULL AND status IN ('Borrowed','Overdue'), book_id, NULL)) VIRTUAL");
                }
                if (!indexExists($pdo, 'transactions', 'uk_tx_open_book')) {
                    $pdo->exec('CREATE UNIQUE INDEX uk_tx_open_book ON transactions (open_book_id)');
                }
            },
        ],
        [
            'id' => '006_audit_log',
            'title' => 'Audit trail table (who did what, when). Adds one new table; no existing data is touched',
            'preflight' => fn(PDO $pdo): array => [],
            'apply' => function (PDO $pdo): void {
                $pdo->exec("CREATE TABLE IF NOT EXISTS audit_log (
                    id BIGINT AUTO_INCREMENT PRIMARY KEY,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    actor_id INT NULL,
                    actor_name VARCHAR(255) NULL,
                    action VARCHAR(40) NOT NULL,
                    entity_type VARCHAR(20) NULL,
                    entity_id VARCHAR(40) NULL,
                    details TEXT NULL,
                    ip VARCHAR(45) NULL,
                    INDEX idx_audit_created (created_at),
                    INDEX idx_audit_entity (entity_type, entity_id),
                    INDEX idx_audit_actor (actor_id, created_at),
                    INDEX idx_audit_action (action, created_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
            },
        ],
        [
            'id' => '007_fine_payments',
            'title' => 'Fine payment state: transactions.fine_paid_at (NULL = unpaid). Existing fines start UNPAID',
            'preflight' => fn(PDO $pdo): array => [],
            'apply' => function (PDO $pdo): void {
                if (!columnExists($pdo, 'transactions', 'fine_paid_at')) {
                    $pdo->exec('ALTER TABLE transactions ADD COLUMN fine_paid_at DATETIME NULL');
                }
                if (!indexExists($pdo, 'transactions', 'idx_tx_unpaid')) {
                    $pdo->exec('CREATE INDEX idx_tx_unpaid ON transactions (user_id, status, fine_paid_at)');
                }
            },
        ],
        [
            'id' => '008_drop_redundant_indexes',
            'title' => 'Drop two redundant indexes (idx_book_id is a prefix of idx_tx_book_status; idx_type has ~1 distinct value)',
            'preflight' => function (PDO $pdo): array {
                // Only drop idx_book_id if the covering index exists, so the book_id foreign key keeps an index.
                if (indexExists($pdo, 'transactions', 'idx_book_id') && !indexExists($pdo, 'transactions', 'idx_tx_book_status')) {
                    return ['idx_tx_book_status is missing; run migration 001 first'];
                }
                return [];
            },
            'apply' => function (PDO $pdo): void {
                foreach (['idx_book_id', 'idx_type'] as $ix) {
                    if (indexExists($pdo, 'transactions', $ix)) {
                        $pdo->exec("ALTER TABLE transactions DROP INDEX `$ix`");
                    }
                }
            },
        ],
        [
            'id' => '009_drop_book_isbn',
            'title' => 'Remove books.isbn and its index. PERMANENTLY deletes every stored ISBN value (back up first)',
            'preflight' => fn(PDO $pdo): array => [],
            'apply' => function (PDO $pdo): void {
                if (indexExists($pdo, 'books', 'idx_books_isbn')) {
                    $pdo->exec('ALTER TABLE books DROP INDEX idx_books_isbn');
                }
                if (columnExists($pdo, 'books', 'isbn')) {
                    $pdo->exec('ALTER TABLE books DROP COLUMN isbn');
                }
            },
        ],
        [
            'id' => '010_totp',
            'title' => 'Time-based one-time passwords for staff and reader accounts',
            'preflight' => fn(PDO $pdo): array => [],
            'apply' => function (PDO $pdo): void {
                if (!columnExists($pdo, 'auth_users', 'totp_secret')) {
                    $pdo->exec('ALTER TABLE auth_users ADD COLUMN totp_secret VARCHAR(64) NULL');
                }
                if (!columnExists($pdo, 'auth_users', 'totp_enabled')) {
                    $pdo->exec('ALTER TABLE auth_users ADD COLUMN totp_enabled TINYINT(1) NOT NULL DEFAULT 0');
                }
                if (!columnExists($pdo, 'auth_users', 'totp_backup_hashes')) {
                    $pdo->exec('ALTER TABLE auth_users ADD COLUMN totp_backup_hashes TEXT NULL');
                }
            },
        ],
        [
            'id' => '011_patron_identity',
            'title' => 'Unique active patron email and student number; retain normalized email on linked accounts',
            'preflight' => function (PDO $pdo): array {
                $problems = [];
                $dup = $pdo->query("SELECT LOWER(TRIM(contact)) AS email, COUNT(*) AS n FROM users WHERE deleted_at IS NULL AND contact IS NOT NULL AND TRIM(contact) <> '' GROUP BY LOWER(TRIM(contact)) HAVING COUNT(*) > 1 LIMIT 1")->fetch();
                if ($dup) $problems[] = 'duplicate active patron email: ' . $dup['email'];
                $futureDup = $pdo->query("SELECT LOWER(TRIM(COALESCE(a.email, u.contact))) AS email FROM users u LEFT JOIN auth_users a ON a.patron_id = u.id WHERE u.deleted_at IS NULL AND COALESCE(a.email, u.contact) IS NOT NULL AND TRIM(COALESCE(a.email, u.contact)) <> '' GROUP BY LOWER(TRIM(COALESCE(a.email, u.contact))) HAVING COUNT(*) > 1 LIMIT 1")->fetch();
                if ($futureDup) $problems[] = 'linked account email would duplicate an active patron email: ' . $futureDup['email'];
                if (columnExists($pdo, 'users', 'student_number')) {
                    $student = $pdo->query("SELECT LOWER(TRIM(student_number)) AS student_number, COUNT(*) AS n FROM users WHERE student_number IS NOT NULL AND TRIM(student_number) <> '' GROUP BY LOWER(TRIM(student_number)) HAVING COUNT(*) > 1 LIMIT 1")->fetch();
                    if ($student) $problems[] = 'duplicate student number: ' . $student['student_number'];
                }
                return $problems;
            },
            'apply' => function (PDO $pdo): void {
                if (!columnExists($pdo, 'users', 'student_number')) {
                    $pdo->exec('ALTER TABLE users ADD COLUMN student_number VARCHAR(50) NULL');
                }
                if (!columnExists($pdo, 'users', 'active_contact')) {
                    $pdo->exec("ALTER TABLE users ADD COLUMN active_contact VARCHAR(255) GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL AND contact IS NOT NULL AND TRIM(contact) <> '' THEN LOWER(TRIM(contact)) ELSE NULL END) VIRTUAL");
                }
                $pdo->exec('UPDATE auth_users SET email = LOWER(TRIM(email)) WHERE email <> LOWER(TRIM(email))');
                $pdo->exec("UPDATE users u JOIN auth_users a ON a.patron_id = u.id SET u.contact = LOWER(TRIM(a.email)) WHERE u.deleted_at IS NULL AND LOWER(TRIM(u.contact)) <> LOWER(TRIM(a.email))");
                $pdo->exec('UPDATE users SET contact = LOWER(TRIM(contact)) WHERE contact IS NOT NULL AND contact <> LOWER(TRIM(contact))');
                $pdo->exec("UPDATE auth_users a JOIN users u ON u.id = a.patron_id SET a.status = 'Inactive', a.email = CONCAT('deleted+', a.id, '@invalid.local') WHERE u.deleted_at IS NOT NULL");
                if (!indexExists($pdo, 'users', 'uk_users_active_contact')) {
                    $pdo->exec('CREATE UNIQUE INDEX uk_users_active_contact ON users (active_contact)');
                }
                if (!indexExists($pdo, 'users', 'uk_users_student_number')) {
                    $pdo->exec('CREATE UNIQUE INDEX uk_users_student_number ON users (student_number)');
                }
            },
        ],
    ];
}

/**
 * Applies pending migrations in order. $dryRun reports only and changes nothing.
 * Stops at the first migration whose preflight finds blocking data (live run).
 * Returns ['applied' => [...ids], 'pending' => [...ids], 'blocked' => bool].
 */
function runMigrations(PDO $pdo, bool $dryRun, callable $log): array {
    $applied = [];
    $done = [];
    if (!$dryRun) {
        $pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (
            version VARCHAR(64) PRIMARY KEY,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    }
    if (tableExists($pdo, 'schema_migrations')) {
        $done = $pdo->query('SELECT version FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN);
    }
    $pending = [];
    $blocked = false;
    foreach (migrationList() as $m) {
        if (in_array($m['id'], $done, true)) {
            $log("  [done]    {$m['id']}");
            continue;
        }
        $pending[] = $m['id'];
        $problems = ($m['preflight'])($pdo);
        if ($problems) {
            $blocked = true;
            $log("  [BLOCKED] {$m['id']}: {$m['title']}");
            foreach ($problems as $p) {
                $log("            - $p");
            }
            if (!$dryRun) {
                break;
            }
            continue;
        }
        if ($dryRun) {
            $log("  [pending] {$m['id']}: {$m['title']}");
            continue;
        }
        $log("  [apply]   {$m['id']}: {$m['title']}");
        ($m['apply'])($pdo);
        $pdo->prepare('INSERT IGNORE INTO schema_migrations (version) VALUES (?)')->execute([$m['id']]);
        $applied[] = $m['id'];
    }
    return ['applied' => $applied, 'pending' => $dryRun ? $pending : array_values(array_diff($pending, $applied)), 'blocked' => $blocked];
}
