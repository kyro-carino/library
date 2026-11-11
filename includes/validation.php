<?php

declare(strict_types=1);

const BOOK_CATEGORIES = [
    'Literature', 'Science', 'History', 'Philosophy', 'Technology', 'Psychology',
    'Arts', 'Business', 'Mathematics', 'Computer Science', 'Education', 'Social Sciences',
];
const BOOK_FORMATS = ['Hardcover', 'Paperback', 'E-book', 'Audiobook'];
const USER_STATUSES = ['Active', 'Inactive'];
const AUTH_ROLES = ['admin', 'librarian', 'patron'];
const DATE_FORMATS = ['short', 'long', 'iso'];
const TIME_FORMATS = ['12h', '24h'];
const PAGE_SIZES = [10, 25, 50, 100];
const DENSITIES = ['comfortable', 'compact'];
const LANDING_PAGES = ['dashboard', 'books', 'users', 'issue', 'reports'];
// Programs a reader can pick (sign-up and profile edit). Keep the same as the PROGRAMS list used by the staff "Add patron" form (script.js).
const READER_PROGRAMS = ['BSIT', 'BS Architecture', 'BS Psychology', 'BS Civil Engineering', 'BS Nursing', 'BS Biology', 'BS Accountancy'];

function getJsonBody(): array {
    static $cached = null;
    if ($cached === null) {
        $raw = file_get_contents('php://input');
        if ($raw !== false && strlen($raw) > 2_000_000) {
            sendError('Request payload is too large.', 413);
        }
        $decoded = json_decode($raw ?: '[]', true);
        $cached = is_array($decoded) ? $decoded : [];
        // Every API body is a flat object of scalars. Arrays/objects as values would otherwise
        // trigger PHP warnings (500) deep inside the validators, so reject them up front.
        $bad = [];
        foreach ($cached as $k => $v) {
            if (is_array($v)) {
                $bad[(string)$k] = 'Invalid value.';
            }
        }
        if ($bad) {
            sendValidationError($bad);
        }
    }
    return $cached;
}

function requestMethod(): string {
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

function getQueryParam(string $name, $default = null) {
    $v = $_GET[$name] ?? $default;
    // ?name[]=x arrives as an array; no endpoint accepts that, so treat it as not supplied.
    return is_array($v) ? $default : $v;
}

/** True when $e is a MySQL/MariaDB duplicate-key error (1062), optionally for the named key. */
function isDuplicateKeyError(Throwable $e, ?string $key = null): bool {
    if (!($e instanceof PDOException) || (int)($e->errorInfo[1] ?? 0) !== 1062) {
        return false;
    }
    return $key === null || str_contains($e->getMessage(), "'" . $key . "'");
}

function toBool($value): bool {
    if (is_bool($value)) {
        return $value;
    }
    $normalized = strtolower(trim((string)$value));
    return in_array($normalized, ['1', 'true', 'yes', 'on'], true);
}

function todayManila(): string {
    return (new DateTimeImmutable('now', new DateTimeZone(APP_TIMEZONE)))->format('Y-m-d');
}

function isValidDate(string $value): bool {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
        return false;
    }
    $dt = DateTimeImmutable::createFromFormat('Y-m-d', $value, new DateTimeZone(APP_TIMEZONE));
    return $dt && $dt->format('Y-m-d') === $value;
}

function requireFields(array $data, array $required): array {
    $errors = [];
    foreach ($required as $field) {
        if (!isset($data[$field]) || $data[$field] === '' || $data[$field] === null) {
            $errors[$field] = 'This field is required.';
        }
    }
    return $errors;
}

function clampInt($value, int $min, int $max, int $fallback): int {
    if (!is_numeric($value)) {
        return $fallback;
    }
    $n = (int)$value;
    return max($min, min($max, $n));
}

function paginationParams(int $defaultLimit = 50, int $maxLimit = 200): array {
    $limit = clampInt(getQueryParam('limit', $defaultLimit), 1, $maxLimit, $defaultLimit);
    $offset = max(0, (int)getQueryParam('offset', 0));
    return [$limit, $offset];
}

function likeTerm(?string $search): ?string {
    if ($search === null || trim($search) === '') {
        return null;
    }
    $escaped = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], trim($search));
    return '%' . $escaped . '%';
}

function validateEmail(string $email): bool {
    return strlen($email) <= 255 && (bool)filter_var($email, FILTER_VALIDATE_EMAIL);
}

function normalizeEmail(string $email): string {
    return strtolower(trim($email));
}

function validStudentNumber(string $number): bool {
    return strlen($number) >= 2 && strlen($number) <= 50
        && (bool)preg_match('/^[A-Za-z0-9][A-Za-z0-9._\/-]{1,49}$/', $number);
}

function validateYear($year, array &$errors, string $key = 'year'): ?int {
    if ($year === null || $year === '') {
        return null;
    }
    if (!is_numeric($year)) {
        $errors[$key] = 'Year must be a number.';
        return null;
    }
    $y = (int)$year;
    if ($y < -2000 || $y > 2100) {
        $errors[$key] = 'Year is out of range.';
        return $y;
    }
    return $y;
}

