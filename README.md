# گزارش تردد پرسنل (Attendance Report)

برنامه دسکتاپ (Electron + Node.js) برای خواندن فایل خام دستگاه حضور و غیاب (ZKTeco و مشابه، مثل `AttLog.dat`)، محاسبه ساعت کارکرد، تأخیر، تعجیل و اضافه‌کار، و خروجی **اکسل** و **PDF** (هر نفر در یک صفحه).

## دانلود و نصب

آخرین نسخه را از بخش [Releases](https://github.com/masoodvahid/rdsco_att_report_maker/releases/latest) دانلود کنید.

| سیستم‌عامل | فایل | توضیح |
|---|---|---|
| Windows (۶۴ بیتی) | `AttendanceReport-Setup-x.y.z.exe` | نصب‌کننده با میان‌بر دسکتاپ و منوی Start |
| Windows (بدون نصب) | `AttendanceReport-x.y.z-portable.exe` | اجرای مستقیم؛ اجرای اول کمی کندتر است |
| macOS (Apple Silicon و Intel) | `AttendanceReport-x.y.z-mac-universal.dmg` | فایل dmg را باز کنید و برنامه را به Applications بکشید |
| Linux | `AttendanceReport-x.y.z-linux-x86_64.AppImage` | `chmod +x` و اجرا |

**Windows:** چون فایل امضای دیجیتال ندارد، SmartScreen هشدار می‌دهد: «More info ← Run anyway».

**macOS:** نسخه مک امضای ad-hoc دارد ولی notarize نشده است. بعد از کپی در Applications، یک‌بار در Terminal:

```bash
xattr -cr "/Applications/Attendance Report.app" && open "/Applications/Attendance Report.app"
```

اگر پیام «damaged» دیدید: `codesign --force --deep --sign - "/Applications/Attendance Report.app"`

تنظیمات برنامه (نام پرسنل، شیفت‌ها، اصلاح ساعت) در این مسیر ذخیره می‌شود و از زبانه «تنظیمات محاسبه» پشتیبان‌گیری دارد:
Windows: `%APPDATA%\Attendance Report` — macOS: `~/Library/Application Support/Attendance Report`

## روش کار

1. «بارگذاری فایل تردد» یا کشیدن فایل روی پنجره. چند فایل هم پشتیبانی می‌شود و ترددهای تکراری حذف می‌شوند.
2. انتخاب پرسنل (یک یا چند نفر یا همه)، ماه یا بازه تاریخ شمسی.
3. «خروجی اکسل» (سه برگه: خلاصه، جزئیات شیفت‌ها، ترددهای خام) یا «خروجی PDF» (هر نفر یک صفحه).

فایل‌های آخرین جلسه هنگام اجرای بعدی خودکار دوباره بارگذاری می‌شوند.

## منطق محاسبه

| مرحله | توضیح |
|---|---|
| اصلاح ساعت دستگاه | برای بازه‌هایی که ساعت دستگاه اشتباه بوده، اختلاف (دقیقه) اعمال می‌شود. |
| تردد تکراری | ترددهای با فاصله کمتر از ۳ دقیقه یکی حساب می‌شوند. |
| تشخیص ورود/خروج | دستگاه ورود و خروج را ثبت نمی‌کند (وضعیت 255). برنامه ترددها را جفت می‌کند و عادت‌های ورود و طول شیفت هر نفر را از سابقه خودش (با وزن بیشتر برای ماه‌های نزدیک) یاد می‌گیرد. شیفت‌هایی که از نیمه‌شب رد می‌شوند درست جفت می‌شوند و یک تردد جاافتاده فقط همان شیفت را «ناقص» می‌کند. |
| شیفت | خروج و ورودهایی که فاصله‌شان کمتر از ۲ ساعت است (مثل ترددهای ۲۳:۴۷ و ۰۰:۰۳) جزو یک شیفت‌اند. کارکرد = اولین ورود تا آخرین خروج. هر شیفت به **تاریخ شروعش** تعلق دارد. |
| تأخیر و اضافه‌کار | هر شیفت خودکار به نزدیک‌ترین الگوی شیفت (بیشتر بر اساس ساعت ورود) وصل می‌شود؛ در زبانه «پرسنل» می‌توان برای هر نفر «شیفت‌های مجاز» تعیین کرد. تأخیر = ورود بعد از شروع، تعجیل = خروج قبل از پایان، اضافه‌کار = ماندن بعد از پایان (بالای حداقل تعیین‌شده). |
| نیازمند بررسی | «خروج/ورود ثبت نشده»، «شیفت طولانی» (بیش از ۲۶ ساعت) و «شیفت نامشخص» در گزارش علامت می‌خورند. |

همه این مقادیر در زبانه‌های «شیفت‌ها»، «اصلاح ساعت دستگاه» و «تنظیمات محاسبه» قابل تغییرند.

> فایل خام دستگاه و گزارش‌ها اطلاعات شخصی پرسنل دارند؛ `.gitignore` جلوی ثبت `*.dat`، `*.xlsx` و `*.pdf` در مخزن را می‌گیرد.

## Development

```bash
npm install
npm start                 # run the app
npm test                  # core unit tests (node:test)
npm run check             # syntax check of all JS files
npm run build:win         # Windows installer + portable (on Linux needs wine + wine32)
npm run build:mac         # on a Mac: .dmg + .zip for Apple Silicon (ad-hoc signed)
npm run build:linux       # AppImage
```

### Release

Releases are built by GitHub Actions on native runners (`.github/workflows/release-desktop.yml`):

```bash
npm version 1.0.1 --no-git-tag-version   # optional: bump package.json
git commit -am "chore: release 1.0.1"
git tag v1.0.1 && git push origin main v1.0.1
```

The workflow builds Windows (NSIS + portable), macOS (universal dmg + zip, ad-hoc signed) and Linux (AppImage), then publishes them to the GitHub release for that tag. It can also be started manually from the Actions tab with a version number.

### Dev helpers

`scripts/dev/` has headless helpers that need a real device log (never commit it):

```bash
ATT_FILE=/path/to/AttLog.dat npx electron scripts/dev/ui-shot.js /tmp/shots   # screenshots of every tab
ATT_FILE=/path/to/AttLog.dat npx electron scripts/dev/pdf-smoke.js            # sample PDF + Excel
ATT_FILE=/path/to/AttLog.dat node scripts/dev/inspect.js                      # print detected shifts
```

Project layout:

```
src/core/      parser.js (ZK attlog), engine.js (clock fix, pairing, blocks, shift matching),
               report.js (report model), time.js (Jalali helpers), defaults.js (first-run settings)
src/export/    excel.js (exceljs, RTL), pdf-html.js + pdf.js (printToPDF, one employee per page)
src/main/      main.js (window + IPC), preload.js (contextBridge API), settings.js (JSON store)
src/renderer/  index.html, styles.css, app.js (no framework)
build/         afterPack.js (sets exe icon/version with resedit — no Wine needed for that step)
scripts/       check.js (CI syntax check), dev/ (local helpers)
```

Security: `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP, navigation blocked.
