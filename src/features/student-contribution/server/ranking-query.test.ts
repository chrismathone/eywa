import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({scope:null as Set<string>|null,allowed:true,attendance:true,exams:true,fail:false,calls:[] as {op:string;args:unknown[]}[],stored:[] as unknown[]}));
vi.mock("./directory",()=>({getContributionDirectory:async()=>m.allowed?{gate:{tenantId:"tenant",canWrite:true,canConfigure:true},rows:[{id:"own",name:"내 학생",status:"enrolled",subjects:[],school:null,grade:null},{id:"outside",name:"다른 학생",status:"enrolled",subjects:[],school:null,grade:null},{id:"left",name:"퇴원생",status:"withdrawn",subjects:[],school:null,grade:null}],subjects:[]}:null,getContributionSnapshot:async()=>({config:{},refreshedAt:"2026-11-08T15:40:00Z"})}));
vi.mock("./family-loyalty",()=>({getFamilyLoyaltyDirectory:async()=>({byStudent:new Map(),fallback:{state:"restricted",asOf:"2026-11-09",members:[],activeCount:null,activeSiblings:null,selfActive:false,needsReview:0}})}));
vi.mock("./fact-access",()=>({readableFactStudents:async()=>m.scope}));
vi.mock("@/lib/auth/current-user",()=>({getCurrentUser:async()=>({systemRole:"teacher"})}));
vi.mock("@/lib/auth/perm-matrix",()=>({canAccessTenant:async(_role:string,key:string)=>key==="attendance"?m.attendance:m.exams}));
vi.mock("@/lib/date-kst",()=>({kstToday:()=>"2026-11-09"}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({from:(table:string)=>{
  m.calls.push({op:"from",args:[table]});const q:Record<string,unknown>={};for(const op of ["select","eq","in","order","range","returns"])q[op]=(...args:unknown[])=>{m.calls.push({op,args});return q;};
  q.then=(resolve:(value:unknown)=>unknown)=>resolve({data:m.stored,error:m.fail?{message:"offline"}:null});return q;
}})}));
import { getLoyaltyRanking } from "./ranking-query";
import { buildRankingFacts } from "../model/ranking-facts";
beforeEach(()=>{m.scope=null;m.allowed=true;m.attendance=true;m.exams=true;m.fail=false;m.calls=[];m.stored=[];});
it("denied access performs no ranking fact query",async()=>{m.allowed=false;expect(await getLoyaltyRanking()).toBeNull();expect(m.calls).toEqual([]);});
it("restricts read IDs and the response cohort before ranking; excludes withdrawn students",async()=>{
  m.scope=new Set(["own"]);const data=await getLoyaltyRanking();expect(data!.rows.map(r=>r.id)).toEqual(["own"]);
  expect(m.calls).toContainEqual({op:"eq",args:["tenant_id","tenant"]});expect(m.calls).toContainEqual({op:"in",args:["student_id",["own"]]});
  expect(JSON.stringify(data)).not.toContain("다른 학생");expect(data!.rows[0]!.family.activeCount).toBeNull();
});
it("strips restricted raw attendance and school fields, not merely their point values",async()=>{
  const facts=buildRankingFacts({studentId:"own",asOf:"2026-11-09",billing:[],attendance:[],targets:[],grades:[],canonical:id=>id,events:{ready:false,checkedAt:null,records:[]}});
  facts.school.current=99;facts.attendance.present=123;facts.attendance.rate=98;m.stored=[{student_id:"own",facts}];m.attendance=false;m.exams=false;
  const row=(await getLoyaltyRanking())!.rows.find(r=>r.id==="own")!;
  expect(row.facts!.school.current).toBeNull();expect(row.facts!.attendance.present).toBe(0);expect(row.metrics.school.value).toBeNull();expect(row.metrics.attendance.value).toBeNull();
});
it("read failures surface instead of turning all records into zero",async()=>{m.fail=true;await expect(getLoyaltyRanking()).rejects.toThrow("offline");});
