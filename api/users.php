<?php
require __DIR__ . '/../config.php';

$method = requestMethod();
$actor = requireAuth();

function userExists(PDO $pdo, string $id): bool {
    $stmt = $pdo->prepare('SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL');
    $stmt->execute([$id]);
    return (bool)$stmt->fetchColumn();
}

function fetchUsersPayload(PDO $pdo, $id = null, $status = null, $search = null, $limit = 50, $offset = 0, &$total = 0): array {
    $where = ['deleted_at IS NULL'];
    $params = [];
    if ($id) {
        $where[] = 'id = ?';
        $params[] = $id;
    }
    if ($status) {
        $where[] = 'status = ?';
        $params[] = $status;
    }
    $like = likeTerm($search);
    if ($like) {
        $where[] = '(first_name LIKE ? ESCAPE \'\\\\\' OR last_name LIKE ? ESCAPE \'\\\\\' OR contact LIKE ? ESCAPE \'\\\\\' OR program LIKE ? ESCAPE \'\\\\\' OR id LIKE ? ESCAPE \'\\\\\')';
        array_push($params, $like, $like, $like, $like, $like);
    }
    $whereSql = implode(' AND ', $where);
    $total = countRows($pdo, "SELECT COUNT(*) FROM users WHERE $whereSql", $params);

    $query = "SELECT * FROM users WHERE $whereSql ORDER BY last_name ASC, first_name ASC LIMIT ? OFFSET ?";
    $exec = $params;
    $exec[] = $limit;
    $exec[] = $offset;
    $stmt = $pdo->prepare($query);
    $stmt->execute($exec);
    $rows = $stmt->fetchAll();
    $borrowed = borrowedIdsByUser($pdo, array_column($rows, 'id'));
    $holds = patronHolds($pdo, array_column($rows, 'id'), todayManila());
    $requestedBooks = [];
    if ($rows) {
        $ids = array_column($rows, 'id');
        $in = implode(',', array_fill(0, count($ids), '?'));
        $requestStmt = $pdo->prepare("SELECT r.user_id, b.id, b.title, b.status FROM reservations r
            JOIN books b ON b.id = r.book_id AND b.deleted_at IS NULL
            WHERE r.status = 'active' AND r.user_id IN ($in) ORDER BY r.created_at, r.id");
        $requestStmt->execute($ids);
        foreach ($requestStmt->fetchAll() as $request) {
            $requestedBooks[$request['user_id']][] = [
                'id' => (string)$request['id'],
                'title' => (string)$request['title'],
                'available' => $request['status'] === 'Available',
            ];
        }
    }
    $users = [];
    foreach ($rows as $row) {
        $users[] = mapUser($row, $borrowed[$row['id']] ?? [], $holds[$row['id']] ?? [], $requestedBooks[$row['id']] ?? []);
    }
    return $users;
}

function updateUser(PDO $pdo, string $id, array $data): void {
    if (!userExists($pdo, $id)) {
        sendError('User not found', 404);
    }
    $errors = [];
    $fields = [];
    $params = [];
    $emailLocks = [];

    if (array_key_exists('lastName', $data) || array_key_exists('last_name', $data)) {
        $lastName = validateStringLength($data['lastName'] ?? $data['last_name'] ?? '', 1, 100, 'lastName', $errors);
        $fields[] = 'last_name = ?';
        $params[] = $lastName;
    }
    if (array_key_exists('firstName', $data) || array_key_exists('first_name', $data)) {
        $firstName = validateStringLength($data['firstName'] ?? $data['first_name'] ?? '', 1, 100, 'firstName', $errors);
        $fields[] = 'first_name = ?';
        $params[] = $firstName;
    }
    if (array_key_exists('middleInitial', $data) || array_key_exists('middle_initial', $data)) {
        $mi = strtoupper(substr(preg_replace('/[^A-Za-z]/', '', (string)($data['middleInitial'] ?? $data['middle_initial'] ?? '')), 0, 1));
        $fields[] = 'middle_initial = ?';
        $params[] = $mi;
    }
    if (array_key_exists('program', $data)) {
        $fields[] = 'program = ?';
        $params[] = validateStringLength($data['program'], 0, 100, 'program', $errors, false) ?: null;
    }
    if (array_key_exists('yearLevel', $data) || array_key_exists('year_level', $data)) {
        $year = $data['yearLevel'] ?? $data['year_level'];
        if ($year === '' || $year === null) {
            $fields[] = 'year_level = ?';
            $params[] = null;
        } else {
            $y = (int)$year;
            if ($y < 1 || $y > 5) {
                $errors['yearLevel'] = 'Year level must be between 1 and 5.';
            }
            $fields[] = 'year_level = ?';
            $params[] = $y;
        }
    }
    if (array_key_exists('studentNumber', $data) || array_key_exists('student_number', $data)) {
        $studentNumber = trim((string)($data['studentNumber'] ?? $data['student_number'] ?? ''));
        if ($studentNumber !== '' && !validStudentNumber($studentNumber)) {
            $errors['studentNumber'] = 'Use 2–50 letters, numbers, dots, slashes or dashes.';
        } else {
            $studentNumber = $studentNumber === '' ? null : $studentNumber;
            $dup = $pdo->prepare('SELECT id FROM users WHERE student_number = ? AND id <> ? LIMIT 1');
            $dup->execute([$studentNumber, $id]);
            if ($studentNumber !== null && $dup->fetchColumn()) {
                $errors['studentNumber'] = 'That student number is already registered.';
            } else {
                $fields[] = 'student_number = ?';
                $params[] = $studentNumber;
            }
        }
    }
    if (array_key_exists('contact', $data)) {
        $contact = normalizeEmail((string)$data['contact']);
        if (!validateEmail($contact)) {
            $errors['contact'] = 'Contact must be a valid email address.';
        } else {
            $emailLocks = acquireEmailLocks($pdo, [$contact]);
            if (emailInUse($pdo, $contact, $id)) {
                $errors['contact'] = 'That email is already registered.';
            } else {
                $fields[] = 'contact = ?';
                $params[] = $contact;
            }
        }
    }
    if (array_key_exists('status', $data)) {
        $status = validateEnum($data['status'], USER_STATUSES, 'status', $errors);
        if ($status) {
            $fields[] = 'status = ?';
            $params[] = $status;
        }
    }

    if ($errors) {
        sendValidationError($errors);
    }
    if (empty($fields)) {
        sendError('No fields to update', 400);
    }

    $params[] = $id;
    $pdo->beginTransaction();
    try {
        $pdo->prepare('UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = ? AND deleted_at IS NULL')->execute($params);
        if (array_key_exists('contact', $data)) {
            $pdo->prepare('UPDATE auth_users SET email = ? WHERE patron_id = ?')->execute([$contact, $id]);
        }
        $pdo->commit();
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        if (isDuplicateKeyError($e, 'uk_users_active_contact') || isDuplicateKeyError($e, 'email')) {
            sendValidationError(['contact' => 'That email is already registered.']);
        }
        if (isDuplicateKeyError($e, 'uk_users_student_number')) {
            sendValidationError(['studentNumber' => 'That student number is already registered.']);
        }
        throw $e;
    }
    releaseEmailLocks($pdo, $emailLocks);
    auditLogQuiet($pdo, 'user.update', 'user', $id, ['fields' => auditFieldNames($fields)]);
    $total = 0;
    $users = fetchUsersPayload($pdo, $id, null, null, 1, 0, $total);
    sendResponse(['message' => 'User updated successfully', 'user' => $users[0]]);
}

if ($method === 'GET') {
    if (!isLibrarian($actor) && getQueryParam('id') && getQueryParam('id') !== ($actor['patronId'] ?? '')) {
        requireLibrarian();
    }
    if (!isLibrarian($actor) && !getQueryParam('id')) {
        requireLibrarian();
    }
    $id = getQueryParam('id');
    [$limit, $offset] = paginationParams(25, 200);
    $total = 0;
    $users = fetchUsersPayload($pdo, $id, getQueryParam('status'), getQueryParam('search'), $limit, $offset, $total);
    if ($id && empty($users)) {
        sendError('User not found', 404);
    }
    if ($id) {
        sendResponse(['user' => $users[0], 'users' => $users, 'total' => $total, 'limit' => $limit, 'offset' => $offset]);
    }
    sendResponse(['users' => $users, 'total' => $total, 'limit' => $limit, 'offset' => $offset]);
}

if ($method === 'PUT') {
    requireStaff($actor);
    $data = getJsonBody();
    $id = getQueryParam('id') ?: ($data['id'] ?? null);
    if (!$id) {
        sendError('User ID is required', 400);
    }
    updateUser($pdo, (string)$id, $data);
}

if ($method === 'POST') {
    requireStaff($actor);
    $data = getJsonBody();
    $errors = [];
    $lastName = validateStringLength($data['lastName'] ?? $data['last_name'] ?? '', 1, 100, 'lastName', $errors);
    $firstName = validateStringLength($data['firstName'] ?? $data['first_name'] ?? '', 1, 100, 'firstName', $errors);
    $middleInitial = strtoupper(substr(preg_replace('/[^A-Za-z]/', '', (string)($data['middleInitial'] ?? $data['middle_initial'] ?? '')), 0, 1));
    $program = validateStringLength($data['program'] ?? '', 0, 100, 'program', $errors, false);
    $studentNumber = trim((string)($data['studentNumber'] ?? $data['student_number'] ?? ''));
    if (!validStudentNumber($studentNumber)) {
        $errors['studentNumber'] = 'Student number is required (2–50 letters, numbers, dots, slashes or dashes).';
    } else {
        $dup = $pdo->prepare('SELECT id FROM users WHERE student_number = ? LIMIT 1');
        $dup->execute([$studentNumber]);
        if ($dup->fetchColumn()) $errors['studentNumber'] = 'That student number is already registered.';
    }
    $yearLevel = $data['yearLevel'] ?? $data['year_level'] ?? null;
    if ($yearLevel !== null && $yearLevel !== '') {
        $yearLevel = (int)$yearLevel;
        if ($yearLevel < 1 || $yearLevel > 5) {
            $errors['yearLevel'] = 'Year level must be between 1 and 5.';
        }
    } else {
        $yearLevel = null;
    }
    $contact = normalizeEmail((string)($data['contact'] ?? ''));
    if (!validateEmail($contact)) {
        $errors['contact'] = 'Contact must be a valid email address.';
    }
    $status = validateEnum($data['status'] ?? 'Active', USER_STATUSES, 'status', $errors);
    if ($errors) {
        sendValidationError($errors);
    }

    $emailLocks = acquireEmailLocks($pdo, [$contact]);
    if (emailInUse($pdo, $contact)) {
        sendValidationError(['contact' => 'That email is already registered.']);
    }

    $pdo->beginTransaction();
    try {
        $newId = nextUserId($pdo);
        $stmt = $pdo->prepare('
            INSERT INTO users (id, last_name, first_name, middle_initial, program, year_level, student_number, contact, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ');
        $stmt->execute([
            $newId,
            $lastName,
            $firstName,
            $middleInitial,
            $program === '' ? null : $program,
            $yearLevel,
            $studentNumber,
            $contact,
            $status,
        ]);
        auditLog($pdo, 'user.create', 'user', $newId, ['name' => formatUserName($lastName, $firstName, $middleInitial)]);
        $pdo->commit();
        releaseEmailLocks($pdo, $emailLocks);
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if ($e instanceof PDOException && isDuplicateKeyError($e, 'uk_users_active_contact')) {
            sendValidationError(['contact' => 'That email is already registered.']);
        }
        if ($e instanceof PDOException && isDuplicateKeyError($e, 'uk_users_student_number')) {
            sendValidationError(['studentNumber' => 'That student number is already registered.']);
        }
        throw $e;
    }

    $total = 0;
    $users = fetchUsersPayload($pdo, $newId, null, null, 1, 0, $total);
    sendResponse([
        'message' => 'User created successfully',
        'id' => $newId,
        'user' => $users[0],
    ], 201);
}

if ($method === 'DELETE') {
    requireStaff($actor);
    $id = getQueryParam('id');
    if (!$id) {
        sendError('User ID is required', 400);
    }
    // Lock the patron row first: an issue to this patron must wait, then sees the patron as deleted.
    $pdo->beginTransaction();
    try {
        $lock = $pdo->prepare('SELECT last_name, first_name, middle_initial, contact FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE');
        $lock->execute([(string)$id]);
        $target = $lock->fetch();
        if (!$target) {
            $pdo->rollBack();
            sendError('User not found', 404);
        }
        $emailLocks = acquireEmailLocks($pdo, [$target['contact'] ?? '']);
        $loan = $pdo->prepare("SELECT COUNT(*) FROM books WHERE borrowed_by = ? AND status IN ('Borrowed','Overdue') AND deleted_at IS NULL");
        $loan->execute([$id]);
        if ((int)$loan->fetchColumn() > 0) {
            $pdo->rollBack();
            sendError("Can't remove a patron with active loans", 400);
        }
        $pdo->prepare('UPDATE users SET deleted_at = NOW() WHERE id = ?')->execute([$id]);
        $pdo->prepare("UPDATE auth_users SET status = 'Inactive', email = CONCAT('deleted+', id, '@invalid.local') WHERE patron_id = ?")->execute([$id]);
        $cancel = $pdo->prepare("UPDATE reservations SET status = 'cancelled' WHERE user_id = ? AND status = 'active'");
        $cancel->execute([$id]);
        auditLog($pdo, 'user.delete', 'user', (string)$id, ['name' => formatUserName($target['last_name'], $target['first_name'], $target['middle_initial'] ?? ''), 'cancelledReservations' => $cancel->rowCount()]);
        $pdo->commit();
        releaseEmailLocks($pdo, $emailLocks ?? []);
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if ($e instanceof PDOException && in_array((int)($e->errorInfo[1] ?? 0), [1205, 1213], true)) {
            sendError('That record is busy. Please try again.', 409);
        }
        throw $e;
    }
    sendResponse(['message' => 'User deleted successfully']);
}

sendError('Method not allowed', 405);
