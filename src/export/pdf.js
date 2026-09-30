'use strict';
/** Renders the report HTML in a hidden window and prints it to PDF (main process only). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BrowserWindow } = require('electron');
const { buildPdfHtml } = require('./pdf-html');

async function writePdf(report, filePath) {
  const html = buildPdfHtml(report);
  // A temp file instead of a data: URL — large reports exceed the URL length limit.
  const tmp = path.join(os.tmpdir(), `attendance-report-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  try {
    await win.loadFile(tmp);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)', true).catch(() => {});
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });
    fs.writeFileSync(filePath, pdf);
  } finally {
    win.destroy();
    fs.rm(tmp, { force: true }, () => {});
  }
}

module.exports = { writePdf };
