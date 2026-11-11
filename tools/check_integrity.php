<?php

declare(strict_types=1);

// Usage (project folder):  php tools/check_integrity.php
// READ-ONLY consistency check of circulation data (only SELECT statements are issued).
// Exit code 0 = everything consistent, 1 = problems found (listed with sample ids). Safe to run on production.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/migrations.php';

if (!migrationsApplied($pdo)) {
    fwrite(STDERR, "Migrations are pending. Run `php tools/migrate.php --yes` first.\n");
    exit(2);
}

$maxBooks = (int)loadSettingsRow($pdo)['max_books_per_user'];
$open = "t.type = 'issue' AND t.return_date IS NULL AND t.status IN ('Borrowed','Overdue')";

/** [label, SQL returning an `id` column (and optional `info`), params] */
$checks = [
    ['Book marked on loan has no matching open loan (or has more than one)',
        "SELECT b.id FROM books b WHERE b.deleted_at IS NULL AND b.status IN ('Borrowed','Overdue')
           AND (SELECT COUNT(*) FROM transactions t WHERE $open AND t.book_id = b.id AND t.user_id <=> b.borrowed_by) <> 1", []],
    ['Open loan whose book is not marked on loan',
        "SELECT t.id FROM transactions t JOIN books b ON b.id = t.book_id WHERE $open AND b.status = 'Available'", []],
    ['Open loan due date differs from the book record',
        "SELECT t.id FROM transactions t JOIN books b ON b.id = t.book_id WHERE $open AND NOT (t.due_date <=> b.due_date)", []],
    ['Available book still carries borrower/dates',
        "SELECT id FROM books WHERE status = 'Available' AND (borrowed_by IS NOT NULL OR due_date IS NOT NULL OR issue_date IS NOT NULL)", []],
    ['Book with more than one open loan',
        "SELECT t.book_id AS id FROM transactions t WHERE $open GROUP BY t.book_id HAVING COUNT(*) > 1", []],
    ['Patron over the loan limit',
        "SELECT borrowed_by AS id FROM books WHERE deleted_at IS NULL AND status IN ('Borrowed','Overdue') AND borrowed_by IS NOT NULL
           GROUP BY borrowed_by HAVING COUNT(*) > ?", [$maxBooks]],
    ['Soft-deleted book or patron still holds an open loan',
        "SELECT t.id FROM transactions t LEFT JOIN books b ON b.id = t.book_id LEFT JOIN users u ON u.id = t.user_id
           WHERE $open AND (b.deleted_at IS NOT NULL OR u.deleted_at IS NOT NULL)", []],
    ['Returned loan without a return date, or with a negative fine',
        "SELECT id FROM transactions WHERE type = 'issue' AND status = 'Returned' AND (return_date IS NULL OR fine < 0)", []],
    ['Return date before issue date',
        "SELECT id FROM transactions WHERE return_date IS NOT NULL AND return_date < issue_date", []],
    ['Fine marked paid but no fine was ever assessed',
        "SELECT id FROM transactions WHERE fine_paid_at IS NOT NULL AND fine <= 0", []],
    ['Active reservation on a deleted book or deleted patron',
        "SELECT r.id FROM reservations r LEFT JOIN books b ON b.id = r.book_id LEFT JOIN users u ON u.id = r.user_id
           WHERE r.status = 'active' AND (b.deleted_at IS NOT NULL OR u.deleted_at IS NOT NULL)", []],
];

$bad = 0;
foreach ($checks as [$label, $sql, $params]) {
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $ids = array_column($stmt->fetchAll(), 'id');
    if (!$ids) {
        fwrite(STDOUT, "  OK       $label\n");
        continue;
    }
    $bad++;
    fwrite(STDOUT, '  PROBLEM  ' . $label . ' (' . count($ids) . '): ' . implode(', ', array_slice($ids, 0, 5)) . (count($ids) > 5 ? ', …' : '') . "\n");
}
fwrite(STDOUT, $bad === 0 ? "\nAll circulation data is consistent.\n" : "\n$bad check(s) found problems. Nothing was changed; fix the records or ask for help.\n");
exit($bad === 0 ? 0 : 1);
