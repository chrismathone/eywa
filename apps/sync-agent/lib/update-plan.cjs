const fs=require('node:fs');
const path=require('node:path');
const {atomicWrite}=require('./storage.cjs');

// Polling can be slightly late, but a missed appointment must never become a
// surprise install at the next login. Once draining starts, finish that job.
const START_GRACE_MS=2*60_000;
class UpdatePlan {
  constructor({root,sequence,now=Date.now}){
    this.file=path.join(root,'update-plan.json');this.now=now;this.plan=null;
    let saved;try{saved=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{return;}
    if(!saved||!Number.isSafeInteger(saved.sequence)||saved.sequence<=sequence||!/^\d+\.\d+\.\d+$/.test(saved.version)
      ||!['now','scheduled'].includes(saved.mode)||!['scheduled','waiting','missed','failed','applying'].includes(saved.state)
      ||(saved.mode==='scheduled'&&!Number.isFinite(Date.parse(saved.at))))return;
    this.plan=saved;
    if(saved.state==='waiting'||saved.state==='applying'||(saved.state==='scheduled'&&Date.parse(saved.at)<=now()))this.save({...saved,state:'missed'});
  }
  save(plan){atomicWrite(this.file,JSON.stringify(plan));this.plan=plan;}
  request(ready,{sequence,at}={}){
    if(!ready||sequence!==ready.sequence)throw new Error('다운로드가 완료된 버전을 다시 확인해 주세요.');
    if(Date.parse(ready.expiresAt)<=this.now())throw new Error('새 버전을 다시 확인해 주세요. 다운로드 유효기간이 지났습니다.');
    const scheduled=at!==undefined;
    if(scheduled&&(typeof at!=='string'||!Number.isFinite(Date.parse(at))||Date.parse(at)<this.now()+60_000))throw new Error('현재보다 1분 이상 뒤의 날짜와 시간을 지정해 주세요.');
    if(scheduled&&Date.parse(at)>=Date.parse(ready.expiresAt))throw new Error('이 버전의 다운로드 유효기간 안으로 예약해 주세요.');
    this.save({sequence:ready.sequence,version:ready.version,mode:scheduled?'scheduled':'now',at:scheduled?new Date(at).toISOString():null,state:scheduled?'scheduled':'waiting'});
  }
  cancel(){this.save(null);}
  interrupt(){
    if(this.plan&&(this.plan.state==='waiting'||(this.plan.state==='scheduled'&&Date.parse(this.plan.at)<=this.now())))this.save({...this.plan,state:'missed'});
  }
  shouldApply({ready,enabled}){
    const p=this.plan;if(!p||!['scheduled','waiting'].includes(p.state))return false;
    if(ready&&(ready.sequence!==p.sequence||ready.version!==p.version)){this.save({...p,state:'missed'});return false;}
    if(p.state==='scheduled'&&this.now()<Date.parse(p.at))return false;
    if(!enabled||!ready||ready.sequence!==p.sequence||ready.version!==p.version||Date.parse(ready.expiresAt)<=this.now()
      ||(p.state==='scheduled'&&this.now()-Date.parse(p.at)>START_GRACE_MS)){
      this.save({...p,state:'missed'});return false;
    }
    if(p.state==='scheduled')this.save({...p,state:'waiting'});
    return true;
  }
  applying(){this.save({...this.plan,state:'applying'});}
  failed(){if(this.plan)this.save({...this.plan,state:'failed'});}
}
module.exports={UpdatePlan,START_GRACE_MS};
