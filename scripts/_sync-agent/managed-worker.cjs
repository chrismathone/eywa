const {brokerCall}=require('./remote-db.cjs');
const managed=process.env.SYNC_AGENT_MODE==='1';
async function state(phase){return managed?brokerCall('state',{phase}):{drain:false};}
function result(task,value={},module){
  if(!managed)return;
  const failed=!!value.error||value.ok===0||value.ok===false;
  const count=[value.processed,value.sent,value.uploaded,value.created,value.notified].find(v=>Number.isInteger(v)&&v>0);
  if(!failed&&!count&&value.ok!==1&&value.ok!==true)return;
  void brokerCall('event',{kind:failed?'job_failed':'job_succeeded',module,detail:{task,...(count?{count:Math.min(1000000,count)}:{})}}).catch(()=>{});
}
async function legacyCutover(sql,tenant){
  if(managed)return false;
  try{const [row]=await sql`select cutover_at from sync_agent_settings where tenant_id=${tenant}`;return !!row?.cutover_at;}
  catch(e){if(e?.code==='42P01')return false;throw e;}
}
module.exports={managed,state,legacyCutover,result};
