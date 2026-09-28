'use strict';

const ExcelJS=require('exceljs');

const COLORS={navy:'FF0F172A',teal:'FF0F766E',tealLight:'FFCCFBF1',gray:'FFF8FAFC',line:'FFE2E8F0',orange:'FFFFF7ED',orangeText:'FFC2410C',white:'FFFFFFFF'};

function applyHeader(row){
  row.height=26;
  row.eachCell(cell=>{cell.font={bold:true,color:{argb:COLORS.white}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:COLORS.teal}};cell.alignment={horizontal:'center',vertical:'middle'};});
}

function styleDataSheet(sheet){
  sheet.views=[{rightToLeft:true,state:'frozen',ySplit:1}];
  sheet.autoFilter={from:'A1',to:sheet.getRow(1).getCell(sheet.columnCount).address};
  sheet.eachRow((row,index)=>{if(index===1)return;row.height=23;row.eachCell(cell=>{cell.alignment={horizontal:'center',vertical:'middle',wrapText:true};cell.border={bottom:{style:'hair',color:{argb:COLORS.line}}};});});
}

async function createExcel(outputPath,report,rawRecords,range){
  const workbook=new ExcelJS.Workbook();
  workbook.creator='RDSCO Attendance';workbook.created=new Date();

  const summary=workbook.addWorksheet('خلاصه',{views:[{rightToLeft:true}]});
  summary.columns=[{width:28},{width:48}];
  [
    ['گزارش','گزارش تردد RDSCO'],
    ['بازه شمسی',range.fromJalali+' تا '+range.toJalali],
    ['بازه میلادی',range.fromGregorian+' تا '+range.toGregorian],
    ['تعداد پرسنل',report.employeeCount],
    ['تعداد ثبت خام',report.recordCount],
    ['تعداد روز/پرسنل',report.dayCount],
    ['قاعده ورود و خروج','اولین ثبت هر روز ورود و آخرین ثبت خروج در نظر گرفته شده است.']
  ].forEach((values,index)=>{const row=summary.addRow(values);row.height=25;row.getCell(1).font={bold:true};row.eachCell(c=>{c.alignment={vertical:'middle',horizontal:'right',wrapText:true};});if(index%2===1)row.eachCell(c=>c.fill={type:'pattern',pattern:'solid',fgColor:{argb:COLORS.gray}});});

  const daily=workbook.addWorksheet('تردد روزانه');
  daily.columns=[
    {header:'کد پرسنلی',key:'employeeId',width:16},{header:'تاریخ شمسی',key:'jalaliDate',width:16},{header:'تاریخ میلادی',key:'gregorianDate',width:16},
    {header:'روز',key:'weekday',width:14},{header:'ورود',key:'firstEntry',width:13},{header:'خروج',key:'lastExit',width:13},{header:'فاصله اولین تا آخرین',key:'span',width:20},
    {header:'تعداد ثبت',key:'count',width:12},{header:'ترددهای میانی',key:'middle',width:30},{header:'توضیح',key:'note',width:28}
  ];
  for(const row of report.daily){daily.addRow({...row,lastExit:row.lastExit||'',span:row.span||'',middle:row.middle.join(' | ')});}
  applyHeader(daily.getRow(1));styleDataSheet(daily);
  daily.eachRow((row,index)=>{if(index>1&&String(row.getCell(10).value||'').startsWith('تک‌ثبت'))row.eachCell(c=>c.fill={type:'pattern',pattern:'solid',fgColor:{argb:COLORS.orange}});});

  const raw=workbook.addWorksheet('لاگ خام');
  raw.columns=[
    {header:'کد پرسنلی',key:'employeeId',width:16},{header:'تاریخ شمسی',key:'jalaliDate',width:16},{header:'تاریخ میلادی',key:'date',width:16},{header:'زمان',key:'time',width:13},
    {header:'Status',key:'status',width:12},{header:'Verify',key:'verify',width:12},{header:'WorkCode',key:'workCode',width:12},{header:'Reserved',key:'reserved',width:12}
  ];
  const {formatJalali}=require('./jalali');
  for(const row of rawRecords)raw.addRow({...row,jalaliDate:formatJalali(row.date)});
  applyHeader(raw.getRow(1));styleDataSheet(raw);

  await workbook.xlsx.writeFile(outputPath);
}

