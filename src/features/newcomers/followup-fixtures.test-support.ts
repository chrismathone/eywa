import { testRow, testView } from "./board-fixtures.test-support";
import type { FollowupReport, FollowupView } from "./followup-model";
export const studentId = "11111111-1111-4111-8111-111111111111";
export const managerId = "22222222-2222-4222-8222-222222222222";
export const teacherId = "33333333-3333-4333-8333-333333333333";
export const reportId = "44444444-4444-4444-8444-444444444444";
export const report = (patch: Partial<FollowupReport> = {}): FollowupReport => ({
  id: reportId, student_id: studentId, subject: "math", stage: "d30", author_id: teacherId, authorName: "김담임",
  condition: "watch", summary: "과제량 조정 후 적응을 살피고 있습니다", response: "", next_action: "부모님과 과제 확인", next_due: "2026-11-01", created_at: "2026-10-30T05:00:00Z",
  review_state: "pending", review_note: "", reviewed_by: null, reviewerName: null, reviewed_at: null,
  followup_result: "", followup_at: null, followup_by: null, followupName: null, version: 1, ...patch,
});
export function fixture() {
  const subjects = ["math","english"].map(subject => testRow({studentId,rowKey: studentId+"|"+subject,subject,name:"정착테스트",enrolledOn:"2026-10-01",firstClassOn:"2026-10-02",elapsedDays:32,checks:subject==="math"?{month1_call:"2026-10-30"}:{}}));
  const legacy = {...testView(subjects),today:"2026-11-02"};
  const data: FollowupView = {today:legacy.today,actorId:managerId,canManage:true,canReport:true,checksKnown:true,error:null,staff:[{id:managerId,name:"박관리"}],
    students:[{row:{...subjects[0],elapsedDays:32},subjects,homerooms:[{id:teacherId,name:"김담임",subject:"math",upcoming:false},{id:"english-teacher",name:"이담임",subject:"english",upcoming:false}],
    managers:[{subject:"math",manager:{id:managerId,name:"박관리"},defaultManager:{id:managerId,name:"박관리"},version:1,source:"manual"},{subject:"english",manager:{id:"55555555-5555-4555-8555-555555555555",name:"정유진"},defaultManager:{id:"55555555-5555-4555-8555-555555555555",name:"정유진"},version:0,source:"default"}],reports:[report()],openPromises:1,
    evidence:{"math|month1_call":{doneBy:managerId,doneByName:"박관리",memo:"수행: 만족도 전화 / 결과: 잘 적응 중",consultationId:null}}}]};
  return {data,legacy};
}
