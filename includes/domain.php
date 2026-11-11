<?php

declare(strict_types=1);

function formatUserName($lastName, $firstName, $middleInitial): string {
    $mi = $middleInitial ? (' ' . $middleInitial . '.') : '';
    return $lastName . ', ' . $firstName . $mi;
}

function loadSettingsRow(PDO $pdo): array {
    $stmt = $pdo->prepare('SELECT * FROM settings WHERE id = 1');
    $stmt->execute();
    $row = $stmt->fetch();
    if (!$row) {
        sendError('Settings not found', 404);
    }
    return $row;
}

function calculateFineAmount(string $dueDate, string $returnDate, array $settings): float {
    if (!toBool($settings['overdue_fines_enabled'] ?? true)) {
        return 0.0;
    }
    $tz = new DateTimeZone(APP_TIMEZONE);
    $due = DateTimeImmutable::createFromFormat('Y-m-d', $dueDate, $tz);
    $ret = DateTimeImmutable::createFromFormat('Y-m-d', $returnDate, $tz);
    if (!$due || !$ret) {
        return 0.0;
    }
    $overdueDays = (int)$due->diff($ret)->format('%r%a');
    $overdueDays = max(0, $overdueDays);
    $grace = max(0, (int)($settings['grace_period_days'] ?? 0));
    $billable = max(0, $overdueDays - $grace);
    $rate = max(0.0, (float)($settings['fine_per_day'] ?? 0));
    return round($billable * $rate, 2);
}

function addDaysIso(string $date, int $days): string {
    return (new DateTimeImmutable($date, new DateTimeZone(APP_TIMEZONE)))
        ->modify(($days >= 0 ? '+' : '') . $days . ' days')->format('Y-m-d');
}

function overdueDays(string $dueDate, ?string $asOf = null): int {
    $asOf = $asOf ?: todayManila();
    $tz = new DateTimeZone(APP_TIMEZONE);
    $due = DateTimeImmutable::createFromFormat('Y-m-d', $dueDate, $tz);
    $day = DateTimeImmutable::createFromFormat('Y-m-d', $asOf, $tz);
    if (!$due || !$day) {
        return 0;
    }
    return max(0, (int)$due->diff($day)->format('%r%a'));
}

function effectiveLoanStatus(string $stored, ?string $dueDate, ?string $returnDate = null): string {
    if ($returnDate || $stored === 'Returned') {
        return 'Returned';
    }
    if ($dueDate && overdueDays($dueDate) > 0 && in_array($stored, ['Borrowed', 'Overdue'], true)) {
        return 'Overdue';
    }
    if (in_array($stored, ['Borrowed', 'Overdue'], true)) {
        return 'Borrowed';
    }
    return $stored;
}

function nextPrefixedId(PDO $pdo, string $counter, string $prefix, int $pad): string {
    $stmt = $pdo->prepare('SELECT next_value FROM id_counters WHERE name = ? FOR UPDATE');
    $stmt->execute([$counter]);
    $row = $stmt->fetch();
    if (!$row) {
        $pdo->prepare('INSERT INTO id_counters (name, next_value) VALUES (?, 2)')->execute([$counter]);
        $n = 1;
    } else {
        $n = (int)$row['next_value'];
        $pdo->prepare('UPDATE id_counters SET next_value = next_value + 1 WHERE name = ?')->execute([$counter]);
    }
    return $prefix . str_pad((string)$n, $pad, '0', STR_PAD_LEFT);
}

function nextBookId(PDO $pdo): string {
    return nextPrefixedId($pdo, 'books', 'BK-', 4);
}

function nextUserId(PDO $pdo): string {
    $year = (new DateTimeImmutable('now', new DateTimeZone(APP_TIMEZONE)))->format('Y');
    return nextPrefixedId($pdo, 'users', $year . '-', 3);
}

/** Serializes email claims across the patron and login-account tables. */
function acquireEmailLocks(PDO $pdo, array $emails): array {
    $names = [];
    foreach ($emails as $email) {
        $email = strtolower(trim((string)$email));
        if ($email !== '') {
            $names[] = 'feu_email_' . substr(hash('sha256', $email), 0, 48);
        }
    }
    $names = array_values(array_unique($names));
    sort($names, SORT_STRING);
    $held = [];
    $stmt = $pdo->prepare('SELECT GET_LOCK(?, 10)');
    foreach ($names as $name) {
        $stmt->execute([$name]);
        if ((int)$stmt->fetchColumn() !== 1) {
            releaseEmailLocks($pdo, $held);
            sendError('Email address is being updated. Please try again.', 409);
        }
        $held[] = $name;
    }
    return $held;
}

