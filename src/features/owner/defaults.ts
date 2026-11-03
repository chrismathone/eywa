// DEFAULT_SETTINGS — **침산 프리셋**의 기본값 = 첫 학원(인재원 침산)이 쓰던 코드 하드코딩 값들.
// 침산처럼 설정 행이 이미 있는 학원은 비어 있는 키를 이 값으로 채워 "오늘과 동일한 동작"을 보장한다(resolve.ts).
// 🔴 새 학원은 이 값을 받지 않는다 — 설정 행에 `preset: "generic"`이 있으면 GENERIC_SETTINGS(generic-defaults.ts)가
//    바탕이다(원장 2026-09-22 방향 B: 침산은 그대로, 새 지점만 일반화). 그러니 여기 값을 "중립"으로 바꾸지 말 것 —
//    침산이 이 값에 기대는 칸(회당 단가·EiE 월 수강료·영어 교시 폴백 등)이 조용히 바뀐다.
// profile.name은 여기서 비우고 resolver가 tenants.name으로 채운다(테넌트별 실제 학원명).
import { ENGLISH_WEEKDAY_PERIOD_LIST } from "@/features/timetable/lib/periods";
import { DEFAULT_TEACHER_VIEW_LINES } from "@/features/timetable/lib/ten-minute-grid";
import { DEFAULT_MONTH_PLAN_TEXTS } from "./month-plan-texts";
import type { TenantSettings } from "./settings-types";
import { DEFAULT_MAKEUP_SETTINGS } from "@/features/makeups/config";
import { DEFAULT_EIE_MONTHLY_PRICE, DEFAULT_SESSION_PRICES } from "@/features/billing/session-pricing";
import { CHINSAN_SCHOOL_SAVE_ALIASES } from "@/features/schools/school-name";

// 평일 표준 교시(8교시·55분) — periods.ts MATH_PERIODS 이식.
const WEEKDAY_PERIODS = [
  { label: "1교시", startTime: "14:30", endTime: "15:25" },
  { label: "2교시", startTime: "15:25", endTime: "16:20" },
  { label: "3교시", startTime: "16:20", endTime: "17:15" },
  { label: "4교시", startTime: "17:15", endTime: "18:10" },
  { label: "5교시", startTime: "18:20", endTime: "19:15" },
  { label: "6교시", startTime: "19:15", endTime: "20:10" },
  { label: "7교시", startTime: "20:10", endTime: "21:05" },
  { label: "8교시", startTime: "21:05", endTime: "22:00" },
];

// 주말 교시(09:00부터 1시간 단위 8교시) — periods.ts WEEKEND_PERIODS 이식.
const WEEKEND_PERIODS = [
  { label: "1교시", startTime: "09:00", endTime: "10:00" },
  { label: "2교시", startTime: "10:00", endTime: "11:00" },
  { label: "3교시", startTime: "11:00", endTime: "12:00" },
  { label: "4교시", startTime: "12:00", endTime: "13:00" },
  { label: "5교시", startTime: "13:00", endTime: "14:00" },
  { label: "6교시", startTime: "14:00", endTime: "15:00" },
  { label: "7교시", startTime: "15:00", endTime: "16:00" },
  { label: "8교시", startTime: "16:00", endTime: "17:00" },
];

// 셔틀버스 기본값 — 공개 접수 폼에 노출. 학원이 학원설정에서 노선·요금·노출여부를 편집.
const DEFAULT_SHUTTLE = {
  enabled: true,
  fee: "월 20,000원",
  routes: [
    { label: "1호차 주요 노선", stops: ["서대구 센트럴자이", "고성동 오페라 아파트", "대구역 앞 북편네거리", "옥산초·경명여중 입구"] },
    { label: "2호차 주요 노선", stops: ["침산 푸르지오 1차", "달성초 앞", "달성파크 푸르지오 힐스테이트", "대구역 센트럴자이", "서희스타힐스 앞"] },
  ],
};

