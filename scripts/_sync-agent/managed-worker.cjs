const {brokerCall}=require('./remote-db.cjs');
const managed=process.env.SYNC_AGENT_MODE==='1';
// `task` = 지금 시작하는 일(protocol의 TASK_LABELS 키) — 연동 앱이 '기다리는 작업'으로 보여 준다(1.0.7). 'cycle'·'idle'은 비운다.
async function state(phase,task){return managed?brokerCall('state',{phase,...(task?{task}:{})}):{drain:false};}
/** 지금 하는 일만 알린다(종료 요청은 보지 않는다 · 실패해도 작업은 그대로). null = 쉬는 중. */
async function activity(task){if(managed)await brokerCall('state',{phase:task?'activity':'idle',...(task?{task}:{})}).catch(()=>{});}
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
module.exports={managed,state,activity,legacyCutover,result};
