<?php

declare(strict_types=1);

namespace Rdsco\AttReport;

use RuntimeException;

final class JsonStore
{
    public static function read(string $path, array $default = []): array
    {
        if (!is_file($path)) {
            return $default;
        }
        $handle = fopen($path, 'rb');
        if (!$handle) {
            return $default;
        }
        flock($handle, LOCK_SH);
        $data = stream_get_contents($handle);
        flock($handle, LOCK_UN);
        fclose($handle);

        $decoded = json_decode((string) $data, true);
        return is_array($decoded) ? $decoded : $default;
    }

    public static function write(string $path, array $data): void
    {
        $dir = dirname($path);
        if (!is_dir($dir)) {
            mkdir($dir, 0700, true);
        }
        $tmp = $path . '.' . bin2hex(random_bytes(6)) . '.tmp';
        $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
        if ($json === false || file_put_contents($tmp, $json, LOCK_EX) === false) {
            throw new RuntimeException('Cannot write JSON store.');
        }
        @chmod($tmp, 0600);
        if (!rename($tmp, $path)) {
            @unlink($tmp);
            throw new RuntimeException('Cannot replace JSON store.');
        }
        @chmod($path, 0600);
    }
}
