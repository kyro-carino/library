<?php

declare(strict_types=1);

/** A session can never outlive this, however active it is (idle limit is separate, 8h). */
const SESSION_ABSOLUTE_LIFETIME = 12 * 3600;

/** Short fingerprint of the stored password hash. Changes whenever the password changes. */
function passwordVersion(string $passwordHash): string {
    return substr(hash('sha256', $passwordHash), 0, 32);
}

function sessionAbsolutelyExpired(?int $created, int $now): bool {
    return $created !== null && ($now - $created) > SESSION_ABSOLUTE_LIFETIME;
}

/** Proxy IPs (comma separated, env TRUSTED_PROXIES) whose X-Forwarded-Proto header may be believed. */
function trustedProxies(): array {
    $v = (string)(getenv('TRUSTED_PROXIES') ?: '');
    return array_values(array_filter(array_map('trim', explode(',', $v)), 'strlen'));
}

/** True only for a genuine TLS request. X-Forwarded-Proto counts only from a trusted proxy. */
function isHttps(): bool {
    if (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off') {
        return true;
    }
    if ((int)($_SERVER['SERVER_PORT'] ?? 0) === 443) {
        return true;
    }
    $remote = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    if ($remote !== '' && in_array($remote, trustedProxies(), true)) {
        $first = strtolower(trim(explode(',', (string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))[0]));
        return $first === 'https';
    }
    return false;
}

function sessionCookiePath(): string {
    $script = str_replace('\\', '/', (string)($_SERVER['SCRIPT_NAME'] ?? '/'));
    if (preg_match('#^(.*?)/api/#', $script, $m)) {
        return $m[1] === '' ? '/' : $m[1];
    }
    $dir = rtrim(str_replace('\\', '/', dirname($script)), '/');
    return $dir === '' ? '/' : $dir;
}

/**
 * Staff (index.php) and readers (users.php) sign in on different pages but share the same API files, so each page
 * gets its own session cookie. With one shared cookie, signing in on the reader page replaced the staff login and
 * staff actions then failed with "You do not have permission". The page is recognised from the request's Referer.
 */
function sessionCookieName(): string {
    $page = basename((string)parse_url((string)($_SERVER['HTTP_REFERER'] ?? ''), PHP_URL_PATH));
    return strtolower($page) === 'users.php' ? 'FEULIBREADERSID' : 'FEULIBSESSID';
}

function startSecureSession(): void {
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $https = isHttps();

    session_name(sessionCookieName());
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => sessionCookiePath(),
        'secure' => $https,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    // Default gc_maxlifetime (24 min) would expire sessions before the 8h idle limit below.
    ini_set('session.gc_maxlifetime', (string)(8 * 3600));
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_start();

    $now = time();
    if (isset($_SESSION['_last_activity']) && ($now - (int)$_SESSION['_last_activity']) > 8 * 3600) {
        $_SESSION = [];
        session_destroy();
        session_start();
    }
    // Absolute lifetime: sessions created before this check existed are stamped on first sight.
    if (isset($_SESSION['user'])) {
        if (!isset($_SESSION['_created'])) {
            $_SESSION['_created'] = $now;
        } elseif (sessionAbsolutelyExpired((int)$_SESSION['_created'], $now)) {
            $_SESSION = [];
            session_destroy();
            session_start();
        }
    }
    $_SESSION['_last_activity'] = $now;
}

function currentUser(): ?array {
    startSecureSession();
    return $_SESSION['user'] ?? null;
}

function staffRoles(): array {
    return ['admin', 'librarian'];
}

function librarianCount(PDO $pdo): int {
    $stmt = $pdo->query("SELECT COUNT(*) FROM auth_users WHERE role IN ('admin', 'librarian')");
    return (int)$stmt->fetchColumn();
}

