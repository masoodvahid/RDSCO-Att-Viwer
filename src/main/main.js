'use strict';

const {app,BrowserWindow,Menu,dialog,ipcMain,shell}=require('electron');
const path=require('path');
const fs=require('fs/promises');
const os=require('os');
const {parseAttendanceFile,filterRecords,buildDailyReport}=require('./attendance');
const {createExcel,buildPdfHtml}=require('./reports');
const {AuditLog}=require('./audit');
const {initUpdater}=require('./updater');

let mainWindow=null;
let dataset=null;
let audit=null;
let updater=null;

function createWindow(){
  mainWindow=new BrowserWindow({
    width:1280,height:820,minWidth:980,minHeight:680,
    backgroundColor:'#f5f7fa',
    title:'RDSCO Attendance',
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}
  });
  Menu.setApplicationMenu(null);
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  mainWindow.loadFile(path.join(__dirname,'../renderer/index.html'));
  updater=initUpdater(mainWindow);
}

function publicMeta(data){
  return {originalName:data.originalName,records:data.records.length,invalidRecords:data.invalidRecords,employeeCount:data.employeeCount,minGregorian:data.minGregorian,maxGregorian:data.maxGregorian,minJalali:data.minJalali,maxJalali:data.maxJalali};
}

function requireDataset(){
  if(!dataset)throw new Error('ابتدا فایل خروجی دستگاه ساعت‌زنی را انتخاب کنید.');
  return dataset;
}

function buildRange(fromJalali,toJalali){
  const data=requireDataset();
  const filtered=filterRecords(data.records,fromJalali,toJalali);
  if(filtered.records.length===0)throw new Error('در بازه انتخاب‌شده هیچ رکوردی وجود ندارد.');
  const report=buildDailyReport(filtered.records);
  return {filtered,report,range:{fromJalali,toJalali,fromGregorian:filtered.fromGregorian,toGregorian:filtered.toGregorian}};
}

async function exportPdf(outputPath,report,range){
  const tempDir=await fs.mkdtemp(path.join(os.tmpdir(),'rdsco-attendance-'));
  const htmlPath=path.join(tempDir,'report.html');
  const pdfWindow=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  try{
    await fs.writeFile(htmlPath,buildPdfHtml(report,range),'utf8');
    await pdfWindow.loadFile(htmlPath);
    const buffer=await pdfWindow.webContents.printToPDF({landscape:true,printBackground:true,pageSize:'A4',preferCSSPageSize:true});
    await fs.writeFile(outputPath,buffer);
  }finally{
    if(!pdfWindow.isDestroyed())pdfWindow.destroy();
    await fs.rm(tempDir,{recursive:true,force:true}).catch(()=>{});
  }
}

function registerIpc(){
  ipcMain.handle('app:info',()=>({version:app.getVersion(),platform:process.platform,packaged:app.isPackaged}));

  ipcMain.handle('attendance:open',async()=>{
    const result=await dialog.showOpenDialog(mainWindow,{title:'انتخاب فایل دستگاه ساعت‌زنی',properties:['openFile'],filters:[{name:'Attendance files',extensions:['dat','txt','csv']},{name:'All files',extensions:['*']}]});
    if(result.canceled||!result.filePaths[0])return {canceled:true};
    dataset=await parseAttendanceFile(result.filePaths[0]);
    await audit.log('file.opened',{name:dataset.originalName,records:dataset.records.length,employees:dataset.employeeCount});
    return {canceled:false,meta:publicMeta(dataset)};
  });

  ipcMain.handle('attendance:filter',async(_event,input)=>{
    const {filtered,report,range}=buildRange(String(input?.fromJalali||''),String(input?.toJalali||''));
    await audit.log('report.filtered',{...range,records:report.recordCount,employees:report.employeeCount});
    return {summary:{recordCount:report.recordCount,employeeCount:report.employeeCount,dayCount:report.dayCount,fromGregorian:range.fromGregorian,toGregorian:range.toGregorian},preview:report.daily.slice(0,150),totalRows:report.daily.length};
  });

  ipcMain.handle('report:excel',async(_event,input)=>{
    const {filtered,report,range}=buildRange(String(input?.fromJalali||''),String(input?.toJalali||''));
    const save=await dialog.showSaveDialog(mainWindow,{title:'ذخیره گزارش Excel',defaultPath:path.join(app.getPath('documents'),'attendance-report.xlsx'),filters:[{name:'Excel Workbook',extensions:['xlsx']}]});
    if(save.canceled||!save.filePath)return {canceled:true};
    await createExcel(save.filePath,report,filtered.records,range);
    await audit.log('report.excel',{path:save.filePath,records:report.recordCount,employees:report.employeeCount});
    return {canceled:false,path:save.filePath};
  });

  ipcMain.handle('report:pdf',async(_event,input)=>{
    const {report,range}=buildRange(String(input?.fromJalali||''),String(input?.toJalali||''));
    const save=await dialog.showSaveDialog(mainWindow,{title:'ذخیره گزارش PDF',defaultPath:path.join(app.getPath('documents'),'attendance-report.pdf'),filters:[{name:'PDF',extensions:['pdf']}]});
    if(save.canceled||!save.filePath)return {canceled:true};
    await exportPdf(save.filePath,report,range);
    await audit.log('report.pdf',{path:save.filePath,records:report.recordCount,employees:report.employeeCount});
    return {canceled:false,path:save.filePath};
  });

  ipcMain.handle('file:reveal',async(_event,filePath)=>{if(typeof filePath==='string'&&filePath)shell.showItemInFolder(filePath);return true;});
  ipcMain.handle('updater:check',()=>updater?updater.check():{ok:false});
}

app.whenReady().then(()=>{
  audit=new AuditLog(app.getPath('userData'));
  registerIpc();
  createWindow();
  audit.log('app.started',{version:app.getVersion(),platform:process.platform});
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});

app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
