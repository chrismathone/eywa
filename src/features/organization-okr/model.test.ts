import { describe,it,expect } from "vitest";
import { blankGoal,documentSchema,progress,assertSave,validateGoal,attention,okrGraph,type OkrRecord } from "./model";
import { unifyGraphs } from "@/features/academy-knowledge/graph";
const actor="0f56bacd-dd58-4249-9240-a5a45cd5a69e",other="3a3d9938-126b-483f-b1c4-aa5b7659898d",today="2026-11-03";
const draft=()=>blankGoal(actor,today);
const record=():OkrRecord=>({id:crypto.randomUUID(),owner_id:actor,version:1,document:draft(),review:null,updated_at:today});
describe("OKR outcome integrity",()=>{
 it("does not invent a baseline, target or actual for a template",()=>{const d=draft();expect(documentSchema.safeParse(d).success).toBe(true);expect(progress(d.krs[0])).toBeNull();expect(d.krs[0].target).toBeNull();});
 it.each([[0,80,40,"higher",50],[10,2,6,"lower",50],[0,10,12,"higher",120]] as const)("uses directional change from baseline %s → %s",(baseline,target,actual,direction,expected)=>expect(progress({...draft().krs[0],baseline,target,actual,direction})).toBe(expected));
 it("requires measurement evidence and a date, including actual zero",()=>{const d=draft();d.krs[0].actual=0;expect(documentSchema.safeParse(d).success).toBe(false);});
 it("does not allow activating an unagreed target",()=>{const d=draft();d.state="active";expect(documentSchema.safeParse(d).success).toBe(false);});
 it("rejects target inconsistent with direction",()=>{const d=draft();d.krs[0]={...d.krs[0],baseline:80,target:70,direction:"higher"};expect(documentSchema.safeParse(d).success).toBe(false);});
 it("requires the result of a completed task",()=>{const d=draft();d.tasks=[{id:crypto.randomUUID(),krId:d.krs[0].id,title:"점검 실시",due:today,status:"done",result:""}];expect(documentSchema.safeParse(d).success).toBe(false);});
 it("rejects orphan tasks and out-of-period due dates",()=>{const d=draft();d.tasks=[{id:crypto.randomUUID(),krId:crypto.randomUUID(),title:"점검 실시",due:"2027-01-01",status:"todo",result:""}];expect(documentSchema.safeParse(d).success).toBe(false);});
 it("rejects future and outside-period measurements",()=>{const d=draft();d.krs[0]={...d.krs[0],actual:2,evidence:"확인한 원본 2건",measuredOn:"2026-11-04"};expect(()=>validateGoal(d,today)).toThrow("측정일");});
 it("requires a next plan and asks for support when blocked",()=>{const d=draft();d.checkin={...d.checkin,date:today,result:"점검 실시",confidence:"blocked"};expect(documentSchema.safeParse(d).success).toBe(false);});
 it("requires retrospective before closing",()=>{const d=draft();d.state="closed";expect(documentSchema.safeParse(d).success).toBe(false);});
 it("does not save an undated weekly narrative as an unrecorded check-in",()=>{const d=draft();d.checkin.result="실행 결과";d.checkin.next="다음 실행";expect(documentSchema.safeParse(d).success).toBe(false);});
});
describe("responsibility and graph",()=>{
 it("allows personal authoring but blocks editing another owner, even by a manager",()=>{const r=record();expect(()=>assertSave(r,r.document,actor,false)).not.toThrow();expect(()=>assertSave(r,r.document,other,true)).toThrow();});
 it("blocks owner reassignment and personal-to-shared scope changes",()=>{const r=record();expect(()=>assertSave(r,{...r.document,ownerId:other},actor,true)).toThrow();expect(()=>assertSave(r,{...r.document,scope:"organization"},actor,true)).toThrow();});
 it("allows only managers to create organization/team goals",()=>expect(()=>assertSave(null,{...draft(),scope:"organization"},actor,false)).toThrow());
 it("rejects cycles through rank and rejects child periods outside parent",()=>{const p=record();p.document={...p.document,scope:"team",state:"active",from:today,through:"2026-11-30"};const d=draft();d.parentId=p.id;expect(()=>validateGoal(d,today,p)).toThrow();d.through="2026-11-30";expect(()=>validateGoal(d,today,p)).not.toThrow();d.scope="team";d.team="수학팀";expect(()=>validateGoal(d,today,p)).toThrow();});
 it("marks overdue tasks, unmeasured KR and overdue check-ins independently",()=>{const d=draft();d.state="active";d.tasks=[{id:crypto.randomUUID(),krId:d.krs[0].id,title:"점검",due:"2026-11-02",status:"todo",result:""}];expect(attention(d,today)).toEqual(expect.arrayContaining(["과제 기한 경과","미측정 KR","주간 점검 필요"]));});
 it("connects actual source IDs and canonical staff without invalid edges",()=>{const r=record();r.document.krs[0].refs=[{kind:"work",id:crypto.randomUUID(),version:2,date:today,label:"주간 업무",href:"/work-records"}];const g=unifyGraphs("tenant",today,[{name:"organization-okr",graph:okrGraph([r],{[actor]:"담당 강사"})}]);expect(g.nodes.some(n=>n.id===`tenant:staff:${actor}`)).toBe(true);expect(g.edges.map(e=>e.relation)).toContain("EVIDENCED_BY");expect(g.issues).toEqual([]);});
});
