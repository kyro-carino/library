<?php
require __DIR__ . '/../config.php';

$method = requestMethod();
$user = requireAuth();

if ($method === 'GET') {
    $row = loadAuthUser($pdo, (int)$user['id']);
    if (!$row) {
        sendError('Account not found', 404);
    }
    sendResponse(['account' => authPublicPayload($row)]);
}

if ($method === 'PUT' || $method === 'POST') {
    $data = getJsonBody();
    $row = loadAuthUser($pdo, (int)$user['id']);
    if (!$row) {
        sendError('Account not found', 404);
    }

    $errors = [];
    $fields = [];
    $params = [];
    $emailLocks = [];
    $email = null;

    if (array_key_exists('displayName', $data)) {
        $name = validateStringLength($data['displayName'], 2, 255, 'displayName', $errors);
        if (!$errors) {
            $fields[] = 'display_name = ?';
            $params[] = $name;
        }
    }
    if (array_key_exists('username', $data)) {
        $username = strtolower(ltrim(trim((string)$data['username']), '@'));
        if (!preg_match('/^[a-zA-Z0-9._-]{3,24}$/', $username)) {
            $errors['username'] = 'Username must be 3–24 letters, numbers, dots or dashes.';
        } else {
            $dup = $pdo->prepare('SELECT id FROM auth_users WHERE username = ? AND id <> ?');
            $dup->execute([$username, $row['id']]);
            if ($dup->fetch()) {
                $errors['username'] = 'That username is already in use.';
            } else {
                $fields[] = 'username = ?';
                $params[] = $username;
            }
        }
    }
    if (array_key_exists('email', $data)) {
        $email = normalizeEmail((string)$data['email']);
        if (!validateEmail($email)) {
            $errors['email'] = 'Enter a valid email.';
        } else {
            $emailLocks = acquireEmailLocks($pdo, [$email]);
            $patronId = $row['patron_id'] !== null ? (string)$row['patron_id'] : null;
            if (emailInUse($pdo, $email, $patronId, (int)$row['id'])) {
                $errors['email'] = 'That email is already in use.';
            } else {
                $fields[] = 'email = ?';
                $params[] = $email;
            }
        }
    }
    if (array_key_exists('avatarDataUrl', $data)) {
        $avatar = validateAvatarDataUrl($data['avatarDataUrl']);
        $fields[] = 'avatar_data_url = ?';
        $params[] = $avatar;
    }
    if (array_key_exists('avatarPreset', $data)) {
        $preset = $data['avatarPreset'] === '' || $data['avatarPreset'] === null ? null : trim((string)$data['avatarPreset']);
        if ($preset !== null && !preg_match('/^#[0-9A-Fa-f]{6}$/', $preset)) {
            $errors['avatarPreset'] = 'Avatar colour must be a hex colour such as #237A43.';
        } else {
            $fields[] = 'avatar_preset = ?';
            $params[] = $preset;
        }
    }

    if ($errors) {
        sendValidationError($errors);
    }
    if (empty($fields)) {
        sendError('No fields to update', 400);
    }

    $params[] = $row['id'];
    try {
        $pdo->beginTransaction();
        $pdo->prepare('UPDATE auth_users SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);
        if ($email !== null && $row['patron_id'] !== null) {
            $pdo->prepare('UPDATE users SET contact = ? WHERE id = ? AND deleted_at IS NULL')->execute([$email, $row['patron_id']]);
        }
        $pdo->commit();
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        // Lost a race with another request between the duplicate check above and this UPDATE.
        if (isDuplicateKeyError($e, 'email')) {
            sendValidationError(['email' => 'That email is already in use.']);
        }
        if (isDuplicateKeyError($e, 'uk_users_active_contact')) {
            sendValidationError(['email' => 'That email is already in use.']);
        }
        if (isDuplicateKeyError($e, 'username')) {
            sendValidationError(['username' => 'That username is already in use.']);
        }
        throw $e;
    }
    releaseEmailLocks($pdo, $emailLocks);
    $fresh = loadAuthUser($pdo, (int)$row['id']);
    $accountDetails = ['fields' => auditFieldNames($fields)];
    foreach (['username', 'email'] as $k) {
        if ($row[$k] !== $fresh[$k]) {
            $accountDetails[$k] = [$row[$k], $fresh[$k]];
        }
    }
    auditLogQuiet($pdo, 'account.update', 'account', (string)$row['id'], $accountDetails);
    $_SESSION['user'] = sessionFromRow($fresh);
    sendResponse([
        'message' => 'Account updated successfully',
        'account' => authPublicPayload($fresh),
    ]);
}

sendError('Method not allowed', 405);
