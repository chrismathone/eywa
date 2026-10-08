const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {UpdatePlan,START_GRACE_MS}=require('../lib/update-plan.cjs');
const {StoredLocalSettingsInput,DEFAULT_LOCAL_SETTINGS}=require('../lib/protocol.cjs');
const ready={sequence:2,version:'1.0.1',expiresAt:'2099-01-01T00:00:00Z'};
function fixture(){let now=Date.parse('2026-10-08T10:00:00Z');const root=fs.mkdtempSync(path.resolve(__dirname,'../../../work/update-plan-'));return{root,now:()=>now,advance:ms=>now+=ms,create:sequence=>new UpdatePlan({root,sequence:sequence??1,now:()=>now})};}
test('download alone never applies; legacy all-day permission becomes download only',()=>{
 const f=fixture(),p=f.create();assert.equal(p.shouldApply({ready,enabled:true}),false);f.advance(30*86400000);assert.equal(p.shouldApply({ready,enabled:true}),false);
 const migrated=StoredLocalSettingsInput.parse({autoStart:false,startMinimized:true,paused:true,classnoteEnabled:false,makeeduEnabled:true,autoUpdate:true,updateStartHour:0,updateEndHour:0});
 assert.deepEqual(migrated,{autoStart:false,startMinimized:true,paused:true,classnoteEnabled:false,makeeduEnabled:true,autoDownload:true});assert.equal(DEFAULT_LOCAL_SETTINGS.autoDownload,true);assert.equal('updateStartHour' in migrated,false);
});
test('immediate consent applies only to the selected version and can be cancelled while draining',()=>{
 const f=fixture(),p=f.create();assert.throws(()=>p.request(null,{sequence:2}));assert.throws(()=>p.request(ready,{sequence:3}));p.request(ready,{sequence:2});assert.equal(p.shouldApply({ready,enabled:true}),true);
 p.cancel();assert.equal(p.shouldApply({ready,enabled:true}),false);p.request(ready,{sequence:2});assert.equal(p.shouldApply({ready:{...ready,sequence:3,version:'1.0.2'},enabled:true}),false);assert.equal(p.plan.state,'missed');
});
test('appointment persists until its exact time, can be moved, and waits for work already running',()=>{
 const f=fixture();let p=f.create();p.request(ready,{sequence:2,at:new Date(f.now()+300000).toISOString()});p=f.create();f.advance(299999);assert.equal(p.shouldApply({ready,enabled:true}),false);
 p.request(ready,{sequence:2,at:new Date(f.now()+120000).toISOString()});f.advance(120000);assert.equal(p.shouldApply({ready,enabled:true}),true);assert.equal(p.plan.state,'waiting');
 f.advance(30*60000);assert.equal(p.shouldApply({ready,enabled:true}),true);p.applying();assert.equal(p.shouldApply({ready,enabled:true}),false);assert.equal(f.create(2).plan,null);
});
test('missed time, restart, sleep and a lost connection require a fresh choice',()=>{
 for(const reason of ['late','restart','sleep','offline','disabled']){
  const f=fixture();let p=f.create();p.request(ready,{sequence:2,at:new Date(f.now()+60000).toISOString()});f.advance(60000+(reason==='late'?START_GRACE_MS+1:0));
  if(reason==='restart')p=f.create();else if(reason==='sleep'||reason==='offline')p.interrupt();else p.shouldApply({ready,enabled:reason!=='disabled'});
  assert.equal(p.plan.state,'missed',reason);assert.equal(p.shouldApply({ready,enabled:true}),false,reason);
 }
 const f=fixture(),p=f.create();p.request(ready,{sequence:2});assert.equal(f.create().plan.state,'missed');
});
test('future appointment survives a brief interruption; active drain does not auto-resume',()=>{
 const f=fixture(),p=f.create();p.request(ready,{sequence:2,at:new Date(f.now()+600000).toISOString()});p.interrupt();assert.equal(p.plan.state,'scheduled');f.advance(600000);assert.equal(p.shouldApply({ready,enabled:true}),true);p.interrupt();assert.equal(p.shouldApply({ready,enabled:true}),false);
});
test('invalid, past and expired times are rejected; expiry and rollback cannot silently retry',()=>{
 const f=fixture(),p=f.create();for(const at of ['invalid',new Date(f.now()).toISOString(),'2099-01-02T00:00:00Z'])assert.throws(()=>p.request(ready,{sequence:2,at}));
 assert.throws(()=>p.request({...ready,expiresAt:'2000-01-01T00:00:00Z'},{sequence:2}));p.request(ready,{sequence:2});p.applying();assert.equal(f.create().plan.state,'missed');p.failed();assert.equal(p.shouldApply({ready,enabled:true}),false);
});
