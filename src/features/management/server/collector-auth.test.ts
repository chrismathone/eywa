// @vitest-environment node
import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({from:vi.fn(),read:vi.fn(),write:vi.fn(),settings:vi.fn()}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({from:m.from})}));
vi.mock("@/features/owner/server/queries",()=>({getTenantSettingsByTenantId:m.settings}));
vi.mock("@/lib/permissions",async(importOriginal)=>({...await importOriginal<typeof import("@/lib/permissions")>(),canAccess:m.read,canWrite:m.write}));
import {collectorAccess,newCollectorIdentity,parseCollectorToken,tokenHash} from "./collector-auth";
const identity=newCollectorIdentity(),tenant="becaa316-e636-42e9-9d09-08b133e0b094",actor="94007db7-12d3-4b5d-97f2-39071446536b";
let row:Record<string,unknown>,owner:Record<string,unknown>|null,touches:unknown[],queries:{table:string;op:string;args:unknown[]}[],deviceError:unknown,toggle:{collector_enabled:boolean}|null;
beforeEach(()=>{
  vi.clearAllMocks();m.read.mockReturnValue(true);m.write.mockReturnValue(true);toggle={collector_enabled:true};m.settings.mockResolvedValue({permissions:{overrides:[],userOverrides:[]},modules:{disabled:[]}});
  row={id:identity.id,tenant_id:tenant,created_by:actor,secret_hash:identity.hash,expires_at:new Date(Date.now()+60_000).toISOString(),revoked_at:null};
  owner={id:actor,tenant_id:tenant,status:"active",system_role:"master"};touches=[{id:identity.id}];queries=[];deviceError=null;
  m.from.mockImplementation((table:string)=>{
    let updated=false;const q:Record<string,unknown>={};
    for(const op of ["select","eq","is","gt","lt","update"]){q[op]=(...args:unknown[])=>{queries.push({table,op,args});if(op==="update")updated=true;return q;};}
    const result=()=>({data:table==="users"?owner:table==="management_collection_settings"?toggle:updated?touches:row,error:table==="management_collection_devices"?deviceError:null});
    q.maybeSingle=async()=>result();q.then=(resolve:(v:unknown)=>unknown)=>Promise.resolve(result()).then(resolve);return q;
  });
});
it("derives tenant and owner solely from the device and checks tenant-scoped active owner",async()=>{
  expect(identity.hash).not.toBe(identity.token.split(".")[1]);
  expect(parseCollectorToken(`Bearer ${identity.token}`).hash).toBe(tokenHash(identity.token.split(".")[1]!));
  await expect(collectorAccess(`Bearer ${identity.token}`,true)).resolves.toEqual({id:actor,tenantId:tenant,deviceId:identity.id});
  expect(queries).toContainEqual({table:"users",op:"eq",args:["tenant_id",tenant]});
  expect(queries).toContainEqual({table:"management_collection_devices",op:"is",args:["revoked_at",null]});
  expect(queries.some(q=>q.op==="lt"&&q.args[0]==="last_request_at")).toBe(true);
});
it.each(["expired","revoked","invalid_date","wrong_secret"])("rejects %s before actor access",async(reason)=>{
  if(reason==="expired")row.expires_at="2000-01-01";if(reason==="revoked")row.revoked_at=new Date().toISOString();if(reason==="invalid_date")row.expires_at="x";if(reason==="wrong_secret")row.secret_hash="0".repeat(64);
  await expect(collectorAccess(`Bearer ${identity.token}`)).rejects.toMatchObject({status:401});expect(m.from).not.toHaveBeenCalledWith("users");
});
it.each(["inactive","teacher","missing","read_denied","write_denied"])("rejects owner change %s",async(reason)=>{
  if(reason==="inactive")owner!.status="inactive";if(reason==="teacher")owner!.system_role="teacher";if(reason==="missing")owner=null;if(reason==="read_denied")m.read.mockReturnValue(false);if(reason==="write_denied")m.write.mockReturnValue(false);
  await expect(collectorAccess(`Bearer ${identity.token}`)).rejects.toMatchObject({status:403});expect(queries.some(q=>q.op==="update")).toBe(false);
});
it("fails closed on database failure and concurrent rate/revocation guard",async()=>{
  deviceError={message:"internal"};await expect(collectorAccess(`Bearer ${identity.token}`)).rejects.toMatchObject({status:503});deviceError=null;touches=[];await expect(collectorAccess(`Bearer ${identity.token}`,true)).rejects.toMatchObject({status:429});
});
it("rejects a malformed bearer without reading the DB",async()=>{
  await expect(collectorAccess(null)).rejects.toMatchObject({status:401});await expect(collectorAccess("Bearer nope")).rejects.toMatchObject({status:401});expect(m.from).not.toHaveBeenCalled();
});
it.each([null,{collector_enabled:false}])("🔴 지점 스위치가 꺼져 있으면(%j) 원장 확인 전에 거절한다",async(value)=>{
  toggle=value;await expect(collectorAccess(`Bearer ${identity.token}`)).rejects.toMatchObject({status:403,code:"collector_disabled"});expect(m.from).not.toHaveBeenCalledWith("users");expect(queries.some(q=>q.op==="update")).toBe(false);
});
it("설정을 못 읽으면 닫힌 쪽(503)",async()=>{m.settings.mockRejectedValue(Error("x"));await expect(collectorAccess(`Bearer ${identity.token}`)).rejects.toMatchObject({status:503});});
