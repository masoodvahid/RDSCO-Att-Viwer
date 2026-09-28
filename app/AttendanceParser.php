<?php
declare(strict_types=1);
namespace Rdsco\AttReport;
use DateTimeImmutable;
use RuntimeException;
final class AttendanceParser
{
    public static function parseToJob(string $uploadedPath,string $originalName): array
    {
        $maxBytes=max(1,Env::int('MAX_UPLOAD_MB',20))*1024*1024; $size=filesize($uploadedPath);
        if ($size===false||$size<=0||$size>$maxBytes) throw new RuntimeException('حجم فایل مجاز نیست.');
        $ext=strtolower(pathinfo($originalName,PATHINFO_EXTENSION));
        if (!in_array($ext,['dat','txt','csv'],true)) throw new RuntimeException('فرمت فایل باید DAT، TXT یا CSV باشد.');
        $job=JobStore::create($originalName); $out=fopen($job['records_path'],'wb'); $in=fopen($uploadedPath,'rb');
        if (!$out||!$in) throw new RuntimeException('خواندن فایل ورودی ممکن نیست.');
        $valid=0;$invalid=0;$employees=[];$minTs=null;$maxTs=null;
        while (($line=fgets($in))!==false) {
            $line=trim($line); if ($line==='') continue;
            $parts=preg_split('/\t+/',$line)?:[];
            if (count($parts)<6 && preg_match('/^\s*(\S+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/',$line,$m)) $parts=array_slice($m,1,6);
            if (count($parts)<6){$invalid++;continue;}
            $employeeId=trim((string)$parts[0]);$timestamp=trim((string)$parts[1]);$dt=DateTimeImmutable::createFromFormat('Y-m-d H:i:s',$timestamp);
            if ($employeeId===''||!$dt||$dt->format('Y-m-d H:i:s')!==$timestamp){$invalid++;continue;}
            $record=['employee_id'=>$employeeId,'timestamp'=>$timestamp,'status'=>trim((string)$parts[2]),'verify'=>trim((string)$parts[3]),'work_code'=>trim((string)$parts[4]),'reserved'=>trim((string)$parts[5])];
            fwrite($out,json_encode($record,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)."\n");
            $valid++;$employees[$employeeId]=($employees[$employeeId]??0)+1;$minTs=$minTs===null||$timestamp<$minTs?$timestamp:$minTs;$maxTs=$maxTs===null||$timestamp>$maxTs?$timestamp:$maxTs;
        }
        fclose($in);fclose($out);@chmod($job['records_path'],0600);
        if ($valid===0){JobStore::delete($job['id']);throw new RuntimeException('هیچ رکورد معتبری در فایل پیدا نشد.');}
        ksort($employees,SORT_NATURAL);
        $meta=['id'=>$job['id'],'original_name'=>basename($originalName),'created_at'=>date(DATE_ATOM),'records'=>$valid,'invalid_records'=>$invalid,'employees'=>$employees,'employee_count'=>count($employees),'min_timestamp'=>$minTs,'max_timestamp'=>$maxTs,'min_gregorian'=>substr((string)$minTs,0,10),'max_gregorian'=>substr((string)$maxTs,0,10),'min_jalali'=>Jalali::formatFromGregorian(substr((string)$minTs,0,10)),'max_jalali'=>Jalali::formatFromGregorian(substr((string)$maxTs,0,10))];
        JobStore::saveMeta($job['id'],$meta); return $meta;
    }
}
