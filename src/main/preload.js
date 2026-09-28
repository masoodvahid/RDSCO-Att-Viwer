'use strict';

const {contextBridge,ipcRenderer}=require('electron');

contextBridge.exposeInMainWorld('desktop',{
  appInfo:()=>ipcRenderer.invoke('app:info'),
  openAttendanceFile:()=>ipcRenderer.invoke('attendance:open'),
  filterAttendance:range=>ipcRenderer.invoke('attendance:filter',range),
  exportExcel:range=>ipcRenderer.invoke('report:excel',range),
  exportPdf:range=>ipcRenderer.invoke('report:pdf',range),
  revealFile:filePath=>ipcRenderer.invoke('file:reveal',filePath),
  checkForUpdates:()=>ipcRenderer.invoke('updater:check'),
  onUpdateStatus:callback=>{
    const listener=(_event,payload)=>callback(payload);
    ipcRenderer.on('updater:status',listener);
    return ()=>ipcRenderer.removeListener('updater:status',listener);
  }
});
