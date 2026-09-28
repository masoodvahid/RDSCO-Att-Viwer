'use strict';
const fs=require('fs/promises');const path=require('path');
class AuditLog{
  constructor(userDataPath){this.baseDir=path.join(userDataPath,'logs');}
  async log(event,context={}){try{await fs.mkdir(this.baseDir,{recursive:true});const month=new Date().toISOString().slice(0,7);const filePath=path.join(this.baseDir,'activity-'+month+'.jsonl');await fs.appendFile(filePath,JSON.stringify({at:new Date().toISOString(),event,context})+'\n','utf8');}catch{}}
}
module.exports={AuditLog};
