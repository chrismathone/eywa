// 학원 설정(owner 콘솔) 문서 스키마 — 단일 소스(타입 = Zod 추론).
// 저장은 tenant_settings.data jsonb. 빈 키는 DEFAULT_SETTINGS로 폴백(resolve.ts).
// 섹션별 부분 저장(saveOwnerSection)이라 SECTION_SCHEMAS로 섹션 단위 검증.
import { z } from "zod";
import { MENU_KEYS, SYSTEM_ROLES, type MenuKey, type SystemRole } from "@/lib/permissions";

const HHMM = /^\d{2}:\d{2}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

// Pill/디자인 토큰 색상 — 과목 색상 선택지.
export const SUBJECT_COLORS = [
  "primary", "green", "blue", "rose", "amber", "danger", "purple", "gold", "neutral",
] as const;

// 과목별 시간표 요일 병합 프리셋 — 같은 반이 묶인 요일에 걸치면 한 칸으로 병합(기본뷰).
// mon-thu=월목/화금(수 단독, 수학식), mon-tue=월화/목금(수 단독, 영어식), mon-wed-fri=월수금/화목, none=요일별 개별.
// 실제 요일 분할·라벨은 features/timetable/lib/weekday-groups.ts(단일 소스). 미설정 행은 코드에서 mon-thu 폴백.
export const WEEKDAY_GROUPINGS = ["mon-thu", "mon-tue", "mon-wed-fri", "none"] as const;
export type WeekdayGrouping = (typeof WEEKDAY_GROUPINGS)[number];

export const periodTimeSchema = z.object({
  label: z.string().min(1).max(20),
  startTime: z.string().regex(HHMM, "HH:MM 형식"),
  endTime: z.string().regex(HHMM, "HH:MM 형식"),
});
export type PeriodTimeRow = z.infer<typeof periodTimeSchema>;

// 강사뷰(강사별시간표) 격자 단위(분) — 60의 약수만(정시선·rowSpan·가로줄 스냅 예측 가능성).
export const TEACHER_VIEW_STEPS = [5, 10, 15, 20, 30, 60] as const;
export type TeacherViewStep = (typeof TEACHER_VIEW_STEPS)[number];

// 강사뷰 세로 밀도 기본값(분당 px). 격자 한 칸(step분) 높이 = step × 이 값(예: 10분 칸 = 14px).
// ⚠️ teacher-grid.tsx의 폴백 상수 PX_PER_MIN과 같은 값을 유지할 것(둘 다 "미설정 기본").
export const DEFAULT_TEACHER_VIEW_PX_PER_MIN = 1.4;

// 강사뷰 쉬는 시간 범위("HH:MM"~"HH:MM") — 앞뒤로 수업이 붙은 강사 컬럼에 "쉬는 시간" 셀로 표시.
export const breakRangeSchema = z.object({
  start: z.string().regex(HHMM, "HH:MM 형식"),
  end: z.string().regex(HHMM, "HH:MM 형식"),
});
export type BreakRangeSetting = z.infer<typeof breakRangeSchema>;

// 통합뷰 커스텀 그룹(과목별) — "N교시 시작" 자동 섹션 대신 원장이 정한 묶음으로 반을 배치한다.
// ijw-calander 통합뷰 CUSTOM_GROUP 이식(2026-07-23). id는 편집 중 안정 키(재정렬·이름변경에도 유지).
export const integrationGroupSchema = z.object({
  id: z.string().min(1).max(36),
  title: z.string().min(1).max(30),
  classIds: z.array(z.string().min(1).max(64)).max(200),
});
export type IntegrationGroupSetting = z.infer<typeof integrationGroupSchema>;