function escapeHtml(value){
  return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function buildPdfHtml(report,range){
  const byEmployee=new Map();
  for(const row of report.daily){if(!byEmployee.has(row.employeeId))byEmployee.set(row.employeeId,[]);byEmployee.get(row.employeeId).push(row);}
  const stats=new Map(report.employeeStats.map(item=>[item.employeeId,item]));

  let sections='';
  for(const [employeeId,rows] of byEmployee){
    const stat=stats.get(employeeId);
    const body=rows.map((row,index)=>`<tr class="${row.count===1?'single':''}">
      <td>${index+1}</td><td class="ltr">${escapeHtml(row.jalaliDate)}</td><td class="ltr">${escapeHtml(row.gregorianDate)}</td><td>${escapeHtml(row.weekday)}</td>
      <td class="ltr">${escapeHtml(row.firstEntry)}</td><td class="ltr">${escapeHtml(row.lastExit||'—')}</td><td class="ltr">${escapeHtml(row.span||'—')}</td>
      <td>${row.count}</td><td class="middle">${escapeHtml(row.middle.length?row.middle.join(' · '):'—')}</td><td>${escapeHtml(row.note||'—')}</td></tr>`).join('');

    sections+=`<section class="employee"><table class="report"><thead>
      <tr class="hero"><th colspan="10"><div class="hero-card"><div><h1>گزارش ورود و خروج پرسنل</h1><p>بازه شمسی ${escapeHtml(range.fromJalali)} تا ${escapeHtml(range.toJalali)} · میلادی ${escapeHtml(range.fromGregorian)} تا ${escapeHtml(range.toGregorian)}</p></div>
      <div class="badges"><span>کد پرسنلی: ${escapeHtml(employeeId)}</span><span>${stat.days} روز</span><span>${stat.punchCount} ثبت</span></div></div></th></tr>
      <tr class="columns"><th>ردیف</th><th>تاریخ شمسی</th><th>تاریخ میلادی</th><th>روز</th><th>ورود</th><th>خروج</th><th>فاصله</th><th>تعداد</th><th>تردد میانی</th><th>توضیح</th></tr>
      </thead><tbody>${body}</tbody></table>
      <div class="note">اولین ثبت هر روز به‌عنوان ورود و آخرین ثبت به‌عنوان خروج گزارش می‌شود. «فاصله» صرفاً فاصله اولین تا آخرین ثبت است و الزاماً زمان کارکرد نیست.</div></section>`;
  }

  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><style>
  @page{size:A4 landscape;margin:11mm 9mm 13mm}
  *{box-sizing:border-box}html,body{margin:0;padding:0}body{direction:rtl;font-family:Vazirmatn,Tahoma,Arial,sans-serif;color:#0f172a;background:#fff;font-size:9.5px}
  .employee{break-before:page}.employee:first-child{break-before:auto}.report{width:100%;border-collapse:collapse;table-layout:fixed}.report thead{display:table-header-group}.report tr{break-inside:avoid}
  .hero th{padding:0 0 7px;border:0}.hero-card{display:flex;justify-content:space-between;align-items:center;gap:12px;border:1px solid #dbe4ea;border-radius:13px;padding:11px 13px;background:#f8fafc;text-align:right}
  h1{font-size:15px;margin:0 0 3px}p{margin:0;color:#64748b;font-weight:400}.badges{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-start}.badges span{background:#ccfbf1;color:#115e59;border-radius:999px;padding:4px 8px;font-weight:700}
  .columns th{background:#0f766e;color:#fff;padding:7px 4px;text-align:center}.report td{padding:6px 4px;text-align:center;border-bottom:1px solid #e2e8f0;line-height:1.55}.report tbody tr:nth-child(even){background:#f8fafc}.single{background:#fff7ed!important}.single td:last-child{color:#c2410c;font-weight:700}
  .ltr{direction:ltr;unicode-bidi:embed}.middle{direction:ltr;font-size:8.5px}.note{margin-top:7px;border:1px solid #fde68a;background:#fffbeb;color:#92400e;border-radius:9px;padding:7px 9px;break-inside:avoid}
  </style></head><body>${sections}</body></html>`;
}

module.exports={createExcel,buildPdfHtml};
