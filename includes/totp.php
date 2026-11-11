<?php

declare(strict_types=1);

const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1;
const TOTP_ISSUER = 'FEU Roosevelt Library';

function totpAlphabet(): string {
    return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
}

function totpBase32Encode(string $binary): string {
    $alphabet = totpAlphabet();
    $bits = '';
    foreach (str_split($binary) as $ch) {
        $bits .= str_pad(decbin(ord($ch)), 8, '0', STR_PAD_LEFT);
    }
    $out = '';
    foreach (str_split($bits, 5) as $chunk) {
        if (strlen($chunk) < 5) {
            $chunk = str_pad($chunk, 5, '0');
        }
        $out .= $alphabet[bindec($chunk)];
    }
    return $out;
}

function totpBase32Decode(string $secret): string {
    $alphabet = totpAlphabet();
    $secret = strtoupper(preg_replace('/\s+/', '', $secret) ?? '');
    $bits = '';
    for ($i = 0, $n = strlen($secret); $i < $n; $i++) {
        $pos = strpos($alphabet, $secret[$i]);
        if ($pos === false) {
            continue;
        }
        $bits .= str_pad(decbin($pos), 5, '0', STR_PAD_LEFT);
    }
    $out = '';
    foreach (str_split($bits, 8) as $chunk) {
        if (strlen($chunk) === 8) {
            $out .= chr(bindec($chunk));
        }
    }
    return $out;
}

function totpNewSecret(): string {
    return totpBase32Encode(random_bytes(20));
}

function totpCodeAt(string $secret, int $timestamp): string {
    $key = totpBase32Decode($secret);
    $counter = intdiv($timestamp, TOTP_PERIOD);
    $bin = pack('N*', 0) . pack('N*', $counter);
    $hash = hash_hmac('sha1', $bin, $key, true);
    $offset = ord($hash[19]) & 0x0f;
    $truncated = unpack('N', substr($hash, $offset, 4))[1] & 0x7fffffff;
    $mod = 10 ** TOTP_DIGITS;
    return str_pad((string)($truncated % $mod), TOTP_DIGITS, '0', STR_PAD_LEFT);
}

function totpVerify(string $secret, string $code, ?int $now = null): bool {
    $code = preg_replace('/\s+/', '', $code) ?? '';
    if (!preg_match('/^\d{6}$/', $code)) {
        return false;
    }
    $now = $now ?? time();
    for ($i = -TOTP_WINDOW; $i <= TOTP_WINDOW; $i++) {
        if (hash_equals(totpCodeAt($secret, $now + ($i * TOTP_PERIOD)), $code)) {
            return true;
        }
    }
    return false;
}

function totpOtpauthUri(string $secret, string $accountName): string {
    $label = rawurlencode(TOTP_ISSUER . ':' . $accountName);
    $query = http_build_query([
        'secret' => $secret,
        'issuer' => TOTP_ISSUER,
        'period' => TOTP_PERIOD,
        'digits' => TOTP_DIGITS,
        'algorithm' => 'SHA1',
    ], '', '&', PHP_QUERY_RFC3986);
    return "otpauth://totp/{$label}?{$query}";
}

function totpNewBackupCodes(): array {
    $codes = [];
    for ($i = 0; $i < 8; $i++) {
        $codes[] = strtoupper(bin2hex(random_bytes(4)));
    }
    return $codes;
}

function totpHashBackupCodes(array $codes): string {
    return json_encode(array_map(static fn(string $c): string => password_hash($c, PASSWORD_DEFAULT), $codes), JSON_THROW_ON_ERROR);
}

function totpConsumeBackupCode(?string $storedJson, string $code): ?string {
    $code = strtoupper(preg_replace('/\s+/', '', $code) ?? '');
    if ($storedJson === null || $storedJson === '' || !preg_match('/^[A-F0-9]{8}$/', $code)) {
        return null;
    }
    $hashes = json_decode($storedJson, true);
    if (!is_array($hashes)) {
        return null;
    }
    foreach ($hashes as $i => $hash) {
        if (is_string($hash) && password_verify($code, $hash)) {
            array_splice($hashes, (int)$i, 1);
            return json_encode(array_values($hashes), JSON_THROW_ON_ERROR);
        }
    }
    return null;
}

function totpIsEnabled(array $row): bool {
    return (int)($row['totp_enabled'] ?? 0) === 1 && (string)($row['totp_secret'] ?? '') !== '';
}

function totpStartPendingLogin(array $row): void {
    startSecureSession();
    session_regenerate_id(true);
    $_SESSION['mfa_login'] = [
        'id' => (int)$row['id'],
        'expires' => time() + 300,
        'pwv' => passwordVersion((string)$row['password_hash']),
    ];
    unset($_SESSION['user']);
}

function totpPendingLoginId(): ?int {
    startSecureSession();
    $pending = $_SESSION['mfa_login'] ?? null;
    if (!is_array($pending) || time() > (int)($pending['expires'] ?? 0)) {
        unset($_SESSION['mfa_login']);
        return null;
    }
    return (int)$pending['id'];
}

function totpClearPendingLogin(): void {
    unset($_SESSION['mfa_login']);
}
