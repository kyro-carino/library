<?php
require __DIR__ . '/../config.php';

$actor = requireLibrarian();
$method = requestMethod();
if ($method !== 'GET') {
    sendError('Method not allowed', 405);
}

$settings = loadSettingsRow($pdo);
$today = todayManila();

$borrowSortKey = (string)getQueryParam('sort', 'newest');
$borrowSortSql = [
    'newest' => 'issue_date DESC, created_at DESC, id DESC',
    'oldest' => 'issue_date ASC, created_at ASC, id ASC',
    'title_az' => 'book_title ASC, issue_date DESC, id DESC',
    'title_za' => 'book_title DESC, issue_date DESC, id DESC',
    'borrower_az' => 'user_name ASC, issue_date DESC, id DESC',
    'due_earliest' => 'CASE WHEN due_date IS NULL THEN 1 ELSE 0 END ASC, due_date ASC, issue_date DESC, id DESC',
    'due_latest' => 'CASE WHEN due_date IS NULL THEN 1 ELSE 0 END ASC, due_date DESC, issue_date DESC, id DESC',
];
if (!isset($borrowSortSql[$borrowSortKey])) {
    $borrowSortKey = 'newest';
}
$borrowPageSize = 10;
$borrowPage = max(1, (int)getQueryParam('page', 1));
$borrowWhere = "type = 'issue'";
$borrowParams = [];
$borrowSearch = likeTerm(getQueryParam('q'));
if ($borrowSearch !== null) {
    $borrowWhere .= " AND (book_title LIKE ? ESCAPE '\\\\' OR user_name LIKE ? ESCAPE '\\\\')";
    $borrowParams[] = $borrowSearch;
    $borrowParams[] = $borrowSearch;
}
$recentTotal = countRows($pdo, "SELECT COUNT(*) FROM transactions WHERE $borrowWhere", $borrowParams);
$borrowPages = max(1, (int)ceil($recentTotal / $borrowPageSize));
if ($borrowPage > $borrowPages) {
    $borrowPage = $borrowPages;
}
$borrowOffset = ($borrowPage - 1) * $borrowPageSize;
$recentStmt = $pdo->prepare("SELECT * FROM transactions WHERE $borrowWhere ORDER BY {$borrowSortSql[$borrowSortKey]} LIMIT $borrowPageSize OFFSET $borrowOffset");
$recentStmt->execute($borrowParams);
$recent = array_map('mapTransaction', $recentStmt->fetchAll());
$ledger = [
    'recent' => $recent,
    'recentTotal' => $recentTotal,
    'recentPage' => $borrowPage,
    'recentPageSize' => $borrowPageSize,
    'recentSort' => $borrowSortKey,
];
if ((string)getQueryParam('ledger', '') === '1') {
    sendResponse($ledger);
}