// 공개 접수/약관 기본 문구 — 학원이 학원설정(알림·약관)에서 편집. 공개 접수 폼이 소비.
const DEFAULT_PRIVACY_TERMS = `1. 수집하는 개인정보의 항목 : 성명, 학년, 학교, 학생 연락처, 학부모 연락처, 제출한 과제의 동영상 및 음원

2. 원생들의 동기부여를 위해 원내 게시물, 가정통신문, 블로그 등 SNS에 학습성과를 홍보할 때 이용합니다.

3. 단, 온라인이나 배포용 홍보물에는 전체 이름을 노출하지 않고 '*'기호 등을 사용해서 개인정보 유출을 막습니다.

4. 동의를 거부할 권리 : 귀하는 위와 같이 개인정보를 수집·이용하는 데 대한 동의를 거부할 권리가 있습니다. 다만, 동의하지 않으실 경우 상담 제공 및 셔틀버스 운영 등 일부 서비스에 제한이 있을 수 있습니다.`;

const DEFAULT_SERVICE_TERMS = `[수강 등록 및 환불 안내]
1. 매월 25일~28일까지 수강료 납부기간이며, 25일에 등록안내 및 학사일정이 모바일로 발송됩니다.
2. 수강료는 선불이며, 매월 1일부터 말일까지 수업횟수 기준으로 산정됩니다.
3. 원활한 학습관리를 위해 월 12회, 월 8회 수업이 최소 단위입니다. (단, 특강반·단과반 제외)

[환불 규정 (공정거래위원회 표준약관 기준)]
교습 시작 전 → 전액 환불
총 수업의 1/3 경과 전 → 2/3 환불
총 수업의 1/2 경과 전 → 1/2 환불
총 수업의 1/2 경과 후 → 환불 불가

[보강 및 퇴원 규정]
1. 규칙적인 학습을 위해 지각·결석에 대한 별도 보강이 없습니다. (단, 건강상의 문제나 증명 가능한 공식 사유는 1회 이내 예외 인정)
2. 규정·예의를 지키지 않거나 수업 분위기를 해칠 경우 경고를 받으며, 2회 경고 시 퇴원 조치됩니다.`;

// 학생상담 기본 양식(템플릿) — 상담 등록 시 요약 뼈대·기본 범주/대상을 프리필. 원장이 학원설정에서 편집.
// '학생 상담일지'가 기본양식(isDefault) — 새 상담 폼이 자동으로 이 뼈대를 채운다. 원장이 다른 양식/무양식으로 바꿀 수 있음.
const DEFAULT_CONSULTATION_TEMPLATES = [
  {
    key: "general",
    name: "학생 상담일지",
    body: "{{날짜}} · 담당 {{담당}}\n\n■ 상담 내용:\n\n■ 조치 사항:\n\n■ 건의 사항:\n\n■ 비고:",
    category: "general" as const,
    audience: "parent" as const,
    isDefault: true,
  },
  {
    key: "new_before",
    name: "신입생 관리 #1 – 첫수업 전 전화",
    body: "[첫수업 전 안내 전화] {{날짜}} · 담당 {{담당}}\n■ 대상: {{학생}} {{학년}}\n■ 첫 수업 일정·준비물 안내:\n■ 학부모 문의·요청 사항:\n■ 특이사항:",
    category: "general" as const,
    audience: "parent" as const,
    isDefault: false,
  },
  {
    key: "new_after",
    name: "신입생 관리 #2 – 첫수업 후 전화",
    body: "[첫수업 후 점검 전화] {{날짜}} · 담당 {{담당}}\n■ 대상: {{학생}} {{학년}}\n■ 첫 수업 반응·소감:\n■ 수업 이해도·태도:\n■ 학부모 피드백:\n■ 조치 사항:",
    category: "general" as const,
    audience: "parent" as const,
    isDefault: false,
  },
  {
    key: "new_week",
    name: "신입생 관리 #3 – 일주일 적응 점검 전화",
    body: "[일주일 적응 점검 전화] {{날짜}} · 담당 {{담당}}\n■ 대상: {{학생}} {{학년}}\n■ 적응 상태(친구·수업·과제):\n■ 학습 습관·숙제 수행:\n■ 학부모 관찰 사항:\n■ 후속 계획:",
    category: "general" as const,
    audience: "parent" as const,
    isDefault: false,
  },
];

