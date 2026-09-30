const fs=require('fs');
const DATA_FILE = process.env.ATT_FILE;
if (!DATA_FILE) { console.error('Set ATT_FILE to the path of a device log (.dat)'); process.exit(1); }

const {parseAttLog}=require('../../src/core/parser');
const {processAll}=require('../../src/core/engine');
const T=require('../../src/core/time');
const txt=fs.readFileSync(DATA_FILE,'latin1');
const {punches,errors}=parseAttLog(txt,'f');
const settings = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2],'utf8')) : {};
const t0=Date.now();
const r=processAll(punches,settings);
console.log('parsed',punches.length,'errors',errors.length,'ms',Date.now()-t0, r.stats);
let tot=0,inc=0,long=0; const durs=[];
for(const [u,bl] of r.blocks){for(const b of bl){tot++; if(!b.complete)inc++; if(b.status==='long')long++; if(b.complete)durs.push(b.workedMin/60);}}
console.log('blocks',tot,'incomplete',inc,'long',long);
const hist={}; for(const d of durs){const k=Math.floor(d);hist[k]=(hist[k]||0)+1;} console.log('dur hist (h):',JSON.stringify(hist));
const show=(u,from,n)=>{console.log('=====',u); for(const b of r.blocks.get(u).slice(from,from+n)){console.log(T.gDate(b.start),T.weekdayFa(b.start).padEnd(9),T.hhmm(b.start),'→',b.end?T.gDate(b.end).slice(5)+' '+T.hhmm(b.end):'   ---   ',T.fmtDuration(b.workedMin).padStart(6),b.status.padEnd(7),b.punches.map(p=>T.hhmm(p.ts)).join(' '), b.shift?`[${b.shift.name} late${b.shift.lateMin} early${b.shift.earlyMin} ot${b.shift.overtimeMin}]`:'');}};
// usage: ATT_FILE=log.dat node scripts/dev/inspect.js [settings.json] [uid:from:count,...]
for (const a of (process.argv[3]||r.users.slice(0,3).map(u=>u+':0:15').join(',')).split(',')){const [u,f,n]=a.split(':');show(u,+f,+n);}
