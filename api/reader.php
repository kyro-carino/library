<?php

declare(strict_types=1);

require __DIR__ . '/../config.php';

$method = requestMethod();
$actor = requireAuth(['patron']);
$patronId = (string)($actor['patronId'] ?? '');
if ($patronId === '') {
    sendError('Reader profile is not linked to a library record.', 403);
}
$patronStmt = $pdo->prepare('SELECT id, first_name, last_name, program, year_level, status FROM users WHERE id = ? AND deleted_at IS NULL');
$patronStmt->execute([$patronId]);
$patron = $patronStmt->fetch();
if (!$patron || $patron['status'] !== 'Active') {
    sendError('This reader account is unavailable. Please contact the library.', 403);
}

/** The reader's own profile: login account plus the linked patron record. Same shape for GET ?view=account and after an edit. */
function readerAccountPayload(PDO $pdo, int $authId, string $patronId): array {
    $auth = loadAuthUser($pdo, $authId);
    $stmt = $pdo->prepare('SELECT first_name, last_name, program, year_level FROM users WHERE id = ? AND deleted_at IS NULL');
    $stmt->execute([$patronId]);
    $p = $stmt->fetch() ?: [];
    return [
        'username' => (string)$auth['username'],
        'email' => (string)$auth['email'],
        'displayName' => (string)$auth['display_name'],
        'firstName' => (string)($p['first_name'] ?? ''),
        'lastName' => (string)($p['last_name'] ?? ''),
        'patronId' => $patronId,
        'program' => (string)($p['program'] ?? ''),
        'yearLevel' => ($p['year_level'] ?? null) === null ? null : (int)$p['year_level'],
    ];
}

function readerLoans(PDO $pdo, string $patronId): array {
    $stmt = $pdo->prepare("SELECT * FROM transactions WHERE user_id = ? AND type = 'issue' ORDER BY created_at DESC, id DESC LIMIT 200");
    $stmt->execute([$patronId]);
    return array_map('mapTransaction', $stmt->fetchAll());
}