export const subjectSchema = z.object({
  key: z.string().min(1).max(24).regex(/^[a-z0-9_]+$/, "영문 소문자·숫자·_"),
  label: z.string().min(1).max(24),
  color: z.enum(SUBJECT_COLORS).default("neutral"),
  // 시간표 기본뷰 요일 병합 방식(과목별). 미설정 저장 데이터는 읽을 때 mon-thu로 폴백(resolve는 스키마 미통과).
  weekdayGrouping: z.enum(WEEKDAY_GROUPINGS).default("mon-thu"),
  // 일일·확인테스트 문항수(만점) — 원스크린 점수 입력의 /N. 기본 5. (강사 변경 허용은 report.allowTeacherTestMax.)
  testMax: z.number().int().min(1).max(100).default(5),
  // 과목 전용 평일 교시(미설정/빈 배열 = 폴백: 영어=내장 11교시, 그 외=전역 평일 교시). 주말은 전역 공통.
  weekdayPeriods: z.array(periodTimeSchema).max(20).optional(),
  // QR 공개접수 폼의 '상담 희망 과목'에서 숨긴다(true = 학부모에게 안 보임). 재원생 대상 반(예: 수학(심화))처럼
  // 신규 상담으로 받지 않는 과목용. 미설정/false = 노출(기존 동작 유지). 내부 화면·시간표엔 영향 없음.
  // (.default(false)가 아니라 .optional() — 예외 플래그라 과목마다 적어넣게 만들지 않는다. weekdayPeriods와 동일.)
  hiddenFromIntake: z.boolean().optional(),
  // 강사뷰(강사별시간표) 내부 가로줄 시각("HH:MM") — 큰 섹션 경계 표시. 미설정 = 영어 기본 6시각.
  teacherViewLines: z.array(z.string().regex(HHMM, "HH:MM 형식")).max(40).optional(),
  // 강사뷰 격자 단위(분). 미설정 = 10.
  teacherViewStep: z
    .union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(60)])
    .optional(),
  // 강사뷰 쉬는 시간(HH:MM~HH:MM) — 앞뒤로 수업이 붙은 강사 컬럼에만 "쉬는 시간" 셀. 미설정=없음.
  teacherViewBreaks: z.array(breakRangeSchema).max(20).optional(),
  // 강사뷰 가로줄(큰 섹션 경계 진한 선)에서 제외할 강사 라벨 — 이 강사 컬럼엔 가로줄 미표시. 미설정=전원 표시.
  teacherViewLineExcluded: z.array(z.string().min(1).max(40)).max(80).optional(),
  // 강사뷰 세로 밀도(분당 px). 격자 한 칸(step분) 높이 = step × 이 값. 미설정 = DEFAULT_TEACHER_VIEW_PX_PER_MIN(1.4).
  teacherViewPxPerMin: z.number().min(0.5).max(6).optional(),
  // 통합뷰 커스텀 그룹(섹션) 정의. 비었으면 지금까지처럼 "N교시 시작" 자동 그룹.
  integrationGroups: z.array(integrationGroupSchema).max(40).optional(),
  // 커스텀 그룹을 실제로 적용할지. false·미설정 = 자동 그룹(정의는 남겨둔다 — 껐다 켜도 배치가 안 날아간다).
  integrationGroupsEnabled: z.boolean().optional(),
  // 어느 그룹에도 없는 반을 맨 아래 '기타' 섹션으로 보여줄지. 미설정 = 보여줌(반이 조용히 사라지면 안 된다).
  integrationShowOthers: z.boolean().optional(),
  integrationOthersTitle: z.string().max(30).optional(),
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

// 셔틀버스 — 공개 접수 폼·운영에 노출. 노선(라벨 + 정류장 목록).
export const shuttleRouteSchema = z.object({
  label: z.string().max(40),
  stops: z.array(z.string().max(80)).max(30),
});
export type ShuttleRoute = z.infer<typeof shuttleRouteSchema>;
export const shuttleSchema = z.object({
  enabled: z.boolean(),
  fee: z.string().max(40), // 표시용 문구(예: "월 20,000원")
  routes: z.array(shuttleRouteSchema).max(10),
});
export type ShuttleSetting = z.infer<typeof shuttleSchema>;

