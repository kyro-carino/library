<?php

declare(strict_types=1);

require __DIR__ . '/../config.php';

$method = requestMethod();
startSecureSession();

function publicPatronAccount(array $row): array {
    return [
        'username' => (string)$row['username'],
        'displayName' => (string)$row['display_name'],
        'email' => (string)$row['email'],
        'patronId' => $row['patron_id'] !== null ? (string)$row['patron_id'] : null,
    ];
}

function patronSessionIsValid(PDO $pdo, ?array $sessionUser): ?array {
    if (!$sessionUser || ($sessionUser['role'] ?? '') !== 'patron') {
        return null;
    }
    $stmt = $pdo->prepare('SELECT * FROM auth_users WHERE id = ?');
    $stmt->execute([(int)$sessionUser['id']]);
    $row = $stmt->fetch();
    if (!$row || $row['role'] !== 'patron' || $row['status'] !== 'Active'
        || !hash_equals(passwordVersion((string)$row['password_hash']), (string)($sessionUser['pwv'] ?? ''))) {
        logoutUser();
        return null;
    }
    return $row;
}

if ($method === 'GET') {
    $row = patronSessionIsValid($pdo, currentUser());
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }
    sendResponse(['authenticated' => (bool)$row, 'user' => $row ? publicPatronAccount($row) : null]);
}

if ($method !== 'POST') {
    sendError('Method not allowed.', 405);
}

$data = getJsonBody();
$action = (string)($data['action'] ?? 'login');

if ($action === 'logout') {
    $who = currentUser();
    if (!$who || ($who['role'] ?? '') !== 'patron') {
        sendError('No patron session is active.', 401);
    }
    auditLogQuiet($pdo, 'auth.logout', 'account', (string)$who['id']);
    logoutUser();
    sendResponse(['message' => 'Signed out.']);
}

if ($action === 'signup') {
    $errors = [];
    $username = strtolower(ltrim(trim((string)($data['username'] ?? '')), '@'));
    $email = normalizeEmail((string)($data['email'] ?? ''));
    $studentNumber = trim((string)($data['studentNumber'] ?? ''));
    $firstName = validateStringLength($data['firstName'] ?? '', 1, 100, 'firstName', $errors);
    $lastName = validateStringLength($data['lastName'] ?? '', 1, 100, 'lastName', $errors);
    $password = (string)($data['password'] ?? '');
    $program = trim((string)($data['program'] ?? ''));
    $yearLevel = filter_var($data['yearLevel'] ?? null, FILTER_VALIDATE_INT);

    if (!in_array($program, READER_PROGRAMS, true)) {
        $errors['program'] = 'Choose your program.';
    }
    if ($yearLevel === false || $yearLevel < 1 || $yearLevel > 5) {
        $errors['yearLevel'] = 'Choose your year level.';
    }
    if (!preg_match('/^[a-zA-Z0-9._-]{3,24}$/', $username)) {
        $errors['username'] = 'Use 3–24 letters, numbers, dots or dashes.';
    }
    if (!validateEmail($email)) {
        $errors['email'] = 'Enter a valid email address.';
    }
    if (!validStudentNumber($studentNumber)) {
        $errors['studentNumber'] = 'Enter a valid student number (2–50 letters, numbers, dots, slashes or dashes).';
    }
    if (strlen($password) < 12) {
        $errors['password'] = 'Use at least 12 characters.';
    } elseif (strlen($password) > 72) {
        $errors['password'] = 'Use at most 72 characters.';
    } elseif ($why = passwordPolicyError($password, [$username, $email])) {
        $errors['password'] = $why;
    }
    if ($errors) {
        sendValidationError($errors);
    }

    $throttle = throttleKeys('signup', $email);
    if (!$IS_DEVELOPMENT) {
        assertNotThrottled($throttle);
    }

    $emailLocks = acquireEmailLocks($pdo, [$email]);
    $existing = $pdo->prepare('SELECT 1 FROM auth_users WHERE username = ? LIMIT 1');
    $existing->execute([$username]);
    if ($existing->fetchColumn()) {
        sendError('That username or email is already registered.', 409);
    }
    if (emailInUse($pdo, $email)) {
        sendError('That email is already registered.', 409);
    }
    $student = $pdo->prepare('SELECT 1 FROM users WHERE student_number = ? LIMIT 1');
    $student->execute([$studentNumber]);
    if ($student->fetchColumn()) {
        sendValidationError(['studentNumber' => 'That student number is already registered.']);
    }

    $displayName = trim($firstName . ' ' . $lastName);
    $pdo->beginTransaction();
    try {
        $patronId = nextUserId($pdo);
        $pdo->prepare('INSERT INTO users (id, last_name, first_name, middle_initial, program, year_level, student_number, contact, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$patronId, $lastName, $firstName, '', $program, $yearLevel, $studentNumber, $email, 'Active']);
        $pdo->prepare('INSERT INTO auth_users (username, email, password_hash, display_name, role, status, patron_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
            ->execute([$username, $email, password_hash($password, PASSWORD_DEFAULT), $displayName, 'patron', 'Active', $patronId]);
        $accountId = (int)$pdo->lastInsertId();
        auditLogQuiet($pdo, 'auth.signup', 'account', (string)$accountId, ['patronId' => $patronId], [null, 'signup']);
        $pdo->commit();
        releaseEmailLocks($pdo, $emailLocks);
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if ($e instanceof PDOException && isDuplicateKeyError($e)) {
            if (isDuplicateKeyError($e, 'uk_users_student_number')) {
                sendValidationError(['studentNumber' => 'That student number is already registered.']);
            }
            sendError('That username or email is already registered.', 409);
        }
        throw $e;
    }

    $row = loadAuthUser($pdo, $accountId);
    loginUser($pdo, $row);
    if (!$IS_DEVELOPMENT) {
        clearThrottle($throttle);
    }
    sendResponse(['message' => 'Account created.', 'user' => publicPatronAccount($row)], 201);
}

if ($action === 'login') {
    $errors = requireFields($data, ['username', 'password']);
    if ($errors) {
        sendValidationError($errors);
    }
    $identity = trim((string)$data['username']);
    $throttle = throttleKeys('user_login', $identity);
    if (!$IS_DEVELOPMENT) {
        assertNotThrottled($throttle);
    }
    $stmt = $pdo->prepare('SELECT * FROM auth_users WHERE username = ? OR email = ? LIMIT 1');
    $stmt->execute([$identity, $identity]);
    $row = $stmt->fetch();
    $valid = password_verify((string)$data['password'], $row['password_hash'] ?? DUMMY_PASSWORD_HASH);
    if (!$row || !$valid || $row['role'] !== 'patron') {
        if (!$IS_DEVELOPMENT) {
            recordThrottleFailure($throttle);
        }
        sendError('Invalid username or password.', 401);
    }
    if ($row['status'] !== 'Active') {
        sendError('This account is inactive.', 403);
    }
    if (!$IS_DEVELOPMENT) {
        clearThrottle($throttle);
    }
    loginUser($pdo, $row);
    sendResponse(['message' => 'Signed in.', 'user' => publicPatronAccount(loadAuthUser($pdo, (int)$row['id']))]);
}

sendError('Unknown action.', 400);