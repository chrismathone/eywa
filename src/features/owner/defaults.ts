// DEFAULT_SETTINGS — 설정값이 없을 때의 폴백 = 현재 코드에 하드코딩된 값들.
// 저장된 행이 없거나 일부 키가 비면 이 값으로 채워 "오늘과 동일한 동작"을 보장(resolve.ts).
// profile.name은 여기서 비우고 resolver가 tenants.name으로 채운다(테넌트별 실제 학원명).
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
    brandColor: "#1a5f3c", // --primary 포레스트 그린
    logoUrl: "",
    sealUrl: "",
  },
  operations: {
    // 과목 — 현재 SUBJECT_LABEL 중복 맵 이식(단일 소스). color=Pill 토큰.
    subjects: [
      { key: "math", label: "수학", color: "primary" },
      // 수학(심화)는 학원 고유 과목이라 표준키 대신 subject_N 계열로 통일(2026-06-19, highmath→subject_1 마이그레이션).
      { key: "subject_1", label: "수학(심화)", color: "primary" },
      { key: "english", label: "영어", color: "blue" },
      { key: "science", label: "과학", color: "purple" },
      { key: "korean", label: "국어", color: "rose" },
    ],
    jobTitles: ["원장", "부원장", "실장", "강사", "조교", "행정"],
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
    account: { bank: "", holder: "", number: "" },
  },
  notifications: {
    alimtalkSenderKey: "",
    kakaoChannelId: "",
    googleSheetId: "",
    printHeader: "",
    privacyTerms: DEFAULT_PRIVACY_TERMS,
    serviceTerms: DEFAULT_SERVICE_TERMS,
  },
  // 권한 override는 sparse(빈 배열) — 진짜 기본값은 permissions.ts의 MENU_ACCESS. 매트릭스 복제 금지.
  permissions: { overrides: [] },
};
