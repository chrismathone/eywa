import {describe,it,expect} from "vitest";
import {compileAgentQuery,InvalidAgentQuery,type QueryCatalog} from "./query-compiler";
import catalog from "./server/query-catalog.json";
const id="a".repeat(64),fragment="b".repeat(64);
const compile=(def:QueryCatalog,parameters:unknown[],module="classnote")=>compileAgentQuery(def,module,{id,parameters});
describe("device query boundary",()=>{
  it("binds an injection string without copying it into SQL",()=>{
    const c={[id]:{parts:["select * from students where id=",""],modules:["classnote"],parameters:[{kind:"value"}]}};
    const input="'; delete from users;--";expect(compile(c,[input])).toEqual({text:"select * from students where id=$1",values:[input]});
  });
  it("rejects unknown operations and wrong modules",()=>{
    const c={[id]:{parts:["select 1"],modules:["classnote"],parameters:[]}};
    expect(()=>compile({},[])).toThrow(InvalidAgentQuery);expect(()=>compile(c,[],"makeedu")).toThrow(InvalidAgentQuery);expect(()=>compile(c,[1])).toThrow(InvalidAgentQuery);
  });
  it("permits only the registered fragment at this parameter",()=>{
    const c={[id]:{parts:["select 1 ",""],modules:["classnote"],parameters:[{kind:"fragment",ids:[fragment]}]},[fragment]:{parts:["where 1=",""],modules:["classnote"],parameters:[{kind:"value"}]}};
    expect(compile(c,[{kind:"fragment",id:fragment,parameters:[1]}]).text).toBe("select 1 where 1=$1");
    expect(()=>compile(c,[{kind:"fragment",id,parameters:[]}])).toThrow();
  });
  it("binds pre-encoded JSON through text to preserve objects, arrays and null",()=>{
    const c={[id]:{parts:["select ",""],modules:["classnote"],parameters:[{kind:"value"}]}};
    for(const value of [{nested:{text:"'; select 1;--"}},[1,"two"],null]) {
      expect(compile(c,[{kind:"json",value}])).toEqual({text:"select $1::text::jsonb",values:[JSON.stringify(value)]});
    }
  });
  it("rejects injected row columns, duplicate columns and unsupported values",()=>{
    const c={[id]:{parts:["insert into students ",""],modules:["makeedu"],parameters:[{kind:"rows",columns:["id","name"]}]}};
    const row={kind:"rows",rows:[{id:1,name:"x"}],columns:["id","name"]};
    expect(compile(c,[row],"makeedu")).toEqual({text:'insert into students ("id","name") values ($1,$2)',values:[1,"x"]});
    for(const columns of [["id);drop table users--"],["id","id"],["tenant_id"]])expect(()=>compile(c,[{...row,columns}],"makeedu")).toThrow();
  });
  it.each([undefined,NaN,Infinity,{text:"select 1"},[[1]],[{id:1}]])("rejects malformed value %j",value=>{
    expect(()=>compile({[id]:{parts:["select ",""],modules:["classnote"],parameters:[{kind:"value"}]}},[value])).toThrow();
  });
  it("every catalog descriptor resolves to registered, same-module fragments",()=>{
    for(const q of Object.values(catalog) as Array<{modules:string[];parameters:Array<{kind:string;ids?:string[]}>}>){for(const p of q.parameters){for(const ref of p.ids??[]){expect(catalog).toHaveProperty(ref);for(const moduleName of q.modules)expect((catalog as QueryCatalog)[ref]!.modules).toContain(moduleName);}}}
  });
  it("the catalog never includes unrestricted SQL/session identity operations",()=>{
    for(const q of Object.values(catalog)){const text=q.parts.join("?");expect(text).not.toMatch(/\b(?:set\s+(?:local\s+)?role|copy\s+.*program|alter\s+role|drop\s+table)\b/i);expect(text).not.toMatch(/set_config\('(?!statement_timeout)/);}
  });
});