/**
 * 학원 이름을 **끝내 못 읽었을 때** 서류·학부모 화면에 적는 중립 표기.
 * `profile.name`은 비어 있으면 `tenants.name`으로 채워지므로(resolve.ts) 여기까지 오는 것은 두 조회가 모두 실패한 경우뿐이다.
 * 🔴 특정 학원 이름을 폴백으로 박지 말 것 — 지점이 둘 이상이면 다른 지점의 학부모 화면(`/r`)·인쇄물에 남의 학원 이름이 찍힌다
 *    (종전 폴백이 "인재원"이었다 — 감사 2026-09-21).
 */
export const NEUTRAL_ACADEMY_NAME = "학원";

export const DEFAULT_SETTINGS: TenantSettings = {
  version: 1,
  preset: "chinsan",
  profile: {
    name: "", // resolver가 tenants.name으로 채움
    representativeName: "",
    phone: "",
    email: "",
    address: "",
    bizRegNo: "",
    branchLabel: "",
    logoText: "에이와",
    brandColor: "#153e75", // --primary 인재원 네이비 — color-utils DEFAULT_BRAND_COLOR와 동일
    logoUrl: "",
    sealUrl: "",
    legalName: "",
    payslipSigners: "",
  },
  operations: {
    // 과목 — 현재 SUBJECT_LABEL 중복 맵 이식(단일 소스). color=Pill 토큰.
    // ⚠️ 과목 색은 **서로 색상각이 충분히 벌어져야** 한다(시간표·밀도막대에서 과목을 색으로 읽는다).
    // primary(브랜드 네이비 214.4°)는 blue(219.2°)와 4.8° 차이라 **과목색으로 쓰지 말 것**
    // — v3 네이비 전환 때 math=primary·english=blue가 같은 파랑으로 붕괴했던 이력(2026-07-20).
    // 현 배정 최소 간격 34.8°: blue 219° · purple 254° · rose 337° · gold 42°.
    // 영어는 과목 전용 평일 교시(내장 11교시)·강사별시간표 기본(가로줄 6시각·격자 10분)을 프리필(2026-07-06).
    subjects: [
      { key: "math", label: "수학", color: "blue", weekdayGrouping: "mon-thu", testMax: 5 },
      {
        key: "english",
        label: "영어",
        color: "rose",
        weekdayGrouping: "mon-tue",
        weekdayPeriods: ENGLISH_WEEKDAY_PERIOD_LIST,
        teacherViewLines: DEFAULT_TEACHER_VIEW_LINES,
        teacherViewStep: 10,
        testMax: 5,
        // 월간 계획서(MP) 인쇄물 문구 — 소비처는 (print)/ecs/[classId]/month-plan.
        // ⚠️ 안내·Prep 문구는 원문을 확인 못 해 **빈 채**로 둔다(인쇄에서 그 블록이 생략된다).
        //    지어낸 문장이 학부모에게 나가는 것보다 빈 것이 낫다 — 원장이 과목 운영 탭에서 채운다.
        monthPlan: DEFAULT_MONTH_PLAN_TEXTS,
      },
      { key: "science", label: "과학", color: "purple", weekdayGrouping: "none", testMax: 5 },
      { key: "korean", label: "국어", color: "gold", weekdayGrouping: "mon-thu", testMax: 5 },
    ],
    // 학원이 만든 요일 병합. 비어 있으면 기본 프리셋만 드롭다운에 선다.
    weekdayGroupings: [],
    hiddenBuiltinWeekdayGroupings: [],
    jobTitles: ["원장", "부원장", "실장", "강사", "조교", "행정"],
    // 부서별 직급(원장 지시 2026-07-29). 교과 3부서는 같은 체계, 관리 부서는 일반 직급 체계.
    // '아르바이트'는 항목이 하나뿐이라 부서를 고르면 직급이 자동 확정된다.
    jobTitlesByDepartment: {
      영어과: ["분원장", "부원장", "교수부장", "전임강사", "파트강사", "프리랜서"],
      수학과: ["분원장", "부원장", "교수부장", "전임강사", "파트강사", "프리랜서"],
      EIE: ["분원장", "부원장", "교수부장", "전임강사", "파트강사", "프리랜서"],
      // 임원(대표·이사)도 경영지원팀 소속으로 이력서를 쓴다(원장 지시 2026-08-24) — 직위 높은 순.
      경영지원팀: ["대표", "이사", "부장", "과장", "대리", "사원"],
      개발팀: ["연구소장", "부장", "과장", "대리", "사원"],
      아르바이트: ["아르바이트"],
    },
    // 미취학(6세·7세)이 맨 앞 — 7세반 문의가 들어온다(원장 2026-08-18). 학년 흐름 순서가 곧 표시·정렬 순서다.
    gradeLevels: ["6세", "7세", "초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3", "고1", "고2", "고3"],
    // 교시 방식 — 침산 방식(두 교시 묶음·영어 내장 교시). 새 학원은 generic-defaults.ts에서 "plain".
    periodStyle: "chinsan",
    // 학교명 저장 별칭 — 원장 확정(2026-09-01 *"일중 -> 대구일중"*). 새 학원은 generic-defaults.ts에서 빈 목록.
    schoolSaveAliases: CHINSAN_SCHOOL_SAVE_ALIASES.map((a) => ({ ...a })),
    weekdayPeriods: WEEKDAY_PERIODS,
    weekendPeriods: WEEKEND_PERIODS,
    terms: [],
    holidays: [],
    shuttle: DEFAULT_SHUTTLE,
    // 자리 공개 출석부 PIN — /seat/lab·/seat/jj 비로그인 접속. 원장이 학원설정에서 바꾼다.
    // 새 지점의 기본값 = 0000(원장 2026-09-22 *"새로운 지점들은 기본 비밀번호 0000으로. 세팅되게."* — 종전 7099).
    // 설정을 건드리지 않아도 바로 열린다(2026-08-19 원칙 그대로). 침산은 7099를 **저장해 둬서** 이 값과 무관하다.
    // ⚠️ 설정에서 **비우면** 그 자리 공개 접속이 꺼진다 — 기본값이 있는 것과 모순되지 않는다.
    seatPins: { lab: "0000", jj: "0000" },
  },
  billing: {
    dueDay: 10,
    taxMode: "none",
    defaultMethod: "계좌이체",
    latePolicy: "",
    account: { label: "", bank: "", holder: "", number: "", targets: [] }, // 하위호환 미러(resolve가 첫 계좌로 채움)
    accounts: [],
    sessionPrices: DEFAULT_SESSION_PRICES,
    eieMonthlyPrice: DEFAULT_EIE_MONTHLY_PRICE,
  },
  notifications: {
    alimtalkSenderKey: "",
    kakaoChannelId: "",
    googleSheetId: "",
    printHeader: "",
    privacyTerms: DEFAULT_PRIVACY_TERMS,
    serviceTerms: DEFAULT_SERVICE_TERMS,
  },
  // 학생상담 양식(템플릿) — 기본 4종 프리셋(신입생 관리 시나리오 + 일반 상담일지). 원장이 학원설정에서 편집.
  consultations: { templates: DEFAULT_CONSULTATION_TEMPLATES },
  // 학부모 보고서(/r)·ClassNote 게시 이미지 표시 — 기본은 전부 표시(기존 동작 유지). 로고 중복은 원장이 학원명 off로.
  report: {
    title: "수업 보고서",
    showLogo: true,
    logoUrl: "",
    showAcademyName: true,
    showFooter: true,
    footerNote: "",
    showTextbook: true,
    showProgress: true,
    showDailyTest: true,
    showCheckTest: true,
    showHomework: true,
    showHomeworkToday: true, // 오늘 과제(숙제 내용) 기본 표시 — 0096a. 값 없으면 행 자체가 숨어 무해.
    showAttitude: true,
    showParentNote: true,
    showTrendNote: true, // 학습 추세(종합분석) 기본 표시 — 0091a
    showTrendGraph: true, // 성적 추이 그래프(시험·과제) 기본 표시 — 데이터 2점 미만이면 자동 숨김
    showAttachments: true,
    allowTeacherTestMax: false, // 기본: 강사는 과목 설정값(문항수) 고정 사용. 켜면 원스크린에서 /N 직접 변경 가능.
    todaysMathTestFill: false, // 오늘 수학 채점 결과로 원스크린 시험 빈칸 채우기 — 개발 중이라 기본 꺼짐.
    todaysMathMonthlyFill: false, // 오늘 수학 월말평가로 성적관리 월말평가 빈칸 채우기 — 개발 중이라 기본 꺼짐.
    todaysMathReportPdf: false, // 오늘 수학 월말평가 성적표 PDF를 수업보고서 첨부에 붙이기 — 개발 중이라 기본 꺼짐.
    videoHomeworkPolicy: { enabled: true, disabledSubjectKeys: [], disabledSchoolLevels: [], disabledClassIds: [] },
    writingExemptTeachers: [], // 작성률 예외 강사(빈=전원 집계) — 강사별 작성률 표에서 제외할 표시 이름.
    noticeMode: "A", // 기본: 단일 문단 멘트. B=수업내용+태도·특이사항 2문단 분리(0093a).
    classnoteSendEnabled: false, // 기본 OFF(dry-run) — 원장 승인 전까지 실제 발송 안 함(오발송 안전장치).
    classnoteSubjects: [], // 발송 허용 과목(빈=아무것도 발송 안 함, 명시 opt-in). 현 운영은 ['math']를 원장이 설정.
    classnoteSharedBoardAllowlist: [], // 공유 보드 발송 예외(빈=예외 없음 = 2가족+ 보드는 전부 보류). 확인된 '같은 학생 다계정' 보드명만.
    classnoteSendWindowStart: "", // 발송 허용 시간창 시작(KST HH:MM). 빈 값=무제한(기존 동작) — 둘 다 채워야 활성.
    classnoteSendWindowEnd: "", // 발송 허용 시간창 종료(KST HH:MM). 빈 값=무제한.
    classnoteMathRoute: "personal", // 수학 발송 경로 — 기본 = 기존 (수학)학생명 1인 보드(지금 동작 그대로).
    classnoteMathRoutePilot: [], // pilot일 때 반 보드로 보내는 강사(표시 이름). 빈 값 = 아무도 반 보드로 안 감.
    classnoteParentReplyMode: "off", // 학부모 글 답글·공감 — 기본 끔(없는 기능). 시험 = 학원이 테스트 보드만, 전체 = 확정 연결이 맞는 글.
  },
  // 권한 override는 sparse(빈 배열) — 진짜 기본값은 permissions.ts의 MENU_ACCESS. 매트릭스 복제 금지.
  // userOverrides = 개인 예외(특정 사용자에게만 메뉴 셀 덮어쓰기, 2026-08-01) — 역시 sparse.
  permissions: { overrides: [], userOverrides: [], specialAccess: { payslipViewerIds: [], payslipManagerIds: [], leaveAdjusterIds: [], classSplitterIds: [], enrollmentDateEditorIds: [], studentStatusManagerIds: [], staffTaskMonitorIds: [], vendorViewerIds: [], jjReportManagerIds: [], beforeClassReportIds: [], withdrawalApproverIds: [], staffSubjectScopes: [] } },
  // 사이드바 표시도 sparse(빈 배열) — **비면 지금과 글자 그대로 같다**(전부 표시·코드 순서).
  // 기본 목록을 여기 복제하지 말 것: 복제하면 메뉴를 새로 만들 때마다 두 곳을 고쳐야 하고,
  // 한쪽을 잊으면 새 메뉴가 조용히 안 보인다(이 기능이 애초에 풀려던 문제 그 자체).
  navigation: { menus: [], teacherMenus: [], groups: [], teacherGroups: [] },
  // 기능 켜기·끄기도 sparse — 침산 프리셋은 **아무것도 끄지 않는다**(오늘과 같다). 일반판은 generic-defaults.ts.
  modules: { disabled: [] },
  makeups: DEFAULT_MAKEUP_SETTINGS,
  // 운영실 배치 — 저장값 없음 = 역할마다 코드의 기본 배치(features/dashboard/layout/defaults.ts). 원장은 지금 운영실 그대로.
  dashboard: { version: 1, layouts: [], assignments: [] },
};
