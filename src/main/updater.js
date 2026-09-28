'use strict';

const {app,dialog}=require('electron');
const {autoUpdater}=require('electron-updater');

function send(window,status,payload={}){
  if(window&&!window.isDestroyed())window.webContents.send('updater:status',{status,...payload});
}

function initUpdater(window){
  autoUpdater.autoDownload=true;
  autoUpdater.autoInstallOnAppQuit=true;
  autoUpdater.allowDowngrade=false;

  autoUpdater.on('checking-for-update',()=>send(window,'checking'));
  autoUpdater.on('update-available',info=>send(window,'available',{version:info.version}));
  autoUpdater.on('update-not-available',info=>send(window,'current',{version:info.version}));
  autoUpdater.on('download-progress',progress=>send(window,'downloading',{percent:Math.round(progress.percent||0)}));
  autoUpdater.on('error',error=>send(window,'error',{message:error.message}));
  autoUpdater.on('update-downloaded',async info=>{
    send(window,'downloaded',{version:info.version});
    const result=await dialog.showMessageBox(window,{type:'info',title:'نسخه جدید آماده است',message:`نسخه ${info.version} دانلود شد.`,detail:'برای نصب نسخه جدید، برنامه باید یک‌بار بسته و دوباره اجرا شود.',buttons:['نصب و راه‌اندازی مجدد','بعداً'],defaultId:0,cancelId:1,noLink:true});
    if(result.response===0)setImmediate(()=>autoUpdater.quitAndInstall(false,true));
  });

  async function check(){
    if(!app.isPackaged){send(window,'development',{version:app.getVersion()});return {development:true};}
    try{await autoUpdater.checkForUpdates();return {ok:true};}
    catch(error){send(window,'error',{message:error.message});return {ok:false,message:error.message};}
  }

  if(app.isPackaged)setTimeout(check,4000);
  else send(window,'development',{version:app.getVersion()});

  return {check};
}

module.exports={initUpdater};
