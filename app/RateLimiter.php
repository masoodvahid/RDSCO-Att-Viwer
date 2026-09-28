<?php

declare(strict_types=1);

namespace Rdsco\AttReport;

final class RateLimiter
{
    public static function attempt(string $scope, string $key, int $max, int $windowSeconds): array
    {
        $hash = hash('sha256', $scope . '|' . $key);
        $path = Helpers::storagePath('rate/' . $hash . '.json');
        $now = time();
        $data = JsonStore::read($path, ['timestamps' => []]);
        $timestamps = array_values(array_filter(
            array_map('intval', $data['timestamps'] ?? []),
            static fn (int $ts): bool => $ts > ($now - $windowSeconds)
        ));

        if (count($timestamps) >= $max) {
            $retry = max(1, $windowSeconds - ($now - min($timestamps)));
            return ['allowed' => false, 'retry_after' => $retry];
        }

        $timestamps[] = $now;
        JsonStore::write($path, ['timestamps' => $timestamps]);
        return ['allowed' => true, 'retry_after' => 0];
    }
}