export const operationsSchema = z
  .object({
    subjects: z.array(subjectSchema).max(40),
    jobTitles: z.array(z.string().min(1).max(24)).max(40),
    gradeLevels: z.array(z.string().min(1).max(24)).max(60),
    weekdayPeriods: z.array(periodTimeSchema).max(20),
    weekendPeriods: z.array(periodTimeSchema).max(20),
    terms: z.array(termSchema).max(20),
    holidays: z.array(holidaySchema).max(200),
    shuttle: shuttleSchema,
  })
  .superRefine((v, ctx) => {
    // 과목 중복 방지(저장 거부) — 내부 키·과목명(라벨) 모두 유일해야 한다. 클라 편집기 경고와 이중 방어.
    const keys = new Set<string>();
    const labels = new Set<string>();
    v.subjects.forEach((s, i) => {
      const k = s.key.trim();
      if (k && keys.has(k)) {
        ctx.addIssue({ code: "custom", message: `과목 내부 ID가 중복됩니다: ${k}`, path: ["subjects", i, "key"] });
      }
      keys.add(k);
      const l = s.label.trim();
      if (l && labels.has(l)) {
        ctx.addIssue({ code: "custom", message: `과목명이 중복됩니다: ${l}`, path: ["subjects", i, "label"] });
      }
      labels.add(l);
    });
  });
export type OperationsSettings = z.infer<typeof operationsSchema>;

// 입금 계좌를 배선할 소비처(어느 화면의 기본 계좌로 쓸지) — 학원설정에서 계좌마다 지정.
// ⚠️ 새 계좌 소비처를 추가하면 여기에 한 줄 추가 + 그 화면에서 accountForTarget(billing, key)로 읽을 것.
export const ACCOUNT_TARGETS = [
  { key: "textbook", label: "교재요청서" },
  { key: "quote", label: "수강료 계산기" },
] as const;
export type AccountTargetKey = (typeof ACCOUNT_TARGETS)[number]["key"];
const ACCOUNT_TARGET_KEYS = ACCOUNT_TARGETS.map((t) => t.key) as [AccountTargetKey, ...AccountTargetKey[]];

// 입금 계좌 — 교재요청서·수강료 안내문 등에 표시되는 학원 계좌(은행/예금주/계좌번호).
// 여러 개 등록하고 계좌마다 '사용할 곳(targets)'을 지정 → 그 화면이 이 계좌를 기본으로 쓴다.
export const accountSchema = z.object({
  label: z.string().max(24).default(""), // 계좌 별칭(예: "메인", "교재비 전용") — 목록 구분·표시용(선택)
  bank: z.string().max(40),
  holder: z.string().max(40),
  number: z.string().max(40),
  // 이 계좌를 기본으로 쓸 소비처 키 목록(학원설정에서 지정). 한 소비처는 한 계좌에만(폼에서 배타 처리).
  targets: z.array(z.enum(ACCOUNT_TARGET_KEYS)).default([]),
});
export type AccountSetting = z.infer<typeof accountSchema>;

export const billingSchema = z.object({
  dueDay: z.number().int().min(1).max(31),
  taxMode: z.enum(["none", "include", "exclude"]),
  defaultMethod: z.string().max(24),
  latePolicy: z.string().max(300),
  // ⚠️ deprecated 단일 계좌 — 하위호환용 미러. resolve(normalizeBilling)가 첫 계좌로 덮어쓴다(미이전 소비처 안전).
  // 새 소비처는 accountForTarget(billing, key)로 배선된 계좌를 읽을 것(이 필드 직접 읽지 말 것).
  account: accountSchema,
  // 입금 계좌 목록(여러 개). 각 계좌의 targets로 소비처에 배선.
  accounts: z.array(accountSchema).max(12),
});
export type BillingSettings = z.infer<typeof billingSchema>;

/** 소비처에 배선된 입금 계좌 — 그 소비처를 targets에 가진 계좌 → 첫 계좌 → 레거시 account 순 폴백. */
export function accountForTarget(billing: BillingSettings, target: AccountTargetKey): AccountSetting {
  const list = billing.accounts ?? [];
  return list.find((a) => a.targets?.includes(target)) ?? list[0] ?? billing.account;
}

export const notificationsSchema = z.object({
  alimtalkSenderKey: z.string().max(80),
  kakaoChannelId: z.string().max(80),
  googleSheetId: z.string().max(120),
  printHeader: z.string().max(200),
  privacyTerms: z.string().max(8000),
  serviceTerms: z.string().max(8000),
});
export type NotificationsSettings = z.infer<typeof notificationsSchema>;

