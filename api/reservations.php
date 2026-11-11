<?php
require __DIR__ . '/../config.php';

$method = requestMethod();
$actor = requireAuth();

if ($method === 'GET') {
    $userId = getQueryParam('user_id') ?: getQueryParam('userId');
    $bookId = getQueryParam('book_id') ?: getQueryParam('bookId');
    if (!isLibrarian($actor)) {
        $userId = $actor['patronId'] ?? '__none__';
    }
    // Staff screen "Borrow requests": ?details=1 adds the patron, the title, its availability and the place in the queue.
    $details = isLibrarian($actor) && (string)getQueryParam('details', '') === '1';
    $where = ["r.status = 'active'"];
    $params = [];
    if ($userId) {
        $where[] = 'r.user_id = ?';
        $params[] = $userId;
    }
    if ($bookId) {
        $where[] = 'r.book_id = ?';
        $params[] = $bookId;
    }
    [$limit, $offset] = paginationParams(200, 500);
    $whereSql = implode(' AND ', $where);
    $total = countRows($pdo, "SELECT COUNT(*) FROM reservations r WHERE $whereSql", $params);
    if ($details) {
        $stmt = $pdo->prepare("
            SELECT r.id, r.book_id, r.user_id, r.status, r.created_at,
                   b.title, b.author, b.status AS book_status, b.due_date,
                   u.last_name, u.first_name, u.middle_initial, u.contact, u.status AS patron_status,
                   (SELECT COUNT(*) FROM reservations r2
                      JOIN users u2 ON u2.id = r2.user_id AND u2.deleted_at IS NULL AND u2.status = 'Active'
                     WHERE r2.book_id = r.book_id AND r2.status = 'active'
                       AND (r2.created_at < r.created_at OR (r2.created_at = r.created_at AND r2.id < r.id))) + 1 AS queue_pos
            FROM reservations r
            LEFT JOIN books b ON b.id = r.book_id
            LEFT JOIN users u ON u.id = r.user_id
            WHERE $whereSql ORDER BY r.created_at ASC, r.id ASC LIMIT ? OFFSET ?");
        $stmt->execute(array_merge($params, [$limit, $offset]));
        $rows = array_map(static function ($row) {
            $bookStatus = $row['book_status'] === null ? null : ($row['book_status'] === 'Available' ? 'Available' : effectiveLoanStatus((string)$row['book_status'], $row['due_date'] ?? null));
            return [
                'id' => $row['id'],
                'bookId' => $row['book_id'],
                'userId' => $row['user_id'],
                'status' => $row['status'],
                'createdAt' => $row['created_at'],
                'bookTitle' => $row['title'] ?? 'Removed book',
                'bookAuthor' => $row['author'] ?? '',
                'bookStatus' => $bookStatus,
                'dueDate' => $row['due_date'] ?? null,
                'userName' => $row['last_name'] === null ? 'Removed patron' : formatUserName($row['last_name'], $row['first_name'], $row['middle_initial'] ?? ''),
                'contact' => $row['contact'] ?? '',
                'patronActive' => ($row['patron_status'] ?? '') === 'Active',
                'queuePosition' => (int)$row['queue_pos'],
            ];
        }, $stmt->fetchAll());
        sendResponse(['reservations' => $rows, 'total' => $total, 'limit' => $limit, 'offset' => $offset]);
    }
    $sql = "SELECT r.* FROM reservations r WHERE $whereSql ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?";
    $stmt = $pdo->prepare($sql);
    $stmt->execute(array_merge($params, [$limit, $offset]));
    $rows = array_map(static function ($row) {
        return [
            'id' => $row['id'],
            'bookId' => $row['book_id'],
            'userId' => $row['user_id'],
            'status' => $row['status'],
            'createdAt' => $row['created_at'],
        ];
    }, $stmt->fetchAll());
    sendResponse(['reservations' => $rows, 'total' => $total, 'limit' => $limit, 'offset' => $offset]);
}

if ($method !== 'POST') {
    sendError('Method not allowed', 405);
}

$data = getJsonBody();
$action = $data['action'] ?? 'create';
$bookId = $data['bookId'] ?? $data['book_id'] ?? null;
$userId = $data['userId'] ?? $data['user_id'] ?? $actor['patronId'] ?? null;
if (!isLibrarian($actor)) {
    $userId = $actor['patronId'] ?? null;
}
if (!$bookId || !$userId) {
    sendError('Book and patron are required.', 400);
}

$pdo->beginTransaction();
try {
    if ($action === 'cancel') {
        $cancel = $pdo->prepare("UPDATE reservations SET status = 'cancelled' WHERE book_id = ? AND user_id = ? AND status = 'active'");
        $cancel->execute([$bookId, $userId]);
        if ($cancel->rowCount() === 0) {
            $pdo->rollBack();
            sendError('There is no active request for this patron and title (it may already be cancelled).', 404);
        }
        auditLog($pdo, 'reservation.cancel', 'book', (string)$bookId, ['userId' => (string)$userId]);
        $pdo->commit();
        sendResponse(['message' => 'Reservation cancelled.']);
    }

    $bookStmt = $pdo->prepare('SELECT * FROM books WHERE id = ? AND deleted_at IS NULL FOR UPDATE');
    $bookStmt->execute([$bookId]);
    $book = $bookStmt->fetch();
    if (!$book) {
        $pdo->rollBack();
        sendError('Book not found', 404);
    }
    $userStmt = $pdo->prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE');
    $userStmt->execute([$userId]);
    $patron = $userStmt->fetch();
    if (!$patron || $patron['status'] !== 'Active') {
        $pdo->rollBack();
        sendError('Patron is not eligible to reserve.', 400);
    }
    $dup = $pdo->prepare("SELECT id FROM reservations WHERE book_id = ? AND user_id = ? AND status = 'active' FOR UPDATE");
    $dup->execute([$bookId, $userId]);
    if ($dup->fetch()) {
        $pdo->rollBack();
        sendError('You already have an active reservation for this title.', 409);
    }
    $limit = requestLimitReason($pdo, (string)$userId);
    if ($limit !== null) {
        $pdo->rollBack();
        sendError($limit, 409);
    }
    $id = nextReservationId($pdo);
    $pdo->prepare('INSERT INTO reservations (id, book_id, user_id, status) VALUES (?, ?, ?, ?)')
        ->execute([$id, $bookId, $userId, 'active']);
    auditLog($pdo, 'reservation.create', 'book', (string)$bookId, ['reservationId' => $id, 'userId' => (string)$userId]);
    $pdo->commit();
    sendResponse(['message' => 'Borrow request sent to library staff.', 'id' => $id], 201);
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    if ($e instanceof PDOException && in_array((int)($e->errorInfo[1] ?? 0), [1205, 1213], true)) {
        sendError('That record is busy. Please try again.', 409);
    }
    throw $e;
}