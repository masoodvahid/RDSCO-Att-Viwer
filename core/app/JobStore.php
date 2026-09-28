<?php
declare(strict_types=1);
namespace Rdsco\AttReport;
use Generator;
use RuntimeException;
final class JobStore
{
    public static function create(string $originalName): array
    {
        self::cleanup();$id=bin2hex(random_bytes(16));$dir=Helpers::storagePath('jobs/'.$id);
        if (!mkdir($dir,0700,true)&&!is_dir($dir)) throw new RuntimeException('ساخت فضای پردازش فایل ناموفق بود.');
        return ['id'=>$id,'dir'=>$dir,'records_path'=>$dir.'/records.ndjson','original_name'=>$originalName];
    }
    public static function dir(string $id): string { self::assertId($id); return Helpers::storagePath('jobs/'.$id); }
    public static function saveMeta(string $id,array $meta): void { JsonStore::write(self::dir($id).'/meta.json',$meta); }
    public static function meta(string $id): array { $m=JsonStore::read(self::dir($id).'/meta.json',[]); if(!$m) throw new RuntimeException('فایل پردازش‌شده پیدا نشد یا منقضی شده است.'); return $m; }
    public static function filtered(string $id,string $fromGregorian,string $toGregorian): Generator
    {
        $path=self::dir($id).'/records.ndjson'; if(!is_file($path)) throw new RuntimeException('رکوردهای پردازش‌شده پیدا نشد.');
        $from=$fromGregorian.' 00:00:00';$to=$toGregorian.' 23:59:59';$h=fopen($path,'rb');if(!$h)throw new RuntimeException('خواندن رکوردهای پردازش‌شده ممکن نیست.');
        try { while(($line=fgets($h))!==false){$row=json_decode($line,true);if(!is_array($row))continue;$ts=(string)($row['timestamp']??'');if($ts>=$from&&$ts<=$to)yield $row;} } finally { fclose($h); }
    }
    public static function delete(string $id): void { $dir=self::dir($id);if(!is_dir($dir))return;foreach(glob($dir.'/*')?:[] as $f)if(is_file($f))@unlink($f);@rmdir($dir); }
    public static function cleanup(): void
    {
        $ttl=max(1,Env::int('JOB_TTL_HOURS',24))*3600;
        foreach(glob(Helpers::storagePath('jobs/*'),GLOB_ONLYDIR)?:[] as $dir){$m=filemtime($dir);if($m!==false&&$m<time()-$ttl){$id=basename($dir);if(preg_match('/^[a-f0-9]{32}$/',$id))self::delete($id);}}
    }
    private static function assertId(string $id): void { if(!preg_match('/^[a-f0-9]{32}$/',$id))throw new RuntimeException('شناسه پردازش نامعتبر است.'); }
}
