<?php

declare(strict_types=1);

use Rdsco\AttReport\Env;
use Rdsco\AttReport\Helpers;

if (!defined('BASE_PATH')) {
    define('BASE_PATH', dirname(__DIR__));
}

if (!defined('PUBLIC_PATH')) {
    define('PUBLIC_PATH', dirname(BASE_PATH) . '/public_html');
}

spl_autoload_register(static function (string $class): void {
    $prefix = 'Rdsco\\AttReport\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    $path = BASE_PATH . '/app/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($path)) {
        require $path;
    }
});

Env::load(BASE_PATH . '/.env');
date_default_timezone_set(Env::get('APP_TIMEZONE', 'Asia/Tehran') ?: 'Asia/Tehran');

$secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
$sessionMinutes = max(15, Env::int('SESSION_LIFETIME_MINUTES', 120));
session_name(Env::get('SESSION_NAME', 'rdsco_att_session') ?: 'rdsco_att_session');
session_set_cookie_params([
    'lifetime' => $sessionMinutes * 60,
    'path' => '/',
    'secure' => $secure,
    'httponly' => true,
    'samesite' => 'Strict',
]);
if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}

ini_set('display_errors', Env::get('APP_ENV', 'production') === 'production' ? '0' : '1');
ini_set('log_errors', '1');
Helpers::ensureStorage();
