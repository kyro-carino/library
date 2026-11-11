<?php

declare(strict_types=1);

// Usage (project folder):
//   php tools/migrate.php --dry-run   report pending steps and blocking data; changes nothing
//   php tools/migrate.php --yes       apply pending steps (back up the database first)
// To target another database (e.g. a restored copy) set DB_NAME in the environment first.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$flags = array_slice($argv, 1);
$dryRun = in_array('--dry-run', $flags, true) || in_array('--check', $flags, true);
$confirmed = in_array('--yes', $flags, true);

require __DIR__ . '/../includes/bootstrap.php';
require_once __DIR__ . '/../includes/migrations.php';

$out = static function (string $line): void {
    fwrite(STDOUT, $line . "\n");
};

try {
    $info = $pdo->query('SELECT DATABASE() AS db, VERSION() AS v')->fetch();
    $out("Database: {$info['db']}   Server: {$info['v']}   Mode: " . ($dryRun ? 'DRY RUN (no changes)' : 'APPLY'));

    if (!$dryRun && !$confirmed) {
        fwrite(STDERR, "Refusing to change the database without --yes. Back it up first, or use --dry-run.\n");
        exit(2);
    }

    if ($dryRun && tableExists($pdo, 'books')) {
        $out('Information (read-only):');
        if (columnExists($pdo, 'books', 'isbn')) {
            $withIsbn = (int)$pdo->query("SELECT COUNT(*) FROM books WHERE isbn IS NOT NULL AND isbn <> ''")->fetchColumn();
            $out("  books with an ISBN value (migration 009 deletes these values for good): $withIsbn");
        }
        $stale = (int)$pdo->query("SELECT COUNT(*) FROM books b WHERE b.status IN ('Borrowed','Overdue') AND b.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.book_id = b.id AND t.return_date IS NULL)")->fetchColumn();
        $out("  books marked on loan with no open loan record: $stale");
    }

    if ($dryRun && tableExists($pdo, 'transactions')) {
        $fines = (int)$pdo->query("SELECT COUNT(*) FROM transactions WHERE type = 'issue' AND status = 'Returned' AND fine > 0")->fetchColumn();
        $out("  returned loans with a fine (they start as UNPAID after migration 007): $fines");
    }

    $out('Migrations:');
    $result = runMigrations($pdo, $dryRun, $out);

    if ($result['blocked']) {
        $out('Result: BLOCKED. Fix the data listed above (nothing destructive was done), then re-run.');
        exit(1);
    }
    if ($dryRun) {
        $out($result['pending'] ? 'Result: ' . count($result['pending']) . ' migration(s) pending.' : 'Result: up to date.');
        exit(0);
    }
    $out($result['applied'] ? 'Result: applied ' . count($result['applied']) . ' migration(s).' : 'Result: already up to date.');
} catch (Throwable $e) {
    fwrite(STDERR, 'Migration failed: ' . $e->getMessage() . "\nNothing further was applied; fix the cause and re-run (steps are repeatable).\n");
    exit(1);
}