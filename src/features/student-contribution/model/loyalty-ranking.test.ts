import { describe, expect, it } from "vitest";
import { DEFAULT_RANKING_CONFIG as config, rankingConfigSchema } from "./ranking-config";
import { buildLoyaltyRanking, rankingValues, type RankingStudent } from "./loyalty-ranking";
import { buildRankingFacts, attendanceRankingFacts, schoolRankingFacts, type RankingGrade } from "./ranking-facts";
import { unknownFamily } from "./family-loyalty";
import type { BillingSeed } from "./billing";
import type { ContributionAttendance } from "./participation";

const today = "2026-11-09";
const bill = (month: string, subjects: string[], paid = 400000): BillingSeed => ({ id: month, studentId: "s", month, subjects, tuitionWon: paid, active: true, unknownSubjects: 0, evidenceIds: [] });
function student(id = "s"): RankingStudent {
  const facts = buildRankingFacts({ studentId:"s",asOf:today,billing:[bill("2026-09",["english","math"]),bill("2026-10",["math"],200000)],targets:[],attendance:[],grades:[],events:{ready:true,checkedAt:today,records:[]},canonical:id=>id });
  return { id,name:id,school:"학교",grade:"중1",subjects:["math"],facts,attendanceAllowed:true,schoolAllowed:true,
    family:{state:"ready",asOf:today,selfActive:true,activeCount:3,activeSiblings:2,needsReview:0,members:[{id,name:id,active:true,basis:"self"}]} };
}
const grade = (day: string, score: number, patch: Partial<RankingGrade> = {}): RankingGrade => ({id:day,student_id:"s",subject:"math",exam_slot:"midterm",exam_name:"중간고사",taken_on:day,score,max_score:100,no_exam:false,...patch});
describe("six-factor loyalty ranking",()=>{
  it("applies subject and concurrency bonuses to each eligible month and its paid amount",()=>{
    const values=rankingValues(student(),config);
    expect(values.tenure.value).toBe(2.5); expect(values.payment.value).toBe(800000);
    expect(values.family.value).toBe(6); // 3 subject-months × two siblings, self excluded.
  });
  it("uses net refunds and never adds a fixed current subject multiplier to all past payments",()=>{
    const s=student();s.facts!.billing.paid=-100;s.facts!.billing.extraSubjectPaid=0;s.facts!.billing.concurrentPaid=0;
    expect(rankingValues(s,config).payment.value).toBe(0);
    const other=structuredClone(s);other.subjects.push("english","science");expect(rankingValues(other,config).tenure.value).toBe(rankingValues(s,config).tenure.value);
  });
  it("unknown subjects withhold tenure/payment/family product instead of undercounting",()=>{
    const s=student();s.facts!.billing.unknownMonths=1;const v=rankingValues(s,config);
    expect([v.tenure.value,v.payment.value,v.family.value]).toEqual([null,null,null]);
  });
  it("restricted families cannot yield a bonus or leak a family count",()=>{const s=student();s.family=unknownFamily(today,"restricted");expect(rankingValues(s,config).family.value).toBeNull();});
  it("no active siblings is a measured zero but an unavailable family is unknown",()=>{
    const s=student();s.family.activeSiblings=0;expect(rankingValues(s,config).family.value).toBe(0);
    s.family=unknownFamily(today);expect(rankingValues(s,config).family.value).toBeNull();
  });
  it("keeps missing axes unknown and shows the possible upper bound without reweighting",()=>{
    const r=buildLoyaltyRanking([student()],config)[0]!;
    expect(r.metrics.school.points).toBeNull();expect(r.metrics.attendance.points).toBeNull();expect(r.score).toBe(85);expect(r.upper).toBe(95);expect(r.complete).toBe(false);
  });
  it("does not rank a missing snapshot from a family zero alone",()=>{const s=student();s.facts=null;s.family.activeSiblings=0;expect(buildLoyaltyRanking([s],config)[0]!.score).toBeNull();});
  it("ties share competition rank and the conservative ending percentile",()=>{
    const rows=Array.from({length:5},(_,i)=>{const s=student(String(i));s.facts!.billing.paid=i<2?600000:100000;s.facts!.billing.concurrentPaid=0;s.facts!.billing.extraSubjectPaid=0;return s;});
    const r=buildLoyaltyRanking(rows,config);expect(r[0]).toMatchObject({rank:1,top:40,band:2,tied:true});expect(r[1]).toMatchObject({rank:1,top:40,band:2});expect(r[2]!.rank).toBe(3);
  });
  it("withholds bands for small cohorts and for identical scores",()=>{expect(buildLoyaltyRanking([student()],config)[0]!.band).toBeNull();expect(buildLoyaltyRanking(Array.from({length:5},(_,i)=>student(String(i))),config).every(r=>r.band===null)).toBe(true);});
  it("a disabled axis does not create an unknown-weight penalty",()=>{const c={...config,weights:{...config.weights,school:0,attendance:0,family:35}};const r=buildLoyaltyRanking([student()],c)[0]!;expect(r.complete).toBe(true);expect(r.score).toBe(95);});
  it("validates the 100-point total and bounded bonuses",()=>{expect(rankingConfigSchema.safeParse(config).success).toBe(true);expect(rankingConfigSchema.safeParse({...config,weights:{...config.weights,family:50}}).success).toBe(false);expect(rankingConfigSchema.safeParse({...config,concurrentBonus:-1}).success).toBe(false);});
});
describe("school records",()=>{
  it("compares same subject/year/exam type on a 100-point scale",()=>{
    const v=schoolRankingFacts([grade("2026-05-01",70),grade("2026-10-01",45,{max_score:50})]);
    expect(v).toMatchObject({current:90,improvement:20,pairs:1});
  });
  it("does not compare a written exam to listening, a score over 200 days old, or a monthly academy test",()=>{
    expect(schoolRankingFacts([grade("2025-05-01",50),grade("2026-10-01",70)]).improvement).toBeNull();
    expect(schoolRankingFacts([grade("2026-05-01",50),grade("2026-10-01",70,{exam_slot:"listening",exam_name:"듣기평가"})]).improvement).toBeNull();
    expect(schoolRankingFacts([grade("2026-05-01",50,{exam_slot:"monthly",exam_name:"월말"})]).current).toBeNull();
    expect(schoolRankingFacts([grade("2026-05-01",50,{exam_slot:"school",exam_name:"내신"}),grade("2026-10-01",70,{exam_slot:"school",exam_name:"내신"})]).improvement).toBeNull();
  });
  it("compares the latest two written school exams across semesters and exam types (real 침산 shape)",()=>{
    // 1학기 기말(8/31, term 1) → 2학기 중간(9/21, term 2), 영어. 같은 연도·종류만 보던 옛 규칙은 비교하지 못했다.
    const rows=[grade("2026-08-31",80,{subject:"english",exam_slot:"final",exam_name:"기말고사",school_year:2026}),
      grade("2026-09-21",90,{subject:"english",exam_slot:"midterm",exam_name:"중간고사",school_year:2026}),
      grade("2026-09-21",40,{subject:"english",exam_slot:null,exam_name:"일일테스트"}),grade("2026-10-30",20,{subject:"english",exam_slot:"monthly",exam_name:"MonthlyTest"})];
    expect(schoolRankingFacts(rows)).toMatchObject({current:90,improvement:10,pairs:1,subjects:1});
  });
  it("does not compare across academic years (중3 기말 → 고1 중간 may be a different school)",()=>{
    expect(schoolRankingFacts([grade("2025-12-10",92,{exam_slot:"final",exam_name:"기말고사"}),grade("2026-04-28",61)]).improvement).toBeNull();
    // 1·2월 시험은 앞 학년도: 2026-02 기말과 2025-10 중간은 같은 학년도.
    expect(schoolRankingFacts([grade("2025-10-10",60),grade("2026-02-05",70,{exam_slot:"final",exam_name:"기말고사"})]).improvement).toBe(10);
    expect(schoolRankingFacts([grade("2025-10-10",60,{school_year:2025}),grade("2026-04-28",70,{school_year:2026})]).improvement).toBeNull();
  });
  it("drops a subject whose latest school exam is over a year old, for both current and improvement",()=>{
    const rows=[grade("2023-05-01",50,{subject:"science"}),grade("2023-10-01",95,{subject:"science"}),grade("2026-10-01",70)];
    expect(schoolRankingFacts(rows,today)).toMatchObject({current:70,improvement:null,subjects:1});
    expect(schoolRankingFacts([grade("2026-12-01",70)],today).current).toBeNull();
  });
  it("an explicit non-school slot wins over the exam name, and a conflicting latest day withholds the lane",()=>{
    expect(schoolRankingFacts([grade("2026-10-01",80,{exam_slot:"monthly",exam_name:"기말대비 월말평가"})]).current).toBeNull();
    expect(schoolRankingFacts([grade("2026-05-01",50),grade("2026-10-01",60),grade("2026-10-01",70,{id:"dup"})])).toMatchObject({current:null,improvement:null});
  });
  it("prefers the written exam over a later listening test for the current score",()=>{
    expect(schoolRankingFacts([grade("2026-09-21",90),grade("2026-09-25",40,{exam_slot:"listening",exam_name:"듣기평가"})]).current).toBe(90);
    expect(schoolRankingFacts([grade("2026-09-25",40,{exam_slot:"listening",exam_name:"듣기평가"})]).current).toBe(40);
  });
  it("excludes no-exam, invalid scores and conflicting duplicate scores",()=>{
    expect(schoolRankingFacts([grade("2026-05-01",101),grade("2026-06-01",20,{no_exam:true}),grade("2026-10-01",60),grade("2026-10-01",70)]).current).toBeNull();
  });
  it("supports current/improvement/mixed modes, and a decline is known zero improvement",()=>{
    const s=student();s.facts!.school={current:80,improvement:10,pairs:1,subjects:1,latest:today};
    expect(rankingValues(s,config).school.value).toBe(65);
    expect(rankingValues(s,{...config,gradeMode:"improvement"}).school.value).toBe(50);
    expect(rankingValues(s,{...config,gradeMode:"current"}).school.value).toBe(80);
    expect(rankingValues(s,{...config,gradeMode:"both"}).school.value).toBe(65);
    s.facts!.school.improvement=-10;expect(rankingValues(s,{...config,gradeMode:"improvement"}).school.value).toBe(0);
  });
});
describe("attendance and seminars",()=>{
  const target={student_id:"s",class_id:"c",session_date:"2026-11-02",slot_start:"14:00"};
  const record=(id:string,status:string,slot_start:string|null="14:00"):ContributionAttendance=>({...target,id,status,slot_start,recorded_at:"2026-11-02T10:00:00Z"});
  it("counts a late arrival as half and scores on recorded slots only, leaving unfilled slots unknown",()=>{
    const a=attendanceRankingFacts([target],[record("a","late")],today);expect(a).toMatchObject({scheduled:1,recorded:1,late:1,rate:50});
    const s=student();s.facts!.attendance=attendanceRankingFacts([target,{...target,slot_start:"15:00"}],[record("a","late")],today);
    expect(s.facts!.attendance).toMatchObject({scheduled:2,recorded:1,rate:50});
    expect(rankingValues(s,config).attendance.value).toBe(50);
  });
  it("no recorded slot at all stays unmeasured, not zero",()=>{
    const s=student();s.facts!.attendance=attendanceRankingFacts([target,{...target,session_date:"2026-10-26"}],[],today);
    expect(s.facts!.attendance).toMatchObject({scheduled:2,recorded:0,rate:null});
    expect(rankingValues(s,config).attendance.value).toBeNull();
  });
  it("applies a whole-day mark (slot_start null) to every scheduled slot of that class-day — 수학 3교시 반 실측 모양",()=>{
    // 실측: 중등M BS3D 반은 월·목 19:15/20:10/21:05 세 교시, 출결은 하루 한 번 slot_start null로 찍힌다.
    const slots=["19:15:00","20:10:00","21:05:00"], days=["2026-07-27","2026-07-30","2026-08-03"];
    const targets=days.flatMap(d=>slots.map(slot_start=>({student_id:"s",class_id:"bs3d",session_date:d,slot_start})));
    const rows=days.map((d,i)=>({id:`r${i}`,student_id:"s",class_id:"bs3d",session_date:d,slot_start:null,status:i===2?"absent":"present",recorded_at:`${d}T12:00:00Z`,seat_label:null}));
    expect(attendanceRankingFacts(targets,rows,today)).toMatchObject({scheduled:9,recorded:9,present:6,absent:3,rate:66.67});
  });
  it("prefers the exact slot mark over a whole-day mark, and uses the only mark of a single-slot day",()=>{
    const two=[target,{...target,slot_start:"15:00"}];
    expect(attendanceRankingFacts(two,[record("a","absent",null),record("b","present","15:00")],today)).toMatchObject({recorded:2,present:1,absent:1});
    expect(attendanceRankingFacts([target],[record("a","present","14:40")],today)).toMatchObject({recorded:1,present:1});
    // 두 교시인 날 다른 시각 기록 하나는 어느 교시인지 모르므로 쓰지 않는다.
    expect(attendanceRankingFacts(two,[record("a","present","16:00")],today).recorded).toBe(0);
  });
  it("does not score future/today, makeup seats or makeup status",()=>{
    expect(attendanceRankingFacts([{...target,session_date:today}],[],today).scheduled).toBe(0);
    expect(attendanceRankingFacts([target],[{...record("a","present"),seat_label:"보강"}],today).recorded).toBe(0);
    expect(attendanceRankingFacts([target],[record("a","makeup",null)],today).recorded).toBe(0);
  });
  it("does not equate seminar registration with attendance and deduplicates confirmed events",()=>{
    const common={tenantId:"t",studentId:"s",eventId:"e",eventDate:"2026-08-01",title:"설명회",sourceIds:["s"],familyKey:"f",basis:"direct" as const};
    const facts=buildRankingFacts({studentId:"s",asOf:today,billing:[],targets:[],attendance:[],grades:[],canonical:id=>id,events:{ready:true,checkedAt:today,records:[{...common,attendanceBasis:"explicit_attendance"},{...common,attendanceBasis:"explicit_attendance"},{...common,eventId:"e2",attendanceBasis:"registration_policy"}]}});
    expect(facts.seminar).toMatchObject({attended:1,registeredOnly:1,pending:true});
    const s=student();s.facts=facts;expect(rankingValues(s,config).seminar.value).toBeNull();
  });
  it("explains why seminar stays unmeasured: unconnected vs tenant-wide unreviewed rows",()=>{
    const build=(events:Parameters<typeof buildRankingFacts>[0]["events"])=>buildRankingFacts({studentId:"s",asOf:today,billing:[],targets:[],attendance:[],grades:[],canonical:id=>id,events});
    const s=student();
    s.facts=build({ready:false,checkedAt:null,records:[]});
    expect(rankingValues(s,config).seminar).toMatchObject({value:null,note:expect.stringContaining("연결되지 않았")});
    s.facts=build({ready:true,checkedAt:today,records:[],pendingRows:652});
    expect(s.facts.seminar).toMatchObject({attended:0,pending:true,unreviewedRows:652});
    expect(rankingValues(s,config).seminar).toMatchObject({value:null,note:expect.stringContaining("검토 전 명단 652행")});
    s.facts=build({ready:true,checkedAt:today,records:[]});
    expect(rankingValues(s,config).seminar.value).toBe(0);
  });
});
