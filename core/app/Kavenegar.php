<?php
declare(strict_types=1);
namespace Rdsco\AttReport;
use RuntimeException;
final class Kavenegar
{
    public static function sendOtp(string $mobile,string $code): void
    {
        $apiKey=trim((string)Env::get('KAVENEGAR_API_KEY',''));
        if ($apiKey==='') throw new RuntimeException('API Key کاوه‌نگار در فایل env تنظیم نشده است.');
        $template=trim((string)Env::get('KAVENEGAR_OTP_TEMPLATE',''));
        if ($template!=='') { $url='https://api.kavenegar.com/v1/'.rawurlencode($apiKey).'/verify/lookup.json'; $params=['receptor'=>$mobile,'token'=>$code,'template'=>$template]; }
        else { $sender=trim((string)Env::get('KAVENEGAR_SENDER','')); if ($sender==='') throw new RuntimeException('برای ارسال پیامک عادی، KAVENEGAR_SENDER را تنظیم کنید یا قالب OTP معرفی کنید.'); $url='https://api.kavenegar.com/v1/'.rawurlencode($apiKey).'/sms/send.json'; $params=['receptor'=>$mobile,'sender'=>$sender,'message'=>'رمز یکبار مصرف ورود: '.$code]; }
        $decoded=json_decode(self::post($url,$params),true);
        if ((int)($decoded['return']['status']??0)!==200) throw new RuntimeException('ارسال پیامک از طریق کاوه‌نگار ناموفق بود.');
    }
    private static function post(string $url,array $params): string
    {
        $body=http_build_query($params);
        if (function_exists('curl_init')) {
            $ch=curl_init($url); curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>$body,CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>15,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_HTTPHEADER=>['Content-Type: application/x-www-form-urlencoded']]);
            $result=curl_exec($ch); $error=curl_error($ch); curl_close($ch);
            if ($result===false) throw new RuntimeException('خطا در ارتباط با کاوه‌نگار: '.$error);
            return (string)$result;
        }
        $ctx=stream_context_create(['http'=>['method'=>'POST','header'=>"Content-Type: application/x-www-form-urlencoded\r\nConnection: close\r\n",'content'=>$body,'timeout'=>15,'ignore_errors'=>true]]);
        $result=@file_get_contents($url,false,$ctx);
        if ($result===false) throw new RuntimeException('امکان ارتباط HTTPS با کاوه‌نگار وجود ندارد.');
        return $result;
    }
}
