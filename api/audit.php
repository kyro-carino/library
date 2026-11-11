<?php
require __DIR__ . '/../config.php';

// Read-only view of the audit trail. Staff only. There is deliberately no way to edit or delete entries here.
requireLibrarian();
if (requestMethod() !== 'GET') {
    sendError('Method not allowed', 405);
}

[$limit, $offset] = paginationParams(50, 200);
$where = ['1=1'];
$params = [];
$errors = [];

$action = getQueryParam('action');
if ($action !== null && $action !== '') {
    // One action name, or a comma-separated list of up to 15 (e.g. "fine.assess,fine.pay").
    $names = explode(',', (string)$action);
    $valid = count($names) <= 15;
    foreach ($names as $name) {
        $valid = $valid && (bool)preg_match('/^[a-z_.]{1,40}$/', $name);
    }
    if (!$valid) {
        $errors['action'] = 'Invalid value.';
    } elseif (count($names) === 1) {
        $where[] = 'action = ?';
        $params[] = $names[0];
    } else {
        $where[] = 'action IN (' . implode(',', array_fill(0, count($names), '?')) . ')';
        array_push($params, ...$names);
    }
}
$entityType = getQueryParam('entity_type');
if ($entityType !== null && $entityType !== '') {
    if (!preg_match('/^[a-z_]{1,20}$/', (string)$entityType)) {
        $errors['entity_type'] = 'Invalid value.';
    } else {
        $where[] = 'entity_type = ?';
        $params[] = $entityType;
    }
}
$entityId = getQueryParam('entity_id');
if ($entityId !== null && $entityId !== '') {
    if (strlen((string)$entityId) > 40) {
        $errors['entity_id'] = 'Invalid value.';
    } else {
        $where[] = 'entity_id = ?';
        $params[] = (string)$entityId;
    }
}
$actorId = getQueryParam('actor_id');
if ($actorId !== null && $actorId !== '') {
    if (!ctype_digit((string)$actorId)) {
        $errors['actor_id'] = 'Invalid value.';
    } else {
        $where[] = 'actor_id = ?';
        $params[] = (int)$actorId;
    }
}
foreach (['from' => '>=', 'to' => '<='] as $key => $op) {
    $v = getQueryParam($key);
    if ($v !== null && $v !== '') {
        if (!isValidDate((string)$v)) {
            $errors[$key] = 'Use YYYY-MM-DD.';
        } else {
            $where[] = "created_at $op ?";
            $params[] = $v . ($key === 'from' ? ' 00:00:00' : ' 23:59:59');
        }
    }
}
if ($errors) {
    sendValidationError($errors);
}

$whereSql = implode(' AND ', $where);
$total = countRows($pdo, "SELECT COUNT(*) FROM audit_log WHERE $whereSql", $params);
$stmt = $pdo->prepare("SELECT * FROM audit_log WHERE $whereSql ORDER BY id DESC LIMIT ? OFFSET ?");
$stmt->execute(array_merge($params, [$limit, $offset]));
$tz = new DateTimeZone(APP_TIMEZONE);
$entries = array_map(static function (array $r) use ($tz): array {
    return [
        'id' => (int)$r['id'],
        'createdAt' => (new DateTimeImmutable($r['created_at'], $tz))->format('c'),
        'actorId' => $r['actor_id'] === null ? null : (int)$r['actor_id'],
        'actorName' => $r['actor_name'],
        'action' => $r['action'],
        'entityType' => $r['entity_type'],
        'entityId' => $r['entity_id'],
        'details' => $r['details'] === null ? null : json_decode($r['details'], true),
        'ip' => $r['ip'],
    ];
}, $stmt->fetchAll());
sendResponse(['entries' => $entries, 'total' => $total, 'limit' => $limit, 'offset' => $offset]);