function readerReservations(PDO $pdo, string $patronId): array {
    $stmt = $pdo->prepare("SELECT r.id, r.book_id, r.status, r.created_at, b.title, b.author, b.status AS book_status,
            (SELECT COUNT(*) FROM reservations r2
               JOIN users u2 ON u2.id = r2.user_id AND u2.deleted_at IS NULL AND u2.status = 'Active'
              WHERE r2.book_id = r.book_id AND r2.status = 'active'
                AND (r2.created_at < r.created_at OR (r2.created_at = r.created_at AND r2.id < r.id))) + 1 AS queue_pos
        FROM reservations r LEFT JOIN books b ON b.id = r.book_id WHERE r.user_id = ?
        ORDER BY r.created_at DESC, r.id DESC LIMIT 200");
    $stmt->execute([$patronId]);
    return array_map(static fn(array $row): array => [
        'id' => (string)$row['id'],
        'bookId' => (string)$row['book_id'],
        'title' => (string)($row['title'] ?? 'Removed book'),
        'author' => (string)($row['author'] ?? ''),
        'status' => (string)$row['status'],
        'createdAt' => (string)$row['created_at'],
        // Whether the title can be borrowed now (no due date or borrower is ever shown) and the reader's place in the queue.
        'bookStatus' => $row['book_status'] === null ? null : ($row['book_status'] === 'Available' ? 'Available' : 'On loan'),
        'queuePosition' => $row['status'] === 'active' ? (int)$row['queue_pos'] : null,
    ], $stmt->fetchAll());
}

if ($method === 'GET') {
    $view = (string)getQueryParam('view', 'overview');
    if ($view === 'books') {
        [$limit, $offset] = paginationParams(50, 100);
        $search = likeTerm(getQueryParam('search'));
        // Sort orders the Collection page may ask for. Anything else falls back to title A-Z.
        $sortOrders = [
            'title' => 'b.title ASC, b.id ASC',
            'title_desc' => 'b.title DESC, b.id ASC',
            'author' => 'b.author ASC, b.title ASC, b.id ASC',
            'year_new' => 'b.year IS NULL, b.year DESC, b.title ASC, b.id ASC',
            'year_old' => 'b.year IS NULL, b.year ASC, b.title ASC, b.id ASC',
            'available' => "(b.status <> 'Available'), b.title ASC, b.id ASC",
        ];
        $order = $sortOrders[(string)getQueryParam('sort', 'title')] ?? $sortOrders['title'];
        $where = ['deleted_at IS NULL'];
        $params = [];
        // Availability filter on the Collection page: "available" or "loan" (on loan). Anything else shows every book.
        $statusFilter = (string)getQueryParam('status', 'all');
        if ($statusFilter === 'available') {
            $where[] = "status = 'Available'";
        } elseif ($statusFilter === 'loan') {
            $where[] = "status <> 'Available'";
        }
        if ($search) {
            $where[] = '(title LIKE ? ESCAPE \'\\\\\' OR author LIKE ? ESCAPE \'\\\\\' OR category LIKE ? ESCAPE \'\\\\\')';
            array_push($params, $search, $search, $search);
        }
        $whereSql = implode(' AND ', $where);
        $total = countRows($pdo, 'SELECT COUNT(*) FROM books WHERE ' . $whereSql, $params);
        $stmt = $pdo->prepare("SELECT b.id, b.title, b.author, b.category, b.year, b.location, b.status, b.due_date, b.cover_url,
                EXISTS(SELECT 1 FROM reservations r WHERE r.book_id = b.id AND r.user_id = ? AND r.status = 'active') AS requested
            FROM books b WHERE $whereSql ORDER BY $order LIMIT ? OFFSET ?");
        $stmt->execute(array_merge([$patronId], $params, [$limit, $offset]));
        $books = array_map(static function (array $row): array {
            $status = effectiveLoanStatus((string)$row['status'], $row['due_date'] ?? null);
            if ($row['status'] === 'Available') $status = 'Available';
            $cover = (string)($row['cover_url'] ?? '');
            if ($cover !== '' && !preg_match('#^https://#i', $cover)) $cover = '';
            return [
                'id' => (string)$row['id'],
                'title' => (string)$row['title'],
                'author' => (string)$row['author'],
                'category' => (string)($row['category'] ?? 'General'),
                'year' => $row['year'] === null ? null : (int)$row['year'],
                'location' => (string)($row['location'] ?? ''),
                'status' => $status === 'Available' ? 'Available' : 'On loan',
                'cover' => $cover,
                'requested' => (bool)$row['requested'],
            ];
        }, $stmt->fetchAll());
        sendResponse(['books' => $books, 'total' => $total, 'limit' => $limit, 'offset' => $offset]);
    }

    if ($view === 'loans') {
        $loans = readerLoans($pdo, $patronId);
        sendResponse(['loans' => $loans]);
    }

    if ($view === 'reservations') {
        sendResponse(['reservations' => readerReservations($pdo, $patronId)]);
    }

    if ($view === 'account') {
        sendResponse(['account' => readerAccountPayload($pdo, (int)$actor['id'], $patronId)]);
    }

    if ($view !== 'overview') {
        sendError('Unknown reader view.', 400);
    }
    $loans = readerLoans($pdo, $patronId);
    $reservations = readerReservations($pdo, $patronId);
    $activeLoans = array_values(array_filter($loans, static fn(array $loan): bool => in_array($loan['status'], ['Borrowed', 'Overdue'], true) && empty($loan['returnDate'])));
    usort($activeLoans, static fn(array $a, array $b): int => strcmp((string)$a['dueDate'], (string)$b['dueDate']));
    $unpaidFines = array_sum(array_map(static fn(array $loan): float => empty($loan['finePaid']) ? (float)$loan['fine'] : 0.0, $loans));
    $today = new DateTimeImmutable('today', new DateTimeZone(APP_TIMEZONE));
    $dueSoonUntil = $today->modify('+3 days')->format('Y-m-d');
    $account = loadAuthUser($pdo, (int)$actor['id']);
    sendResponse([
        'account' => [
            'username' => (string)$account['username'],
            'email' => (string)$account['email'],
            'displayName' => (string)$account['display_name'],
            'patronId' => $patronId,
        ],
        'summary' => [
            'activeLoans' => count($activeLoans),
            'dueSoon' => count(array_filter($activeLoans, static fn(array $loan): bool => $loan['status'] === 'Borrowed' && $loan['dueDate'] >= $today->format('Y-m-d') && $loan['dueDate'] <= $dueSoonUntil)),
            'activeReservations' => count(array_filter($reservations, static fn(array $hold): bool => $hold['status'] === 'active')),
            'unpaidFines' => round($unpaidFines, 2),
        ],
        'loans' => $activeLoans,
        'reservations' => $reservations,
    ]);
}

if ($method !== 'POST') {
    sendError('Method not allowed.', 405);
}

$data = getJsonBody();
$action = (string)($data['action'] ?? '');
if ($action === 'cancel_reservation') {
    $reservationId = trim((string)($data['reservationId'] ?? ''));
    if ($reservationId === '' || strlen($reservationId) > 20) {
        sendValidationError(['reservationId' => 'Choose a reservation to cancel.']);
    }
    $pdo->beginTransaction();
    try {
        $lock = $pdo->prepare("SELECT book_id FROM reservations WHERE id = ? AND user_id = ? AND status = 'active' FOR UPDATE");
        $lock->execute([$reservationId, $patronId]);
        $reservation = $lock->fetch();
        if (!$reservation) {
            $pdo->rollBack();
            sendError('Active reservation not found.', 404);
        }
        $pdo->prepare("UPDATE reservations SET status = 'cancelled' WHERE id = ? AND user_id = ?")->execute([$reservationId, $patronId]);
        auditLog($pdo, 'reservation.cancel', 'book', (string)$reservation['book_id'], ['reservationId' => $reservationId, 'userId' => $patronId]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    sendResponse(['message' => 'Reservation cancelled.']);
}

if ($action === 'update_profile') {
    // A reader may edit their own name, username, email, program and year level. The Library ID and the
    // account role/status are never accepted from this request. Only fields that actually changed are written.
    $authRow = loadAuthUser($pdo, (int)$actor['id']);
    if (!$authRow) {
        sendError('Account not found.', 404);
    }
    $errors = [];
    $authSet = [];
    $authParams = [];
    $patronSet = [];
    $patronParams = [];
    $emailLocks = [];
    $first = (string)$patron['first_name'];
    $last = (string)$patron['last_name'];

    if (array_key_exists('firstName', $data)) {
        $v = validateStringLength($data['firstName'], 1, 100, 'firstName', $errors);
        if (!isset($errors['firstName']) && $v !== $first) {
            $first = $v;
            $patronSet[] = 'first_name = ?';
            $patronParams[] = $v;
        }
    }
    if (array_key_exists('lastName', $data)) {
        $v = validateStringLength($data['lastName'], 1, 100, 'lastName', $errors);
        if (!isset($errors['lastName']) && $v !== $last) {
            $last = $v;
            $patronSet[] = 'last_name = ?';
            $patronParams[] = $v;
        }
    }
    if ($first !== (string)$patron['first_name'] || $last !== (string)$patron['last_name']) {
        // Same rule as sign-up: the display name is "first last".
        $authSet[] = 'display_name = ?';
        $authParams[] = trim($first . ' ' . $last);
    }
    if (array_key_exists('username', $data)) {
        $username = strtolower(ltrim(trim((string)$data['username']), '@'));
        if (!preg_match('/^[a-zA-Z0-9._-]{3,24}$/', $username)) {
            $errors['username'] = 'Use 3–24 letters, numbers, dots or dashes.';
        } elseif ($username !== (string)$authRow['username']) {
            $dup = $pdo->prepare('SELECT 1 FROM auth_users WHERE username = ? AND id <> ? LIMIT 1');
            $dup->execute([$username, $authRow['id']]);
            if ($dup->fetchColumn()) {
                $errors['username'] = 'That username is already in use.';
            } else {
                $authSet[] = 'username = ?';
                $authParams[] = $username;
            }
        }
    }
    if (array_key_exists('email', $data)) {
        $email = normalizeEmail((string)$data['email']);
        if (!validateEmail($email)) {
            $errors['email'] = 'Enter a valid email address.';
        } elseif ($email !== normalizeEmail((string)$authRow['email'])) {
            $emailLocks = acquireEmailLocks($pdo, [$email]);
            if (emailInUse($pdo, $email, $patronId, (int)$authRow['id'])) {
                $errors['email'] = 'That email is already in use.';
            } else {
                $authSet[] = 'email = ?';
                $authParams[] = $email;
                $patronSet[] = 'contact = ?';
                $patronParams[] = $email;
            }
        }
    }
    if (array_key_exists('program', $data)) {
        $program = trim((string)$data['program']);
        // A program outside the list (a patron added by staff) may be kept as it is, but not newly chosen.
        if ($program !== (string)($patron['program'] ?? '')) {
            if (!in_array($program, READER_PROGRAMS, true)) {
                $errors['program'] = 'Choose your program.';
            } else {
                $patronSet[] = 'program = ?';
                $patronParams[] = $program;
            }
        }
    }
    if (array_key_exists('yearLevel', $data)) {
        $year = filter_var($data['yearLevel'], FILTER_VALIDATE_INT);
        if ($year === false || $year < 1 || $year > 5) {
            $errors['yearLevel'] = 'Choose your year level.';
        } elseif ($year !== ($patron['year_level'] === null ? null : (int)$patron['year_level'])) {
            $patronSet[] = 'year_level = ?';
            $patronParams[] = $year;
        }
    }

    if ($errors) {
        releaseEmailLocks($pdo, $emailLocks);
        sendValidationError($errors);
    }
    if (!$authSet && !$patronSet) {
        releaseEmailLocks($pdo, $emailLocks);
        sendResponse(['message' => 'No changes to save.', 'account' => readerAccountPayload($pdo, (int)$authRow['id'], $patronId)]);
    }

    $pdo->beginTransaction();
    try {
        if ($patronSet) {
            $pdo->prepare('UPDATE users SET ' . implode(', ', $patronSet) . ' WHERE id = ? AND deleted_at IS NULL')
                ->execute(array_merge($patronParams, [$patronId]));
        }
        if ($authSet) {
            $pdo->prepare('UPDATE auth_users SET ' . implode(', ', $authSet) . ' WHERE id = ?')
                ->execute(array_merge($authParams, [$authRow['id']]));
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        releaseEmailLocks($pdo, $emailLocks);
        // Lost a race with another request between the checks above and the UPDATE.
        if ($e instanceof PDOException) {
            if (isDuplicateKeyError($e, 'email') || isDuplicateKeyError($e, 'uk_users_active_contact')) {
                sendValidationError(['email' => 'That email is already in use.']);
            }
            if (isDuplicateKeyError($e, 'username')) {
                sendValidationError(['username' => 'That username is already in use.']);
            }
        }
        throw $e;
    }
    releaseEmailLocks($pdo, $emailLocks);

    $fresh = loadAuthUser($pdo, (int)$authRow['id']);
    $details = ['fields' => array_values(array_unique(auditFieldNames(array_merge($patronSet, $authSet)))), 'via' => 'reader'];
    foreach (['username', 'email'] as $k) {
        if ($authRow[$k] !== $fresh[$k]) {
            $details[$k] = [$authRow[$k], $fresh[$k]];
        }
    }
    auditLogQuiet($pdo, 'account.update', 'account', (string)$authRow['id'], $details);
    // Keep this session's copy of the account current (the password version is unchanged, so it stays valid).
    $_SESSION['user'] = sessionFromRow($fresh);
    sendResponse(['message' => 'Profile updated.', 'account' => readerAccountPayload($pdo, (int)$authRow['id'], $patronId)]);
}

if ($action === 'reserve') {
    $bookId = trim((string)($data['bookId'] ?? ''));
    if ($bookId === '' || strlen($bookId) > 20) {
        sendValidationError(['bookId' => 'Choose a book to reserve.']);
    }
    $pdo->beginTransaction();
    try {
        $bookStmt = $pdo->prepare('SELECT id, status FROM books WHERE id = ? AND deleted_at IS NULL FOR UPDATE');
        $bookStmt->execute([$bookId]);
        $book = $bookStmt->fetch();
        if (!$book) {
            $pdo->rollBack();
            sendError('Book not found.', 404);
        }
        $duplicate = $pdo->prepare("SELECT id FROM reservations WHERE book_id = ? AND user_id = ? AND status = 'active' FOR UPDATE");
        $duplicate->execute([$bookId, $patronId]);
        if ($duplicate->fetch()) {
            $pdo->rollBack();
            sendError('You already have an active reservation for this book.', 409);
        }
        // One reader must not be able to hold the whole catalog: count under a patron lock so parallel requests cannot slip past.
        lockPatronForRequest($pdo, $patronId);
        $limit = requestLimitReason($pdo, $patronId);
        if ($limit !== null) {
            $pdo->rollBack();
            sendError($limit, 409);
        }
        $reservationId = nextReservationId($pdo);
        $pdo->prepare('INSERT INTO reservations (id, book_id, user_id, status) VALUES (?, ?, ?, ?)')->execute([$reservationId, $bookId, $patronId, 'active']);
        auditLog($pdo, 'reservation.create', 'book', $bookId, ['reservationId' => $reservationId, 'userId' => $patronId]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        if ($e instanceof PDOException && in_array((int)($e->errorInfo[1] ?? 0), [1205, 1213], true)) {
            sendError('That record is busy. Please try again.', 409);
        }
        throw $e;
    }
    sendResponse(['message' => 'Borrow request sent to library staff.', 'reservationId' => $reservationId], 201);
}

sendError('Unknown reader action.', 400);