# RDSCO Attendance Report Maker

سامانه سبک PHP برای دریافت خروجی دستگاه ساعت‌زنی، فیلتر تاریخ شمسی و تولید Excel/PDF.

## ساختار مناسب هاست

پروژه عمداً به دو بخش جدا شده است:

```text
ROOT/
├── core/
│   ├── app/
│   ├── resources/
│   ├── scripts/
│   ├── storage/
│   ├── .env
│   ├── package.json
│   └── package-lock.json
│
└── public_html/
    ├── index.php
    ├── api.php
    ├── .htaccess
    └── assets/
```

در هاست، پوشه `core` را کنار `public_html` قرار دهید. فقط محتویات `public_html` از وب قابل دسترسی است و فایل‌های حساس مثل `.env`، کاربران، لاگ‌ها و Jobهای پردازش در `core` باقی می‌مانند.

## نصب روی هاست

1. پوشه `core` را در Root اکانت، کنار `public_html` آپلود کنید.
2. محتویات پوشه `public_html` پروژه را داخل `public_html` هاست قرار دهید.
3. فایل تنظیمات را بسازید:

```bash
cp core/.env.example core/.env
```

4. دسترسی نوشتن PHP به `core/storage` را فراهم کنید.
5. در مرورگر سایت را باز کنید؛ فرم ایجاد اولین اپراتور نمایش داده می‌شود.

فایل‌های `public_html/index.php` و `public_html/api.php` به صورت مستقیم `../core/app/bootstrap.php` را لود می‌کنند؛ نیازی به تغییر Document Root یا Symlink نیست.

## اجرای Build

تمام کارهای ترمینال در یک اسکریپت قرار گرفته‌اند:

```bash
./core/scripts/build-assets.sh
```

این اسکریپت:
- `npm ci` یا `npm install`
- `npm run build:css`
- PHP lint روی `core/app` و `public_html`

را اجرا می‌کند.

GitHub Action با نام **Build & Validate** نیز همین کار را خودکار روی `main` انجام می‌دهد و CSS ساخته‌شده را در این مسیر قرار می‌دهد:

```text
public_html/assets/css/tailwind.css
```

## تست محلی

از Root پروژه:

```bash
cp core/.env.example core/.env
./core/scripts/build-assets.sh
php -S 127.0.0.1:8080 -t public_html
```

## تنظیمات env

فایل تنظیمات در `core/.env` قرار می‌گیرد:

```dotenv
APP_ENV=production
APP_TIMEZONE=Asia/Tehran
APP_KEY=change-this-to-a-long-random-secret

KAVENEGAR_API_KEY=
KAVENEGAR_OTP_TEMPLATE=
KAVENEGAR_SENDER=

PDF_BROWSER_PATH=/usr/bin/chromium
PDF_NO_SANDBOX=false
PDF_TIMEOUT_SECONDS=60
```

## فونت Vazirmatn

فایل فونت را در این مسیر قرار دهید:

```text
public_html/assets/fonts/Vazirmatn-Regular.woff2
```

PDF نیز همین فایل محلی را استفاده می‌کند.

## قابلیت‌های اصلی

- PHP خالص و بدون فریم‌ورک یا دیتابیس خارجی
- ورود با موبایل و رمز عبور
- OTP کاوه‌نگار
- Audit Log
- CSRF و Rate Limit
- DAT/TXT/CSV
- فیلتر تاریخ شمسی
- تاریخ شمسی و میلادی در خروجی
- Excel سه‌شیتی
- PDF افقی A4 با جداسازی کامل صفحات پرسنل
- بدون CDN در Runtime

## امنیت

- `core` باید کنار `public_html` و خارج از Document Root باشد.
- `core/.env` در Git ثبت نمی‌شود.
- `core/storage` حاوی اطلاعات عملیاتی است و باید قابل نوشتن برای PHP ولی غیرعمومی باشد.
- رمز عبور با `password_hash()` ذخیره می‌شود.
- OTP به صورت Hash و با TTL کوتاه ذخیره می‌شود.
- فایل خام ساعت‌زنی نگهداری نمی‌شود؛ Jobهای نرمال‌شده طبق `JOB_TTL_HOURS` منقضی می‌شوند.
- در Production از HTTPS استفاده کنید.

## نیازمندی PDF

برای PDF باید Chromium یا Google Chrome روی سرور نصب باشد و PHP اجازه اجرای `proc_open` داشته باشد. مسیر مرورگر از `core/.env` با `PDF_BROWSER_PATH` تنظیم می‌شود.


## استقرار خودکار روی DirectAdmin

Workflow با نام **Deploy Production** در مسیر زیر قرار دارد:

```text
.github/workflows/deploy-production.yml
```

این Workflow در دو حالت اجرا می‌شود:

- به‌صورت خودکار هنگام Publish کردن یک GitHub Release جدید
- به‌صورت دستی از تب Actions > Deploy Production > Run workflow

قبل از اولین Deploy، در GitHub به مسیر **Settings > Secrets and variables > Actions** بروید و Repository Secretهای زیر را بسازید:

```text
DEPLOY_HOST
DEPLOY_USER
DEPLOY_PORT
DEPLOY_ROOT
DEPLOY_SSH_KEY
```

برای سرور فعلی نمونه مقادیر به این شکل است:

```text
DEPLOY_HOST=saat.tukasabz.com
DEPLOY_USER=tukasabz
DEPLOY_PORT=22
DEPLOY_ROOT=/home/tukasabz/domains/saat.tukasabz.com
DEPLOY_SSH_KEY=<private SSH key>
```

کلید خصوصی باید متعلق به یک SSH Key باشد که Public Key آن در حساب DirectAdmin/SSH کاربر `tukasabz` مجاز شده است.

در هر Deploy:

- پروژه Build و PHP lint می‌شود.
- پوشه `core` با سرور Sync می‌شود.
- `core/.env` هرگز overwrite یا حذف نمی‌شود.
- `core/storage` و اطلاعات کاربران/لاگ‌ها/Jobها حفظ می‌شوند.
- محتویات `public_html` با نسخه Release همگام می‌شود.
- پوشه‌های سیستمی رایج مانند `.well-known` و `cgi-bin` حذف نمی‌شوند.

برای اولین تست، می‌توان Workflow را به‌صورت دستی اجرا کرد و پس از اطمینان، Releaseهای بعدی به‌طور خودکار Deploy خواهند شد.
