<?php
declare(strict_types=1);
require dirname(__DIR__).'/app/bootstrap.php';
use Rdsco\AttReport\AttendanceParser;use Rdsco\AttReport\Audit;use Rdsco\AttReport\Auth;use Rdsco\AttReport\Helpers;use Rdsco\AttReport\Jalali;use Rdsco\AttReport\JobStore;use Rdsco\AttReport\PdfRenderer;use Rdsco\AttReport\ReportService;use Rdsco\AttReport\XlsxWriter;
$action=(string)($_GET['action']??$_POST['action']??'');
try{
 if($_SERVER['REQUEST_METHOD']==='POST')Helpers::verifyCsrf();
 switch($action){
  case 'setup': if(Auth::hasUsers())Helpers::jsonResponse(['ok'=>false,'message'=>'راه‌اندازی اولیه قبلاً انجام شده است.'],409);$p=(string)($_POST['password']??'');if($p!==(string)($_POST['password_confirmation']??''))Helpers::jsonResponse(['ok'=>false,'message'=>'تکرار رمز عبور یکسان نیست.'],422);Auth::createFirstUser((string)($_POST['mobile']??''),$p);Helpers::jsonResponse(['ok'=>true,'message'=>'حساب اپراتور ساخته شد.','reload'=>true]);
  case 'login': if(Auth::loginWithPassword((string)($_POST['mobile']??''),(string)($_POST['password']??'')))Helpers::jsonResponse(['ok'=>true,'message'=>'ورود موفق بود.','reload'=>true]);Helpers::jsonResponse(['ok'=>false,'message'=>'شماره موبایل یا رمز عبور نادرست است.'],422);
  case 'request_otp': Auth::requestOtp((string)($_POST['mobile']??''));Helpers::jsonResponse(['ok'=>true,'message'=>'اگر شماره ثبت شده باشد، رمز یکبار مصرف ارسال شد.']);
  case 'verify_otp': if(Auth::loginWithOtp((string)($_POST['mobile']??''),(string)($_POST['otp']??'')))Helpers::jsonResponse(['ok'=>true,'message'=>'ورود موفق بود.','reload'=>true]);Helpers::jsonResponse(['ok'=>false,'message'=>'رمز یکبار مصرف نامعتبر یا منقضی است.'],422);
  case 'logout': Auth::requireUser();Auth::logout();Helpers::jsonResponse(['ok'=>true,'reload'=>true]);
  case 'upload':
   Auth::requireUser();if(!isset($_FILES['attendance_file'])||!is_array($_FILES['attendance_file']))Helpers::jsonResponse(['ok'=>false,'message'=>'فایل انتخاب نشده است.'],422);
   $file=$_FILES['attendance_file'];if(($file['error']??UPLOAD_ERR_NO_FILE)!==UPLOAD_ERR_OK||!is_uploaded_file((string)$file['tmp_name']))Helpers::jsonResponse(['ok'=>false,'message'=>'آپلود فایل ناموفق بود.'],422);
   $meta=AttendanceParser::parseToJob((string)$file['tmp_name'],(string)($file['name']??'attendance.dat'));$_SESSION['job_id']=$meta['id'];Audit::log('attendance.uploaded',['file'=>$meta['original_name'],'records'=>$meta['records'],'invalid_records'=>$meta['invalid_records'],'employee_count'=>$meta['employee_count']]);Helpers::jsonResponse(['ok'=>true,'message'=>'فایل پردازش شد.','meta'=>$meta]);
  case 'filter_summary':
   Auth::requireUser();[$jobId,$fromJ,$toJ,$fromG,$toG]=dateRange();$report=ReportService::collect(JobStore::filtered($jobId,$fromG,$toG));Audit::log('attendance.filtered',['from_jalali'=>$fromJ,'to_jalali'=>$toJ,'record_count'=>$report['record_count'],'employee_count'=>$report['employee_count']]);Helpers::jsonResponse(['ok'=>true,'summary'=>['record_count'=>$report['record_count'],'employee_count'=>$report['employee_count'],'day_count'=>$report['day_count'],'from_gregorian'=>$fromG,'to_gregorian'=>$toG]]);
  case 'export_xlsx':
   Auth::requireUser();[$jobId,$fromJ,$toJ,$fromG,$toG]=dateRange();$report=ReportService::collect(JobStore::filtered($jobId,$fromG,$toG));if($report['record_count']===0)Helpers::jsonResponse(['ok'=>false,'message'=>'در این بازه رکوردی وجود ندارد.'],422);$path=JobStore::dir($jobId).'/attendance-'.date('Ymd-His').'.xlsx';XlsxWriter::build($path,$report,$fromJ,$toJ);Audit::log('report.xlsx_exported',['records'=>$report['record_count']]);Helpers::download($path,'attendance-report.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  case 'export_pdf':
   Auth::requireUser();[$jobId,$fromJ,$toJ,$fromG,$toG]=dateRange();$report=ReportService::collect(JobStore::filtered($jobId,$fromG,$toG));if($report['record_count']===0)Helpers::jsonResponse(['ok'=>false,'message'=>'در این بازه رکوردی وجود ندارد.'],422);$path=JobStore::dir($jobId).'/attendance-'.date('Ymd-His').'.pdf';PdfRenderer::build($path,$report,$fromJ,$toJ);Audit::log('report.pdf_exported',['records'=>$report['record_count'],'employees'=>$report['employee_count']]);Helpers::download($path,'attendance-report.pdf','application/pdf');
  case 'logs': Auth::requireUser();Helpers::jsonResponse(['ok'=>true,'logs'=>Audit::recent(100)]);
  default: Helpers::jsonResponse(['ok'=>false,'message'=>'عملیات نامعتبر است.'],404);
 }
}catch(Throwable $e){Audit::log('system.error',['action'=>$action,'message'=>$e->getMessage()]);Helpers::jsonResponse(['ok'=>false,'message'=>$e->getMessage()],500);}
function dateRange(): array{
 $jobId=(string)($_SESSION['job_id']??'');if($jobId==='')Helpers::jsonResponse(['ok'=>false,'message'=>'ابتدا فایل ساعت‌زنی را بارگذاری کنید.'],422);
 $meta=JobStore::meta($jobId);$fromJ=trim((string)($_POST['from_jalali']??$meta['min_jalali']));$toJ=trim((string)($_POST['to_jalali']??$meta['max_jalali']));$fromG=Jalali::parseToGregorian($fromJ);$toG=Jalali::parseToGregorian($toJ);if($fromG>$toG)Helpers::jsonResponse(['ok'=>false,'message'=>'تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد.'],422);return[$jobId,$fromJ,$toJ,$fromG,$toG];
}
