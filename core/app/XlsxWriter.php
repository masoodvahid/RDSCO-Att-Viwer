<?php
declare(strict_types=1);
namespace Rdsco\AttReport;
final class XlsxWriter
{
    public static function build(string $path,array $report,string $fromJalali,string $toJalali): void
    {
        $dailyRows=[['کد پرسنلی','تاریخ شمسی','تاریخ میلادی','اولین ثبت (ورود)','آخرین ثبت (خروج)','ترددهای میانی','تعداد ثبت','فاصله اولین تا آخرین','وضعیت']];
        foreach($report['daily'] as $row)$dailyRows[]=[$row['employee_id'],$row['jalali_date'],$row['gregorian_date'],$row['first_entry'],$row['last_exit']??'',implode(' | ',$row['middle']),$row['count'],$row['span']??'',$row['status']];
        $rawRows=[['کد پرسنلی','تاریخ شمسی','تاریخ میلادی','زمان','Status','Verify','WorkCode','Reserved']];
        foreach($report['raw'] as $row){$date=substr($row['timestamp'],0,10);$rawRows[]=[$row['employee_id'],Jalali::formatFromGregorian($date),$date,substr($row['timestamp'],11,8),$row['status'],$row['verify'],$row['work_code'],$row['reserved']];}
        $infoRows=[['گزارش','سامانه گزارش تردد RDSCO'],['بازه شمسی',$fromJalali.' تا '.$toJalali],['تعداد پرسنل',$report['employee_count']],['تعداد رکورد خام',$report['record_count']],['تعداد روز/پرسنل',$report['day_count']],['قاعده ورود/خروج','اولین ثبت هر روز = ورود، آخرین ثبت = خروج. روز تک‌ثبت به‌صورت نامشخص علامت‌گذاری می‌شود.']];
        self::writeWorkbook($path,[['name'=>'خلاصه','rows'=>$infoRows,'rtl'=>true,'header'=>false],['name'=>'تردد روزانه','rows'=>$dailyRows,'rtl'=>true,'header'=>true],['name'=>'لاگ خام','rows'=>$rawRows,'rtl'=>true,'header'=>true]]);
    }
    private static function writeWorkbook(string $path,array $sheets): void
    {
        $zip=new ZipBuilder();$sheetXml=[];foreach($sheets as $i=>$sheet)$sheetXml[$i+1]=self::sheetXml($sheet['rows'],(bool)$sheet['rtl'],(bool)$sheet['header']);
        $contentTypes='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
        foreach(array_keys($sheetXml) as $i)$contentTypes.='<Override PartName="/xl/worksheets/sheet'.$i.'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';$contentTypes.='</Types>';
        $workbookSheets='';$rels='';foreach($sheets as $i=>$sheet){$n=$i+1;$workbookSheets.='<sheet name="'.self::xml($sheet['name']).'" sheetId="'.$n.'" r:id="rId'.$n.'"/>';$rels.='<Relationship Id="rId'.$n.'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'.$n.'.xml"/>';}
        $rels.='<Relationship Id="rId'.(count($sheets)+1).'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
        $zip->add('[Content_Types].xml',$contentTypes);$zip->add('_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
        $zip->add('xl/workbook.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'.$workbookSheets.'</sheets></workbook>');
        $zip->add('xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'.$rels.'</Relationships>');$zip->add('xl/styles.xml',self::stylesXml());foreach($sheetXml as $i=>$xml)$zip->add('xl/worksheets/sheet'.$i.'.xml',$xml);$zip->save($path);
    }
    private static function sheetXml(array $rows,bool $rtl,bool $header): string
    {
        $maxCols=1;foreach($rows as $row)$maxCols=max($maxCols,count($row));$lastCol=self::columnName($maxCols);$lastRow=max(1,count($rows));
        $xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:'.$lastCol.$lastRow.'"/><sheetViews><sheetView workbookViewId="0" rightToLeft="'.($rtl?'1':'0').'"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>';
        for($c=1;$c<=$maxCols;$c++){$width=$c<=3?18:($c===6?30:20);$xml.='<col min="'.$c.'" max="'.$c.'" width="'.$width.'" customWidth="1"/>';}$xml.='</cols><sheetData>';
        foreach($rows as $rIndex=>$row){$r=$rIndex+1;$xml.='<row r="'.$r.'" ht="24" customHeight="1">';foreach(array_values($row) as $cIndex=>$value){$ref=self::columnName($cIndex+1).$r;$style=($header&&$r===1)?1:2;if(is_int($value)||is_float($value))$xml.='<c r="'.$ref.'" s="'.$style.'"><v>'.$value.'</v></c>';else $xml.='<c r="'.$ref.'" s="'.$style.'" t="inlineStr"><is><t xml:space="preserve">'.self::xml((string)$value).'</t></is></c>';}$xml.='</row>';}$xml.='</sheetData>';if($header&&count($rows)>1)$xml.='<autoFilter ref="A1:'.$lastCol.$lastRow.'"/>';return $xml.'</worksheet>';
    }
    private static function stylesXml(): string { return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'; }
    private static function xml(string $value): string { return htmlspecialchars($value,ENT_XML1|ENT_COMPAT,'UTF-8'); }
    private static function columnName(int $index): string { $name='';while($index>0){$index--;$name=chr(65+($index%26)).$name;$index=intdiv($index,26);}return $name; }
}
