// Monotonic deadlines. A timeout or expired prior lease permanently retires this instance.
class DeviceLease {
  constructor(api,{instanceId,version,now=()=>performance.now(),onLost=()=>{}}){Object.assign(this,{api,instanceId,version,now,onLost});this.generation=null;this.deadline=0;this.lost=false;this.pending=false;}
  get held(){return !this.lost && this.generation!==null && this.now()<this.deadline;}
  lose(){if(this.lost)return;this.lost=true;this.deadline=0;this.onLost();}
  accept(result,started){
    const duration=Number(result.remainingMs);
    if(this.lost||!Number.isFinite(duration)||duration<=10_000||duration>90_000||this.now()>=started+duration-10_000)return false;
    this.deadline=started+duration-10_000;return true;
  }
  async acquire(){
    if(this.lost||this.pending)return false;if(this.generation)return this.held;
    this.pending=true;const start=this.now();
    try{const row=await this.api.call('acquire',{instanceId:this.instanceId,version:this.version});if(!/^[1-9]\d{0,17}$/.test(String(row.generation))||!this.accept(row,start))return false;this.generation=String(row.generation);return true;}
    finally{this.pending=false;}
  }
  async renew(status){
    if(!this.held){this.lose();return null;}if(this.pending)return null;
    this.pending=true;const start=this.now();
    try{const row=await this.api.call('heartbeat',{instanceId:this.instanceId,version:this.version,generation:this.generation,status});if(!this.held||!this.accept(row,start)){this.lose();return null;}return row.config;}
    catch(e){this.lose();throw e;}finally{this.pending=false;}
  }
  assert(){if(!this.held){this.lose();throw new Error('실행 권한을 확인하지 못했습니다.');}}
  envelope(module){this.assert();return{instanceId:this.instanceId,generation:this.generation,module};}
  async release(){const generation=this.generation;this.deadline=0;this.lost=true;if(generation)await this.api.call('release',{instanceId:this.instanceId,generation});}
}
module.exports={DeviceLease};
