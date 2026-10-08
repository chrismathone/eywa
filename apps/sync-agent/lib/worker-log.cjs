const fs=require('node:fs'),path=require('node:path'),{StringDecoder}=require('node:string_decoder');
const kstStamp=ms=>new Date(ms+9*3600_000).toISOString().replace('T',' ').slice(0,23)+' +09:00';
function createWorkerLog(root,{secrets=[],now=Date.now,onSafeLog=()=>{},maxBytes=20*1024*1024}={}) {
  const base=path.resolve(root),redactions=[...new Set(secrets.filter(v=>typeof v==='string'&&v.length>=3))].sort((a,b)=>b.length-a.length);
  const last=new Map();
  function append(module,line) {
    if(!['app','classnote','makeedu'].includes(module))throw Error('Invalid log module');
    const at=now(),stamp=kstStamp(at),dir=path.join(base,stamp.slice(0,10));fs.mkdirSync(dir,{recursive:true});
    let safe=String(line).replace(/\x1b\[[0-9;]*m/g,'').replace(/^\[\d{4}-\d{2}-\d{2}[T ][\d:.]+(?:Z| [^\]]+)?\]\s*/,'');for(const secret of redactions)safe=safe.replaceAll(secret,'[보호됨]');
    safe=safe.replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi,'$1[보호됨]').replace(/((?:password|passwd|refresh_token|access_token|client_secret)\s*[:=]\s*)[^\s,;]+/gi,'$1[보호됨]');
    let part=0,file;do{file=path.join(dir,module+(part?'-'+String(part).padStart(3,'0'):'')+'.log');part++;}while(fs.existsSync(file)&&fs.statSync(file).size>=maxBytes);
    fs.appendFileSync(file,`[${stamp}] ${safe.slice(0,16_384)}\n`,'utf8');
    const event=summarize(module,safe);if(event&&at-(last.get(event.logCode)??-Infinity)>=60_000){last.set(event.logCode,at);onSafeLog(event);}
  }
  return {append,sink(module){const decoder=new StringDecoder('utf8');let pending='';const lines=text=>{pending+=text;let pos;while((pos=pending.indexOf('\n'))>=0){append(module,pending.slice(0,pos).replace(/\r$/,''));pending=pending.slice(pos+1);}if(pending.length>16_384){append(module,pending.slice(0,16_384)+' [긴 줄 생략]');pending='';}};
    return {write:chunk=>{try{lines(decoder.write(chunk));}catch{}},end:()=>{try{lines(decoder.end());if(pending)append(module,pending);}catch{}pending='';}};
  }};
}
function summarize(module,line) {
  let logCode,level='info';
  if(/heartbeat 실패/.test(line)){logCode='status_failed';level='error';}
  else if(/실행 로그 기록 실패/.test(line)){logCode='result_failed';level='error';}
  else if(/폴링 오류/.test(line)){logCode='poll_failed';level='error';}
  else if(module==='makeedu') {
    if(/메이크에듀|makeedu/.test(line)&&/동기화 시작/.test(line))logCode='makeedu_sync_started';
    else if(/동기화 완료.*실패 도메인: 없음/.test(line))logCode='makeedu_sync_complete';
    else if(/동기화 완료.*실패 도메인:/.test(line)){logCode='makeedu_sync_partial';level='error';}
    else if(/login ok|makeedu-health.*정상.*로그인 성공/.test(line))logCode='login_ok';
    else {const stage=/─+ (students|classes|prospects|invoices|textbook_checks|consultations):/.exec(line)?.[1];if(stage)logCode='makeedu_'+stage;}
  }
  return logCode?{logCode,level}:null;
}
module.exports={createWorkerLog,kstStamp,summarize};