function requireAuth(array $roles = []): array {
    global $pdo;
    $user = currentUser();
    if (!$user) {
        sendError('Authentication required.', 401);
    }
    // Re-validate against the database so deactivation / role changes apply immediately.
    $stmt = $pdo->prepare('SELECT role, status, password_hash FROM auth_users WHERE id = ?');
    $stmt->execute([(int)$user['id']]);
    $row = $stmt->fetch();
    // A password change on any device invalidates every other session for that account.
    if (!$row || $row['status'] !== 'Active'
        || !hash_equals(passwordVersion((string)$row['password_hash']), (string)($user['pwv'] ?? ''))) {
        logoutUser();
        sendError('Your session has ended. Sign in again.', 401);
    }
    $changed = ($user['role'] ?? null) !== $row['role'] || ($user['status'] ?? null) !== $row['status'];
    $user['role'] = $row['role'];
    $user['status'] = $row['status'];
    if ($changed) {
        $_SESSION['user'] = $user;
    }
    if (!empty($roles) && !in_array($user['role'], $roles, true)) {
        sendError('You do not have permission to perform this action.', 403);
    }
    releaseSessionLockIfReadOnly();
    return $user;
}

/**
 * PHP keeps a file lock on the session from session_start() until the script ends, so parallel requests from
 * one browser queue up. Read-only requests never change the session, so let go of the lock right after auth.
 * (The in-memory $_SESSION stays readable; only writes after this point are not saved.)
 */
function releaseSessionLockIfReadOnly(): void {
    if (requestIsReadOnly() && session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }
}

/** GET/HEAD never change the session, so they may let go of its lock early. */
function requestIsReadOnly(): bool {
    $m = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    return $m === 'GET' || $m === 'HEAD';
}

/** Permission check for an already validated user (requireAuth() just re-read the role from the DB). */
function requireStaff(array $user): array {
    if (!isLibrarian($user)) {
        sendError('You do not have permission to perform this action.', 403);
    }
    return $user;
}

function requireLibrarian(): array {
    return requireAuth(staffRoles());
}

function isLibrarian(?array $user = null): bool {
    $user = $user ?? currentUser();
    return $user && in_array((string)($user['role'] ?? ''), staffRoles(), true);
}

function authPublicPayload(array $row): array {
    return mapAccount($row);
}

function loadAuthUser(PDO $pdo, int $id): ?array {
    $stmt = $pdo->prepare('SELECT * FROM auth_users WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function sessionFromRow(array $row): array {
    return [
        'id' => (int)$row['id'],
        'username' => $row['username'],
        'email' => $row['email'],
        'displayName' => $row['display_name'],
        'role' => $row['role'],
        'status' => $row['status'],
        'patronId' => $row['patron_id'],
        'avatarDataUrl' => null, // can be ~500 KB; kept out of the session. Read from the DB when needed.
        'avatarPreset' => $row['avatar_preset'],
        'lastLogin' => $row['last_login'],
        'pwv' => passwordVersion((string)$row['password_hash']),
    ];
}

function loginUser(PDO $pdo, array $row): array {
    startSecureSession();
    session_regenerate_id(true);
    $pdo->prepare('UPDATE auth_users SET last_login = NOW() WHERE id = ?')->execute([$row['id']]);
    $fresh = loadAuthUser($pdo, (int)$row['id']);
    $_SESSION['user'] = sessionFromRow($fresh);
    $_SESSION['_created'] = time();
    return $_SESSION['user'];
}

function logoutUser(): void {
    startSecureSession();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires' => time() - 42000,
            'path' => $params['path'] ?: '/',
            'secure' => (bool)$params['secure'],
            'httponly' => true,
            'samesite' => $params['samesite'] ?: 'Lax',
        ]);
    }
    session_destroy();
}