// === 학생상담 양식(템플릿) — 상담 등록 시 요약 뼈대·기본 범주/대상을 프리필 ===
// 테넌트 공용 목록 + 기본양식(isDefault) 최대 1개. 소비처 = 상담 등록 폼(consultation-form.tsx)의 양식 선택기.
// 범주·대상은 학생상담의 고정 도메인 enum(운영 enum 아님 — 코드 고정). 상담 폼(actions.ts CATEGORIES/AUDIENCES)과 동일 값.
export const CONSULTATION_CATEGORIES = ["general", "academic", "emotional", "career", "social", "other"] as const;
export const CONSULTATION_AUDIENCES = ["parent", "student", "both"] as const;

// 빈 문자열/undefined → null 정규화(에디터 select "없음" 값이 "" 로 넘어와도 통과).
const emptyToNull = (v: unknown) => (v === "" || v === undefined ? null : v);

export const consultationTemplateSchema = z.object({
  key: z.string().min(1).max(24),
  name: z.string().min(1, "양식 이름을 입력하세요").max(40),
  body: z.string().max(4000), // 요약 뼈대(빈 값 허용 — 제목만 있는 양식도 가능)
  category: z.preprocess(emptyToNull, z.enum(CONSULTATION_CATEGORIES).nullable()),
  audience: z.preprocess(emptyToNull, z.enum(CONSULTATION_AUDIENCES).nullable()),
  isDefault: z.boolean().default(false),
});
export type ConsultationTemplate = z.infer<typeof consultationTemplateSchema>;

export const consultationsSchema = z
  .object({ templates: z.array(consultationTemplateSchema).max(30) })
  .superRefine((v, ctx) => {
    // 양식 ID(key) 중복 금지 + 기본양식은 최대 1개(라디오 UI와 이중 방어).
    const keys = new Set<string>();
    let defaults = 0;
    v.templates.forEach((t, i) => {
      const k = t.key.trim();
      if (k && keys.has(k)) {
        ctx.addIssue({ code: "custom", message: `양식 ID가 중복됩니다: ${k}`, path: ["templates", i, "key"] });
      }
      keys.add(k);
      if (t.isDefault) defaults += 1;
    });
    if (defaults > 1) {
      ctx.addIssue({ code: "custom", message: "기본양식은 하나만 지정할 수 있습니다", path: ["templates"] });
    }
  });
export type ConsultationsSettings = z.infer<typeof consultationsSchema>;

