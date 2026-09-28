<?php

declare(strict_types=1);

namespace Rdsco\AttReport;

use InvalidArgumentException;

final class Jalali
{
    public static function toJalali(int $gy, int $gm, int $gd): array
    {
        $gDaysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        $jDaysInMonth = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];
        $gy2 = $gy - 1600;
        $gm2 = $gm - 1;
        $gd2 = $gd - 1;

        $gDayNo = 365 * $gy2 + intdiv($gy2 + 3, 4) - intdiv($gy2 + 99, 100) + intdiv($gy2 + 399, 400);
        for ($i = 0; $i < $gm2; $i++) {
            $gDayNo += $gDaysInMonth[$i];
        }
        if ($gm2 > 1 && (($gy2 % 4 === 0 && $gy2 % 100 !== 0) || $gy2 % 400 === 0)) {
            $gDayNo++;
        }
        $gDayNo += $gd2;

        $jDayNo = $gDayNo - 79;
        $jNp = intdiv($jDayNo, 12053);
        $jDayNo %= 12053;
        $jy = 979 + 33 * $jNp + 4 * intdiv($jDayNo, 1461);
        $jDayNo %= 1461;
        if ($jDayNo >= 366) {
            $jy += intdiv($jDayNo - 1, 365);
            $jDayNo = ($jDayNo - 1) % 365;
        }
        for ($i = 0; $i < 11 && $jDayNo >= $jDaysInMonth[$i]; $i++) {
            $jDayNo -= $jDaysInMonth[$i];
        }
        return [$jy, $i + 1, $jDayNo + 1];
    }

    public static function toGregorian(int $jy, int $jm, int $jd): array
    {
        $gDaysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        $jDaysInMonth = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];
        $jy2 = $jy - 979;
        $jm2 = $jm - 1;
        $jd2 = $jd - 1;

        $jDayNo = 365 * $jy2 + intdiv($jy2, 33) * 8 + intdiv(($jy2 % 33) + 3, 4);
        for ($i = 0; $i < $jm2; $i++) {
            $jDayNo += $jDaysInMonth[$i];
        }
        $jDayNo += $jd2;

        $gDayNo = $jDayNo + 79;
        $gy = 1600 + 400 * intdiv($gDayNo, 146097);
        $gDayNo %= 146097;
        $leap = true;
        if ($gDayNo >= 36525) {
            $gDayNo--;
            $gy += 100 * intdiv($gDayNo, 36524);
            $gDayNo %= 36524;
            if ($gDayNo >= 365) {
                $gDayNo++;
            } else {
                $leap = false;
            }
        }
        $gy += 4 * intdiv($gDayNo, 1461);
        $gDayNo %= 1461;
        if ($gDayNo >= 366) {
            $leap = false;
            $gDayNo--;
            $gy += intdiv($gDayNo, 365);
            $gDayNo %= 365;
        }
        for ($i = 0; $gDayNo >= $gDaysInMonth[$i] + (($i === 1 && $leap) ? 1 : 0); $i++) {
            $gDayNo -= $gDaysInMonth[$i] + (($i === 1 && $leap) ? 1 : 0);
        }
        return [$gy, $i + 1, $gDayNo + 1];
    }

    public static function formatFromGregorian(string $date): string
    {
        if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $m)) {
            return '';
        }
        [$jy, $jm, $jd] = self::toJalali((int) $m[1], (int) $m[2], (int) $m[3]);
        return sprintf('%04d/%02d/%02d', $jy, $jm, $jd);
    }

    public static function parseToGregorian(string $jalali): string
    {
        $jalali = Helpers::normalizeDigits(trim($jalali));
        $jalali = str_replace(['-', '.'], '/', $jalali);
        if (!preg_match('/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/', $jalali, $m)) {
            throw new InvalidArgumentException('تاریخ شمسی نامعتبر است. نمونه صحیح: 1405/07/06');
        }
        $jy = (int) $m[1];
        $jm = (int) $m[2];
        $jd = (int) $m[3];
        if ($jm < 1 || $jm > 12 || $jd < 1 || $jd > 31 || ($jm > 6 && $jd > 30)) {
            throw new InvalidArgumentException('تاریخ شمسی نامعتبر است.');
        }
        [$gy, $gm, $gd] = self::toGregorian($jy, $jm, $jd);
        return sprintf('%04d-%02d-%02d', $gy, $gm, $gd);
    }
}
