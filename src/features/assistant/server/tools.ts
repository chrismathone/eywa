import "server-only";
// AI 비서 툴 레지스트리 — 학생 4 · 운영 5 · 직원 3 · 반 2 · 기록 4 + **일정 2 · 업무흐름 2**
// (2026-08-20 권한 커버리지 배선) = 22종.
// 전부 **read-only**(mutation 액션 래핑 금지)이고 사용자 세션(쿠키 createClient) 안에서 실행돼
// RLS·권한을 자동 상속한다. 새 툴 추가 시 불변 조건:
// ① 기존 features/*/server/queries.ts 함수 래핑(새 쿼리 금지) ② PII 금지 필드(주민번호·계좌·급여·
// 이력서 form_data·환불 계좌 + 직원/학부모 연락처·인사 memo) 표면 금지 ③ paged/count/RPC 변형만
// (전건 fetch 금지, B2) ④ raw enum은 서버에서 한글 라벨링(labels.ts)
// ⑤ **그 화면의 메뉴 게이트**를 requireMenu로 통과시킬 것(tool-gate.ts) — RLS는 대부분 테넌트
//    격리라 역할을 안 본다. 안 걸면 화면을 못 여는 사람이 비서로 우회 조회한다(#77).
//    가드: assistant/tool-menu-gate.test.ts가 툴마다 게이트 유무를 검사한다.

import {
  searchStudentsTool,
  studentSummaryTool,
  studentTimelineTool,
  studentLessonReportsTool,
} from "./tools-students";
import {
  attendanceDayTool,
  billingSummaryTool,
  topOutstandingTool,
  searchConsultationsTool,
  retentionRisksTool,
} from "./tools-ops";
import { searchStaffTool, staffSummaryTool, writingStatusTool } from "./tools-staff";
import { searchClassesTool, classDetailTool } from "./tools-classes";
import {
  enrollmentConsultationsTool,
  recentWithdrawalsTool,
  searchMeetingsTool,
  meetingSummaryTool,
} from "./tools-records";
import { timetableDayTool, calendarEventsTool } from "./tools-schedule";
import { reportSendStatusTool, myApprovalsTool } from "./tools-workflow";

export function assistantTools() {
  return [
    searchStudentsTool,
    studentSummaryTool,
    studentTimelineTool,
    studentLessonReportsTool,
    attendanceDayTool,
    billingSummaryTool,
    topOutstandingTool,
    searchConsultationsTool,
    retentionRisksTool,
    searchStaffTool,
    staffSummaryTool,
    writingStatusTool,
    searchClassesTool,
    classDetailTool,
    enrollmentConsultationsTool,
    recentWithdrawalsTool,
    searchMeetingsTool,
    meetingSummaryTool,
    timetableDayTool,
    calendarEventsTool,
    reportSendStatusTool,
    myApprovalsTool,
  ];
}
