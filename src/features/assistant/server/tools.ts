import "server-only";
// AI 비서 툴 레지스트리 — v1 시작 세트 9종. 전부 **read-only**(mutation 액션 래핑 금지)이고
// 사용자 세션(쿠키 createClient) 안에서 실행돼 RLS·권한을 자동 상속한다. 새 툴 추가 시 불변 조건:
// ① 기존 features/*/server/queries.ts 함수 래핑(새 쿼리 금지) ② PII 금지 필드(주민번호·계좌·급여·
// 이력서 form_data·환불 계좌) 표면 금지 ③ paged/count/RPC 변형만(전건 fetch 금지, B2) ④ raw enum은
// 서버에서 한글 라벨링(labels.ts).

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
  ];
}
