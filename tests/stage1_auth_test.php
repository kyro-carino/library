<?php
// CLI: php tests/stage1_auth_test.php  (needs php-sqlite3 for the requireAuth checks)
declare(strict_types=1);
class Stop extends Exception { public $code2; public $extra; }
function sendError(string $m, int $c = 400, array $extra = []): void { $e = new Stop($m); $e->code2 = $c; $e->extra = $extra; throw $e; }
function sendResponse($d, int $c = 200): void {}
require __DIR__ . '/../includes/auth.php';
require __DIR__ . '/../includes/validation.php';
$ok = 0; $fail = 0;
function check(string $name, bool $cond) { global $ok, $fail; $cond ? $ok++ : $fail++; echo ($cond ? "PASS " : "FAIL ") . $name . "\n"; }
function expectErr(callable $f): ?Stop { try { $f(); } catch (Stop $e) { return $e; } return null; }

// --- throttle
$_SERVER['REMOTE_ADDR'] = '10.0.0.' . random_int(1, 250) . random_int(1,9);
$u = 'user' . bin2hex(random_bytes(3));
$keys = throttleKeys('login', $u);
check('not throttled initially', expectErr(fn() => assertNotThrottled($keys)) === null);
for ($i = 0; $i < 4; $i++) recordThrottleFailure($keys);
check('4 failures still allowed', expectErr(fn() => assertNotThrottled($keys)) === null);
recordThrottleFailure($keys);
$e = expectErr(fn() => assertNotThrottled($keys));
check('5th failure blocks with 429', $e && $e->code2 === 429 && ($e->extra['retryAfter'] ?? 0) > 0);
$other = throttleKeys('login', 'someoneelse');
check('different username same ip not blocked', expectErr(fn() => assertNotThrottled($other)) === null);
check('username case-insensitive', expectErr(fn() => assertNotThrottled(throttleKeys('login', strtoupper($u)))) !== null);
clearThrottle($keys);
check('success clears per-user key', expectErr(fn() => assertNotThrottled($keys)) === null);
// window expiry
recordThrottleFailure($keys); 
$f = throttleFile($keys[0]['key']); file_put_contents($f, json_encode(['count' => 99, 'first' => time() - THROTTLE_WINDOW - 5]));
check('expired window resets', expectErr(fn() => assertNotThrottled($keys)) === null);
// per-ip limit
$ipKeys = throttleKeys('login', 'x1'); 
for ($i = 0; $i < THROTTLE_MAX_PER_IP; $i++) recordThrottleFailure(throttleKeys('login', 'n' . $i));
check('per-ip limit blocks new username', expectErr(fn() => assertNotThrottled(throttleKeys('login', 'brandnew'))) !== null);
foreach (glob(sys_get_temp_dir() . '/feu_throttle_*.json') as $g) unlink($g);

// --- dummy hash valid + timing equalizer
check('dummy hash is valid bcrypt', password_get_info(DUMMY_PASSWORD_HASH)['algoName'] === 'bcrypt' && !password_verify('x', DUMMY_PASSWORD_HASH));

// --- requireAuth against sqlite
if (extension_loaded('pdo_sqlite')) {
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec("CREATE TABLE auth_users (id INTEGER PRIMARY KEY, role TEXT, status TEXT, password_hash TEXT)");
    $pdo->exec("INSERT INTO auth_users VALUES (1,'admin','Active','hashA'),(2,'patron','Active','hashP')");
    ob_start();
    session_save_path(sys_get_temp_dir());
    $_SESSION = [];
    startSecureSession();
    $_SESSION['user'] = ['id' => 1, 'role' => 'admin', 'status' => 'Active', 'pwv' => passwordVersion('hashA')];
    check('active admin passes requireLibrarian', requireLibrarian()['role'] === 'admin');
    $pdo->exec("UPDATE auth_users SET role='patron' WHERE id=1");
    $e = expectErr(fn() => requireLibrarian());
    check('role demoted in DB -> 403 immediately', $e && $e->code2 === 403);
    $pdo->exec("UPDATE auth_users SET role='admin', status='Inactive' WHERE id=1");
    $_SESSION['user'] = ['id' => 1, 'role' => 'admin', 'status' => 'Active', 'pwv' => passwordVersion('hashA')];
    $e = expectErr(fn() => requireAuth());
    check('deactivated in DB -> 401 and session cleared', $e && $e->code2 === 401 && !isset($_SESSION['user']));
    // password changed elsewhere -> this (other) session is rejected; a session without pwv is rejected too
    $pdo->exec("UPDATE auth_users SET status='Active' WHERE id=1");
    startSecureSession();
    $_SESSION['user'] = ['id' => 1, 'role' => 'admin', 'status' => 'Active', 'pwv' => passwordVersion('hashA')];
    check('matching password version passes', requireAuth()['id'] === 1);
    // Read-only requests give the session lock back right after auth; writes keep the session open.
    // (CLI cannot start a real session once output has been sent, so the decision itself is tested here and the
    //  live behaviour is covered by the HTTP benchmark in the Phase 4 notes.)
    foreach (['GET' => true, 'HEAD' => true, 'POST' => false, 'PUT' => false, 'DELETE' => false] as $m => $expected) {
        $_SERVER['REQUEST_METHOD'] = $m;
        check("session lock is " . ($expected ? 'released' : 'kept') . " for $m requests", requestIsReadOnly() === $expected);
    }
    unset($_SERVER['REQUEST_METHOD']); check('missing method counts as GET', requestIsReadOnly());
    $_SERVER['REQUEST_METHOD'] = 'POST';
    check('requireStaff allows staff, rejects a patron', requireStaff(['role' => 'librarian'])['role'] === 'librarian' && expectErr(fn() => requireStaff(['role' => 'patron']))->code2 === 403);
    $pdo->exec("UPDATE auth_users SET password_hash='hashB' WHERE id=1");
    $e = expectErr(fn() => requireAuth());
    check('password changed in DB -> 401 and session cleared', $e && $e->code2 === 401 && !isset($_SESSION['user']));
    startSecureSession();
    $_SESSION['user'] = ['id' => 1, 'role' => 'admin', 'status' => 'Active'];
    $e = expectErr(fn() => requireAuth());
    check('session without password version -> 401', $e && $e->code2 === 401);
    startSecureSession();
    $_SESSION['user'] = ['id' => 99, 'role' => 'admin', 'status' => 'Active', 'pwv' => passwordVersion('x')];
    $e = expectErr(fn() => requireAuth());
    check('deleted account -> 401', $e && $e->code2 === 401);
    $_SESSION = [];
    $e = expectErr(fn() => requireAuth());
    check('no session -> 401', $e && $e->code2 === 401);
    ob_end_clean();
} else { echo "SKIP requireAuth tests (no pdo_sqlite)\n"; }

