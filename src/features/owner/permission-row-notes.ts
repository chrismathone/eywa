/**
 * 역할·권한 표의 **줄 아래 작은 글** — 다른 역할에 열 때 알아야 할 위험·까닭. 순수(Vitest). 화면 문구라 내부 역할 이름은 쓰지 않는다(AGENTS.md).
 *
 * 🔴 **그 화면의 서버 문이 실제로 하는 일만** 적는다 — 2026-11-11까지 아래 넷은 "시안 화면 — 예시 값만"이라고 적혀 있었는데, 그날 이식으로
 *    넷 다 실제 기록을 읽고 쓰게 된 뒤에도 그 글이 남아 있었다(원장이 그 글을 믿고 다른 역할에 열면 실제 자료가 나간다).
 *    문을 바꾸면 이 글도 함께 고친다(가드 `permission-rows.test.ts` · `permission-row-notes.test.ts`가 글과 문의 조건을 맞춘다):
 *    · 경영 분석·지식그래프 = `academy-knowledge/studio-server.ts`(읽기 = 이 권한 · 고치기 = '전체') · `server-records.ts`의 `knowledgeAccess`(모든 직원의 관찰 기록 열람 = 업무 작성센터 열람 + 이 권한 '전체' — 역할 조건 없음 · 학생 기록은 원생목록 권한 범위 `readableFactStudents` 안만 · 확인·후속 조치 = 업무 작성센터 쓰기 + 이 권한 '전체')
 *      · `management/server/access.ts`(경영 분석 화면 = 원장 역할만).
 *    · 조직·OKR = `organization-okr/server.ts` · 업무 작성센터 = `work-records/server.ts`(직원 역할 여섯만 · 검토·피드백 = 원장·관리자·매니저의 '전체').
 *    · 홍보·마케팅 = `marketing-archive/server.ts`의 `archiveGate`(행사 자료를 옮겨 둔 학원 한 곳만 · 보기 = 이 권한 + 수납관리 · 저장 = 원장·관리자 역할 + 두 권한 모두 쓰기)
 *      · 마케팅 입력·검토 화면만 예시 값(`marketing/sample-access.ts`).
 */
import { DASHBOARD_ROLE_LABELS as ROLE } from "@/features/dashboard/layout/roles";
import { MENU_LABEL, STAFF_RECORD_ROLES, type MenuKey } from "@/lib/permissions";
import { pickJosa } from "@/lib/text/josa";

/** 역할 이름은 권한 표의 머리 줄과 같은 말로 적는다(`DASHBOARD_ROLE_LABELS` — 매니저 역할은 표에 '실장'으로 선다). */
const REVIEWERS = `${ROLE.master}·${ROLE.admin}·${ROLE.manager}${pickJosa(ROLE.manager, "은")}`;
const STAFF_SIX = STAFF_RECORD_ROLES.map((role) => ROLE[role]).join("·");
const NOT_STAFF = `${ROLE.viewer}·${ROLE.parttime}`;
export const ROW_NOTE: Partial<Record<MenuKey, string>> = {
  assistant: "지점 자료 전부(급여·계약·연락처·계좌 포함)를 조회해 답합니다 — 다른 역할에 열면 그 사람도 모두 묻고 볼 수 있습니다. 전체·없음만 쓰고, 강사 화면에는 비서가 없어 강사 칸은 고정입니다.",
  management: `통합 지식그래프·스키마 스튜디오가 열립니다 — 수강·목표·관찰 등 실제 기록을 읽고(학생·직원·반 이름은 ${MENU_LABEL.students}·${MENU_LABEL.staff}·${MENU_LABEL.classes} 권한 범위 안에서만), ‘전체’면 항목 정의·점검 기준을 고칩니다. ‘전체’인 사람은 ${MENU_LABEL.work_records}가 열려 있으면 그 화면의 관찰 기록도 모든 직원 것을 읽고(학생에 대한 기록은 ${MENU_LABEL.students} 권한 범위의 학생 것만), 그 화면에 쓸 수 있으면 확인·후속 조치까지 합니다 — 강사·상담에게 줘도 같습니다. 경영 분석 화면(학원 재무 자료)은 이 권한을 열어도 ${ROLE.master} 계정에서만 열립니다.`,
  okr: `직원이 자기 목표·핵심결과를 실제로 기록합니다. ‘담당’ = 본인 목표만 쓰고 봅니다(실행 중인 조직·팀 목표는 요약만). ‘전체’ = ${REVIEWERS} 모든 직원의 목표를 보고 피드백하며 조직·팀 목표를 만듭니다(그 밖의 역할은 ‘담당’과 같습니다). ${NOT_STAFF} 칸은 고정입니다 — 직원 역할(${STAFF_SIX})만 쓸 수 있는 화면입니다.`,
  marketing: `행사·홍보 기록(기획 · 채널 집행 · 참석·비용 · 원생 연결)을 실제로 읽고 저장합니다 — 행사 자료를 옮겨 둔 학원에서만 열리고, 그 밖의 학원에서는 이 칸을 열어도 화면이 열리지 않습니다. 보려면 ${MENU_LABEL.billing} 권한이 함께 있어야 하고, 저장은 ${ROLE.master}·${ROLE.admin}${pickJosa(ROLE.admin, "이")} 두 권한 모두 ‘전체’나 ‘담당’일 때만 합니다(‘읽기’면 보기만). 마케팅 입력·검토 화면만 아직 예시 값입니다.`,
  work_records: `직원이 자기 계정으로 업무 문서와 관찰 기록을 실제로 씁니다. ‘담당’ = 본인 문서만 쓰고 봅니다. ‘전체’ = ${REVIEWERS} 검토 요청된 다른 직원의 문서를 보고 확인합니다(그 밖의 역할은 ‘담당’과 같습니다). 관찰 기록은 이 권한만으로는 본인 것만 읽고 씁니다 — 모든 직원의 관찰 기록 열람과 확인·후속 조치는 ‘${MENU_LABEL.management}’ ‘전체’가 함께 있어야 합니다. ${NOT_STAFF} 칸은 고정입니다 — 직원 역할만 쓸 수 있는 화면입니다.`,
  withdrawals_churn: "퇴원관리 안 '강사별 퇴원율 추이' 표 — 강사평가가 달마다 매긴 퇴원율을 모든 강사 × 달로 보여 줍니다(강사 한 사람씩의 평가 수치). 퇴원관리 권한이 있어야 열립니다.",
  shuttle_admin: "학부모 관리 현황 · 탑승 학생 시간표 · 가까운 노선 찾기 · 실시간 위치 — 셔틀 권한이 있어야 열립니다. 학부모 계정(로그인 이메일·연락처)을 다루는 화면이라 원장·관리자 칸만 바꿀 수 있습니다. 관리자 칸을 닫아도 학부모 계정 자료 읽기는 관리자 역할 기준으로 남습니다.",
};