function releaseEmailLocks(PDO $pdo, array $names): void {
    $stmt = $pdo->prepare('SELECT RELEASE_LOCK(?)');
    foreach ($names as $name) {
        $stmt->execute([$name]);
    }
}

/** True when another active patron or account already claims this normalized email. */
function emailInUse(PDO $pdo, string $email, ?string $excludePatronId = null, ?int $excludeAuthId = null): bool {
    $s = $pdo->prepare('SELECT id FROM users WHERE deleted_at IS NULL AND LOWER(TRIM(contact)) = ? AND (? IS NULL OR id <> ?) LIMIT 1');
    $s->execute([strtolower(trim($email)), $excludePatronId, $excludePatronId]);
    if ($s->fetchColumn()) {
        return true;
    }
    $s = $pdo->prepare('SELECT id FROM auth_users WHERE LOWER(TRIM(email)) = ? AND (? IS NULL OR id <> ?) AND (? IS NULL OR patron_id IS NULL OR patron_id <> ?) LIMIT 1');
    $s->execute([strtolower(trim($email)), $excludeAuthId, $excludeAuthId, $excludePatronId, $excludePatronId]);
    return (bool)$s->fetchColumn();
}

function nextTxId(PDO $pdo): string {
    return nextPrefixedId($pdo, 'transactions', 'TX-', 4);
}

function nextReservationId(PDO $pdo): string {
    return nextPrefixedId($pdo, 'reservations', 'RV-', 4);
}

function mapBook(array $row): array {
    $status = effectiveLoanStatus($row['status'], $row['due_date'] ?? null);
    if (($row['status'] ?? '') === 'Available') {
        $status = 'Available';
    }
    return [
        'id' => $row['id'],
        'title' => $row['title'],
        'author' => $row['author'],
        'category' => $row['category'],
        'year' => $row['year'] === null ? null : (int)$row['year'],
        'location' => $row['location'],
        'status' => $status,
        'borrowedBy' => $row['borrowed_by'],
        'issueDate' => $row['issue_date'],
        'dueDate' => $row['due_date'],
        'description' => $row['description'],
        'format' => $row['format'],
        'cover' => $row['cover_url'],
        'createdAt' => $row['created_at'] ?? null,
        'renewalCount' => isset($row['renewal_count']) ? (int)$row['renewal_count'] : 0,
        'borrowCount' => isset($row['borrow_count']) ? (int)$row['borrow_count'] : 0,
    ];
}

function mapUser(array $row, array $borrowedBookIds = [], array $holds = [], array $requestedBooks = []): array {
    return [
        'id' => $row['id'],
        'lastName' => $row['last_name'],
        'firstName' => $row['first_name'],
        'middleInitial' => $row['middle_initial'] ?? '',
        'name' => formatUserName($row['last_name'], $row['first_name'], $row['middle_initial'] ?? ''),
        'program' => $row['program'],
        'yearLevel' => $row['year_level'] === null ? null : (int)$row['year_level'],
        'studentNumber' => $row['student_number'] ?? null,
        'contact' => $row['contact'],
        'status' => $row['status'],
        'borrowedBookIds' => array_values($borrowedBookIds),
        'requestedBooks' => array_values($requestedBooks),
        'unpaidFines' => (float)($holds['unpaidFines'] ?? 0),
        'overdueLoans' => (int)($holds['overdueLoans'] ?? 0),
    ];
}

function mapTransaction(array $row): array {
    $status = effectiveLoanStatus($row['status'], $row['due_date'] ?? null, $row['return_date'] ?? null);
    return [
        'id' => $row['id'],
        'type' => $row['type'],
        'bookId' => $row['book_id'],
        'bookTitle' => $row['book_title'],
        'userId' => $row['user_id'],
        'userName' => $row['user_name'],
        'issueDate' => $row['issue_date'],
        'dueDate' => $row['due_date'],
        'returnDate' => $row['return_date'],
        'fine' => (float)$row['fine'],
        'finePaid' => (float)$row['fine'] <= 0 || !empty($row['fine_paid_at']),
        'status' => $status,
        'renewalCount' => isset($row['renewal_count']) ? (int)$row['renewal_count'] : 0,
        'createdAt' => $row['created_at'] ?? null,
    ];
}