/* ---------- Login throttling (file-based; no schema change) ---------- */
const THROTTLE_WINDOW = 900;      // seconds
const THROTTLE_MAX_PER_USER = 5;  // failures per (ip, username) per window
const THROTTLE_MAX_PER_IP = 30;   // failures per ip per window
const DUMMY_PASSWORD_HASH = '$2y$10$fO9PxaH0ec3LhKgCE/Zjsea9ocf/8L.vcXBI9QRguHbXmqhIgtnmC'; // equalizes timing for unknown usernames

function throttleFile(string $key): string {
    return rtrim(sys_get_temp_dir(), '/\\') . DIRECTORY_SEPARATOR . 'feu_throttle_' . hash('sha256', $key) . '.json';
}

function throttleState(string $key): array {
    $file = throttleFile($key);
    $data = is_file($file) ? json_decode((string)@file_get_contents($file), true) : null;
    if (!is_array($data) || !isset($data['count'], $data['first']) || time() - (int)$data['first'] > THROTTLE_WINDOW) {
        return ['count' => 0, 'first' => time()];
    }
    return ['count' => (int)$data['count'], 'first' => (int)$data['first']];
}

function throttleKeys(string $scope, string $identity): array {
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'cli');
    return [
        ['key' => $scope . '|' . $ip . '|' . strtolower($identity), 'max' => THROTTLE_MAX_PER_USER],
        ['key' => $scope . '|' . $ip, 'max' => THROTTLE_MAX_PER_IP],
    ];
}

function assertNotThrottled(array $keys): void {
    foreach ($keys as $k) {
        $st = throttleState($k['key']);
        if ($st['count'] >= $k['max']) {
            $retry = max(1, THROTTLE_WINDOW - (time() - $st['first']));
            if (!headers_sent()) {
                header('Retry-After: ' . $retry);
            }
            sendError('Too many attempts. Try again in ' . (int)ceil($retry / 60) . ' minute(s).', 429, ['retryAfter' => $retry]);
        }
    }
}

function recordThrottleFailure(array $keys): void {
    foreach ($keys as $k) {
        $fh = @fopen(throttleFile($k['key']), 'c+');
        if (!$fh) {
            error_log('[feu-library] throttle store not writable');
            continue;
        }
        if (flock($fh, LOCK_EX)) {
            $data = json_decode((string)stream_get_contents($fh), true);
            if (!is_array($data) || !isset($data['count'], $data['first']) || time() - (int)$data['first'] > THROTTLE_WINDOW) {
                $data = ['count' => 0, 'first' => time()];
            }
            $data['count'] = (int)$data['count'] + 1;
            ftruncate($fh, 0);
            rewind($fh);
            fwrite($fh, json_encode($data));
            fflush($fh);
            flock($fh, LOCK_UN);
        }
        fclose($fh);
    }
    if (random_int(1, 100) === 1) {
        foreach (glob(rtrim(sys_get_temp_dir(), '/\\') . DIRECTORY_SEPARATOR . 'feu_throttle_*.json') ?: [] as $f) {
            if (time() - (int)@filemtime($f) > THROTTLE_WINDOW) {
                @unlink($f);
            }
        }
    }
}

function clearThrottle(array $keys): void {
    // Only the per-identity key resets on success; the per-IP counter keeps its history.
    @unlink(throttleFile($keys[0]['key']));
}

/* Reject cross-site state-changing requests (defence in depth on top of SameSite=Lax). */
function assertSameOrigin(): void {
    $method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if (in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
        return;
    }
    $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
    if ($origin === '') {
        return; // non-browser client or same-origin request without an Origin header
    }
    $allowed = (string)(getenv('CORS_ALLOW_ORIGIN') ?: '');
    if ($allowed !== '' && hash_equals($allowed, $origin)) {
        return;
    }
    $parts = parse_url($origin);
    $hostPort = strtolower((string)($parts['host'] ?? '')) . (isset($parts['port']) ? ':' . $parts['port'] : '');
    if ($hostPort === '' || $hostPort !== strtolower((string)($_SERVER['HTTP_HOST'] ?? ''))) {
        sendError('Cross-site request blocked.', 403);
    }
}