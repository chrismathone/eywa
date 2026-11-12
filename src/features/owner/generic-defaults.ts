// GENERIC_SETTINGS — **새로 여는 학원(일반판 프리셋)**의 출발점.
//
// 원장 2026-09-22 방향 B: *"'침산'은 그대로 두고 나머지 모든 지점, 새로 시작하는 지점 포함 … 일반화"*.
// 침산 기본값(DEFAULT_SETTINGS)에서 **첫 학원의 운영 방식에 묶인 값만** 걷어 낸다 — 셔틀 노선·학칙 동의서·
// 회당 단가표·부서 체계·수학(심화) 과목·영어 11교시 폴백·월간 계획서 문구, 그리고 침산 전용 기능(모듈)은 끈 채로.
// 나머지(성적 표시 항목·상담 양식·학년 등 어느 학원에나 맞는 값)는 침산과 같다.
//
// 🔴 지어낸 규정을 학부모에게 보내지 않는다 — 학칙·환불 안내(serviceTerms)는 **비워 둔다**(공개 접수 폼에서 그 블록이 빠진다).
//    개인정보 동의는 공개 접수 폼이 체크를 **필수로** 받으므로, 비우면 "무엇에 동의하는지 모르는 동의"가 된다 —
//    그래서 수집 항목·목적·거부권만 적은 **최소 표준 문구**를 둔다(학원이 학원설정 '알림·약관'에서 고친다).
// ⚠️ 교시 시각은 침산과 같은 틀(평일 14:30~22:00)을 **시작점**으로 둔다 — 시간표에 교시가 하나도 없으면 반을
//    배치할 칸이 없다. 대시보드 '시작하기'가 원장에게 교시부터 확인하게 한다.
import { DEFAULT_SETTINGS } from "./defaults";
import type { TenantSettings } from "./settings-types";
import { GENERIC_DISABLED_MODULES, MODULE_BASELINE_V1 } from "@/lib/modules";

const GENERIC_PRIVACY_TERMS = `1. 수집하는 개인정보 항목: 학생 성명·학교·학년·연락처, 보호자 성명·연락처
2. 수집·이용 목적: 입학 상담과 상담 결과 안내 연락
3. 동의를 거부할 권리가 있으며, 거부하시면 상담 진행이 어려울 수 있습니다.`;

export const GENERIC_SETTINGS: TenantSettings = {
  ...DEFAULT_SETTINGS,
  preset: "generic",
  profile: { ...DEFAULT_SETTINGS.profile },
  operations: {
    ...DEFAULT_SETTINGS.operations,
    // 과목 = 흔한 네 과목. 교시·강사뷰·월간 계획서 같은 과목별 부가 설정은 **비운다**(학원이 과목 운영에서 채운다).
    subjects: [
      { key: "math", label: "수학", color: "blue", weekdayGrouping: "mon-thu", testMax: 5 },
      { key: "english", label: "영어", color: "rose", weekdayGrouping: "mon-thu", testMax: 5 },
      { key: "korean", label: "국어", color: "gold", weekdayGrouping: "mon-thu", testMax: 5 },
      { key: "science", label: "과학", color: "purple", weekdayGrouping: "mon-thu", testMax: 5 },
    ],
    // 부서 체계는 학원마다 다르다 — 비워 두면 직급 목록(jobTitles)만 쓴다.
    jobTitlesByDepartment: {},
    shuttle: { enabled: false, fee: "", routes: [] },
    // 교시마다 한 줄 — 침산의 두 교시 묶음(1-1·1-2)·영어 내장 11교시는 침산 운영 방식이다.
    periodStyle: "plain",
    // 학교명 저장 별칭 없음 — 침산의 `일중 → 대구일중`은 대구 학교 이름이다.
    schoolSaveAliases: [],
  },
  billing: {
    ...DEFAULT_SETTINGS.billing,
    account: { ...DEFAULT_SETTINGS.billing.account },
    accounts: [],
    // 회당 단가표는 학원 요금이다 — 비운다(수강료 계산기·회차 단가 선택지가 빈 채로 시작).
    sessionPrices: [],
  },
  notifications: {
    ...DEFAULT_SETTINGS.notifications,
    privacyTerms: GENERIC_PRIVACY_TERMS,
    serviceTerms: "",
  },
  consultations: { templates: DEFAULT_SETTINGS.consultations.templates.map((t) => ({ ...t })), briefFacts: { ...DEFAULT_SETTINGS.consultations.briefFacts } },
  report: { ...DEFAULT_SETTINGS.report },
  permissions: { overrides: [], userOverrides: [], specialAccess: { payslipViewerIds: [], payslipManagerIds: [], leaveAdjusterIds: [], classSplitterIds: [], enrollmentDateEditorIds: [], studentStatusManagerIds: [], staffTaskMonitorIds: [], vendorViewerIds: [], jjReportManagerIds: [], beforeClassReportIds: [], withdrawalApproverIds: [], withdrawalDeskIds: [], staffSubjectScopes: [] } },
  navigation: { menus: [], teacherMenus: [], groups: [], teacherGroups: [] },
  modules: { disabled: [...GENERIC_DISABLED_MODULES], known: [...MODULE_BASELINE_V1] },
  dashboard: { version: 1, layouts: [], assignments: [] },
};
