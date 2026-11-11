<?php
// Shared API bootstrap: environment, timezone, headers, errors, PDO.

declare(strict_types=1);

const APP_TIMEZONE = 'Asia/Manila';
const APP_TZ_OFFSET = '+08:00';

date_default_timezone_set(APP_TIMEZONE);

if (file_exists(dirname(__DIR__) . '/.env')) {
    $env = parse_ini_file(dirname(__DIR__) . '/.env', false, INI_SCANNER_RAW);
    if (is_array($env)) {
        foreach ($env as $key => $value) {
            if (getenv($key) === false) {
                putenv($key . '=' . $value);
                $_ENV[$key] = $value;
            }
        }
    }
}

$APP_ENV = getenv('APP_ENV') !== false && getenv('APP_ENV') !== '' ? getenv('APP_ENV') : 'production';
if (!in_array(strtolower((string)$APP_ENV), ['development', 'production'], true)) {
    error_log('[feu-library] unknown APP_ENV "' . $APP_ENV . '"; treating as production');
    $APP_ENV = 'production';
}
$IS_DEVELOPMENT = strtolower((string)$APP_ENV) === 'development';
$IS_PRODUCTION = !$IS_DEVELOPMENT;

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

function jsonHeaders(): void {
    if (headers_sent()) {
        return;
    }
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('X-Frame-Options: DENY');
    header('Cache-Control: no-store, no-cache, must-revalidate, private');
    header('Pragma: no-cache');
    $csp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
    header('Content-Security-Policy: ' . $csp);

    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allow = getenv('CORS_ALLOW_ORIGIN');
    if ($allow && $origin && hash_equals($allow, $origin)) {
        header('Access-Control-Allow-Origin: ' . $allow);
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');
        header('Vary: Origin');
    }

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

function sendResponse($data, int $statusCode = 200): void {
    jsonHeaders();
    http_response_code($statusCode);
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function sendError(string $message, int $statusCode = 400, array $extra = []): void {
    jsonHeaders();
    http_response_code($statusCode);
    echo json_encode(array_merge(['error' => $message], $extra));
    exit;
}

function sendValidationError(array $errors, string $message = 'Please check the highlighted fields.'): void {
    sendError($message, 422, ['errors' => $errors]);
}

set_exception_handler(function (Throwable $e): void {
    error_log('[feu-library] ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    if ($e instanceof PDOException) {
        sendError('A database error occurred. Please try again.', 500);
    }
    sendError('An unexpected error occurred.', 500);
});

set_error_handler(function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) {
        return false;
    }
    if ($severity & (E_DEPRECATED | E_USER_DEPRECATED | E_NOTICE | E_USER_NOTICE)) {
        error_log('[feu-library] php notice: ' . $message . ' in ' . $file . ':' . $line);
        return true;
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

register_shutdown_function(function (): void {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        error_log('[feu-library] fatal: ' . $err['message'] . ' in ' . $err['file'] . ':' . $err['line']);
        if (!headers_sent()) {
            jsonHeaders();
            http_response_code(500);
            echo json_encode(['error' => 'An unexpected error occurred.']);
        }
    }
});

jsonHeaders();

$DB_HOST = getenv('DB_HOST') !== false && getenv('DB_HOST') !== '' ? getenv('DB_HOST') : 'localhost';
$DB_PORT = getenv('DB_PORT') !== false && getenv('DB_PORT') !== '' ? getenv('DB_PORT') : '3306';
$DB_NAME = getenv('DB_NAME') !== false && getenv('DB_NAME') !== '' ? getenv('DB_NAME') : 'feu_library';
$DB_USER = getenv('DB_USER') !== false && getenv('DB_USER') !== '' ? getenv('DB_USER') : ($IS_PRODUCTION ? '' : 'root');
$DB_PASS = getenv('DB_PASS') !== false ? getenv('DB_PASS') : '';

if ($IS_PRODUCTION) {
    $missing = [];
    foreach (['DB_HOST', 'DB_NAME', 'DB_USER'] as $required) {
        $val = getenv($required);
        if ($val === false || $val === '') {
            $missing[] = $required;
        }
    }
    if ($missing || $DB_USER === '') {
        error_log('[feu-library] production config missing: ' . implode(', ', $missing ?: ['DB_USER']));
        sendError('Server configuration is incomplete.', 500);
    }
    if (strtolower($DB_USER) === 'root' || $DB_PASS === '') {
        error_log('[feu-library] production refuses the root DB user or an empty DB_PASS; use a dedicated least-privilege account');
        sendError('Server configuration is incomplete.', 500);
    }
}

try {
    $dsn = "mysql:host={$DB_HOST};port={$DB_PORT};dbname={$DB_NAME};charset=utf8mb4";
    $pdo = new PDO($dsn, $DB_USER, $DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec("SET time_zone = '" . APP_TZ_OFFSET . "'");
    $pdo->exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
} catch (PDOException $e) {
    error_log('[feu-library] db connect: ' . $e->getMessage());
    $driverError = (int)($e->errorInfo[1] ?? 0);
    if (in_array($driverError, [2002, 2003], true)) {
        sendError($IS_DEVELOPMENT
            ? 'MySQL is unreachable at the configured DB_HOST/DB_PORT. Start MySQL in XAMPP and review its error log.'
            : 'Service temporarily unavailable.', 503);
    }
    if (stripos($e->getMessage(), 'could not find driver') !== false) {
        sendError($IS_DEVELOPMENT
            ? 'PHP PDO MySQL support is not enabled. Enable pdo_mysql in the XAMPP PHP configuration.'
            : 'Server configuration is incomplete.', 500);
    }
    sendError($IS_DEVELOPMENT
        ? 'Database connection failed. Verify DB_* settings and the PHP error log.'
        : 'Service temporarily unavailable.', $IS_DEVELOPMENT ? 500 : 503);
}

require_once __DIR__ . '/validation.php';
require_once __DIR__ . '/domain.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/totp.php';

// Production serves the API over HTTPS only (set ALLOW_INSECURE_HTTP=1 to override, e.g. an internal-only test).
// TLS behind a reverse proxy: list the proxy's IP in TRUSTED_PROXIES so its X-Forwarded-Proto is believed.
if ($IS_PRODUCTION && PHP_SAPI !== 'cli') {
    if (!isHttps()) {
        if (getenv('ALLOW_INSECURE_HTTP') !== '1') {
            sendError('HTTPS is required.', 403);
        }
    } elseif (!headers_sent()) {
        header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    }
}
assertSameOrigin();