function mapSettings(array $row): array {
    return [
        'finePerDay' => (float)$row['fine_per_day'],
        'loanDays' => (int)$row['loan_days'],
        'maxBooksPerUser' => (int)$row['max_books_per_user'],
        'maxRenewals' => (int)$row['max_renewals'],
        'gracePeriodDays' => (int)$row['grace_period_days'],
        'overdueFinesEnabled' => toBool($row['overdue_fines_enabled']),
        'dateFormat' => $row['date_format'],
        'timeFormat' => $row['time_format'],
        'pageSize' => (int)$row['page_size'],
        'language' => $row['language'],
        'confirmDeletes' => toBool($row['confirm_deletes']),
        'landingPage' => $row['landing_page'],
        'density' => $row['density'],
        'libraryName' => $row['library_name'],
        'libraryEmail' => $row['library_email'],
        'libraryPhone' => $row['library_phone'],
        'libraryAddress' => $row['library_address'],
    ];
}

function mapAccount(array $row): array {
    $last = $row['last_login'] ?? null;
    $lastIso = null;
    if ($last) {
        $dt = new DateTimeImmutable($last, new DateTimeZone(APP_TIMEZONE));
        $lastIso = $dt->format('c');
    }
    return [
        'id' => $row['id'] ?? null,
        'displayName' => $row['display_name'],
        'username' => $row['username'],
        'email' => $row['email'],
        'role' => $row['role'],
        'status' => $row['status'],
        'patronId' => $row['patron_id'] ?? null,
        'avatarDataUrl' => $row['avatar_data_url'] ?? null,
        'avatarPreset' => $row['avatar_preset'] ?? null,
        'lastLogin' => $lastIso,
        'totpEnabled' => (int)($row['totp_enabled'] ?? 0) === 1 && (string)($row['totp_secret'] ?? '') !== '',
    ];
}

function mapNotifPrefs(array $row): array {
    return [
        'due' => toBool($row['due_notification']),
        'overdue' => toBool($row['overdue_notification']),
        'newUser' => toBool($row['new_user_notification']),
        'returns' => toBool($row['returns_notification']),
        'system' => toBool($row['system_notification']),
    ];
}

function borrowedIdsByUser(PDO $pdo, array $userIds): array {
    $result = [];
    foreach ($userIds as $id) {
        $result[$id] = [];
    }
    if (empty($userIds)) {
        return $result;
    }
    $placeholders = implode(',', array_fill(0, count($userIds), '?'));
    $stmt = $pdo->prepare("
        SELECT id, borrowed_by, status, due_date
        FROM books
        WHERE borrowed_by IN ($placeholders)
          AND deleted_at IS NULL
          AND status IN ('Borrowed', 'Overdue')
    ");
    $stmt->execute(array_values($userIds));
    foreach ($stmt->fetchAll() as $row) {
        $result[$row['borrowed_by']][] = $row['id'];
    }
    return $result;
}

function countRows(PDO $pdo, string $sql, array $params): int {
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    return (int)$stmt->fetchColumn();
}

/* ---------- Audit trail ---------- */

/** [actor id, actor name] of the signed-in staff member; [null, null] for anonymous events. */
function auditActor(): array {
    $u = function_exists('currentUser') ? currentUser() : null;
    return $u ? [(int)$u['id'], (string)(($u['displayName'] ?? '') ?: ($u['username'] ?? ''))] : [null, null];
}

/** Column names (without backticks / "= ?") from an UPDATE ... SET fragment list. */
function auditFieldNames(array $fields): array {
    return array_map(static fn($f) => trim(explode(' = ', (string)$f)[0], '` '), $fields);
}

/** [key => [old, new]] for every key whose value differs. */
function auditDiff(array $before, array $after): array {
    $out = [];
    foreach ($after as $k => $v) {
        if (($before[$k] ?? null) !== $v) {
            $out[$k] = [$before[$k] ?? null, $v];
        }
    }
    return $out;
}

/**
 * Records one audit entry. STRICT: throws on failure, so call it inside the same transaction as the
 * action it describes (a failed log write then rolls the action back). Never put passwords, tokens
 * or avatar data in $details.
 */
function auditLog(PDO $pdo, string $action, ?string $entityType = null, ?string $entityId = null, array $details = [], ?array $actor = null): void {
    [$actorId, $actorName] = $actor ?? auditActor();
    $json = $details ? json_encode($details, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR) : null;
    if ($json !== null && strlen($json) > 2000) {
        $json = mb_strcut($json, 0, 1997, 'UTF-8') . '...';
    }
    $ip = substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);
    $pdo->prepare('INSERT INTO audit_log (actor_id, actor_name, action, entity_type, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)')
        ->execute([$actorId, $actorName, $action, $entityType, $entityId, $json, $ip === '' ? null : $ip]);
}

