<?php

declare(strict_types=1);

/** Cache-bust query value for a file next to the app root (index.php / users.php). */
function assetVersion(string $relative): int {
    return (int)@filemtime(dirname(__DIR__) . '/' . $relative);
}

function htmlPageHeaders(): void {
    if (headers_sent()) {
        return;
    }
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('Cache-Control: no-cache, must-revalidate');
}
