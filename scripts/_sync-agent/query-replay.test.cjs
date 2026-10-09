// Execute real worker read functions through the wire adapter and server compiler.
// External requests and all database writes are forbidden in this fixture.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),work=fs.mkdtempSync(path.join(root,'work/query-replay-')),bundle=path.join(work,'compiler.cjs');
require('../../apps/sync-agent/node_modules/esbuild').buildSync({entryPoints:[path.join(root,'src/features/sync-agent/query-compiler.ts')],bundle:true,platform:'node',format:'cjs',outfile:bundle,logLevel:'silent'});
const {compileAgentQuery}=require(bundle),catalog=require('../../src/features/sync-agent/server/query-catalog.json'),remote=require('./remote-db.cjs');
const tenant='bd4a636a-5356-483f-bf1c-b615067a7426';
function fixture(){const calls=[];const sql=remote('',{},async(action,body)=>{
  assert.equal(action,'query');const wire=JSON.parse(JSON.stringify(body)),compiled=compileAgentQuery(catalog,'classnote',wire);calls.push({wire,...compiled});
  const rows=compiled.text.trimStart().startsWith('with cls')?[{classes:[],links:[],members:[]}]:compiled.text.includes('group by c.id, c.class_name')?[{id:'class-fixture',class_name:'fixture',student_ids:[]}]:[];
  return{rows,columns:[],count:rows.length};
});return{sql,calls};}
test('local and imported SQL helpers survive real loadAywa/auto-sync wire serialization',async()=>{
  const oldFetch=global.fetch;let requests=0;global.fetch=()=>{requests++;throw Error('External request forbidden');};
  try{
    const {loadAywa}=await import('../_classnote/math-class-boards-load.mjs'),{loadAutoSyncInputs}=await import('../_classnote/auto-sync-load.mjs');
    const f=fixture();assert.equal((await loadAywa(f.sql,tenant)).classes.length,1);await loadAutoSyncInputs(f.sql,tenant);
    assert.equal(f.calls.length,3);for(const q of [f.calls[0],f.calls[2]]){assert.match(q.text,/c\.tenant_id = \$\d+/);assert.match(q.text,/e\.tenant_id = \$\d+/);assert.match(q.text,/not coalesce\(s\.is_test, false\)/);assert.ok(q.values.includes(tenant));assert.equal(q.text.includes('[object Object]'),false);}
    const query=f.calls[2].wire;assert.throws(()=>compileAgentQuery(catalog,'makeedu',query));
    const wrong=JSON.parse(JSON.stringify(query));wrong.parameters[0].id=query.parameters[1].id;assert.throws(()=>compileAgentQuery(catalog,'classnote',wrong));
    assert.equal(requests,0);
  }finally{global.fetch=oldFetch;}
});
test('installed 1.0.3 attachment query uses the corrected registered read and keeps shape/module gates',()=>{
  const old='63bb961c8416762e284136a79f2b0d69a77c6dca789abe4d9b64227fffbe4e05',replacement=catalog[old].replacement;
  assert.ok(replacement);const query={id:old,parameters:[tenant]};
  assert.deepEqual(compileAgentQuery(catalog,'classnote',query),compileAgentQuery(catalog,'classnote',{...query,id:replacement}));
  assert.throws(()=>compileAgentQuery(catalog,'makeedu',query));assert.throws(()=>compileAgentQuery(catalog,'classnote',{...query,parameters:[]}));
});
test('compatibility aliases cannot cross modules or loop indefinitely',()=>{
  const a='a'.repeat(64),b='b'.repeat(64),q={id:a,parameters:[]},def={parts:['select 1'],modules:['classnote'],parameters:[]};
  assert.throws(()=>compileAgentQuery({[a]:{...def,replacement:b},[b]:{...def,modules:['makeedu']}},'classnote',q));
  assert.throws(()=>compileAgentQuery({[a]:{...def,replacement:b},[b]:{...def,replacement:a}},'classnote',q));
});
