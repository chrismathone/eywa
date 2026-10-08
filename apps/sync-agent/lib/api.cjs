class ApiError extends Error {constructor(status,code){super(code);this.status=status;this.code=code;}}
class AgentApi {
  constructor(base,identity,fetchImpl=fetch){
    const url=new URL(base);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('서버 주소를 확인하지 못했습니다.');
    this.base=url.origin;this.identity=identity;this.fetch=fetchImpl;
  }
  async call(action,body={},auth=true){
    if(!/^[a-z-]+$/.test(action))throw new Error('지원하지 않는 요청입니다.');
    const headers={'content-type':'application/json'};
    if(auth){if(!this.identity?.deviceId||!this.identity?.secret)throw new ApiError(401,'unauthorized');headers.authorization=`Bearer ${this.identity.deviceId}.${this.identity.secret}`;}
    const response=await this.fetch(`${this.base}/api/sync-agent/${action}`,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(action==='operation'||action==='query'?50_000:12_000),redirect:'error'});
    const result=await response.json();
    if(!response.ok)throw new ApiError(response.status,result.error??'unavailable');
    return result;
  }
}
module.exports={AgentApi,ApiError};
