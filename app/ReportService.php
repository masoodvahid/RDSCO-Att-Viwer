<?php
declare(strict_types=1);
namespace Rdsco\AttReport;
use DateTimeImmutable;
final class ReportService
{
    public static function collect(iterable $records): array
    {
        $raw=[];$daily=[];$employees=[];
        foreach($records as $row){$employee=(string)$row['employee_id'];$timestamp=(string)$row['timestamp'];$date=substr($timestamp,0,10);$time=substr($timestamp,11,8);$raw[]=$row;$employees['e:'.$employee]=true;$daily['e:'.$employee][$date][]=$time;}
        ksort($daily,SORT_NATURAL);$summaries=[];
        foreach($daily as $employeeKey=>$dates){$employee=substr((string)$employeeKey,2);ksort($dates,SORT_STRING);foreach($dates as $date=>$times){sort($times,SORT_STRING);$count=count($times);$first=$times[0];$last=$count>1?$times[$count-1]:null;$middle=$count>2?array_slice($times,1,-1):[];$span=$last?self::diff($date.' '.$first,$date.' '.$last):null;$summaries[]=['employee_id'=>$employee,'gregorian_date'=>$date,'jalali_date'=>Jalali::formatFromGregorian($date),'first_entry'=>$first,'last_exit'=>$last,'middle'=>$middle,'count'=>$count,'span'=>$span,'status'=>$count===1?'تک‌ثبت / نامشخص':'کامل'];}}
        return ['raw'=>$raw,'daily'=>$summaries,'employee_count'=>count($employees),'record_count'=>count($raw),'day_count'=>count($summaries)];
    }
    private static function diff(string $from,string $to): string { $a=new DateTimeImmutable($from);$b=new DateTimeImmutable($to);$s=$b->getTimestamp()-$a->getTimestamp();return sprintf('%02d:%02d',intdiv($s,3600),intdiv($s%3600,60)); }
}
