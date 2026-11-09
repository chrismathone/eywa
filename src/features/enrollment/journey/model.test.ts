import {describe,it,expect} from "vitest";
import {journeyDocumentSchema,saveJourneySchema,validateJourneyDates,summarizeJourney,journeyPersonGroups,inquiryDay,type JourneyConsultation,type JourneyRecord,type JourneyDocument} from "./model";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const row=(n=1,patch:Partial<JourneyConsultation>={}):JourneyConsultation=>({id:id(n),prospect_name:"가상 학생",consulted_at:"2026-01-05T05:00:00Z",received_date:null,consultation_date:null,consultation_path:null,outcome:"enrolled",counselor:null,consultant_id:null,legacy_source:null,...patch});
const doc=(patch:Partial<JourneyDocument>={}):JourneyDocument=>({kind:"visit",status:"completed",purpose:"new",scheduledOn:null,happenedOn:"2026-01-06",ownerId:id(9),evidence:"방문하여 학생면담 실시",sourceUrl:"",nextAction:"",nextDue:null,nextDoneOn:null,...patch});
const record=(n:number,d:Partial<JourneyDocument>={},patch:Partial<JourneyRecord>={}):JourneyRecord=>({id:id(n+100),consultation_id:id(1),version:1,document:doc(d),voided:false,updated_at:"2026-01-10T00:00:00Z",actor_id:id(9),...patch});
const stats=(r:JourneyRecord[],c=[row()])=>summarizeJourney(c,r,"2026-01-01","2026-11-03");
describe("실제 방문과 등록의 확인 기준",()=>{
  it("예약·노쇼·전화·기존재원·미확인 대상은 실제 방문에 포함하지 않는다",()=>{
    const r=stats([record(1,{status:"scheduled",scheduledOn:"2026-01-06",happenedOn:null}),record(2,{status:"no_show",scheduledOn:"2026-01-06"}),record(3,{kind:"call",status:"connected"}),record(4,{purpose:"existing"}),record(5,{purpose:"unknown"})]);
    expect(r.visits).toBe(0);expect(r.conversion).toBeNull();expect(r.pendingVisits).toBe(1);expect(r.noShows).toBe(1);
  });
  it("기존 등록상태·상담일만으로 방문·실제 등록일을 추정하지 않는다",()=>{const r=stats([],[row(1,{consultation_date:"2026-01-06"})]);expect(r.visits).toBe(0);expect(r.issues[0].reasons).toContain("등록 확정일 미확인");});
  it("같은 학생 재방문을 월별과 기간 전체에서 각각 중복 제거한다",()=>{const r=stats([record(1),record(2,{happenedOn:"2026-01-20"}),record(3,{happenedOn:"2026-02-01"})]);expect(r.visits).toBe(3);expect(r.people).toBe(1);expect(r.monthly.slice(0,2).map(m=>m.people)).toEqual([1,1]);});
  it("형제·동명이인·마스킹 연락처는 자동 합치지 않는다",()=>{const r=[row(1,{parent_phone:"010-1234-5678"}),row(2,{prospect_name:"다른 형제",parent_phone:"010-1234-5678"}),row(3,{parent_phone:"010-****-5678"}),row(4,{parent_phone:"010-****-5678"})];expect(new Set(journeyPersonGroups(r).values()).size).toBe(4);});
  it("같은 학생 ID는 상담 건이 달라도 등록 근거에 연결한다",()=>{const c=[row(1,{student_id:id(50)}),row(2,{student_id:id(50)})];const r=stats([record(1),record(2,{kind:"registration",status:"confirmed",happenedOn:"2026-02-01"},{consultation_id:id(2)})],c);expect(r.conversion).toBe(100);});
  it("방문 전 등록과 기준일 이후 등록은 전환에 포함하지 않는다",()=>{const r=stats([record(1),record(2,{kind:"registration",status:"confirmed",happenedOn:"2026-01-01"}),record(3,{kind:"registration",status:"confirmed",happenedOn:"2026-12-01"})]);expect(r.registered).toBe(0);});
  it("등록 취소는 등록 근거만 해제하고 실제 방문은 보존한다",()=>{const r=stats([record(1),record(2,{kind:"registration",status:"confirmed",happenedOn:"2026-01-07"}),record(3,{kind:"registration",status:"cancelled",happenedOn:"2026-01-09"})]);expect(r.registered).toBe(0);expect(r.visits).toBe(1);});
  it("제외된 오입력과 완료된 후속 업무는 실적·미완료에 남지 않는다",()=>{const r=stats([record(1,{}, {voided:true}),record(2,{nextAction:"전화",nextDue:"2026-01-10",nextDoneOn:"2026-01-10"})]);expect(r.visits).toBe(1);expect(r.overdue).toBe(0);});
  it("KST 경계를 정확히 처리한다",()=>expect(inquiryDay(row(1,{consulted_at:"2026-01-31T16:00:00Z"}))).toBe("2026-02-01"));
});
describe("입력 검증",()=>{
  it.each([{happenedOn:null},{kind:"call",status:"completed"},{evidence:""},{nextAction:"연락",nextDue:null},{sourceUrl:"javascript:alert(1)"},{happenedOn:"2026-02-30"}])("잘못된 결과·누락·날짜를 거부한다: %j",patch=>expect(journeyDocumentSchema.safeParse(doc(patch as Partial<JourneyDocument>)).success).toBe(false));
  it("예약은 실제 처리일을 미리 기록하지 않는다",()=>expect(journeyDocumentSchema.safeParse(doc({status:"scheduled",scheduledOn:"2026-12-01"})).success).toBe(false));
  it("미래 실적과 예약 전 노쇼 확정을 거부한다",()=>{expect(validateJourneyDates(doc({happenedOn:"2026-12-01"}),"2026-11-03")).toContain("미래");expect(validateJourneyDates(doc({status:"no_show",scheduledOn:"2026-02-01"}),"2026-11-03")).toContain("예정일");});
  it("수정은 사유와 버전이 필요하고 호출자 임의 지점은 받지 않는다",()=>{const v={id:id(1),consultationId:id(2),expectedVersion:1,reason:"",document:doc()};expect(saveJourneySchema.safeParse(v).success).toBe(false);expect(saveJourneySchema.safeParse({...v,reason:"날짜 오기 수정",tenantId:id(3)}).success).toBe(false);});
});
