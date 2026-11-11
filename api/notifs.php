<?php
require __DIR__ . '/../config.php';

$method = requestMethod();
$user = $method === 'GET' ? requireAuth() : requireLibrarian();

function loadNotifs(PDO $pdo): array {
    $stmt = $pdo->prepare('SELECT * FROM notif_prefs WHERE id = 1');
    $stmt->execute();
    $row = $stmt->fetch();
    if (!$row) {
        sendError('Notification preferences not found', 404);
    }
    return mapNotifPrefs($row);
}

if ($method === 'GET') {
    $prefs = loadNotifs($pdo);
    $items = [];
    if (isLibrarian($user) && $prefs['overdue']) {
        $n = (int)$pdo->query("SELECT COUNT(*) FROM transactions WHERE type='issue' AND return_date IS NULL AND due_date < CURDATE() AND status IN ('Borrowed','Overdue')")->fetchColumn();
        if ($n > 0) {
            $items[] = ['title' => $n . ' title' . ($n === 1 ? ' is' : 's are') . ' overdue', 'when' => 'Today', 'kind' => 'overdue'];
        }
    }
    if (isLibrarian($user) && $prefs['due']) {
        $n = (int)$pdo->query("SELECT COUNT(*) FROM transactions WHERE type='issue' AND return_date IS NULL AND due_date = CURDATE()")->fetchColumn();
        if ($n > 0) {
            $items[] = ['title' => $n . ' title' . ($n === 1 ? '' : 's') . ' due today', 'when' => 'Today', 'kind' => 'due'];
        }
    }
    if (isLibrarian($user) && $prefs['returns']) {
        $n = (int)$pdo->query("SELECT COUNT(*) FROM transactions WHERE type='issue' AND status='Returned' AND return_date = CURDATE()")->fetchColumn();
        if ($n > 0) {
            $items[] = ['title' => $n . ' return' . ($n === 1 ? '' : 's') . ' recorded today', 'when' => 'Today', 'kind' => 'returns'];
        }
    }
    sendResponse(['notifPrefs' => $prefs, 'prefs' => $prefs, 'items' => $items]);
}

if ($method === 'PUT' || $method === 'POST') {
    $data = getJsonBody();
    $map = [
        'due' => 'due_notification',
        'overdue' => 'overdue_notification',
        'newUser' => 'new_user_notification',
        'returns' => 'returns_notification',
        'system' => 'system_notification',
    ];
    $fields = [];
    $params = [];
    foreach ($map as $key => $col) {
        if (array_key_exists($key, $data)) {
            $fields[] = "$col = ?";
            $params[] = toBool($data[$key]) ? 1 : 0;
        }
    }
    if (empty($fields)) {
        sendError('No fields to update', 400);
    }
    $params[] = 1;
    $before = loadNotifs($pdo);
    $pdo->prepare('UPDATE notif_prefs SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);
    $prefs = loadNotifs($pdo);
    $diff = auditDiff($before, $prefs);
    if ($diff) {
        auditLogQuiet($pdo, 'notifs.update', 'settings', 'notifications', ['changes' => $diff]);
    }
    sendResponse([
        'message' => 'Notification preferences updated',
        'notifPrefs' => $prefs,
        'prefs' => $prefs,
    ]);
}

sendError('Method not allowed', 405);