// === 보고서 — 학부모 보고서(/r)·ClassNote 게시 이미지의 표시 설정 ===
// 표시 세부를 하드코딩 대신 원장이 제어(로고/학원명 중복 제거, 항목 토글, 바닥글). 배열 없음(deepMerge 안전).
export const reportSchema = z.object({
  title: z.string().max(40),
  showLogo: z.boolean(),
  showAcademyName: z.boolean(),
  showFooter: z.boolean(),
  footerNote: z.string().max(200),
  showTextbook: z.boolean(), // 교재명 — 0089a(강사 필드 패리티)
  showProgress: z.boolean(),
  showDailyTest: z.boolean(),
  showCheckTest: z.boolean(),
  showHomework: z.boolean(),
  showHomeworkToday: z.boolean().default(true), // 오늘 과제(숙제 내용) — 0096a(edutrix homework_today 패리티)
  showAttitude: z.boolean(),
  showParentNote: z.boolean(),
  showTrendNote: z.boolean(), // 학습 추세(종합분석) — 0091a(edutrix graph_eval 이식)
  showTrendGraph: z.boolean().default(true), // 성적 추이 그래프(시험·과제 순수 SVG) — edutrix ReportPaper 그래프 이식
  showAttachments: z.boolean(), // 학생 사진 첨부(P2b) — /r·ClassNote 게시 이미지에 표시
  allowTeacherTestMax: z.boolean(), // 강사가 원스크린에서 테스트 문항수(/N)를 직접 변경 가능한지. off=과목 설정값 고정.
  // 작성률 예외 강사(표시 이름 배열) — '강사별 작성률' 표에서 제외(보고서 작성 대상이 아닌 보조·데스크 강사 등).
  writingExemptTeachers: z.array(z.string()).default([]),
  // AI 멘트 공지 모드 — 0093a(4c). A=단일 문단(사실+특이사항 종합), B=수업내용(P1)+태도·특이사항(P2) 2문단 분리.
  noticeMode: z.enum(["A", "B"]).default("A"),
  // ClassNote 실제 발송 스위치 — **기본 false(dry-run)**. 원장이 켜기 전까지 발송 버튼은 저장만 하고 실제 전송 안 함.
  // 공유 DB+라이브 워커라 이관분 오발송 방지용 안전장치(메인 병합 후에도 원장 승인 전까지 OFF 유지).
  classnoteSendEnabled: z.boolean().default(false),
  // ClassNote 발송 허용 과목(과목 키 배열) — **명시 opt-in**: 여기 든 과목만 학부모에게 발송. 빈 배열(기본)=아무것도
  // 발송 안 함. 현 운영은 수학만 사용 → ['math']. classnoteSendEnabled와 이중 방어(큐 진입 시 isClassnoteSubjectEnabled).
  classnoteSubjects: z.array(z.string()).default([]),
  // ClassNote 공유 보드 발송 예외(보드명 배열, 예 '(수학)안은지') — 워커 프리플라이트 게이트는 한 보드에 연결된
  // 가족이 2+이면 오발송(남의 가족에게 노출) 방지로 발송을 보류하는데, **원장이 운영관리에서 전화·보호자를 직접
  // 확인해 "같은 학생이 학부모·본인 등 다계정으로 붙은 것"이라 판정한 보드만** 여기 등재해 예외 허용한다.
  // 빈 배열(기본)=예외 없음(모든 공유 보드 차단 = fail-safe). ⚠️ 잘못 등재하면 실제 남의 가족에게 발송되므로
  // 반드시 육안 확인 후 등재. 소비처 = ClassNote 워커(classnote-core.mjs `getClassnoteBoardAllowlist`)가
  // raw SQL `data->'report'->'classnoteSharedBoardAllowlist'`로 직접 읽음(getTenantSettings 미경유).
  // 값은 boardClassName(subject, studentName) 결과 `(과목)학생명`과 일치해야 함(비교는 공백 무시).
  classnoteSharedBoardAllowlist: z.array(z.string()).default([]),
  // ClassNote 발송 허용 시간창(KST "HH:MM", 매일 동일) — 밤 수업 보고서가 밤에 학부모 폰을 울리지 않게
  // 워커가 창 밖이면 발송을 미룬다(큐 보존, 창 진입 시 자동 발송). **둘 다 채워야 활성**, 하나라도 비면
  // 무제한(기존 동작). start > end면 자정 넘김 창(예 06:00~22:00은 주간, 22:00~06:00은 야간만 발송).
  // 소비처 = ClassNote 워커(classnote-core.mjs `getClassnoteSendWindow`, raw SQL 직독 — allowlist와 동일 패턴)
  // + saveAndQueueClassnote(창 밖 발송 시 강사 대기 안내 문구).
  classnoteSendWindowStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM 형식(예 09:00)")
    .or(z.literal(""))
    .default(""),
  classnoteSendWindowEnd: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM 형식(예 21:00)")
    .or(z.literal(""))
    .default(""),
});
export type ReportSettings = z.infer<typeof reportSchema>;

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
        ctx.addIssue({ code: "custom", message: "원장(master)의 owner/admin/오늘 접근은 잠글 수 없습니다" });
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
  consultations: consultationsSchema,
  report: reportSchema,
  permissions: permissionsSchema,
});
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

// 섹션 단위 검증 맵 — saveOwnerSection이 section 키로 골라 부분 저장.
export const SECTION_SCHEMAS = {
  profile: profileSchema,
  operations: operationsSchema,
  billing: billingSchema,
  notifications: notificationsSchema,
  consultations: consultationsSchema,
  report: reportSchema,
  permissions: permissionsSchema,
} as const;
export type SectionKey = keyof typeof SECTION_SCHEMAS;

/** 섹션 한글 라벨 — 저장 액션 targetLabel(owner/server/actions)과 감사로그 상세 표시(features/audit/describe)가 공유. */
export const SECTION_LABELS: Record<SectionKey, string> = {
  profile: "학원 프로필·브랜드",
  operations: "운영 체계",
  billing: "수납·청구 기본값",
  notifications: "알림·약관",
  consultations: "상담 양식",
  report: "보고서",
  permissions: "역할별 메뉴 권한",
};
