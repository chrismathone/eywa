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
  it("does not compare a final to listening, another year, or a monthly academy test",()=>{
    expect(schoolRankingFacts([grade("2025-05-01",50),grade("2026-10-01",70)]).improvement).toBeNull();
    expect(schoolRankingFacts([grade("2026-05-01",50),grade("2026-10-01",70,{exam_slot:"listening",exam_name:"듣기평가"})]).improvement).toBeNull();
    expect(schoolRankingFacts([grade("2026-05-01",50,{exam_slot:"monthly",exam_name:"월말"})]).current).toBeNull();
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
  const record=(id:string,status:string,slot_start="14:00"):ContributionAttendance=>({...target,id,status,slot_start,recorded_at:"2026-11-02T10:00:00Z"});
  it("counts a late arrival as half and leaves an unfilled scheduled slot unknown",()=>{
    const a=attendanceRankingFacts([target],[record("a","late")],today);expect(a).toMatchObject({scheduled:1,recorded:1,late:1,rate:50});
    const s=student();s.facts!.attendance=attendanceRankingFacts([target,{...target,slot_start:"15:00"}],[record("a","late")],today);
    expect(rankingValues(s,config).attendance.value).toBeNull();
  });
  it("does not reuse a day-only mark across multiple slots, score future/today or makeup seats",()=>{
    expect(attendanceRankingFacts([target,{...target,slot_start:"15:00"}],[record("a","present","")],today).recorded).toBe(0);
    expect(attendanceRankingFacts([{...target,session_date:today}],[],today).scheduled).toBe(0);
    expect(attendanceRankingFacts([target],[{...record("a","present"),seat_label:"보강"}],today).recorded).toBe(0);
  });
  it("does not equate seminar registration with attendance and deduplicates confirmed events",()=>{
    const common={tenantId:"t",studentId:"s",eventId:"e",eventDate:"2026-08-01",title:"설명회",sourceIds:["s"],familyKey:"f",basis:"direct" as const};
    const facts=buildRankingFacts({studentId:"s",asOf:today,billing:[],targets:[],attendance:[],grades:[],canonical:id=>id,events:{ready:true,checkedAt:today,records:[{...common,attendanceBasis:"explicit_attendance"},{...common,attendanceBasis:"explicit_attendance"},{...common,eventId:"e2",attendanceBasis:"registration_policy"}]}});
    expect(facts.seminar).toMatchObject({attended:1,registeredOnly:1,pending:true});
    const s=student();s.facts=facts;expect(rankingValues(s,config).seminar.value).toBeNull();
  });
});
