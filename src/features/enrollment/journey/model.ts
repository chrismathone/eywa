import { z } from "zod";
import { samePersonGroups, phoneKeyOf, type PersonRow } from "../same-person";
import { kstDateOf } from "@/lib/date-kst";

export const kinds = { call: "전화·온라인 상담", visit: "방문 예약·결과", registration: "등록 확정" } as const;
export const statuses = { connected: "상담 완료", unanswered: "연결 안 됨", scheduled: "방문 예약", completed: "실제 방문 완료", no_show: "노쇼 확인", cancelled: "취소 확인", confirmed: "등록 확정" } as const;
export const purposes = { new: "신규 입학", returning: "재입학", existing: "기존 재원 상담", unknown: "대상 확인 필요" } as const;
export const allowedStatuses = { call: ["connected", "unanswered"], visit: ["scheduled", "completed", "no_show", "cancelled"], registration: ["confirmed", "cancelled"] } as const;
const day = z.iso.date().nullable();
export const journeyDocumentSchema = z.object({
  kind: z.enum(["call", "visit", "registration"]),
  status: z.enum(["connected", "unanswered", "scheduled", "completed", "no_show", "cancelled", "confirmed"]),
  purpose: z.enum(["new", "returning", "existing", "unknown"]),
  scheduledOn: day, happenedOn: day,
  ownerId: z.uuid(), evidence: z.string().trim().min(2, "결과와 확인 근거를 적어 주세요").max(3000),
  sourceUrl: z.union([z.literal(""), z.url().refine(v => /^https?:\/\//.test(v), "웹 주소를 확인해 주세요")]),
  nextAction: z.string().trim().max(1000), nextDue: day, nextDoneOn: day,
}).superRefine((d, ctx) => {
  const fail = (message: string) => ctx.addIssue({code:"custom",message});
  if (!(allowedStatuses[d.kind] as readonly string[]).includes(d.status)) fail("기록 종류와 결과가 맞지 않습니다");
  if (d.kind === "visit" && ["scheduled", "no_show", "cancelled"].includes(d.status) && !d.scheduledOn) fail("방문 예정일을 입력해 주세요");
  if (d.status === "scheduled" && d.happenedOn) fail("예약 단계에는 실제 처리일을 넣지 않습니다");
  if (d.status !== "scheduled" && !d.happenedOn) fail("실제 통화·방문·확인일을 입력해 주세요");
  if (d.nextAction && !d.nextDue) fail("다음 할 일의 기한을 입력해 주세요");
  if (d.nextDue && !d.nextAction) fail("다음 할 일을 입력해 주세요");
  if (d.nextDoneOn && !d.nextAction) fail("완료할 후속 업무가 없습니다");
});
export type JourneyDocument = z.infer<typeof journeyDocumentSchema>;
export const saveJourneySchema = z.strictObject({id:z.uuid(),consultationId:z.uuid(),expectedVersion:z.number().int().min(0),voided:z.boolean().default(false),reason:z.string().trim().max(1000),document:journeyDocumentSchema}).superRefine((v,ctx)=>{if(v.expectedVersion>0&&!v.reason)ctx.addIssue({code:"custom",message:"수정·제외 사유를 적어 주세요"});if(v.expectedVersion===0&&v.voided)ctx.addIssue({code:"custom",message:"새 기록은 집계 제외로 저장할 수 없습니다"});});
export type JourneyRecord = { id:string; consultation_id:string; version:number; document:JourneyDocument; voided:boolean; updated_at:string; actor_id:string };
export type JourneyConsultation = PersonRow & { prospect_name:string; consulted_at:string; received_date:string|null; consultation_date:string|null; consultation_path:string|null; outcome:string; counselor:string|null; consultant_id:string|null; legacy_source:string|null };
export function validateJourneyDates(d: JourneyDocument, today: string) {
  if ((d.happenedOn && d.happenedOn > today) || (d.nextDoneOn && d.nextDoneOn > today)) return "미래의 실적은 기록할 수 없습니다";
  if (d.status === "no_show" && d.scheduledOn && d.happenedOn && d.happenedOn < d.scheduledOn) return "방문 예정일 전에는 노쇼를 확정할 수 없습니다";
  return null;
}
export const eventDay = (r:JourneyRecord) => r.document.happenedOn ?? r.document.scheduledOn ?? "";
export const inquiryDay = (r:JourneyConsultation) => r.received_date ?? kstDateOf(r.consulted_at) ?? "";
export const isIntake = (d:JourneyDocument) => d.purpose === "new" || d.purpose === "returning";

/** Only stable student IDs or name + full mobile number group cases. Masked phones/names alone never merge. */
export function journeyPersonGroups(rows:JourneyConsultation[]) {
  return samePersonGroups(rows.map(r=>({id:r.id,student_id:r.student_id,prospect_name:r.prospect_name,parent_phone:r.parent_phone})));
}
export function summarizeJourney(rows:JourneyConsultation[], records:JourneyRecord[], from:string, through:string) {
  const groups=journeyPersonGroups(rows), byId=new Map(rows.map(r=>[r.id,r]));
  const valid=records.filter(r=>!r.voided&&byId.has(r.consultation_id));
  // 상담별 기록 묶음 — 달·상담마다 전체 기록을 다시 훑지 않는다(상담 수 × 기록 수로 커지지 않게).
  const byConsult=new Map<string,JourneyRecord[]>();
  for(const r of valid){const l=byConsult.get(r.consultation_id);if(l)l.push(r);else byConsult.set(r.consultation_id,[r]);}
  const hasVisit=(id:string)=>!!byConsult.get(id)?.some(e=>e.document.kind==="visit");
  const selected=valid.filter(r=>isIntake(r.document)&&eventDay(r)>=from&&eventDay(r)<=through);
  const visits=selected.filter(r=>r.document.kind==="visit"&&r.document.status==="completed");
  const person=(r:JourneyRecord)=>groups.get(r.consultation_id)!;
  const visitPeople=new Set(visits.map(person));
  // A dated confirmation on/after the person's first visit, up to the reporting cut-off. No payment-date substitution.
  const registered=new Set<string>();
  const decisions=new Map<string,JourneyRecord>();
  for(const r of valid.filter(r=>isIntake(r.document)&&r.document.kind==="registration"&&eventDay(r)<=through).sort((a,b)=>eventDay(a).localeCompare(eventDay(b))||a.updated_at.localeCompare(b.updated_at)))decisions.set(person(r),r);
  for(const r of decisions.values()) {
    if(r.document.status==="confirmed"&&visits.some(v=>person(v)===person(r)&&eventDay(v)<=eventDay(r)))registered.add(person(r));
  }
  const monthly=[];
  for(let y=Number(from.slice(0,4)),m=Number(from.slice(5,7));`${y}-${String(m).padStart(2,"0")}`<=through.slice(0,7);) {
    const key=`${y}-${String(m).padStart(2,"0")}`, vm=visits.filter(r=>eventDay(r).startsWith(key));
    const related=rows.filter(r=>inquiryDay(r).startsWith(key));
    monthly.push({month:key,visits:vm.length,people:new Set(vm.map(person)).size,unverified:related.filter(r=>!hasVisit(r.id)).length});
    m++;if(m>12){m=1;y++;}
  }
  const dated=rows.filter(r=>{const day=inquiryDay(r);return day>=from&&day<=through;});
  const issues=dated.map(r=>{
    const events=byConsult.get(r.id)??[], reasons:string[]=[];
    if(!events.some(e=>e.document.kind==="visit"))reasons.push("방문 여부 미확인");
    if(r.outcome==="enrolled"&&!events.some(e=>e.document.kind==="registration"&&e.document.status==="confirmed"))reasons.push("등록 확정일 미확인");
    if(!r.student_id&&!phoneKeyOf(r.parent_phone))reasons.push("학생 식별정보 부족");
    if(!r.consultation_path)reasons.push("유입경로 미기재");
    if(!r.consultant_id&&!r.counselor)reasons.push("상담 담당자 미기재");
    return {id:r.id,name:r.prospect_name,school:r.prospect_school??"",grade:r.prospect_grade??"",date:inquiryDay(r),reasons};
  }).filter(r=>r.reasons.length);
  return {visits:visits.length,people:visitPeople.size,registered:registered.size,conversion:visitPeople.size?Math.round(registered.size/visitPeople.size*1000)/10:null,
    noShows:selected.filter(r=>r.document.kind==="visit"&&r.document.status==="no_show").length,
    calls:selected.filter(r=>r.document.kind==="call").length,
    connected:selected.filter(r=>r.document.kind==="call"&&r.document.status==="connected").length,
    unknownIdentity:visits.filter(r=>{const c=byId.get(r.consultation_id)!;return !c.student_id&&!phoneKeyOf(c.parent_phone);}).length,
    overdue:valid.filter(r=>r.document.nextDue&&r.document.nextDue<through&&!r.document.nextDoneOn).length,
    pendingVisits:valid.filter(r=>r.document.kind==="visit"&&r.document.status==="scheduled"&&r.document.scheduledOn!<through).length,
    monthly,issues,selected};
}