/** Same as auditLog() but never throws: for single-statement actions outside a transaction. */
function auditLogQuiet(PDO $pdo, string $action, ?string $entityType = null, ?string $entityId = null, array $details = [], ?array $actor = null): void {
    try {
        auditLog($pdo, $action, $entityType, $entityId, $details, $actor);
    } catch (Throwable $e) {
        error_log('[feu-library] audit log write failed: ' . $e->getMessage());
    }
}

/* ---------- Circulation policy ---------- */

/** [patronId => ['unpaidFines' => float, 'overdueLoans' => int]] for the given patrons. */
function patronHolds(PDO $pdo, array $userIds, string $today): array {
    $out = [];
    foreach ($userIds as $id) {
        $out[$id] = ['unpaidFines' => 0.0, 'overdueLoans' => 0];
    }
    if (!$userIds) {
        return $out;
    }
    $in = implode(',', array_fill(0, count($userIds), '?'));
    $stmt = $pdo->prepare("
        SELECT user_id,
          COALESCE(SUM(CASE WHEN status = 'Returned' AND fine > 0 AND fine_paid_at IS NULL THEN fine END), 0) AS unpaid,
          COALESCE(SUM(CASE WHEN return_date IS NULL AND status IN ('Borrowed','Overdue') AND due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END), 0) AS overdue
        FROM transactions WHERE type = 'issue' AND user_id IN ($in) GROUP BY user_id
    ");
    $stmt->execute(array_merge([$today], array_values($userIds)));
    foreach ($stmt->fetchAll() as $r) {
        $out[$r['user_id']] = ['unpaidFines' => round((float)$r['unpaid'], 2), 'overdueLoans' => (int)$r['overdue']];
    }
    return $out;
}

/** Why this patron may not borrow right now (overdue books, then unpaid fines), or null if they may. */
function patronBlockReason(PDO $pdo, string $userId, string $today): ?string {
    $h = patronHolds($pdo, [$userId], $today)[$userId];
    if ($h['overdueLoans'] > 0) {
        $n = $h['overdueLoans'];
        return "This patron has {$n} overdue book" . ($n === 1 ? '' : 's') . '. Return ' . ($n === 1 ? 'it' : 'them') . ' before borrowing more.';
    }
    if ($h['unpaidFines'] > 0) {
        return 'This patron has unpaid fines of ₱' . number_format($h['unpaidFines'], 2) . '. Record the payment before borrowing.';
    }
    return null;
}

/** Most borrow requests (active reservations) one patron may hold at the same time. */
const MAX_ACTIVE_REQUESTS = 5;

/**
 * Locks the patron row so that two requests from the same patron are counted one after the other.
 * Always take this lock AFTER the book lock (the same order as issuing a loan) so requests cannot deadlock.
 */
function lockPatronForRequest(PDO $pdo, string $userId): void {
    $stmt = $pdo->prepare('SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE');
    $stmt->execute([$userId]);
    $stmt->fetchColumn();
}

/** Why this patron cannot place another request right now, or null if they can. Call after lockPatronForRequest(). */
function requestLimitReason(PDO $pdo, string $userId): ?string {
    $n = countRows($pdo, "SELECT COUNT(*) FROM reservations WHERE user_id = ? AND status = 'active'", [$userId]);
    if ($n >= MAX_ACTIVE_REQUESTS) {
        return 'Request limit reached: at most ' . MAX_ACTIVE_REQUESTS . ' active requests at a time. Cancel one before requesting another title.';
    }
    return null;
}

/** First active reservation on the book from an eligible patron, or null. */
function firstReservationHolder(PDO $pdo, string $bookId): ?string {
    $stmt = $pdo->prepare("
        SELECT r.user_id FROM reservations r
        JOIN users u ON u.id = r.user_id AND u.deleted_at IS NULL AND u.status = 'Active'
        WHERE r.book_id = ? AND r.status = 'active' ORDER BY r.created_at, r.id LIMIT 1
    ");
    $stmt->execute([$bookId]);
    $v = $stmt->fetchColumn();
    return $v === false ? null : (string)$v;
}
