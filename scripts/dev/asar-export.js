// ATT_FILE=log.dat electron scripts/dev/asar-export.js <asarPath> <outDir> : runs core + exports from a packaged app.asar
const { app } = require('electron');
const DATA_FILE = process.env.ATT_FILE;
if (!DATA_FILE) { console.error('Set ATT_FILE to the path of a device log (.dat)'); process.exit(1); }

const fs = require('fs'); const path = require('path');
const [asar, out] = process.argv.slice(-2);
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    const R = (p) => require(path.join(asar, p));
    const { parseAttLog } = R('src/core/parser.js'); const { processAll } = R('src/core/engine.js');
    const { buildReport } = R('src/core/report.js'); const { writePdf } = R('src/export/pdf.js'); const { writeExcel } = R('src/export/excel.js');
    const settings = R('src/core/defaults.js');
    const r = processAll(parseAttLog(fs.readFileSync(DATA_FILE, 'utf8')).punches, settings);
    const rep = buildReport(r, settings, { from: '1405/06/01', to: '1405/06/31' });
    await writePdf(rep, path.join(out, 'asar.pdf')); await writeExcel(rep, path.join(out, 'asar.xlsx'));
    console.log('ASAR EXPORT OK', rep.employees.length);
  } catch (e) { console.error('ASAR EXPORT FAIL', e); }
  app.exit(0);
});
