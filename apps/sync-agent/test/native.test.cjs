const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {spawn}=require('node:child_process');const {setTimeout:delay}=require('node:timers/promises');
test('native host terminates the worker and its descendant when parent pipe closes',{timeout:20000},async()=>{
  const root=fs.mkdtempSync(path.resolve(__dirname,'../../../work/worker-host-'));
  const file=path.join(root,'worker with spaces.cjs'),pids=path.join(root,'pids.json');
  fs.writeFileSync(file,"const fs=require('fs');const {spawn}=require('child_process');const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true});fs.writeFileSync(process.argv[2],JSON.stringify([process.pid,p.pid]));setInterval(()=>{},1000);");
  const host=spawn(path.resolve(__dirname,'../build/WorkerHost.exe'),[process.execPath,file,pids],{windowsHide:true,stdio:['pipe','pipe','pipe']});let ids=[];
  try{
    for(let i=0;i<100&&!fs.existsSync(pids);i++)await delay(50);
    assert.ok(fs.existsSync(pids),'host starts arguments containing spaces');ids=JSON.parse(fs.readFileSync(pids,'utf8'));assert.equal(ids.length,2);
    for(const id of ids)assert.doesNotThrow(()=>process.kill(id,0));host.stdin.destroy();
    const alive=id=>{try{process.kill(id,0);return true;}catch{return false;}};
    for(let i=0;i<100&&ids.some(alive);i++)await delay(50);
    assert.deepEqual(ids.filter(alive),[],'all descendants stopped after controller exit');
  }finally{host.stdin.destroy();if(host.exitCode===null)host.kill();for(const id of ids){try{process.kill(id);}catch{}}}
});
