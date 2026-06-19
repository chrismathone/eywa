// 학원 설정(owner 콘솔) 문서 스키마 — 단일 소스(타입 = Zod 추론).
// 저장은 tenant_settings.data jsonb. 빈 키는 DEFAULT_SETTINGS로 폴백(resolve.ts).
// 섹션별 부분 저장(saveOwnerSection)이라 SECTION_SCHEMAS로 섹션 단위 검증.
import { z } from "zod";
import { MENU_KEYS, SYSTEM_ROLES, type MenuKey, type SystemRole } from "@/lib/permissions";

const HHMM = /^\d{2}:\d{2}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

// Pill/디자인 토큰 색상 — 과목 색상 선택지.
export const SUBJECT_COLORS = [
  "primary", "blue", "rose", "amber", "danger", "purple", "gold", "neutral",
] as const;

export const periodTimeSchema = z.object({
  label: z.string().min(1).max(20),
  startTime: z.string().regex(HHMM, "HH:MM 형식"),
  endTime: z.string().regex(HHMM, "HH:MM 형식"),
});
export type PeriodTimeRow = z.infer<typeof periodTimeSchema>;

export const subjectSchema = z.object({
  key: z.string().min(1).max(24).regex(/^[a-z0-9_]+$/, "영문 소문자·숫자·_"),
  label: z.string().min(1).max(24),
  color: z.enum(SUBJECT_COLORS).default("neutral"),
});
export type SubjectSetting = z.infer<typeof subjectSchema>;

export const termSchema = z.object({
  name: z.string().min(1).max(24),
  start: z.string().regex(YMD, "YYYY-MM-DD"),
  end: z.string().regex(YMD, "YYYY-MM-DD"),
});
export type TermSetting = z.infer<typeof termSchema>;

// 공휴일·휴원일 — 날짜 + 이름(공휴일명). 옛 데이터(string[])는 resolve.ts에서 {date,name:""}로 정규화.
export const holidaySchema = z.object({
  date: z.string().regex(YMD, "YYYY-MM-DD"),
  name: z.string().max(40),
});
export type HolidaySetting = z.infer<typeof holidaySchema>;

// === 섹션 스키마 ===
export const profileSchema = z.object({
  name: z.string().max(60),
  representativeName: z.string().max(40),
  phone: z.string().max(30),
  email: z.string().max(80),
  address: z.string().max(200),
  bizRegNo: z.string().max(20), // 사업자등록번호 — 인쇄물·청구 헤더 법정 표기
  branchLabel: z.string().max(40), // "강남" 같은 지점 표기(헤더 부제)
  logoText: z.string().max(12), // 사이드바 워드마크(기본 "EYWA")
  brandColor: z.string().max(24),
  logoUrl: z.string().max(400), // 로고 이미지 URL(호스팅 주소). 인쇄물 머리글. 파일 업로드 UI는 후속.
  sealUrl: z.string().max(400), // 직인/도장 이미지 URL. 인쇄물 하단.
});
export type ProfileSettings = z.infer<typeof profileSchema>;

export const operationsSchema = z.object({
  subjects: z.array(subjectSchema).max(40),
  jobTitles: z.array(z.string().min(1).max(24)).max(40),
  gradeLevels: z.array(z.string().min(1).max(24)).max(60),
  weekdayPeriods: z.array(periodTimeSchema).max(20),
  weekendPeriods: z.array(periodTimeSchema).max(20),
  terms: z.array(termSchema).max(20),
  holidays: z.array(holidaySchema).max(200),
});
export type OperationsSettings = z.infer<typeof operationsSchema>;

export const billingSchema = z.object({
  dueDay: z.number().int().min(1).max(31),
  taxMode: z.enum(["none", "include", "exclude"]),
  defaultMethod: z.string().max(24),
  latePolicy: z.string().max(300),
});
export type BillingSettings = z.infer<typeof billingSchema>;

export const notificationsSchema = z.object({
  alimtalkSenderKey: z.string().max(80),
  kakaoChannelId: z.string().max(80),
  googleSheetId: z.string().max(120),
  printHeader: z.string().max(200),
  privacyTerms: z.string().max(8000),
  serviceTerms: z.string().max(8000),
});
export type NotificationsSettings = z.infer<typeof notificationsSchema>;

// === 역할/권한 — 테넌트별 메뉴 접근 override (sparse) ===
// 진짜 기본값은 코드의 하드코딩 MENU_ACCESS(permissions.ts). 여기엔 원장이 바꾼 (menu,role) 셀만
// 담는다. ⚠️ 배열 모델인 이유: resolve.ts deepMerge가 base 키만 순회 → 빈 {} 기본값 아래 객체 record는
// 새 키가 탈락. 배열은 "있으면 통째 교체"라 sparse override가 resolve 무수정으로 보존된다.
export const accessEnum = z.enum(["full", "scoped", "readonly", "none"]);
export const permissionOverrideSchema = z.object({
  menu: z.enum(MENU_KEYS as unknown as [MenuKey, ...MenuKey[]]),
  role: z.enum(SYSTEM_ROLES as unknown as [SystemRole, ...SystemRole[]]),
  access: accessEnum,
});
export const permissionsSchema = z
  .object({ overrides: z.array(permissionOverrideSchema).max(160) })
  .superRefine((v, ctx) => {
    // 가드레일을 스키마에서 강제(저장 자체 거부) — resolveMatrix 적용 단계와 이중 방어.
    for (const r of v.overrides) {
      if (r.menu === "teacher_onescreen" || r.menu === "my_learning") {
        ctx.addIssue({ code: "custom", message: "역할 전용 화면(원스크린/내 학습)은 편집할 수 없습니다" });
      }
      if (r.role === "student") {
        ctx.addIssue({ code: "custom", message: "학생(student)은 '내 학습' 전용 역할이라 메뉴 권한을 부여할 수 없습니다" });
      }
      if (r.role === "master" && (r.menu === "owner" || r.menu === "admin" || r.menu === "dashboard") && r.access === "none") {
        ctx.addIssue({ code: "custom", message: "원장(master)의 owner/admin/대시보드 접근은 잠글 수 없습니다" });
      }
    }
  });
export type PermissionsSettings = z.infer<typeof permissionsSchema>;

export const tenantSettingsSchema = z.object({
  version: z.literal(1),
  profile: profileSchema,
  operations: operationsSchema,
  billing: billingSchema,
  notifications: notificationsSchema,
  permissions: permissionsSchema,
});
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

// 섹션 단위 검증 맵 — saveOwnerSection이 section 키로 골라 부분 저장.
export const SECTION_SCHEMAS = {
  profile: profileSchema,
  operations: operationsSchema,
  billing: billingSchema,
  notifications: notificationsSchema,
  permissions: permissionsSchema,
} as const;
export type SectionKey = keyof typeof SECTION_SCHEMAS;
