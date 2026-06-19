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
      { key: "highmath", label: "수학(심화)", color: "primary" },
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
  },
  billing: {
    dueDay: 10,
    taxMode: "none",
    defaultMethod: "계좌이체",
    latePolicy: "",
  },
  notifications: {
    alimtalkSenderKey: "",
    kakaoChannelId: "",
    googleSheetId: "",
    printHeader: "",
    privacyTerms: "",
    serviceTerms: "",
  },
  // 권한 override는 sparse(빈 배열) — 진짜 기본값은 permissions.ts의 MENU_ACCESS. 매트릭스 복제 금지.
  permissions: { overrides: [] },
};
