'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (ch, ...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('api', {
  init: () => call('app:init'),
  openFiles: () => call('files:open'),
  loadPaths: (paths) => call('files:load', paths),
  removeFile: (p) => call('files:remove', p),
  pathForFile: (file) => webUtils.getPathForFile(file),
  saveSettings: (patch) => call('settings:save', patch),
  resetSettings: (keys) => call('settings:reset', keys),
  exportSettings: () => call('settings:export'),
  importSettings: () => call('settings:import'),
  importEmployees: () => call('employees:import'),
  getReport: (filter) => call('report:get', filter),
  exportExcel: (filter) => call('export:excel', filter),
  exportPdf: (filter) => call('export:pdf', filter),
  calMonth: (jy, jm) => call('cal:month', jy, jm),
  calToday: () => call('cal:today'),
  openPath: (p) => call('shell:open', p),
  showInFolder: (p) => call('shell:showInFolder', p),
});