// Last 7 days: one grouped query per column (was 14 single-day queries).
$firstDay = addDaysIso($today, -6);
$issuedByDay = $pdo->prepare("SELECT issue_date AS d, COUNT(*) AS n FROM transactions
    WHERE type = 'issue' AND issue_date BETWEEN ? AND ? GROUP BY issue_date");
$issuedByDay->execute([$firstDay, $today]);
$issuedByDay = array_column($issuedByDay->fetchAll(), 'n', 'd');
$returnedByDay = $pdo->prepare("SELECT return_date AS d, COUNT(*) AS n FROM transactions
    WHERE type = 'issue' AND status = 'Returned' AND return_date BETWEEN ? AND ? GROUP BY return_date");
$returnedByDay->execute([$firstDay, $today]);
$returnedByDay = array_column($returnedByDay->fetchAll(), 'n', 'd');
$activity = [];
for ($i = 6; $i >= 0; $i--) {
    $day = addDaysIso($today, -$i);
    $activity[] = [
        'date' => $day,
        'label' => (new DateTimeImmutable($day, new DateTimeZone(APP_TIMEZONE)))->format('D'),
        'issued' => (int)($issuedByDay[$day] ?? 0),
        'returned' => (int)($returnedByDay[$day] ?? 0),
    ];
}

$most = $pdo->query("
    SELECT book_id, book_title, COUNT(*) AS borrow_count
    FROM transactions
    WHERE type = 'issue' AND book_id IS NOT NULL
    GROUP BY book_id, book_title
    ORDER BY borrow_count DESC, book_title ASC
    LIMIT 8
")->fetchAll();

$overdueStmt = $pdo->query("
    SELECT t.*, b.due_date AS book_due
    FROM transactions t
    LEFT JOIN books b ON b.id = t.book_id
    WHERE t.type = 'issue'
      AND t.return_date IS NULL
      AND t.status IN ('Borrowed','Overdue')
      AND t.due_date IS NOT NULL
      AND t.due_date < CURDATE()
    ORDER BY t.due_date ASC
");
$overdue = [];
$totalEstFines = 0.0;
foreach ($overdueStmt as $row) {
    $mapped = mapTransaction($row);
    $days = overdueDays((string)$row['due_date'], $today);
    $est = calculateFineAmount((string)$row['due_date'], $today, $settings);
    $mapped['daysLate'] = $days;
    $mapped['estimatedFine'] = $est;
    $totalEstFines += $est;
    $overdue[] = $mapped;
}

$finesAssessed = (float)$pdo->query("
    SELECT COALESCE(SUM(fine), 0)
    FROM transactions
    WHERE type = 'issue' AND status = 'Returned'
")->fetchColumn();

$finesUnpaid = (float)$pdo->query("
    SELECT COALESCE(SUM(fine), 0)
    FROM transactions
    WHERE type = 'issue' AND status = 'Returned' AND fine > 0 AND fine_paid_at IS NULL
")->fetchColumn();

$collectionRow = $pdo->prepare("
    SELECT COUNT(*) AS titles,
      COALESCE(SUM(status = 'Available'), 0) AS available,
      COALESCE(SUM(status IN ('Borrowed','Overdue') AND due_date IS NOT NULL AND due_date < ?), 0) AS overdue,
      COALESCE(SUM(status IN ('Borrowed','Overdue') AND (due_date IS NULL OR due_date >= ?)), 0) AS on_loan
    FROM books WHERE deleted_at IS NULL
");
$collectionRow->execute([$today, $today]);
$c = $collectionRow->fetch();
$collection = [
    'titles' => (int)$c['titles'],
    'available' => (int)$c['available'],
    'onLoan' => (int)$c['on_loan'],
    'overdue' => (int)$c['overdue'],
    'activePatrons' => (int)$pdo->query("SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND status = 'Active'")->fetchColumn(),
];

$dueTodayWhere = "type = 'issue' AND return_date IS NULL AND status IN ('Borrowed','Overdue') AND due_date = ?";
$dueTodayCount = countRows($pdo, "SELECT COUNT(*) FROM transactions WHERE $dueTodayWhere", [$today]);
$dueStmt = $pdo->prepare("SELECT * FROM transactions WHERE $dueTodayWhere ORDER BY id ASC LIMIT 10");
$dueStmt->execute([$today]);
$dueToday = array_map('mapTransaction', $dueStmt->fetchAll());

$openLoans = (int)$pdo->query("
    SELECT COUNT(*) FROM transactions
    WHERE type = 'issue' AND return_date IS NULL AND status IN ('Borrowed','Overdue')
")->fetchColumn();

sendResponse([
    'activity' => $activity,
    'mostBorrowed' => array_map(static function ($row) {
        return [
            'bookId' => $row['book_id'],
            'title' => $row['book_title'],
            'count' => (int)$row['borrow_count'],
        ];
    }, $most),
    'overdue' => $overdue,
    'dueToday' => $dueToday,
    'collection' => $collection,
    'totals' => [
        'openLoans' => $openLoans,
        'overdueCount' => count($overdue),
        'estimatedOverdueFines' => round($totalEstFines, 2),
        'finesAssessed' => round($finesAssessed, 2),
        'finesUnpaid' => round($finesUnpaid, 2),
        'dueTodayCount' => $dueTodayCount,
    ],
    'recent' => $ledger['recent'],
    'recentTotal' => $ledger['recentTotal'],
    'recentPage' => $borrowPage,
    'recentPageSize' => $borrowPageSize,
    'recentSort' => $borrowSortKey,
    'asOf' => $today,
]);