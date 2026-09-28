<?php

declare(strict_types=1);

namespace Rdsco\AttReport;

use RuntimeException;

final class Helpers
{
    public static function storagePath(string $suffix = ''): string
    {
        $configured = trim((string) Env::get('STORAGE_PATH', ''));
        $base = $configured !== '' ? rtrim($configured, DIRECTORY_SEPARATOR) : BASE_PATH . '/storage';
        return $suffix === '' ? $base : $base . '/' . ltrim($suffix, '/');
    }

    public static function ensureStorage(): void
    {
        foreach (['', 'logs', 'jobs', 'otp', 'rate'] as $dir) {
            $path = self::storagePath($dir);
            if (!is_dir($path) && !mkdir($path, 0700, true) && !is_dir($path)) {
                throw new RuntimeException('Cannot create storage directory: ' . $path);
            }
            @chmod($path, 0700);
        }
    }

    public static function jsonResponse(array $payload, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store, max-age=0');
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    public static function csrfToken(): string
    {
        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }
        return (string) $_SESSION['csrf_token'];
    }

    public static function verifyCsrf(): void
    {
        $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? $_POST['_csrf'] ?? '';
        if (!is_string($token) || !hash_equals(self::csrfToken(), $token)) {
            self::jsonResponse(['ok' => false, 'message' => 'نشست امنیتی معتبر نیست. صفحه را تازه‌سازی کنید.'], 419);
        }
    }

    public static function requestIp(): string
    {
        return substr((string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 0, 64);
    }

    public static function requestUserAgent(): string
    {
        return substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? 'unknown'), 0, 500);
    }

    public static function normalizeDigits(string $value): string
    {
        return strtr($value, [
            '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4',
            '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9',
            '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4',
            '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
        ]);
    }

    public static function normalizeMobile(string $mobile): ?string
    {
        $mobile = preg_replace('/\D+/', '', self::normalizeDigits($mobile)) ?? '';
        if (str_starts_with($mobile, '0098')) {
            $mobile = '0' . substr($mobile, 4);
        } elseif (str_starts_with($mobile, '98') && strlen($mobile) === 12) {
            $mobile = '0' . substr($mobile, 2);
        } elseif (strlen($mobile) === 10 && str_starts_with($mobile, '9')) {
            $mobile = '0' . $mobile;
        }

        return preg_match('/^09\d{9}$/', $mobile) ? $mobile : null;
    }

    public static function maskMobile(string $mobile): string
    {
        if (strlen($mobile) !== 11) {
            return $mobile;
        }
        return substr($mobile, 0, 4) . '***' . substr($mobile, -4);
    }

    public static function safeFilename(string $name): string
    {
        $name = preg_replace('/[^A-Za-z0-9._-]+/', '-', $name) ?: 'file';
        return trim($name, '-.');
    }

    public static function download(string $path, string $downloadName, string $contentType): never
    {
        if (!is_file($path)) {
            http_response_code(404);
            exit('File not found');
        }
        header('Content-Type: ' . $contentType);
        header('Content-Disposition: attachment; filename="' . self::safeFilename($downloadName) . '"');
        header('Content-Length: ' . filesize($path));
        header('Cache-Control: no-store, private');
        readfile($path);
        exit;
    }
}
