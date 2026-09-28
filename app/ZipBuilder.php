<?php
declare(strict_types=1);
namespace Rdsco\AttReport;
use RuntimeException;
final class ZipBuilder
{
    private array $files=[];
    public function add(string $name,string $data): void { $name=str_replace('\\','/',ltrim($name,'/'));$this->files[]=['name'=>$name,'data'=>$data]; }
    public function save(string $path): void
    {
        $out=fopen($path,'wb');if(!$out)throw new RuntimeException('ساخت فایل ZIP/XLSX ممکن نیست.');
        $central='';$offset=0;[$dosTime,$dosDate]=$this->dosTimeDate();
        foreach($this->files as $file){$name=$file['name'];$data=$file['data'];$crc=hexdec(hash('crc32b',$data));$size=strlen($data);$nameLen=strlen($name);
            $local=pack('VvvvvvVVVvv',0x04034b50,20,0,0,$dosTime,$dosDate,$crc,$size,$size,$nameLen,0).$name.$data;fwrite($out,$local);
            $central.=pack('VvvvvvvVVVvvvvvVV',0x02014b50,20,20,0,0,$dosTime,$dosDate,$crc,$size,$size,$nameLen,0,0,0,0,0,$offset).$name;$offset+=strlen($local);}
        $centralOffset=$offset;fwrite($out,$central);$centralSize=strlen($central);$count=count($this->files);fwrite($out,pack('VvvvvVVv',0x06054b50,0,0,$count,$count,$centralSize,$centralOffset,0));fclose($out);@chmod($path,0600);
    }
    private function dosTimeDate(): array { $t=getdate();$year=max(1980,(int)$t['year']);return [((int)$t['hours']<<11)|((int)$t['minutes']<<5)|intdiv((int)$t['seconds'],2),(($year-1980)<<9)|((int)$t['mon']<<5)|(int)$t['mday']]; }
}
