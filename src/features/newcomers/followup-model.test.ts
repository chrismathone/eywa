import {describe,it,expect} from "vitest";
import {callSummary,followupOpen,needsReview,reportSchema,reviewSchema,resolveSubjectManager,hasUnassignedSubject,subjectStudent} from "./followup-model";
import {fixture,report,studentId,reportId} from "./followup-fixtures.test-support";
describe("학생 단위 점검은 근거를 합쳐 판정한다",()=>{
  it("한 과목 완료를 전체 완료로 보이지 않는다",()=>{const s=fixture().data.students[0];const r=callSummary(s,"month1_call","2026-11-02");expect(r.state).toBe("overdue");expect(r.label).toBe("1/2과목 완료");expect(r.actors).toEqual(["박관리"]);});
  it("모든 과목이 완료되었을 때만 완료",()=>{const s=fixture().data.students[0];s.subjects[1].checks.month1_call="2026-11-01";expect(callSummary(s,"month1_call","2026-11-02").state).toBe("done");});
  it("선택 60일콜·조회 실패·빈 과목을 구분",()=>{const s=fixture().data.students[0];expect(callSummary(s,"month2_call","2027-01-01").state).toBe("optional");expect(callSummary(s,"month1_call","2026-11-02",false).label).toBe("확인 필요");s.subjects=[];expect(callSummary(s,"month1_call","2026-11-02").state).toBe("unknown");});
  it("관리자 확인만으로 후속 업무가 사라지지 않는다",()=>{const r=report({review_state:"confirmed"});expect(needsReview(r)).toBe(false);expect(followupOpen(r)).toBe(true);r.followup_at="2026-11-02T00:00:00Z";expect(followupOpen(r)).toBe(false);});
  it("후속 조치와 기한은 함께 필수, 잘못된 날짜와 추가 필드 거부",()=>{const v={id:reportId,studentId,subject:"math",stage:"d30",condition:"good",summary:"적응 확인했습니다",nextAction:"과제 확인",nextDue:null};expect(reportSchema.safeParse(v).success).toBe(false);expect(reportSchema.safeParse({...v,nextDue:"2026-02-30"}).success).toBe(false);expect(reportSchema.safeParse({...v,nextDue:"2026-11-05"}).success).toBe(true);expect(reportSchema.safeParse({...v,nextDue:"2026-11-05",author_id:studentId}).success).toBe(false);});
  it("빈 완료 결과와 유효하지 않은 버전 거부",()=>{expect(reviewSchema.safeParse({id:reportId,studentId,version:0,operation:"resolve",note:"완료"}).success).toBe(false);expect(reviewSchema.safeParse({id:reportId,studentId,version:1,operation:"resolve",note:" "}).success).toBe(false);});
});
describe("과목별 기본 담당자",()=>{
 const people=[{id:"math-manager",name:"허은진"},{id:"english-manager",name:"정유진"}];
 const defaults=[{subject:"math",manager_id:"math-manager"},{subject:"english",manager_id:"english-manager"},{subject:"eie",manager_id:"english-manager"}];
 it("동시 수강은 같은 학생 아래 두 담당자, 영어와 EiE는 동일 담당",()=>{expect(["math","english","eie"].map(s=>resolveSubjectManager(s,undefined,defaults,people).manager?.name)).toEqual(["허은진","정유진","정유진"]);expect(resolveSubjectManager("science",undefined,defaults,people).manager).toBeNull();});
 it("수동 미지정은 기본 배정을 덮고 기본 복귀는 기존 배정을 해제",()=>{const a={student_id:studentId,subject:"math",manager_id:null,mode:"manual" as const,version:2};expect(resolveSubjectManager("math",a,defaults,people).manager).toBeNull();expect(resolveSubjectManager("math",{...a,mode:"default"},defaults,people,{manager_id:"english-manager"}).manager?.name).toBe("허은진");expect(resolveSubjectManager("math",undefined,defaults,people,{manager_id:"english-manager"}).source).toBe("legacy");});
 it("비활성 담당자나 한 과목 미지정을 완전 배정으로 보지 않음",()=>{expect(resolveSubjectManager("math",undefined,defaults,[]).manager).toBeNull();const s=fixture().data.students[0];s.managers[1].manager=null;expect(hasUnassignedSubject(s)).toBe(true);expect(callSummary(subjectStudent(s,"math"),"month1_call","2026-11-02").state).toBe("done");expect(callSummary(subjectStudent(s,"english"),"month1_call","2026-11-02").state).toBe("overdue");});
});
