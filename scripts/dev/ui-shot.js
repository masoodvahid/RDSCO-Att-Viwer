// Screenshot harness: ATT_FILE=log.dat electron scripts/dev/ui-shot.js <outDir>
// Uses a temporary profile, pre-loads the sample file, clicks through tabs and captures PNGs.
const { app, BrowserWindow } = require('electron');
const DATA_FILE = process.env.ATT_FILE;
if (!DATA_FILE) { console.error('Set ATT_FILE to the path of a device log (.dat)'); process.exit(1); }

const fs = require('fs');
const path = require('path');
const os = require('os');
const out = path.resolve(process.argv[process.argv.length - 1]);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'att-ui-'));
app.setPath('userData', profile);
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  lastFiles: [path.resolve(DATA_FILE)],
}));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.on('browser-window-created', (_e, win) => {
  if (win.__shot) return; win.__shot = true;
  win.webContents.once('did-finish-load', async () => {
    try {
      win.setSize(1360, 860);
      await wait(1500);
      const js = (code) => win.webContents.executeJavaScript(code, true);
      const shot = async (name) => { await wait(400); const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, name), img.toPNG()); };
      await shot('1-report.png');
      await js(`document.querySelector('#summaryTable tr[data-uid]').click()`);
      await js(`document.querySelector('.detail-wrap').scrollIntoView()`);
      await shot('2-detail.png');
      await js(`document.querySelector('main').scrollTop=0; document.querySelector('#empPickerBtn').click()`);
      await shot('3-picker.png');
      await js(`document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); document.querySelector('#fromDate').focus()`);
      await shot('4-datepicker.png');
      for (const [tab, name] of [['employees', '5-employees.png'], ['shifts', '6-shifts.png'], ['clock', '7-clock.png'], ['rules', '8-rules.png']]) {
        await js(`document.querySelector('#fromDate').blur(); document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); document.querySelector('[data-tab=${tab}]').click()`);
        await shot(name);
      }
      await js(`document.querySelector('[data-tab=employees]').click()`);
      await js(`document.querySelector('[data-assign]').click()`);
      await shot('9-assign.png');
      const errs = await js(`window.__errors || []`);
      console.log('errors', JSON.stringify(errs));
    } catch (e) { console.error('shot failed', e); }
    app.exit(0);
  });
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) console.log('console:', e.message); });
});
require(process.env.MAIN || '../../src/main/main.js');
