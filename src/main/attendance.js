'use strict';

const fs=require('fs/promises');
const path=require('path');
const {formatJalali,parseJalali}=require('./jalali');
const MAX_FILE_BYTES=50*1024*1024;

function parseAttendanceText(text,originalName='attendance.dat'){
  const lines=String(text).replace(/^\uFEFF/,'').split(/\r?\n/);
  const records=[];const employees=new Map();let invalidRecords=0;let minTimestamp=null;let maxTimestamp=null;
  for(const sourceLine of lines){
    const line=sourceLine.trim();if(!line)continue;
    let parts=line.split(/\t+/);
    if(parts.length<6){const m=/^\s*(\S+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/.exec(line);parts=m?m.slice(1,7):[];}
    if(parts.length<6){invalidRecords+=1;continue;}
    const employeeId=String(parts[0]).trim();const timestamp=String(parts[1]).trim();
    if(!employeeId||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp)){invalidRecords+=1;continue;}
    const date=timestamp.slice(0,10),time=timestamp.slice(11,19);
    if(Number.isNaN(Date.parse(date+'T'+time+'Z'))){invalidRecords+=1;continue;}
    records.push({employeeId,timestamp,date,time,status:String(parts[2]).trim(),verify:String(parts[3]).trim(),workCode:String(parts[4]).trim(),reserved:String(parts[5]).trim()});
    employees.set(employeeId,(employees.get(employeeId)||0)+1);
    if(minTimestamp===null||timestamp<minTimestamp)minTimestamp=timestamp;
    if(maxTimestamp===null||timestamp>maxTimestamp)maxTimestamp=timestamp;
  }
  if(records.length===0)throw new Error('هیچ رکورد معتبر ساعت‌زنی در فایل پیدا نشد.');
  records.sort((a,b)=>a.timestamp.localeCompare(b.timestamp)||a.employeeId.localeCompare(b.employeeId,'en',{numeric:true}));
  return {originalName:path.basename(originalName),records,invalidRecords,employeeCount:employees.size,employees:Object.fromEntries(employees),minTimestamp,maxTimestamp,minGregorian:minTimestamp.slice(0,10),maxGregorian:maxTimestamp.slice(0,10),minJalali:formatJalali(minTimestamp.slice(0,10)),maxJalali:formatJalali(maxTimestamp.slice(0,10))};
}

async function parseAttendanceFile(filePath){
  const stats=await fs.stat(filePath);
  if(!stats.isFile())throw new Error('فایل انتخاب‌شده معتبر نیست.');
  if(stats.size<=0||stats.size>MAX_FILE_BYTES)throw new Error('حجم فایل باید کمتر از ۵۰ مگابایت باشد.');
  const ext=path.extname(filePath).toLowerCase();
  if(!['.dat','.txt','.csv'].includes(ext))throw new Error('فرمت فایل باید DAT، TXT یا CSV باشد.');
  return parseAttendanceText((await fs.readFile(filePath)).toString('utf8'),path.basename(filePath));
}

function filterRecords(records,fromJalali,toJalali){
  const fromGregorian=parseJalali(fromJalali),toGregorian=parseJalali(toJalali);
  if(fromGregorian>toGregorian)throw new Error('تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد.');
  return {records:records.filter(r=>r.date>=fromGregorian&&r.date<=toGregorian),fromGregorian,toGregorian};
}

function formatSpan(start,end){
  const [sh,sm,ss]=start.split(':').map(Number),[eh,em,es]=end.split(':').map(Number);
  const seconds=Math.max(0,(eh*3600+em*60+es)-(sh*3600+sm*60+ss));
  return String(Math.floor(seconds/3600)).padStart(2,'0')+':'+String(Math.floor((seconds%3600)/60)).padStart(2,'0');
}

function weekdayFa(date){
  try{return new Intl.DateTimeFormat('fa-IR',{weekday:'long',timeZone:'Asia/Tehran'}).format(new Date(date+'T12:00:00Z'));}catch{return '';}
}

function buildDailyReport(records){
  const grouped=new Map();
  for(const row of records){if(!grouped.has(row.employeeId))grouped.set(row.employeeId,new Map());const dates=grouped.get(row.employeeId);if(!dates.has(row.date))dates.set(row.date,[]);dates.get(row.date).push(row.time);}
  const employeeIds=[...grouped.keys()].sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));const daily=[];const employeeStats=[];
  for(const employeeId of employeeIds){
    const dates=grouped.get(employeeId),sortedDates=[...dates.keys()].sort();let punchCount=0,singleDays=0,middleDays=0;
    for(const date of sortedDates){const times=[...dates.get(date)].sort(),count=times.length,firstEntry=times[0],lastExit=count>1?times[count-1]:null,middle=count>2?times.slice(1,-1):[];
      punchCount+=count;if(count===1)singleDays+=1;if(middle.length>0)middleDays+=1;
      daily.push({employeeId,gregorianDate:date,jalaliDate:formatJalali(date),weekday:weekdayFa(date),firstEntry,lastExit,middle,count,span:lastExit?formatSpan(firstEntry,lastExit):null,note:count===1?'تک‌ثبت؛ خروج قابل تعیین نیست':(middle.length>0?'دارای تردد میانی':'')});
    }
    employeeStats.push({employeeId,days:sortedDates.length,punchCount,singleDays,middleDays});
  }
  return {daily,employeeStats,employeeCount:employeeIds.length,recordCount:records.length,dayCount:daily.length};
}

module.exports={parseAttendanceText,parseAttendanceFile,filterRecords,buildDailyReport};
