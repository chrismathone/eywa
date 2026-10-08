const http=require('node:http');
const {randomBytes,timingSafeEqual}=require('node:crypto');
async function createBroker({module,lease,api,isDraining,onCycle,onEvent}) {
  const token=randomBytes(32).toString('base64url');let inflight=0;
  const server=http.createServer(async(req,res)=>{
    const reply=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store',connection:'close'});res.end(JSON.stringify(body));};
    const expected=Buffer.from(`Bearer ${token}`),supplied=Buffer.from(req.headers.authorization??'');
    if(req.method!=='POST'||req.headers.origin||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){req.resume();reply(401,{error:'unauthorized'});return;}
    try {
      lease.assert();let size=0,chunks=[];
      for await(const c of req){size+=c.length;if(size>2*1024*1024){reply(413,{error:'too_large'});req.destroy();return;}chunks.push(c);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));let result;
      inflight++;
      try {
        if(req.url==='/state'){onCycle();result={drain:isDraining()};}
        else if(req.url==='/lease-check'){result={generation:lease.generation,remainingMs:Math.max(0,lease.deadline-lease.now())};}
        else if(req.url==='/schedule'){result=await api.call('schedule',{...body,...lease.envelope(module)});}
        else if(req.url==='/event'){onEvent(body);result={ok:true};}
        else if(['/query','/operation'].includes(req.url))result=await api.call(req.url.slice(1),{...body,...lease.envelope(module)});
        else {reply(404,{error:'not_found'});return;}
        reply(200,result);
      } finally {inflight--;}
    } catch(e){reply(e.status??503,{error:e.code??'unavailable'});}
  });
  server.requestTimeout=65000;server.headersTimeout=10000;server.maxConnections=16;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {port:server.address().port,token,get inflight(){return inflight;},close:()=>{server.closeAllConnections();server.close();}};
}
module.exports={createBroker};
