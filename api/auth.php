<?php
require __DIR__ . '/../config.php';

$method = requestMethod();
startSecureSession();

function findAuthByUsername(PDO $pdo, string $username): ?array {
    $stmt = $pdo->prepare('SELECT * FROM auth_users WHERE username = ? OR email = ? LIMIT 1');
    $stmt->execute([$username, $username]);
    $row = $stmt->fetch();
    return $row ?: null;
}

if ($method === 'GET') {
    $action = getQueryParam('action', 'me');
    if ($action === 'status') {
        $cu = currentUser();
        if ($cu) {
            $chk = $pdo->prepare('SELECT * FROM auth_users WHERE id = ?');
            $chk->execute([(int)$cu['id']]);
            $row = $chk->fetch();
            if (!$row || $row['status'] !== 'Active' || !in_array((string)$row['role'], staffRoles(), true)
                || !hash_equals(passwordVersion((string)$row['password_hash']), (string)($cu['pwv'] ?? ''))) {
                logoutUser();
                $cu = null;
            }
        }
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        // Whether first-run setup is open is deliberately not advertised to anonymous callers.
        sendResponse([
            'authenticated' => (bool)$cu,
            'user' => $cu ? authPublicPayload($row) : null,
        ]);
    }
    $user = requireAuth();
    $row = loadAuthUser($pdo, (int)$user['id']);
    sendResponse(['user' => authPublicPayload($row), 'account' => authPublicPayload($row)]);
}

if ($method !== 'POST') {
    sendError('Method not allowed', 405);
}

$data = getJsonBody();
$action = $data['action'] ?? getQueryParam('action', 'login');

