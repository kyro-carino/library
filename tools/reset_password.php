<?php

declare(strict_types=1);

// Usage: php tools/reset_password.php <username>      (optional env NEW_PASSWORD)
// Resets ONLY the password of one existing staff account. Works in any environment.
// Role, status, username and email are untouched; all of that account's sessions end (the hash changes).

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
$username = strtolower(ltrim((string)($argv[1] ?? ''), '@'));
if ($username === '') {
    fwrite(STDERR, "Usage: php tools/reset_password.php <username>\n");
    exit(2);
}
$stmt = $pdo->prepare('SELECT id, username, email, role FROM auth_users WHERE username = ?');
$stmt->execute([$username]);
$row = $stmt->fetch();
if (!$row || !in_array($row['role'], staffRoles(), true)) {
    fwrite(STDERR, "No staff account with that username. Nothing was changed.\n");
    exit(1);
}

$password = getenv('NEW_PASSWORD');
if ($password === false || $password === '') {
    fwrite(STDOUT, 'New password (12-72 chars): ');
    $hide = DIRECTORY_SEPARATOR === '/';
    if ($hide) {
        shell_exec('stty -echo');
    }
    $password = trim((string)fgets(STDIN));
    if ($hide) {
        shell_exec('stty echo');
        fwrite(STDOUT, "\n");
    } else {
        fwrite(STDOUT, "(input is visible on this system; clear your terminal afterwards)\n");
    }
}
if (strlen($password) < 12 || strlen($password) > 72) {
    fwrite(STDERR, "Password must be 12-72 characters. Nothing was changed.\n");
    exit(1);
}
if ($why = passwordPolicyError($password, [$row['username'], $row['email']])) {
    fwrite(STDERR, $why . "\nNothing was changed.\n");
    exit(1);
}
$pdo->prepare('UPDATE auth_users SET password_hash = ? WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), $row['id']]);
auditLogQuiet($pdo, 'auth.password_reset', 'account', (string)$row['id'], ['via' => 'cli'], [null, 'cli']);
fwrite(STDOUT, "Password reset for '{$row['username']}'. Other sessions for this account were ended.\n");
