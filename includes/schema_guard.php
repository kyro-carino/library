<?php

declare(strict_types=1);

function columnExists(PDO $pdo, string $table, string $column): bool {
    $stmt = $pdo->prepare('
        SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
    ');
    $stmt->execute([$table, $column]);
    return (int)$stmt->fetchColumn() > 0;
}

function indexExists(PDO $pdo, string $table, string $index): bool {
    $stmt = $pdo->prepare('
        SELECT COUNT(*) FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
    ');
    $stmt->execute([$table, $index]);
    return (int)$stmt->fetchColumn() > 0;
}

/** Idempotent baseline: tables, columns, indexes, id counters, admin role enum. Run ONLY from tools/migrate.php. */
function ensureBaselineSchema(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS id_counters (
          name VARCHAR(32) PRIMARY KEY,
          next_value INT NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS auth_users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(100) NOT NULL UNIQUE,
          email VARCHAR(255) NOT NULL UNIQUE,
          password_hash VARCHAR(255) NOT NULL,
          display_name VARCHAR(255) NOT NULL,
          role ENUM('admin','librarian','patron') NOT NULL DEFAULT 'patron',
          status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
          patron_id VARCHAR(20) NULL,
          avatar_data_url LONGTEXT NULL,
          avatar_preset VARCHAR(50) NULL,
          last_login DATETIME NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_auth_patron (patron_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS reservations (
          id VARCHAR(20) PRIMARY KEY,
          book_id VARCHAR(20) NOT NULL,
          user_id VARCHAR(20) NOT NULL,
          status ENUM('active','cancelled','fulfilled') NOT NULL DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_res_book (book_id, status),
          INDEX idx_res_user (user_id, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    if (!columnExists($pdo, 'books', 'deleted_at')) {
        $pdo->exec('ALTER TABLE books ADD COLUMN deleted_at DATETIME NULL');
    }
    if (!columnExists($pdo, 'books', 'renewal_count')) {
        $pdo->exec('ALTER TABLE books ADD COLUMN renewal_count INT NOT NULL DEFAULT 0');
    }
    if (!columnExists($pdo, 'users', 'deleted_at')) {
        $pdo->exec('ALTER TABLE users ADD COLUMN deleted_at DATETIME NULL');
    }
    if (!columnExists($pdo, 'transactions', 'renewal_count')) {
        $pdo->exec('ALTER TABLE transactions ADD COLUMN renewal_count INT NOT NULL DEFAULT 0');
    }

    if (!indexExists($pdo, 'books', 'idx_books_category')) {
        $pdo->exec('CREATE INDEX idx_books_category ON books (category)');
    }
    if (!indexExists($pdo, 'books', 'idx_books_created')) {
        $pdo->exec('CREATE INDEX idx_books_created ON books (created_at)');
    }
    if (!indexExists($pdo, 'users', 'idx_users_name')) {
        $pdo->exec('CREATE INDEX idx_users_name ON users (last_name, first_name)');
    }
    if (!indexExists($pdo, 'users', 'idx_users_contact')) {
        $pdo->exec('CREATE INDEX idx_users_contact ON users (contact)');
    }
    if (!indexExists($pdo, 'transactions', 'idx_tx_book_status')) {
        $pdo->exec('CREATE INDEX idx_tx_book_status ON transactions (book_id, status)');
    }
    if (!indexExists($pdo, 'transactions', 'idx_tx_created')) {
        $pdo->exec('CREATE INDEX idx_tx_created ON transactions (created_at)');
    }

    $maxBook = (int)$pdo->query("SELECT COALESCE(MAX(CAST(SUBSTRING(id, 4) AS UNSIGNED)), 0) FROM books WHERE id LIKE 'BK-%'")->fetchColumn();
    $maxTx = (int)$pdo->query("SELECT COALESCE(MAX(CAST(SUBSTRING(id, 4) AS UNSIGNED)), 0) FROM transactions WHERE id LIKE 'TX-%'")->fetchColumn();
    $maxUser = (int)$pdo->query("SELECT COALESCE(MAX(CAST(SUBSTRING(id, 6) AS UNSIGNED)), 0) FROM users WHERE id LIKE '____-%'")->fetchColumn();
    $maxRes = 0;
    try {
        $maxRes = (int)$pdo->query("SELECT COALESCE(MAX(CAST(SUBSTRING(id, 4) AS UNSIGNED)), 0) FROM reservations WHERE id LIKE 'RV-%'")->fetchColumn();
    } catch (Throwable $e) {
        $maxRes = 0;
    }

    $upsert = $pdo->prepare('INSERT INTO id_counters (name, next_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE next_value = GREATEST(next_value, VALUES(next_value))');
    $upsert->execute(['books', $maxBook + 1]);
    $upsert->execute(['transactions', $maxTx + 1]);
    $upsert->execute(['users', $maxUser + 1]);
    $upsert->execute(['reservations', $maxRes + 1]);

    ensureAdminRoleEnum($pdo);
}

function ensureAdminRoleEnum(PDO $pdo): void {
    $stmt = $pdo->prepare('
        SELECT COLUMN_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
    ');
    $stmt->execute(['auth_users', 'role']);
    $type = (string)$stmt->fetchColumn();
    if ($type === '' || stripos($type, "'admin'") !== false) {
        return;
    }
    $pdo->exec("ALTER TABLE auth_users MODIFY COLUMN role ENUM('admin','librarian','patron') NOT NULL DEFAULT 'patron'");
}

/** Development-only sample CATALOG data. Never creates accounts; use tools/seed_admin.php or tools/create_admin.php. */
function ensureDevSeeds(PDO $pdo): void {
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    try {
        $needsCatalog = (int)$pdo->query("SELECT COUNT(*) FROM seed_meta WHERE name = 'dev_catalog_v1'")->fetchColumn() === 0;
    } catch (Throwable $e) {
        $needsCatalog = true;
    }
    if (!$needsCatalog) {
        return;
    }
    require_once __DIR__ . '/dev_seed.php';
    try {
        ensureDevCatalogSeed($pdo);
    } catch (Throwable $e) {
        error_log('[feu-library] catalog seed failed: ' . $e->getMessage());
    }
}