// Run with: ATT_FILE=log.dat electron scripts/dev/pdf-smoke.js  (writes to scripts/dev/out)
const { app } = require('electron');
const DATA_FILE = process.env.ATT_FILE;
if (!DATA_FILE) { console.error('Set ATT_FILE to the path of a device log (.dat)'); process.exit(1); }

const fs = require('fs');
const path = require('path');
const { parseAttLog } = require('../../src/core/parser');
const { processAll } = require('../../src/core/engine');
const { buildReport } = require('../../src/core/report');
const { writePdf } = require('../../src/export/pdf');
const { writeExcel } = require('../../src/export/excel');
const settings = require('../../src/core/defaults');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    const { punches } = parseAttLog(fs.readFileSync(DATA_FILE, 'utf8'));
    const r = processAll(punches, settings);
    const rep = buildReport(r, settings, { uids: r.users.slice(0, 4), from: '1404/07/01', to: '1404/07/30' });
    const out = path.join(__dirname, 'out');
    fs.mkdirSync(out, { recursive: true });
    const t0 = Date.now();
    await writePdf(rep, path.join(out, 'sample.pdf'));
    console.log('pdf ms', Date.now() - t0);
    const all = buildReport(r, settings, { from: '1405/06/01', to: '1405/06/31' });
    await writePdf(all, path.join(out, 'all-shahrivar.pdf'));
    await writeExcel(all, path.join(out, 'all-shahrivar.xlsx'));
    console.log('employees', all.employees.length);
  } catch (e) { console.error(e); }
  app.quit();
});
