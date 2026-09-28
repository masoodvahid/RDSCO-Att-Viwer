'use strict';

const DIGITS = {
  '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9',
  '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9'
};

function normalizeDigits(value) {
  return String(value ?? '').replace(/[۰-۹٠-٩]/g, digit => DIGITS[digit] ?? digit);
}

function toJalali(gy, gm, gd) {
  const gDays=[31,28,31,30,31,30,31,31,30,31,30,31];
  const jDays=[31,31,31,31,31,31,30,30,30,30,30,29];
  const gy2=gy-1600, gm2=gm-1, gd2=gd-1;
  let gDayNo=365*gy2+Math.floor((gy2+3)/4)-Math.floor((gy2+99)/100)+Math.floor((gy2+399)/400);
  for(let i=0;i<gm2;i+=1) gDayNo+=gDays[i];
  if(gm2>1&&((gy2%4===0&&gy2%100!==0)||gy2%400===0)) gDayNo+=1;
  gDayNo+=gd2;
  let jDayNo=gDayNo-79;
  const jNp=Math.floor(jDayNo/12053);
  jDayNo%=12053;
  let jy=979+33*jNp+4*Math.floor(jDayNo/1461);
  jDayNo%=1461;
  if(jDayNo>=366){jy+=Math.floor((jDayNo-1)/365);jDayNo=(jDayNo-1)%365;}
  let jm=0;
  while(jm<11&&jDayNo>=jDays[jm]){jDayNo-=jDays[jm];jm+=1;}
  return [jy,jm+1,jDayNo+1];
}

function toGregorian(jy,jm,jd) {
  const gDays=[31,28,31,30,31,30,31,31,30,31,30,31];
  const jDays=[31,31,31,31,31,31,30,30,30,30,30,29];
  const jy2=jy-979, jm2=jm-1, jd2=jd-1;
  let jDayNo=365*jy2+Math.floor(jy2/33)*8+Math.floor(((jy2%33)+3)/4);
  for(let i=0;i<jm2;i+=1) jDayNo+=jDays[i];
  jDayNo+=jd2;
  let gDayNo=jDayNo+79;
  let gy=1600+400*Math.floor(gDayNo/146097);
  gDayNo%=146097;
  let leap=true;
  if(gDayNo>=36525){gDayNo-=1;gy+=100*Math.floor(gDayNo/36524);gDayNo%=36524;if(gDayNo>=365)gDayNo+=1;else leap=false;}
  gy+=4*Math.floor(gDayNo/1461);
  gDayNo%=1461;
  if(gDayNo>=366){leap=false;gDayNo-=1;gy+=Math.floor(gDayNo/365);gDayNo%=365;}
  let gm=0;
  while(gm<11){const days=gDays[gm]+(gm===1&&leap?1:0);if(gDayNo<days)break;gDayNo-=days;gm+=1;}
  return [gy,gm+1,gDayNo+1];
}

function formatJalali(gregorianDate) {
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(gregorianDate));
  if(!m) return '';
  const [jy,jm,jd]=toJalali(Number(m[1]),Number(m[2]),Number(m[3]));
  return String(jy).padStart(4,'0')+'/'+String(jm).padStart(2,'0')+'/'+String(jd).padStart(2,'0');
}

function parseJalali(value) {
  const normalized=normalizeDigits(value).trim().replace(/[.-]/g,'/');
  const m=/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(normalized);
  if(!m) throw new Error('تاریخ شمسی نامعتبر است. نمونه صحیح: 1405/07/06');
  const jy=Number(m[1]), jm=Number(m[2]), jd=Number(m[3]);
  if(jm<1||jm>12||jd<1||jd>31||(jm>6&&jd>30)) throw new Error('تاریخ شمسی نامعتبر است.');
  const [gy,gm,gd]=toGregorian(jy,jm,jd);
  const result=String(gy).padStart(4,'0')+'-'+String(gm).padStart(2,'0')+'-'+String(gd).padStart(2,'0');
  const canonical=String(jy).padStart(4,'0')+'/'+String(jm).padStart(2,'0')+'/'+String(jd).padStart(2,'0');
  if(formatJalali(result)!==canonical) throw new Error('تاریخ شمسی نامعتبر است.');
  return result;
}

module.exports={normalizeDigits,toJalali,toGregorian,formatJalali,parseJalali};
