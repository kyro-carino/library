<?php

declare(strict_types=1);

// Usage (project folder):  php tools/create_admin.php
// Creates the FIRST administrator account on a fresh database. Works in production; refuses to run
// if any admin/librarian already exists. Optional env vars (avoid shell history): NEW_ADMIN_USERNAME,
// NEW_ADMIN_EMAIL, NEW_ADMIN_NAME, NEW_ADMIN_PASSWORD. Run after `php tools/migrate.php --yes`.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/migrations.php';

if (!migrationsApplied($pdo)) {
    fwrite(STDERR, "Run `php tools/migrate.php --yes` first.\n");
    exit(1);
}
if (librarianCount($pdo) > 0) {
    fwrite(STDERR, "An administrator already exists. Nothing was changed.\n");
    exit(1);
}

$ask = static function (string $envKey, string $label, bool $secret = false): string {
    $v = getenv($envKey);
    if ($v !== false && $v !== '') {
        return (string)$v;
    }
    fwrite(STDOUT, $label . ': ');
    $hide = $secret && DIRECTORY_SEPARATOR === '/';
    if ($hide) {
        shell_exec('stty -echo');
    }
    $line = fgets(STDIN);
    if ($hide) {
        shell_exec('stty echo');
        fwrite(STDOUT, "\n");
    } elseif ($secret) {
        fwrite(STDOUT, "(input is visible on this system; clear your terminal afterwards)\n");
    }
    return trim((string)$line);
};

$username = strtolower(ltrim($ask('NEW_ADMIN_USERNAME', 'Username'), '@'));
$email = normalizeEmail($ask('NEW_ADMIN_EMAIL', 'Email'));
$display = $ask('NEW_ADMIN_NAME', 'Display name');
$password = $ask('NEW_ADMIN_PASSWORD', 'Password (12-72 chars)', true);

$errors = [];
if (!preg_match('/^[a-zA-Z0-9._-]{3,24}$/', $username)) {
    $errors[] = 'Username must be 3-24 letters, numbers, dots or dashes.';
}
if (!validateEmail($email)) {
    $errors[] = 'Enter a valid email.';
}
if (mb_strlen($display) < 2) {
    $errors[] = 'Display name must be at least 2 characters.';
}
if (strlen($password) < 12 || strlen($password) > 72) {
    $errors[] = 'Password must be 12-72 characters.';
} elseif ($why = passwordPolicyError($password, [$username, $email])) {
    $errors[] = $why;
}
if ($errors) {
    fwrite(STDERR, implode("\n", $errors) . "\nNothing was changed.\n");
    exit(1);
}

$emailLocks = acquireEmailLocks($pdo, [$email]);
if (emailInUse($pdo, $email)) {
    fwrite(STDERR, "That email is already in use by a patron or account. Nothing was changed.\n");
    exit(1);
}

$pdo->query("SELECT GET_LOCK('feu_library_setup', 5)");
try {
    if (librarianCount($pdo) > 0) {
        fwrite(STDERR, "An administrator already exists. Nothing was changed.\n");
        exit(1);
    }
    $pdo->prepare('INSERT INTO auth_users (username, email, password_hash, display_name, role, status) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([$username, $email, password_hash($password, PASSWORD_DEFAULT), $display, 'admin', 'Active']);
    fwrite(STDOUT, "Administrator '{$username}' created.\n");
} finally {
    $pdo->query("SELECT RELEASE_LOCK('feu_library_setup')");
}
