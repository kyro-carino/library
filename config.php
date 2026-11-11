<?php
require __DIR__ . '/includes/bootstrap.php';
require_once __DIR__ . '/includes/migrations.php';

// Requests never create or alter schema. Pending migrations are applied only by
// `php tools/migrate.php --yes` after a backup.
if (!migrationsApplied($pdo)) {
    error_log('[feu-library] database migrations are pending; run tools/migrate.php');
    sendError($IS_DEVELOPMENT
        ? 'Database setup is incomplete. An administrator must run: php tools/migrate.php --yes'
        : 'Service temporarily unavailable.', 503);
}
if ($IS_DEVELOPMENT) {
    ensureDevSeeds($pdo);
}