// --- absolute session lifetime + password version
$now = time();
check('fresh session not expired', !sessionAbsolutelyExpired($now - 60, $now));
check('session past absolute lifetime expires', sessionAbsolutelyExpired($now - SESSION_ABSOLUTE_LIFETIME - 1, $now));
check('password version differs per hash and is stable', passwordVersion('a') !== passwordVersion('b') && passwordVersion('a') === passwordVersion('a'));

// --- HTTPS detection: X-Forwarded-Proto is believed only from a trusted proxy
unset($_SERVER["HTTPS"]); $_SERVER["SERVER_PORT"] = 80; $_SERVER["REMOTE_ADDR"] = "203.0.113.9"; putenv("TRUSTED_PROXIES");
check("plain http is not https", !isHttps());
$_SERVER["HTTP_X_FORWARDED_PROTO"] = "https";
check("X-Forwarded-Proto ignored when no proxy is trusted", !isHttps());
putenv("TRUSTED_PROXIES=203.0.113.9, 10.0.0.1");
check("X-Forwarded-Proto honoured from a trusted proxy", isHttps());
$_SERVER["HTTP_X_FORWARDED_PROTO"] = "http";
check("trusted proxy reporting http is not https", !isHttps());
$_SERVER["REMOTE_ADDR"] = "198.51.100.7"; $_SERVER["HTTP_X_FORWARDED_PROTO"] = "https";
check("untrusted address cannot claim https", !isHttps());
$_SERVER["HTTPS"] = "on"; check("HTTPS=on is https", isHttps());
$_SERVER["HTTPS"] = "off"; $_SERVER["SERVER_PORT"] = 443; check("port 443 is https", isHttps());
unset($_SERVER["HTTPS"], $_SERVER["HTTP_X_FORWARDED_PROTO"]); $_SERVER["SERVER_PORT"] = 80; putenv("TRUSTED_PROXIES");

// --- duplicate-key detection (races on unique columns map to 422/409, not 500)
$mk = function (int $code, string $msg): PDOException { $e = new PDOException($msg); $e->errorInfo = ['23000', $code, $msg]; return $e; };
$dup = $mk(1062, "SQLSTATE[23000]: Integrity constraint violation: 1062 Duplicate entry 'x' for key 'username'");
check('duplicate key detected (any key)', isDuplicateKeyError($dup));
check('duplicate key detected for the named key', isDuplicateKeyError($dup, 'username') && !isDuplicateKeyError($dup, 'email'));
check('other SQL errors are not duplicate keys', !isDuplicateKeyError($mk(1213, 'Deadlock found')) && !isDuplicateKeyError(new RuntimeException('x')));

// --- same-origin guard
$_SERVER['REQUEST_METHOD'] = 'POST'; $_SERVER['HTTP_HOST'] = 'localhost';
$_SERVER['HTTP_ORIGIN'] = 'http://localhost';
check('same-origin POST allowed', expectErr(fn() => assertSameOrigin()) === null);
$_SERVER['HTTP_ORIGIN'] = 'http://evil.example';
$e = expectErr(fn() => assertSameOrigin());
check('cross-site POST blocked 403', $e && $e->code2 === 403);
$_SERVER['HTTP_HOST'] = 'localhost:8080'; $_SERVER['HTTP_ORIGIN'] = 'http://localhost:8080';
check('same-origin with port allowed', expectErr(fn() => assertSameOrigin()) === null);
$_SERVER['HTTP_ORIGIN'] = 'http://localhost';
check('different port blocked', expectErr(fn() => assertSameOrigin()) !== null);
unset($_SERVER['HTTP_ORIGIN']);
check('missing Origin allowed (non-browser)', expectErr(fn() => assertSameOrigin()) === null);
$_SERVER['REQUEST_METHOD'] = 'GET'; $_SERVER['HTTP_ORIGIN'] = 'http://evil.example';
check('GET never blocked', expectErr(fn() => assertSameOrigin()) === null);
echo "\n$ok passed, $fail failed\n";