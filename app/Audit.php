<?php

declare(strict_types=1);

namespace Rdsco\AttReport;

final class Audit
{
    public static function log(string $event, array $context = []): void
    {
        $mobile = Auth::user()['mobile'] ?? ($context['mobile'] ?? null);
        unset($context['password'], $context['otp'], $context['api_key'], $context['token']);

        $entry = [
            'at' => date(DATE_ATOM),
            'event' => $event,
            'user' => $mobile,
            'ip' => Helpers::requestIp(),
            'ua' => Helpers::requestUserAgent(),
            'request_id' => $_SERVER['HTTP_X_REQUEST_ID'] ?? bin2hex(random_bytes(8)),
            'context' => $context,
        ];

        $path = Helpers::storagePath('logs/audit-' . date('Y-m') . '.jsonl');
        $handle = fopen($path, 'ab');
        if ($handle) {
            flock($handle, LOCK_EX);
            fwrite($handle, json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL);
            fflush($handle);
            flock($handle, LOCK_UN);
            fclose($handle);
            @chmod($path, 0600);
        }
    }

    public static function recent(int $limit = 100): array
    {
        $files = glob(Helpers::storagePath('logs/audit-*.jsonl')) ?: [];
        rsort($files, SORT_STRING);
        $items = [];

        foreach ($files as $file) {
            $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
            for ($i = count($lines) - 1; $i >= 0; $i--) {
                $row = json_decode($lines[$i], true);
                if (is_array($row)) {
                    $items[] = $row;
                    if (count($items) >= $limit) {
                        return $items;
                    }
                }
            }
        }
        return $items;
    }
}
