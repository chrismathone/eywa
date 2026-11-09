import { it,expect,vi,beforeEach } from "vitest";
const m=vi.hoisted(()=>({context:vi.fn(),gate:vi.fn(),calls:[] as {table:string;op:string;args:unknown[]}[],rows:{} as Record<string,unknown[]>,failed:new Set<string>()}));
function db(){return {from:(table:string)=>{
  const q:Record<string,unknown>={};for(const op of ["select","eq","in","gte","lte","or","order","range"]){q[op]=(...args:unknown[])=>{m.calls.push({table,op,args});return q;};}
  q.single=async()=>({data:{id:"s",name:"학생",enrolled_at:"2025-11-01",withdrawn_at:null,school:"확인 학교",grade:"초4"},error:null});
  q.then=(resolve:(x:unknown)=>unknown)=>resolve({data:m.failed.has(table)?null:m.rows[table]??[],error:m.failed.has(table)?{message:"unavailable"}:null});return q;
}};}
vi.mock("./family-loyalty",()=>({getFamilyLoyalty:async()=>({state:"unavailable"})}));
vi.mock("./live-context",()=>({getLiveContext:m.context}));vi.mock("./access",()=>({getContributionGate:m.gate}));
vi.mock("./identity-query",()=>({getContributionReadIdentity:async()=>({ids:["s","alias"],resolve:()=>"s"})}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>db()}));
import { getFactorWorkspace,monthWindow } from "./factor-query";
beforeEach(()=>{m.calls=[];m.rows={};m.failed.clear();m.gate.mockResolvedValue({tenantId:"tenant",canWrite:true});m.context.mockResolvedValue({db:db(),tenant:"tenant",today:"2026-11-03",readable:null,attendance:true});});
it("수납 실패를 0원으로, 이력 실패를 저장 가능으로 바꾸지 않는다",async()=>{
 m.failed.add("invoices");m.failed.add("student_contribution_factor_records");const d=await getFactorWorkspace("s");
 expect(d?.observations.find(o=>o.factorId==="F01")?.state).toBe("missing");expect(d?.canWrite).toBe(false);expect(d?.storageReady).toBe(false);expect(d?.warnings).toHaveLength(2);
});
it("기존 자료는 지점·병합 ID·기준 기간으로 조회하고 출결/과제를 확인 필요로 남긴다",async()=>{
 m.rows.attendance_records=[{id:"a",student_id:"s",class_id:"c",session_date:"2026-11-01",slot_start:null,recorded_at:"2026-11-01T10:00:00Z",status:"present",homework_required:true,homework_done:true}];
 const d=await getFactorWorkspace("s");expect(d?.observations.find(o=>o.factorId==="F08")).toMatchObject({state:"partial",value:100});expect(d?.observations.find(o=>o.factorId==="F09")).toMatchObject({state:"partial",value:100});
 for(const table of ["invoices","enrollments","attendance_records","student_grades"]){expect(m.calls).toContainEqual({table,op:"eq",args:["tenant_id","tenant"]});expect(m.calls).toContainEqual({table,op:"in",args:["student_id",["s","alias"]]});}
 expect(m.calls).toContainEqual({table:"attendance_records",op:"lte",args:["session_date","2026-11-03"]});
});
it("기준 월의 6·12개월 범위는 연도 경계와 윤년을 처리한다",()=>{
 expect(monthWindow("2024-02","2026-11-03")).toEqual({asOf:"2024-02-29",six:"2023-09-01",year:"2023-03-01"});expect(()=>monthWindow("2026-12","2026-11-03")).toThrow();
});