if ($action === 'setup') {
    // First-run administrator creation over HTTP is OFF unless SETUP_TOKEN (>= 24 chars) is set in the
    // environment, and then it requires that token. Preferred route: php tools/create_admin.php.
    if (librarianCount($pdo) > 0) {
        sendError('An administrator account already exists.', 409);
    }
    $expected = (string)(getenv('SETUP_TOKEN') ?: '');
    if (strlen($expected) < 24) {
        sendError('Web setup is disabled. Create the administrator with: php tools/create_admin.php', 403);
    }
    $throttle = throttleKeys('setup', 'setup');
    assertNotThrottled($throttle);
    if (!hash_equals($expected, (string)($data['setupToken'] ?? ''))) {
        recordThrottleFailure($throttle);
        sendError('Invalid setup token.', 403);
    }
    // Serialize concurrent first-run requests; the lock is released when the connection closes.
    $locked = (int)$pdo->query("SELECT GET_LOCK('feu_library_setup', 5)")->fetchColumn();
    if (!$locked) {
        sendError('Setup is already in progress. Try again.', 409);
    }
    if (librarianCount($pdo) > 0) {
        sendError('An administrator account already exists.', 409);
    }
    $errors = requireFields($data, ['username', 'email', 'password', 'displayName']);
    $username = strtolower(ltrim(trim((string)($data['username'] ?? '')), '@'));
    $email = normalizeEmail((string)($data['email'] ?? ''));
    $password = (string)($data['password'] ?? '');
    $display = trim((string)($data['displayName'] ?? ''));
    if ($username && !preg_match('/^[a-zA-Z0-9._-]{3,24}$/', $username)) {
        $errors['username'] = 'Username must be 3–24 letters, numbers, dots or dashes.';
    }
    if ($email && !validateEmail($email)) {
        $errors['email'] = 'Enter a valid email.';
    }
    if (strlen($password) < 10) {
        $errors['password'] = 'Use at least 10 characters.';
    } elseif (strlen($password) > 72) {
        $errors['password'] = 'Use at most 72 characters.';
    } elseif ($why = passwordPolicyError($password, [$username, $email])) {
        $errors['password'] = $why;
    }
    if (mb_strlen($display) < 2) {
        $errors['displayName'] = 'Enter a display name.';
    }
    if ($errors) {
        sendValidationError($errors);
    }
    $emailLocks = acquireEmailLocks($pdo, [$email]);
    if (emailInUse($pdo, $email)) {
        sendValidationError(['email' => 'That email is already in use.']);
    }
    $hash = password_hash($password, PASSWORD_DEFAULT);
    $stmt = $pdo->prepare('
        INSERT INTO auth_users (username, email, password_hash, display_name, role, status)
        VALUES (?, ?, ?, ?, ?, ?)
    ');
    try {
        $stmt->execute([$username, $email, $hash, $display, 'admin', 'Active']);
    } catch (PDOException $e) {
        if (isDuplicateKeyError($e)) {
            sendError('An administrator account already exists.', 409);
        }
        throw $e;
    }
    $row = loadAuthUser($pdo, (int)$pdo->lastInsertId());
    loginUser($pdo, $row);
    auditLogQuiet($pdo, 'auth.setup', 'account', (string)$row['id'], ['username' => $username]);
    sendResponse([
        'message' => 'Administrator account created.',
        'user' => authPublicPayload($row),
        'account' => authPublicPayload($row),
    ], 201);
}

if ($action === 'login') {
    $errors = requireFields($data, ['username', 'password']);
    if ($errors) {
        sendValidationError($errors);
    }
    $username = trim((string)$data['username']);
    $throttle = throttleKeys('login', $username);
    assertNotThrottled($throttle);

    $row = findAuthByUsername($pdo, $username);
    // Always run one hash verification so unknown usernames take the same time.
    $valid = password_verify((string)$data['password'], $row['password_hash'] ?? DUMMY_PASSWORD_HASH);
    // The typed username/password are deliberately NOT logged (people sometimes type one into the other).
    if (!$row || !$valid) {
        recordThrottleFailure($throttle);
        auditLogQuiet($pdo, 'auth.login_failed', null, null, ['accountExists' => (bool)$row], [null, null]);
        sendError('Invalid username or password.', 401);
    }
    if ($row['status'] !== 'Active') {
        auditLogQuiet($pdo, 'auth.login_denied', 'account', (string)$row['id'], ['reason' => 'inactive'], [null, null]);
        sendError('This account is inactive.', 403);
    }
    if (!in_array((string)$row['role'], staffRoles(), true)) {
        auditLogQuiet($pdo, 'auth.login_denied', 'account', (string)$row['id'], ['reason' => 'not_staff'], [null, null]);
        sendError('This portal is for administrators only.', 403);
    }
    clearThrottle($throttle);
    loginUser($pdo, $row);
    auditLogQuiet($pdo, 'auth.login', 'account', (string)$row['id']);
    $fresh = loadAuthUser($pdo, (int)$row['id']);
    sendResponse([
        'message' => 'Signed in.',
        'user' => authPublicPayload($fresh),
        'account' => authPublicPayload($fresh),
    ]);
}

if ($action === 'logout') {
    if ($who = currentUser()) {
        auditLogQuiet($pdo, 'auth.logout', 'account', (string)$who['id']);
    }
    logoutUser();
    sendResponse(['message' => 'Signed out.']);
}

if ($action === 'password') {
    $user = requireAuth();
    $errors = [];
    $current = (string)($data['currentPassword'] ?? '');
    $new = (string)($data['newPassword'] ?? '');
    $confirm = (string)($data['confirmPassword'] ?? $data['newPassword'] ?? '');
    if ($current === '') {
        $errors['currentPassword'] = 'Enter the current password.';
    }
    if (strlen($new) < 10) {
        $errors['newPassword'] = 'Use at least 10 characters.';
    } elseif (strlen($new) > 72) {
        $errors['newPassword'] = 'Use at most 72 characters.';
    } elseif ($new === $current) {
        $errors['newPassword'] = 'Choose a password different from the current one.';
    } elseif ($why = passwordPolicyError($new, [$user['username'] ?? '', $user['email'] ?? ''])) {
        $errors['newPassword'] = $why;
    }
    if ($new !== $confirm) {
        $errors['confirmPassword'] = 'Passwords do not match.';
    }
    if ($errors) {
        sendValidationError($errors);
    }
    $throttle = throttleKeys('password', (string)$user['id']);
    assertNotThrottled($throttle);
    $row = loadAuthUser($pdo, (int)$user['id']);
    if (!$row || !password_verify($current, $row['password_hash'])) {
        recordThrottleFailure($throttle);
        auditLogQuiet($pdo, 'auth.password_failed', 'account', (string)$user['id']);
        sendError('Current password is incorrect.', 400);
    }
    clearThrottle($throttle);
    $newHash = password_hash($new, PASSWORD_DEFAULT);
    $pdo->prepare('UPDATE auth_users SET password_hash = ? WHERE id = ?')->execute([$newHash, $row['id']]);
    session_regenerate_id(true);
    // Keep THIS session valid; every other session for the account now fails requireAuth().
    $_SESSION['user']['pwv'] = passwordVersion($newHash);
    auditLogQuiet($pdo, 'auth.password_change', 'account', (string)$user['id']);
    sendResponse(['message' => 'Password updated successfully. Other signed-in devices were signed out.']);
}

sendError('Unknown action.', 400);
