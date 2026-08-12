// DEFAULT_SETTINGS — 설정값이 없을 때의 폴백 = 현재 코드에 하드코딩된 값들.
// 저장된 행이 없거나 일부 키가 비면 이 값으로 채워 "오늘과 동일한 동작"을 보장(resolve.ts).
// profile.name은 여기서 비우고 resolver가 tenants.name으로 채운다(테넌트별 실제 학원명).
import { ENGLISH_WEEKDAY_PERIOD_LIST } from "@/features/timetable/lib/periods";
import { DEFAULT_TEACHER_VIEW_LINES } from "@/features/timetable/lib/ten-minute-grid";
import type { TenantSettings } from "./settings-types";

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
// 🔴 동의 문구 3종(2026-08-12 개인정보 검토로 전면 재작성) — 수집·이용(제15조)·국외이전(제28조의8)·
// 민감정보(제23조)는 **법이 각각 별도 동의를 요구**하므로 문구도 화면 체크박스도 셋으로 나눈다.
// 종전 문구는 항목이 "제출한 과제의 동영상 및 음원"이고 목적이 "홍보"뿐이라 상담 녹음·AI 분석을
// 전혀 덮지 못했다(= 받아 둔 동의가 목적 외 이용이 되는 상태였다).
// ⚠️ 문구를 고칠 때 각 항목의 **번호 구조(항목·목적·기간·거부권)를 지울 것**이 아니다 — 법정 고지사항이다.
const DEFAULT_PRIVACY_TERMS = `[개인정보 수집·이용 동의]

1. 수집하는 항목
 · 학생 : 성명, 학년, 학교, 생년월일, 성별, 연락처
 · 학부모 : 성명, 연락처, 학생과의 관계
 · 상담 과정에서 작성·수집되는 상담 기록
 · 상담 녹음 파일과 그 전사(轉寫) 내용 — 녹음에 동의하신 경우에만 해당합니다

2. 이용 목적
 · 수업 배정, 학습 관리, 상담 기록의 작성과 보관
 · 수강료 청구 및 학부모 안내
 · 상담 내용을 정확히 기록하고 요약·정리하기 위한 목적(녹음에 동의하신 경우)

3. 보유 및 이용 기간
 · 상담 녹음의 전사(대화 내용을 그대로 옮긴 글) : 상담일로부터 14일이 지나면 자동 삭제됩니다
 · 상담 녹음 원본 : 녹음일로부터 90일이 지나면 자동 삭제됩니다
 · 상담 기록과 요약 : 재원 기간 및 퇴원 후 1년까지, 등록하지 않으신 경우 상담일로부터 1년까지
 · 다른 법령이 보존 기간을 정한 경우에는 그 기간을 따릅니다

4. 동의를 거부할 권리와 그에 따른 불이익
 동의를 거부하실 수 있습니다. 다만 성명·연락처 등 필수 항목에 동의하지 않으시면 수업 배정과
 학부모 안내가 어려워 서비스 제공이 제한될 수 있습니다.
 ※ 상담 녹음은 필수가 아닙니다 — 거부하셔도 상담은 그대로 진행됩니다.`;

const DEFAULT_OVERSEAS_TRANSFER_TERMS = `[개인정보 국외 이전 동의]

상담 녹음을 문자로 옮기고 내용을 요약하기 위해, 아래와 같이 국외 사업자에게 개인정보를 이전합니다.
이 동의는 녹음에 동의하신 경우에만 적용됩니다.

1. 이전받는 자와 이전되는 국가
 · AssemblyAI, Inc. (미국) — 음성을 문자로 변환(전사)
 · Anthropic PBC (미국) — 상담 내용 요약·정리
 · 주식회사 업스테이지 (대한민국) — 상담 내용 요약·정리
 ※ 이용하는 사업자가 바뀌는 경우 개인정보 처리방침을 통해 미리 알려드립니다.

2. 이전 일시와 방법
 녹음이 등록되는 즉시, 암호화된 인터넷 통신(HTTPS)으로 전송합니다.

3. 이전되는 항목
 상담 녹음 파일과 그 전사 내용, 학생 성명·학년·학교, 학부모 성명

4. 이전 목적
 음성의 문자 변환(전사)과 상담 내용의 요약·정리

5. 이전받는 자의 보유·이용 기간
 처리가 끝나는 즉시 이용을 종료하며, 해당 사업자의 정책에 따라 삭제됩니다.
 학원이 보관하는 전사 내용도 상담일로부터 14일이 지나면 자동 삭제됩니다.

6. 동의를 거부할 권리와 그에 따른 불이익
 국외 이전에 동의하지 않으실 수 있습니다. 동의하지 않으시면 녹음과 자동 요약 기능만 제공되지
 않으며, 상담을 포함한 그 밖의 모든 서비스는 아무런 제한 없이 이용하실 수 있습니다.`;

const DEFAULT_SENSITIVE_INFO_TERMS = `[민감정보 수집·이용 동의]

상담 과정에서 학생의 학습 태도나 정서 상태에 관한 이야기가 오갈 수 있습니다. 이러한 내용은
개인정보 보호법이 정한 민감정보에 해당할 수 있어 별도로 동의를 받습니다.

1. 수집하는 항목
 학습 태도와 정서 상태(학습 의욕, 자신감, 스트레스 등), 그리고 상담 중 학부모·학생께서
 자발적으로 말씀하신 건강이나 가정 환경에 관한 내용

2. 이용 목적
 학생에게 맞는 학습 지도 방향과 상담 방향을 정하기 위한 참고 자료로만 사용합니다.

3. 보유 및 이용 기간
 상담 기록의 보유 기간과 같습니다.

4. 동의를 거부할 권리와 그에 따른 불이익
 거부하실 수 있으며, 거부하셔도 수업 등록과 상담에는 아무런 제한이 없습니다.
 거부하신 경우 해당 내용은 기록·분석에 사용하지 않습니다.`;

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