function validateEnum($value, array $allowed, string $key, array &$errors, bool $optional = false) {
    if ($value === null || $value === '') {
        if (!$optional) {
            $errors[$key] = 'This field is required.';
        }
        return null;
    }
    if (!in_array($value, $allowed, true)) {
        $errors[$key] = 'Invalid value.';
        return null;
    }
    return $value;
}

function validateStringLength($value, int $min, int $max, string $key, array &$errors, bool $required = true): string {
    $text = trim((string)$value);
    if ($text === '') {
        if ($required) {
            $errors[$key] = 'This field is required.';
        }
        return '';
    }
    $len = mb_strlen($text);
    if ($len < $min || $len > $max) {
        $errors[$key] = "Must be between {$min} and {$max} characters.";
    }
    return $text;
}

function validateAvatarDataUrl($value): ?string {
    if ($value === null || $value === '') {
        return null;
    }
    if (!is_string($value) || !preg_match('#^data:image/(jpeg|jpg|png|webp);base64,#i', $value, $m)) {
        sendError('Avatar must be a JPEG, PNG, or WebP image.', 400);
    }
    $raw = substr($value, strpos($value, ',') + 1);
    $bin = base64_decode($raw, true);
    if ($bin === false || $bin === '') {
        sendError('Avatar image data is invalid.', 400);
    }
    if (strlen($bin) > 400_000) {
        sendError('Avatar is too large. Use a smaller photo.', 400);
    }
    $info = @getimagesizefromstring($bin);
    if ($info === false) {
        sendError('Avatar is not a valid image.', 400);
    }
    $mime = $info['mime'] ?? '';
    if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
        sendError('Avatar must be a JPEG, PNG, or WebP image.', 400);
    }
    return $value;
}

/** Common passwords/words (letters only, lowercase). A password that is one of these, or one of these plus a few
 *  digits/symbols, is rejected. Not exhaustive: it blocks the guesses attackers try first. */
const COMMON_PASSWORD_WORDS = [
    'password', 'passw', 'passwort', 'welcome', 'letmein', 'admin', 'administrator', 'root', 'qwerty', 'qwertyuiop',
    'qwertyuiopasdfghjkl', 'asdfgh', 'asdfghjkl', 'zxcvbn', 'zxcvbnm', 'iloveyou', 'monkey', 'dragon', 'master',
    'sunshine', 'princess', 'football', 'baseball', 'basketball', 'superman', 'batman', 'shadow', 'trustno',
    'michael', 'jennifer', 'jessica', 'charlie', 'jordan', 'harley', 'hunter', 'ranger', 'buster', 'thomas',
    'hello', 'freedom', 'whatever', 'login', 'abc', 'abcdef', 'abcdefgh', 'secret', 'changeme', 'default', 'guest',
    'test', 'testing', 'temp', 'temporary', 'access', 'starwars', 'pokemon', 'naruto', 'computer', 'internet',
    'library', 'librarian', 'books', 'school', 'student', 'teacher', 'feu', 'feuroosevelt', 'roosevelt',
    'philippines', 'pilipinas', 'manila', 'mahalkita', 'maganda', 'kamusta', 'mabuhay', 'angel', 'ilovemyself',
    'iloveyou', 'lovely', 'summer', 'winter', 'spring', 'autumn', 'january', 'february', 'november', 'december',
];

/** Returns a message if the password is too guessable, or null if it is acceptable (length is checked separately).
 *  $identity: values it must not contain (username, email). */
function passwordPolicyError(string $password, array $identity = []): ?string {
    $lower = strtolower($password);
    if (preg_match('/^(.)\1+$/su', $password)) {
        return 'A single repeated character is too easy to guess.';
    }
    if (preg_match('/^\d+$/', $password)) {
        return 'Digits alone are too easy to guess. Add letters.';
    }
    foreach ($identity as $v) {
        $v = strtolower(trim((string)$v));
        $candidates = array_filter([$v, str_contains($v, '@') ? explode('@', $v)[0] : null], static fn($c) => $c !== null && strlen($c) >= 4);
        foreach ($candidates as $c) {
            if (str_contains($lower, $c)) {
                return 'The password must not contain your username or email.';
            }
        }
    }
    // Compare the letters only, both as typed and with common look-alike substitutions undone (p@ssw0rd -> password).
    $plain = preg_replace('/[^a-z]+/', '', $lower);
    $leet = preg_replace('/[^a-z]+/', '', strtr($lower, ['@' => 'a', '4' => 'a', '0' => 'o', '1' => 'i', '!' => 'i', '3' => 'e', '$' => 's', '5' => 's', '7' => 't']));
    foreach (array_unique([$plain, $leet]) as $letters) {
        foreach (COMMON_PASSWORD_WORDS as $w) {
            $n = strlen($w);
            if ($letters === $w || ($n >= 6 && str_starts_with($letters, $w) && strlen($letters) <= $n + 4)) {
                return 'This password is too common or too easy to guess. Use a longer, less predictable one.';
            }
        }
    }
    return null;
}