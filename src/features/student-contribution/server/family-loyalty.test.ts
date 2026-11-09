import { it, expect, vi, beforeEach } from "vitest";
const m=vi.hoisted(()=>({scope:null as Set<string>|null,fail:false,calls:[] as {table:string;op:string;args:unknown[]}[],rows:{} as Record<string,unknown[]>}));
vi.mock("react",()=>({cache:(f:unknown)=>f}));
vi.mock("./access",()=>({getContributionGate:async()=>({tenantId:"clone"})}));
vi.mock("./fact-access",()=>({readableFactStudents:async()=>m.scope}));
vi.mock("@/lib/date-kst",()=>({kstToday:()=>"2026-11-09"}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({from:(table:string)=>{
  const q:Record<string,unknown>={};for(const op of ["select","eq","order","range","lte","or"]){q[op]=(...args:unknown[])=>{m.calls.push({table,op,args});return q;};}
  q.then=(resolve:(v:unknown)=>unknown)=>resolve({data:m.rows[table]??[],error:m.fail?{message:"failed"}:null});return q;
}})}));
import { getFamilyLoyaltyDirectory } from "./family-loyalty";
beforeEach(()=>{m.scope=null;m.fail=false;m.calls=[];m.rows={students:[{id:"s",name:"학생",status:"enrolled",enrolled_at:"2025-01-01",withdrawn_at:null,is_test:false,notes:null}],student_siblings:[],enrollments:[{student_id:"s",class_id:"c",on_hold:false,is_transferred:false}],classes:[{id:"c",is_makeup_pool:false,closed_at:null}]};});
it("scoped users receive neither hidden sibling identities nor counts and cause no broad query",async()=>{
  m.scope=new Set(["s"]);const d=await getFamilyLoyaltyDirectory();expect(d.fallback.state).toBe("restricted");expect(d.byStudent.size).toBe(0);expect(m.calls).toEqual([]);
});
it("every source is tenant scoped, inactive courses ignored, and contact data stays server-side",async()=>{
  const d=await getFamilyLoyaltyDirectory();expect(d.byStudent.get("s")).toMatchObject({state:"ready",activeCount:1});
  for(const table of ["students","student_siblings","enrollments","classes"])expect(m.calls).toContainEqual({table,op:"eq",args:["tenant_id","clone"]});
  expect(JSON.stringify([...d.byStudent.values()])).not.toContain("parent_phone");
  m.rows.enrollments=[{student_id:"s",class_id:"c",on_hold:true}];expect((await getFamilyLoyaltyDirectory()).byStudent.get("s")?.activeCount).toBe(0);
});
it("source failures remain unavailable rather than zero families",async()=>{
  m.fail=true;const d=await getFamilyLoyaltyDirectory();expect(d.fallback.state).toBe("unavailable");expect(d.byStudent.size).toBe(0);
});