export const DEFAULT_SETTINGS: TenantSettings = {
  version: 1,
  profile: {
    name: "", // resolver가 tenants.name으로 채움
    representativeName: "",
    phone: "",
    email: "",
    address: "",
    bizRegNo: "",
    branchLabel: "",
    logoText: "EYWA",
    brandColor: "#153e75", // --primary 인재원 네이비 — color-utils DEFAULT_BRAND_COLOR와 동일
    logoUrl: "",
    sealUrl: "",
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
      // 수학(심화)는 학원 고유 과목이라 표준키 대신 subject_N 계열로 통일(2026-06-19, highmath→subject_1 마이그레이션).
      // hiddenFromIntake: 재원생 대상 반이라 QR 공개접수 '상담 희망 과목'에선 뺀다(2026-07-15 원장 지시).
      {
        key: "subject_1",
        label: "수학(심화)",
        color: "blue",
        weekdayGrouping: "mon-thu",
        testMax: 5,
        hiddenFromIntake: true,
      },
      {
        key: "english",
        label: "영어",
        color: "rose",
        weekdayGrouping: "mon-tue",
        weekdayPeriods: ENGLISH_WEEKDAY_PERIOD_LIST,
        teacherViewLines: DEFAULT_TEACHER_VIEW_LINES,
        teacherViewStep: 10,
        testMax: 5,
      },
      { key: "science", label: "과학", color: "purple", weekdayGrouping: "none", testMax: 5 },
      { key: "korean", label: "국어", color: "gold", weekdayGrouping: "mon-thu", testMax: 5 },
    ],
    jobTitles: ["원장", "부원장", "실장", "강사", "조교", "행정"],
    // 부서별 직급(원장 지시 2026-07-29). 교과 3부서는 같은 체계, 관리 부서는 일반 직급 체계.
    // '아르바이트'는 항목이 하나뿐이라 부서를 고르면 직급이 자동 확정된다.
    jobTitlesByDepartment: {
      영어과: ["분원장", "부원장", "교수부장", "전임강사", "파트강사", "프리랜서"],
      수학과: ["분원장", "부원장", "교수부장", "전임강사", "파트강사", "프리랜서"],
      EIE: ["분원장", "부원장", "교수부장", "전임강사", "파트강사", "프리랜서"],
      경영지원팀: ["부장", "과장", "대리", "사원"],
      개발팀: ["연구소장", "부장", "과장", "대리", "사원"],
      아르바이트: ["아르바이트"],
    },
    gradeLevels: ["초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3", "고1", "고2", "고3"],
    weekdayPeriods: WEEKDAY_PERIODS,
    weekendPeriods: WEEKEND_PERIODS,
    terms: [],
    holidays: [],
    shuttle: DEFAULT_SHUTTLE,
  },
  billing: {
    dueDay: 10,
    taxMode: "none",
    defaultMethod: "계좌이체",
    latePolicy: "",
    account: { label: "", bank: "", holder: "", number: "", targets: [] }, // 하위호환 미러(resolve가 첫 계좌로 채움)
    accounts: [],
  },
  notifications: {
    alimtalkSenderKey: "",
    kakaoChannelId: "",
    googleSheetId: "",
    printHeader: "",
    privacyTerms: DEFAULT_PRIVACY_TERMS,
    overseasTransferTerms: DEFAULT_OVERSEAS_TRANSFER_TERMS,
    sensitiveInfoTerms: DEFAULT_SENSITIVE_INFO_TERMS,
    serviceTerms: DEFAULT_SERVICE_TERMS,
  },
  // 학생상담 양식(템플릿) — 기본 4종 프리셋(신입생 관리 시나리오 + 일반 상담일지). 원장이 학원설정에서 편집.
  consultations: { templates: DEFAULT_CONSULTATION_TEMPLATES },
  // 학부모 보고서(/r)·ClassNote 게시 이미지 표시 — 기본은 전부 표시(기존 동작 유지). 로고 중복은 원장이 학원명 off로.
  report: {
    title: "수업 보고서",
    showLogo: true,
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
    writingExemptTeachers: [], // 작성률 예외 강사(빈=전원 집계) — 강사별 작성률 표에서 제외할 표시 이름.
    noticeMode: "A", // 기본: 단일 문단 멘트. B=수업내용+태도·특이사항 2문단 분리(0093a).
    classnoteSendEnabled: false, // 기본 OFF(dry-run) — 원장 승인 전까지 실제 발송 안 함(오발송 안전장치).
    classnoteSubjects: [], // 발송 허용 과목(빈=아무것도 발송 안 함, 명시 opt-in). 현 운영은 ['math']를 원장이 설정.
    classnoteSharedBoardAllowlist: [], // 공유 보드 발송 예외(빈=예외 없음 = 2가족+ 보드는 전부 보류). 확인된 '같은 학생 다계정' 보드명만.
    classnoteSendWindowStart: "", // 발송 허용 시간창 시작(KST HH:MM). 빈 값=무제한(기존 동작) — 둘 다 채워야 활성.
    classnoteSendWindowEnd: "", // 발송 허용 시간창 종료(KST HH:MM). 빈 값=무제한.
  },
  // 권한 override는 sparse(빈 배열) — 진짜 기본값은 permissions.ts의 MENU_ACCESS. 매트릭스 복제 금지.
  // userOverrides = 개인 예외(특정 사용자에게만 메뉴 셀 덮어쓰기, 2026-08-01) — 역시 sparse.
  permissions: { overrides: [], userOverrides: [] },
};
