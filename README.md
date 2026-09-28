# RDSCO Attendance Report Maker

سامانه سبک PHP برای دریافت خروجی دستگاه ساعت‌زنی، فیلتر بر اساس تاریخ شمسی و تولید Excel/PDF.

## قابلیت‌های MVP

- PHP خالص و بدون فریم‌ورک یا دیتابیس خارجی.
- ورود با شماره موبایل و رمز عبور.
- ورود با OTP کاوه‌نگار.
- فقط یک سطح دسترسی.
- ثبت Audit Log برای ورود، خروج، آپلود، فیلتر، خروجی و خطاها.
- CSRF، Session امن و Rate Limit.
- آپلود DAT/TXT/CSV با ساختار:
  `EmployeeID<TAB>YYYY-MM-DD HH:MM:SS<TAB>Status<TAB>Verify<TAB>WorkCode<TAB>Reserved`
- فیلتر با تاریخ شمسی.
- درج تاریخ شمسی و میلادی در Excel و PDF.
- Excel سه‌شیتی: خلاصه، تردد روزانه و لاگ خام.
- PDF افقی A4؛ هر پرسنل از صفحه جدید شروع می‌شود و هیچ صفحه‌ای بین دو پرسنل مشترک نیست.
- اولین ثبت هر روز = ورود، آخرین ثبت = خروج؛ تک‌ثبت = نامشخص.
- بدون CDN در Runtime.

## نیازمندی‌ها

- PHP 8.2+
- دسترسی نوشتن به `storage/`
- HTTPS در Production
- برای PDF: Chromium یا Google Chrome محلی + فعال بودن `proc_open`
- برای OTP: دسترسی HTTPS به API کاوه‌نگار؛ cURL یا `allow_url_fopen`

Excel توسط Writer داخلی ساخته می‌شود و به PhpSpreadsheet یا ZipArchive نیاز ندارد.

## نصب

```bash
git clone https://github.com/masoodvahid/rdsco_att_report_maker.git
cd rdsco_att_report_maker
cp .env.example .env
```

Document Root دامنه را روی `public/` قرار دهید.

برای تست محلی:

```bash
php -S 127.0.0.1:8080 -t public
```

در اولین بازدید، فرم ساخت اولین اپراتور باز می‌شود. بعد از ساخت اولین حساب، ثبت‌نام بسته می‌شود.

## تنظیمات env

```dotenv
APP_ENV=production
APP_TIMEZONE=Asia/Tehran
APP_KEY=change-this
KAVENEGAR_API_KEY=...
KAVENEGAR_OTP_TEMPLATE=YourVerifyTemplate
PDF_BROWSER_PATH=/usr/bin/chromium
PDF_NO_SANDBOX=false
PDF_TIMEOUT_SECONDS=60
```

اگر Verify Lookup کاوه‌نگار استفاده نمی‌شود، `KAVENEGAR_OTP_TEMPLATE` خالی و `KAVENEGAR_SENDER` تنظیم شود.

## Vazirmatn

برای استفاده کاملاً محلی از فونت، فایل زیر را خودتان در این مسیر قرار دهید:

```text
public/assets/fonts/Vazirmatn-Regular.woff2
```

در نبود فونت، رابط با Tahoma/Arial نمایش داده می‌شود.

## Tailwind

فایل source برای Tailwind v4 در `resources/css/app.css` و فرمان build در `package.json` قرار دارد. Runtime به هیچ CDN وابسته نیست.

```bash
npm install
npm run build:css
```

## امنیت

- `.env` و `storage/` خارج از Document Root بمانند.
- رمز با `password_hash()` ذخیره می‌شود.
- OTP فقط به‌صورت hash و با TTL کوتاه ذخیره می‌شود.
- فایل خام آپلودی نگهداری نمی‌شود؛ Job نرمال‌شده طبق `JOB_TTL_HOURS` منقضی می‌شود.
- لاگ‌ها در `storage/logs/` به‌صورت JSONL ذخیره می‌شوند.
- در Production حتماً HTTPS و Permission محدود برای `.env` و `storage` اعمال شود.

## نکته PDF

PDF با Chromium/Chrome محلی سرور تولید می‌شود. اگر هاست اشتراکی `proc_open` را بسته باشد، PDF سمت سرور در آن محیط قابل تولید نیست و باید Chrome/Chromium و این تابع فعال باشند.
