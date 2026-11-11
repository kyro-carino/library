<?php

declare(strict_types=1);

// Usage: php tools/seed_admin.php
// Development only. Creates the 'admin' account from DEV_ADMIN_PASSWORD, and ONLY when no staff account exists.
// It never updates or overwrites an existing account. Forgotten password: php tools/reset_password.php <username>

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../includes/bootstrap.php';

if (strtolower((string)$APP_ENV) !== 'development') {
    fwrite(STDERR, "Refusing to seed unless APP_ENV=development. Use tools/create_admin.php.\n");
    exit(1);
}
require_once __DIR__ . '/../includes/dev_seed.php';

try {
    $password = developmentAdminPassword();
} catch (RuntimeException $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
if ($password === null) {
    fwrite(STDERR, "Set DEV_ADMIN_PASSWORD in the local .env file first.\n");
    exit(1);
}

$pdo->query("SELECT GET_LOCK('feu_library_setup', 5)");
try {
    if (librarianCount($pdo) > 0) {
        fwrite(STDERR, "A staff account already exists. Nothing was changed.\n");
        exit(1);
    }
    $email = normalizeEmail(DEV_ADMIN_EMAIL);
    $emailLocks = acquireEmailLocks($pdo, [$email]);
    if (emailInUse($pdo, $email)) {
        fwrite(STDERR, "The development admin email is already in use by a patron. Nothing was changed.\n");
        exit(1);
    }
    $pdo->prepare("INSERT INTO auth_users (username, email, password_hash, display_name, role, status) VALUES (?, ?, ?, ?, 'admin', 'Active')")
        ->execute([DEV_ADMIN_USERNAME, $email, password_hash($password, PASSWORD_DEFAULT), DEV_ADMIN_DISPLAY]);
    auditLogQuiet($pdo, 'auth.account_added', 'account', (string)$pdo->lastInsertId(), ['username' => DEV_ADMIN_USERNAME, 'via' => 'seed_admin'], [null, 'cli']);
    fwrite(STDOUT, "Development administrator '" . DEV_ADMIN_USERNAME . "' created.\n");
} catch (PDOException $e) {
    if (isDuplicateKeyError($e)) {
        fwrite(STDERR, "The username or email is already in use. Nothing was changed.\n");
        exit(1);
    }
    throw $e;
} finally {
    $pdo->query("SELECT RELEASE_LOCK('feu_library_setup')");
}
