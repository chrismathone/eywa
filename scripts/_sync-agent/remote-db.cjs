const { createHash } = require('node:crypto');
const idOf = parts => createHash('sha256').update(JSON.stringify(Array.from(parts))).digest('hex');

async function brokerCall(action, body) {
  const port = Number(process.env.SYNC_AGENT_BROKER_PORT);
  const token = process.env.SYNC_AGENT_BROKER_TOKEN;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !token) throw new Error('연동 앱 연결을 확인하지 못했습니다.');
  const response = await fetch(`http://127.0.0.1:${port}/${action}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(60_000), redirect: 'error',
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error('연동 작업을 처리하지 못했습니다.'), { code: result.code || result.error || 'AGENT_UNAVAILABLE' });
  return result;
}

function remoteDatabase(_url, _options, injectedRequest) {
  const request = injectedRequest ?? brokerCall;
  function make(readOnly = false) {
    function sql(parts, ...values) {
      if (!Array.isArray(parts) || !Object.hasOwn(parts,'raw')) {
        if (!Array.isArray(parts)) throw new Error('허용되지 않는 데이터 형식입니다.');
        return values.length ? { kind:'rows', rows:parts, columns:values } : { kind:'list', values:parts };
      }
      const operation = { id:idOf(parts), parameters:values };
      let pending;
      const execute = () => pending ??= request('query',{...operation,readOnly}).then(result => {
        const rows=result.rows;
        if(!Array.isArray(rows)) throw new Error('작업 응답을 확인하지 못했습니다.');
        for(const column of result.columns ?? []) if([1114,1184,1082].includes(column.type))
          for(const row of rows) if(row[column.name]!==null && row[column.name]!==undefined) row[column.name]=new Date(row[column.name]);
        Object.defineProperty(rows,'count',{value:Number(result.count ?? rows.length),enumerable:false});
        return rows;
      });
      return { then:(...args)=>execute().then(...args), catch:(...args)=>execute().catch(...args), finally:(...args)=>execute().finally(...args),
        toJSON:()=>({kind:'fragment',...operation}) };
    }
    sql.json = value => ({kind:'json',value});
    sql.end = async () => {};
    sql.begin = async (mode, fn) => {
      if (mode !== 'read only' || typeof fn !== 'function') throw new Error('이 작업은 서버의 묶음 처리 경로가 필요합니다.');
      return fn(make(true));
    };
    sql.agentOperation = (operation,input) => request('operation',{operation,input});
    sql.unsafe = () => { throw new Error('지원하지 않는 작업입니다.'); };
    return sql;
  }
  return make();
}
module.exports = remoteDatabase;
module.exports.brokerCall = brokerCall;
module.exports.idOf = idOf;
