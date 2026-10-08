const {test}=require('node:test'),assert=require('node:assert/strict'),{spawn,spawnSync}=require('node:child_process');
const {brokerCall}=require('../../../scripts/_sync-agent/remote-db.cjs');
test('worker broker requests do not reuse sockets after a blocking legacy subprocess',{timeout:10000},async()=>{
 const child=spawn(process.execPath,['-e',`const h=require('node:http');let n=0;const s=h.createServer((req,res)=>{req.resume();req.on('end',()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({count:++n,connection:req.headers.connection}));});});s.keepAliveTimeout=25;s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 const oldPort=process.env.SYNC_AGENT_BROKER_PORT,oldToken=process.env.SYNC_AGENT_BROKER_TOKEN;
 try {
  const port=await new Promise((resolve,reject)=>{child.stdout.once('data',data=>resolve(Number(data.toString().trim())));child.once('error',reject);});
  process.env.SYNC_AGENT_BROKER_PORT=String(port);process.env.SYNC_AGENT_BROKER_TOKEN='fixture-local-token';
  for(let n=1;n<=3;n++){const row=await brokerCall('query',{});assert.deepEqual(row,{count:n,connection:'close'});spawnSync(process.execPath,['-e','setTimeout(()=>{},100)'],{windowsHide:true});}
 }finally{child.kill();if(oldPort===undefined)delete process.env.SYNC_AGENT_BROKER_PORT;else process.env.SYNC_AGENT_BROKER_PORT=oldPort;if(oldToken===undefined)delete process.env.SYNC_AGENT_BROKER_TOKEN;else process.env.SYNC_AGENT_BROKER_TOKEN=oldToken;}
});
