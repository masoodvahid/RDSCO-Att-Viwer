'use strict';

const $=selector=>document.querySelector(selector);
const state={fileLoaded:false,filtered:false,lastExport:null};
const nf=new Intl.NumberFormat('fa-IR');

function toast(message,type='ok'){
  const el=$('#toast');el.textContent=message;el.className='fixed bottom-5 left-5 z-50 max-w-md rounded-xl px-4 py-3 text-sm font-bold text-white shadow-xl '+(type==='error'?'bg-rose-800':'bg-emerald-700');
  clearTimeout(window.__toastTimer);window.__toastTimer=setTimeout(()=>el.classList.add('hidden'),4200);
}

function setBusy(button,busy,text){
  if(!button)return;button.disabled=busy;if(busy){button.dataset.oldText=button.textContent;button.textContent=text;}else if(button.dataset.oldText){button.textContent=button.dataset.oldText;delete button.dataset.oldText;}
}

function currentRange(){return {fromJalali:$('#from-date').value.trim(),toJalali:$('#to-date').value.trim()};}

function renderPreview(rows,totalRows){
  const body=$('#preview-body');body.replaceChildren();
  for(const row of rows){
    const tr=document.createElement('tr');tr.className='border-b border-slate-100 '+(row.count===1?'bg-orange-50':'');
    const values=[row.employeeId,row.jalaliDate,row.gregorianDate,row.weekday,row.firstEntry,row.lastExit||'—',row.span||'—',String(row.count),row.middle.length?row.middle.join(' · '):'—'];
    values.forEach((value,index)=>{const td=document.createElement('td');td.textContent=value;td.className='p-3 text-center '+([1,2,4,5,6,8].includes(index)?'ltr':'');tr.appendChild(td);});
    body.appendChild(tr);
  }
  $('#preview-count').textContent=totalRows>rows.length?`${nf.format(rows.length)} ردیف از ${nf.format(totalRows)}`:`${nf.format(totalRows)} ردیف`;
  $('#preview-wrap').classList.remove('hidden');
}

async function applyFilter(){
  const button=$('#apply-filter');setBusy(button,true,'در حال پردازش...');
  try{
    const result=await window.desktop.filterAttendance(currentRange());
    $('#sum-records').textContent=nf.format(result.summary.recordCount);
    $('#sum-employees').textContent=nf.format(result.summary.employeeCount);
    $('#sum-days').textContent=nf.format(result.summary.dayCount);
    $('#sum-range').textContent=result.summary.fromGregorian+' تا '+result.summary.toGregorian;
    $('#summary').classList.remove('hidden');$('#summary').classList.add('grid');
    renderPreview(result.preview,result.totalRows);
    state.filtered=true;$('#export-excel').disabled=false;$('#export-pdf').disabled=false;
    toast('فیلتر اعمال شد.');
  }catch(error){toast(error.message||'خطا در فیلتر گزارش','error');}
  finally{setBusy(button,false);}
}

$('#open-file').addEventListener('click',async()=>{
  const button=$('#open-file');button.disabled=true;
  try{
    const result=await window.desktop.openAttendanceFile();if(result.canceled)return;
    const m=result.meta;state.fileLoaded=true;state.filtered=false;
    $('#file-name').textContent=m.originalName;$('#meta-records').textContent=nf.format(m.records);$('#meta-employees').textContent=nf.format(m.employeeCount);
    $('#meta-start').textContent=m.minJalali+' / '+m.minGregorian;$('#meta-end').textContent=m.maxJalali+' / '+m.maxGregorian;
    $('#file-meta').classList.remove('hidden');$('#file-meta').classList.add('grid');
    $('#from-date').value=m.minJalali;$('#to-date').value=m.maxJalali;$('#apply-filter').disabled=false;$('#export-excel').disabled=true;$('#export-pdf').disabled=true;
    $('#summary').classList.add('hidden');$('#preview-wrap').classList.add('hidden');
    toast('فایل با موفقیت خوانده شد.');
    await applyFilter();
  }catch(error){toast(error.message||'خطا در خواندن فایل','error');}
  finally{button.disabled=false;}
});

$('#apply-filter').addEventListener('click',applyFilter);

async function exportReport(type){
  if(!state.fileLoaded)return;
  const button=type==='excel'?$('#export-excel'):$('#export-pdf');setBusy(button,true,'در حال ساخت...');
  try{
    const result=type==='excel'?await window.desktop.exportExcel(currentRange()):await window.desktop.exportPdf(currentRange());
    if(result.canceled)return;state.lastExport=result.path;toast('فایل با موفقیت ذخیره شد.');
    await window.desktop.revealFile(result.path);
  }catch(error){toast(error.message||'خطا در ساخت خروجی','error');}
  finally{setBusy(button,false);}
}

$('#export-excel').addEventListener('click',()=>exportReport('excel'));
$('#export-pdf').addEventListener('click',()=>exportReport('pdf'));

function updateStatus(payload){
  const el=$('#update-status');
  const map={
    checking:'در حال بررسی نسخه جدید...',
    current:'آخرین نسخه نصب است.',
    available:`نسخه ${payload.version||''} پیدا شد؛ در حال دانلود...`,
    downloading:`در حال دانلود بروزرسانی: ${payload.percent||0}٪`,
    downloaded:`نسخه ${payload.version||''} آماده نصب است.`,
    development:'حالت توسعه؛ بروزرسانی خودکار غیرفعال است.',
    error:'بررسی بروزرسانی ناموفق بود.'
  };
  el.textContent=map[payload.status]||'';
}

window.desktop.onUpdateStatus(updateStatus);
$('#check-update').addEventListener('click',async()=>{try{await window.desktop.checkForUpdates();}catch(error){toast(error.message,'error');}});

window.desktop.appInfo().then(info=>{$('#app-version').textContent='v'+info.version;}).catch(()=>{});
