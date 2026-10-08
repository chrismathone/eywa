const fs=require('node:fs');
const path=require('node:path');
function atomicWrite(file,value) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=file+'.next';
  const fd=fs.openSync(temp,'w',0o600);
  try {fs.writeFileSync(fd,value);fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  fs.renameSync(temp,file);
}
function secretStore(root,safeStorage) {
  const file=path.join(root,'connection.bin');
  return {
    read(){
      if(!fs.existsSync(file))return null;
      if(!safeStorage.isEncryptionAvailable())throw new Error('Windows 보안 저장소를 사용할 수 없습니다.');
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
    },
    write(value){
      if(!safeStorage.isEncryptionAvailable())throw new Error('Windows 보안 저장소를 사용할 수 없습니다.');
      atomicWrite(file,safeStorage.encryptString(JSON.stringify(value)));
    },
    clear(){if(fs.existsSync(file))fs.unlinkSync(file);},
  };
}
function eventQueue(root,max=1000) {
  const file=path.join(root,'events.json');
  let rows=[];
  try {const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(Array.isArray(raw))rows=raw.slice(-max);}catch{}
  const save=()=>atomicWrite(file,JSON.stringify(rows));
  return {
    add(row){rows.push(row);if(rows.length>max)rows=rows.slice(-max);save();},
    peek(){return rows.slice(0,50);},
    ack(ids){const accepted=new Set(ids);rows=rows.filter(r=>!accepted.has(r.id));save();},
    get length(){return rows.length;},
  };
}
module.exports={atomicWrite,secretStore,eventQueue};
