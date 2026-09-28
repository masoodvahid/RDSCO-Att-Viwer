<?php

declare(strict_types=1);

namespace Rdsco\AttReport;

use RuntimeException;

final class Auth
{
    private static function usersPath(): string { return Helpers::storagePath('users.json'); }
    public static function hasUsers(): bool { return count(self::users()) > 0; }
    public static function users(): array
    {
        $data = JsonStore::read(self::usersPath(), ['users' => []]);
        return is_array($data['users'] ?? null) ? $data['users'] : [];
    }
    public static function createFirstUser(string $mobile, string $password): array
    {
        if (self::hasUsers()) throw new RuntimeException('راه‌اندازی اولیه قبلاً انجام شده است.');
        $mobile = Helpers::normalizeMobile($mobile) ?? throw new RuntimeException('شماره موبایل معتبر نیست.');
        if (strlen($password) < 10) throw new RuntimeException('رمز عبور باید حداقل ۱۰ کاراکتر باشد.');
        $user = ['id'=>bin2hex(random_bytes(16)),'mobile'=>$mobile,'password_hash'=>password_hash($password,PASSWORD_DEFAULT),'created_at'=>date(DATE_ATOM),'updated_at'=>date(DATE_ATOM)];
        JsonStore::write(self::usersPath(), ['users'=>[$user]]);
        Audit::log('setup.completed',['mobile'=>$mobile]);
        return $user;
    }
    public static function findByMobile(string $mobile): ?array
    {
        $mobile = Helpers::normalizeMobile($mobile);
        if (!$mobile) return null;
        foreach (self::users() as $user) if (($user['mobile'] ?? null) === $mobile) return $user;
        return null;
    }
    public static function loginWithPassword(string $mobile, string $password): bool
    {
        $normalized = Helpers::normalizeMobile($mobile) ?? $mobile;
        $rate = RateLimiter::attempt('login', Helpers::requestIp().'|'.$normalized, 8, 900);
        if (!$rate['allowed']) throw new RuntimeException('تعداد تلاش ورود زیاد است. کمی بعد دوباره تلاش کنید.');
        $user = self::findByMobile($mobile);
        if (!$user || !password_verify($password,(string)($user['password_hash']??''))) { Audit::log('auth.password_failed',['mobile'=>$normalized]); return false; }
        self::establish($user,'password'); return true;
    }
    public static function requestOtp(string $mobile): void
    {
        $normalized = Helpers::normalizeMobile($mobile);
        $rate = RateLimiter::attempt('otp_request', Helpers::requestIp().'|'.($normalized??'invalid'), 5, 600);
        if (!$rate['allowed']) throw new RuntimeException('تعداد درخواست رمز یکبار مصرف زیاد است. کمی بعد دوباره تلاش کنید.');
        $user = $normalized ? self::findByMobile($normalized) : null;
        if (!$user) { Audit::log('auth.otp_requested_unknown',['mobile'=>$normalized]); return; }
        $code = (string)random_int(100000,999999);
        $path = self::otpPath($normalized);
        JsonStore::write($path,['hash'=>password_hash($code,PASSWORD_DEFAULT),'expires_at'=>time()+max(60,Env::int('OTP_TTL_SECONDS',120)),'attempts'=>0,'sent_at'=>time()]);
        Kavenegar::sendOtp($normalized,$code);
        Audit::log('auth.otp_sent',['mobile'=>$normalized]);
    }
    public static function loginWithOtp(string $mobile, string $code): bool
    {
        $normalized = Helpers::normalizeMobile($mobile);
        if (!$normalized || !preg_match('/^\d{6}$/', Helpers::normalizeDigits($code))) return false;
        $user = self::findByMobile($normalized); if (!$user) return false;
        $path = self::otpPath($normalized); $data = JsonStore::read($path,[]);
        if (!$data || (int)($data['expires_at']??0) < time()) { @unlink($path); Audit::log('auth.otp_failed',['mobile'=>$normalized,'reason'=>'expired_or_missing']); return false; }
        $attempts = (int)($data['attempts']??0)+1; $max=max(3,Env::int('OTP_MAX_ATTEMPTS',5));
        if ($attempts>$max) { @unlink($path); Audit::log('auth.otp_failed',['mobile'=>$normalized,'reason'=>'too_many_attempts']); return false; }
        $data['attempts']=$attempts; JsonStore::write($path,$data); $code=Helpers::normalizeDigits($code);
        if (!password_verify($code,(string)($data['hash']??''))) { Audit::log('auth.otp_failed',['mobile'=>$normalized,'reason'=>'invalid']); return false; }
        @unlink($path); self::establish($user,'otp'); return true;
    }
    private static function otpPath(string $mobile): string { return Helpers::storagePath('otp/'.hash('sha256',$mobile.'|'.(Env::get('APP_KEY','')?:'local')).'.json'); }
    private static function establish(array $user,string $method): void
    {
        session_regenerate_id(true);
        $_SESSION['user']=['id'=>$user['id'],'mobile'=>$user['mobile'],'login_at'=>time(),'method'=>$method];
        Audit::log('auth.login',['method'=>$method]);
    }
    public static function check(): bool { return is_array($_SESSION['user']??null) && !empty($_SESSION['user']['id']); }
    public static function user(): ?array { return self::check()?$_SESSION['user']:null; }
    public static function requireUser(): void { if (!self::check()) Helpers::jsonResponse(['ok'=>false,'message'=>'ابتدا وارد سامانه شوید.'],401); }
    public static function logout(): void
    {
        if (self::check()) Audit::log('auth.logout');
        $_SESSION=[];
        if (ini_get('session.use_cookies')) { $p=session_get_cookie_params(); setcookie(session_name(),'',time()-42000,$p['path'],$p['domain']??'',$p['secure'],$p['httponly']); }
        session_destroy();
    }
}
