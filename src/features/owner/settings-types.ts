// 학원 설정(owner 콘솔) 문서 스키마 — 단일 소스(타입 = Zod 추론).
// 저장은 tenant_settings.data jsonb. 빈 키는 DEFAULT_SETTINGS로 폴백(resolve.ts).
// 섹션별 부분 저장(saveOwnerSection)이라 SECTION_SCHEMAS로 섹션 단위 검증.
import { z } from "zod";
import { MENU_KEYS, MENU_LABEL, SYSTEM_ROLES, type MenuKey, type SystemRole } from "@/lib/permissions";
// 감출 수 없는 목적지 판정 — 스키마(저장 거부)와 적용(isMenuHiddenByLayout)이 **같은 함수**를 본다.
import { isLayoutHideLocked, isFixedDestination, FIXED_GROUP_IDS, MAX_NAV_GROUPS } from "./menu-layout";
import { hasMenuGlyph } from "@/components/icons/menu-glyph";
import type { AywaIconName } from "@/components/icons/aywa-icons";
import { HUB_GROUPS, SUPPORT_GROUPS } from "@/lib/menu-hub";
import { TEACHER_NAV_GROUPS, TEACHER_DEFAULT_GROUP } from "@/lib/teacher-navigation";
// 보관 가능한 배치 수는 **화면도 읽는 값**이라 zod 없는 순수 모듈에 산다(클라 번들에 zod 유입 방지).
import { MAX_GROUP_PRESETS } from "@/features/timetable/lib/group-presets";
import { DEFAULT_EIE_MONTHLY_PRICE, DEFAULT_SESSION_PRICES } from "@/features/billing/session-pricing";
import { MODULE_IDS } from "@/lib/modules";
import { makeupSettingsSchema } from "@/features/makeups/config";
import { BUNDLES, DASHBOARD_VERSION, GRID_COLS, MAX_ITEMS, MAX_ROW_SPAN, MAX_GRID_Y } from "@/features/dashboard/layout/types";
import { CHINSAN_SCHOOL_SAVE_ALIASES } from "@/features/schools/school-name";
import { DEFAULT_VIDEO_HOMEWORK_POLICY } from "@/features/video-homework/policy";
import { parseWeekdayPartition, weekdayPartitionKey } from "@/features/timetable/lib/weekday-partition";

const HHMM = /^\d{2}:\d{2}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

// Pill/디자인 토큰 색상 — 과목 색상 선택지.
export const SUBJECT_COLORS = [
  "primary", "green", "blue", "rose", "amber", "danger", "purple", "gold", "neutral",
] as const;

// 과목별 시간표 요일 병합 프리셋 — 같은 반이 묶인 요일에 걸치면 한 칸으로 병합(기본뷰).
// mon-thu=월목/화금(수 단독), mon-tue=월화/목금(수 단독), mon-wed-fri=월수금/화목,
// mon-tue-seq=월화/수목(금 단독), none=요일별 개별.
// 실제 요일 분할·라벨은 features/timetable/lib/weekday-groups.ts(단일 소스). 미설정 행은 코드에서 mon-thu 폴백.
export const WEEKDAY_GROUPINGS = ["mon-thu", "mon-tue", "mon-wed-fri", "mon-tue-seq", "none"] as const;
export type WeekdayGrouping = (typeof WEEKDAY_GROUPINGS)[number];

// 과목을 열 때 처음 보이는 시간표 뷰(과목별). 원장 2026-08-06: *"영어는 기본뷰를 잘 안 쓴다"* —
// 과목마다 주로 보는 뷰가 다르므로 **코드에 과목 키를 박지 않고** 학원 설정에서 고른다(운영 enum 규칙).
// ⚠️ 교실뷰(rooms)는 전 과목 지도라 '과목의 기본 뷰'가 될 수 없다 → 선택지에서 뺀다.
// ⚠️ 강사뷰는 허용 과목(영어·강사별시간표 설정 보유)에서만 유효 — 아니면 페이지가 기본뷰로 강등한다.
export const SUBJECT_DEFAULT_VIEWS = ["basic", "integrated", "teacher"] as const;
export type SubjectDefaultView = (typeof SUBJECT_DEFAULT_VIEWS)[number];
export const SUBJECT_DEFAULT_VIEW_LABEL: Record<SubjectDefaultView, string> = {
  basic: "기본뷰",
  integrated: "통합뷰",
  teacher: "강사뷰",
};
export const SUBJECT_DEFAULT_VIEW_OPTIONS: { value: SubjectDefaultView; label: string }[] =
  SUBJECT_DEFAULT_VIEWS.map((v) => ({ value: v, label: SUBJECT_DEFAULT_VIEW_LABEL[v] }));

export const periodTimeSchema = z.object({
  // 교시 이름 — **빈 값 허용**(원장 2026-08-13: *"빈값이면 그냥 표기하고 싶지 않은 것"*).
  // 빈 문자열은 "미입력"이 아니라 **뜻이 있는 값**이다: 소비처가 이름 자리에 시간대만 그린다
  // (내장 교시표처럼 label 키 자체가 없으면 지금처럼 `N교시` 폴백 — periods.ts periodListLabel).
  label: z.string().max(20),
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

// 통합뷰 그룹 배치 **프리셋**(과목별 여러 벌) — "학기 배치"·"방학 배치"처럼 묶음을 여러 개 저장해 두고
// 골라 불러온다(원장 2026-08-06 "여러가지 그룹화로 저장/불러오기"). 지금 적용 중인 배치는 여전히
// integrationGroups 한 벌뿐이고, 프리셋은 **보관함**이다 — 불러오기 = 그 내용을 지금 배치에 복사.
// (프리셋을 '현재'와 링크로 묶지 않는 이유: 링크면 프리셋을 고른 뒤의 임시 수정이 보관본까지 오염시킨다.)
export const integrationGroupPresetSchema = z.object({
  id: z.string().min(1).max(36),
  name: z.string().min(1).max(30),
  groups: z.array(integrationGroupSchema).max(40),
  showOthers: z.boolean().optional(),
  othersTitle: z.string().max(30).optional(),
  // 누가·언제 저장했나 — 불러오기 목록에서 "이거 누가 언제 만든 배치더라"를 알 수 있어야 고를 수 있다
  // (원장 2026-08-06). ⚠️ 이 두 값은 **서버가 찍는다**(saveIntegrationGroups) — 클라가 보낸 값을
  // 그대로 믿으면 남의 이름으로 저장한 것처럼 꾸밀 수 있다. optional인 이유는 이 필드 도입 전 저장분.
  savedBy: z.string().max(40).optional(),
  /** 저장 시각(ISO, UTC). 표시는 Asia/Seoul로 포맷한다. */
  savedAt: z.string().max(40).optional(),
});
export type IntegrationGroupPresetSetting = z.infer<typeof integrationGroupPresetSchema>;

// ECS(English Class Sheet) 수업계획 '구분' 영역 — 저장은 영문 slug(key), 라벨은 설정(라벨을 바꿔도
// 저장된 계획 행의 key는 불변 = orphan 방지, subjects[].key와 동일 원칙). english는 미설정 시
// resolveSkillAreas(skill-areas.ts)가 기본 6영역(Vocab~Speaking)을 프리필한다.
export const skillAreaSchema = z.object({
  key: z.string().min(1).max(24).regex(/^[a-z0-9_]+$/, "영문 소문자·숫자·_"),
  label: z.string().min(1).max(24),
  // 영역 색 — 계획 화면에서 "아 보카네" 하고 한눈에 갈리게(원장 지시 2026-07-31). 과목 색과 같은 팔레트.
  // optional인 이유: 이미 저장된 설정(색 없음)도 그대로 통과해야 하고, 미설정은 skillAreaColorOf가
  // 기본 6영역 색 → 순번 회전으로 채운다(색 없는 화면이 되지 않게).
  color: z.enum(SUBJECT_COLORS).optional(),
});
export type SkillAreaSetting = z.infer<typeof skillAreaSchema>;

// 월간 계획서(MP) 인쇄물의 머리말·꼬리말 — 원본 구글 시트가 반이 달라도 같은 문구를 쓰므로 과목 단위로
// 둔다. 미설정 폴백은 resolveMonthPlanTexts(month-plan-texts.ts) — skillAreas와 같은 규약.
// 🔴 소비처 = (print)/ecs/[classId]/month-plan. 소비처 없이 칸만 늘리지 말 것.
export const monthPlanTextsSchema = z.object({
  bookLegend: z.string().max(200),
  notices: z.string().max(600),
  // 세션 줄 바로 아래 한 줄(시트: "발음은 정확하게! 큰 소리로! 자신감있게!").
  // ⚠️ `.optional()` — 이 칸이 생기기 전에 저장된 monthPlan 행이 통째로 검증에 걸리지 않게 한다
  //    (미설정은 resolveMonthPlanTexts가 기본값으로 채운다).
  slogan: z.string().max(120).optional(),
  prepTitle: z.string().max(80),
  prepNotes: z.string().max(600),
});
export type MonthPlanTextsSetting = z.infer<typeof monthPlanTextsSchema>;

export const subjectSchema = z.object({
  key: z.string().min(1).max(24).regex(/^[a-z0-9_]+$/, "영문 소문자·숫자·_"),
  label: z.string().min(1).max(24),
  color: z.enum(SUBJECT_COLORS).default("neutral"),
  // 시간표 기본뷰 요일 병합. 기본 프리셋 id 또는 학원이 만든 묶음 id.
  // 문자열인 이유: 만든 묶음 id는 코드 enum에 없다. 없는 id는 읽을 때 월·목/화·금으로 떨어진다.
  weekdayGrouping: z.string().min(1).max(40).default("mon-thu"),
  // 이 과목을 열 때 처음 보이는 시간표 뷰. 미설정 = 기본뷰(지금까지의 동작).
  // (.optional() — 예외 플래그 관례. 안 적은 과목은 지금과 완전히 같게 동작한다.)
  defaultView: z.enum(SUBJECT_DEFAULT_VIEWS).optional(),
  // 일일·확인테스트 문항수(만점) — 원스크린 점수 입력의 /N. 기본 5. (강사 변경 허용은 report.allowTeacherTestMax.)
  testMax: z.number().int().min(1).max(100).default(5),
  // 과목 전용 평일 교시(미설정/빈 배열 = 폴백: 영어=내장 11교시, 그 외=전역 평일 교시). 주말은 전역 공통.
  weekdayPeriods: z.array(periodTimeSchema).max(20).optional(),
  // QR 공개접수 폼의 '상담 희망 과목'에서 숨긴다(true = 학부모에게 안 보임). 재원생 대상 반(예: 수학(심화))처럼
  // 신규 상담으로 받지 않는 과목용. 미설정/false = 노출(기존 동작 유지). 내부 화면·시간표엔 영향 없음.
  // (.default(false)가 아니라 .optional() — 예외 플래그라 과목마다 적어넣게 만들지 않는다. weekdayPeriods와 동일.)
  hiddenFromIntake: z.boolean().optional(),
  // 원생상담 의무(직원 평가 · 원장 2026-10-19) — false = 그 과목에서 학생을 **가장 많은 요일 맡은 선생님만** 의무(같으면 모두).
  // true = 학생이 다니는 반의 **수업 담당**(반에 '담당'으로 세팅된 선생님) 모두. 미설정 = 영어(english)는 수업 담당, 그 밖은 요일 많은 선생님
  // (원장 2026-10-19 *"영어과목은 '담당'으로 수업에서 세팅된 선생님"* — 영어는 원어민이 교시를 많이 맡는다). 판정 = `counselByClassTeacher`.
  counselAllHomerooms: z.boolean().optional(),
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
  // 강사뷰 컬럼(강사) 순서 — 여기 적힌 라벨이 적힌 순서대로 왼쪽부터. 미설정/목록 밖 강사는 시트 미러
  // 순서 → 이름순으로 뒤에 붙고, **자리(JJ·LAB)는 명시하지 않는 한 항상 최우측**(원장 2026-08-04).
  teacherViewOrder: z.array(z.string().min(1).max(40)).max(80).optional(),
  // 강사뷰 세로 밀도(분당 px). 격자 한 칸(step분) 높이 = step × 이 값. 미설정 = DEFAULT_TEACHER_VIEW_PX_PER_MIN(1.4).
  teacherViewPxPerMin: z.number().min(0.5).max(6).optional(),
  // 통합뷰 커스텀 그룹(섹션) 정의. 비었으면 지금까지처럼 "N교시 시작" 자동 그룹.
  integrationGroups: z.array(integrationGroupSchema).max(40).optional(),
  // 커스텀 그룹을 실제로 적용할지. false·미설정 = 자동 그룹(정의는 남겨둔다 — 껐다 켜도 배치가 안 날아간다).
  integrationGroupsEnabled: z.boolean().optional(),
  // 어느 그룹에도 없는 반을 맨 아래 '기타' 섹션으로 보여줄지. 미설정 = 보여줌(반이 조용히 사라지면 안 된다).
  integrationShowOthers: z.boolean().optional(),
  integrationOthersTitle: z.string().max(30).optional(),
  // 저장해 둔 그룹 배치들(보관함). 현재 적용 배치(integrationGroups)와 별개 — 불러오기로 복사해 쓴다.
  integrationGroupPresets: z.array(integrationGroupPresetSchema).max(MAX_GROUP_PRESETS).optional(),
  // ECS 수업계획 '구분' 영역 목록(과목별). 미설정 = english만 기본 6영역 프리필(resolveSkillAreas),
  // 그 외 과목은 빈 목록(= ECS 진입 대상 아님). (.optional() — 예외 필드 관례, weekdayPeriods와 동일.)
  skillAreas: z.array(skillAreaSchema).max(20).optional(),
  // 월간 계획서(MP) 인쇄물 문구. 미설정 = resolveMonthPlanTexts의 기본값(범례만 채워져 있고 나머지는
  // 빈 채라 그 블록이 인쇄에서 통째로 생략된다). (.optional() — 예외 필드 관례, skillAreas와 동일.)
  monthPlan: monthPlanTextsSchema.optional(),
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
  logoText: z.string().max(12), // 사이드바 워드마크(기본 "AYWA")
  brandColor: z.string().max(24),
  logoUrl: z.string().max(400), // 로고 이미지 URL(호스팅 주소). 인쇄물 머리글. 파일 업로드 UI는 후속.
  sealUrl: z.string().max(400), // 직인/도장 이미지 URL. 인쇄물 하단.
  // 법인명 — 급여명세서 머리글의 '회사명'. 학원명(name)과 다를 수 있다(실제: 학원 "인재원" / 법인
  // "(주) 곰돌이 (강의하는아이들인재원)"). 비우면 name으로 폴백한다. 소비처 = 급여명세서 인쇄.
  legalName: z.string().max(80),
  // 급여명세서 서명란 '담당'에 인쇄할 이름(여러 명이면 줄바꿈). 비우면 그 칸은 빈 서명란으로 남는다.
  payslipSigners: z.string().max(120),
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

const weekdayNameSchema = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

/** 학원이 만든 요일 병합. id는 과목의 weekdayGrouping이 가리킨다. 월~금은 빠짐없이, 토·일은 넣은 것만. */
export const customWeekdayGroupingSchema = z.object({
  id: z.string().regex(/^c_[a-z0-9]{6,24}$/),
  groups: z.array(z.array(weekdayNameSchema).min(1).max(7)).min(1).max(7),
});
export type CustomWeekdayGrouping = z.infer<typeof customWeekdayGroupingSchema>;

export const operationsSchema = z
  .object({
    subjects: z.array(subjectSchema).max(40),
    // 과목 드롭다운에 더해지는 요일 병합. 비어 있으면 기본 다섯 개만. 기본값 []이라 옛 저장도 통과한다.
    weekdayGroupings: z.array(customWeekdayGroupingSchema).max(20).default([]),
    // 기본 묶음은 시간표 해석 규칙을 남겨 두고 과목 드롭다운에서만 숨긴다. 옛 저장에는 없는 필드.
    hiddenBuiltinWeekdayGroupings: z.array(z.enum(WEEKDAY_GROUPINGS)).max(WEEKDAY_GROUPINGS.length).default([]),
    jobTitles: z.array(z.string().min(1).max(24)).max(40),
    /**
     * 부서별 직급 선택지(2026-07-29 원장 지시) — 이력서 '근무부서'를 고르면 직급 드롭다운이 그 부서 것으로 바뀐다.
     * 키 = 근무부서명(`RESUME_DEPARTMENTS`), 값 = 그 부서의 직급들. 부서에 항목이 없으면 위 `jobTitles`(공통)로 폴백.
     * 값이 정확히 1개면 그 직급으로 **자동 확정**(아르바이트 부서 = 직급 '아르바이트').
     */
    jobTitlesByDepartment: z.record(z.string(), z.array(z.string().min(1).max(24)).max(40)),
    gradeLevels: z.array(z.string().min(1).max(24)).max(60),
    // 교시 방식 — "chinsan"(첫 학원: 영어가 아닌 과목은 두 교시를 한 교시로 묶고 1-1·1-2, 영어는 내장 11교시 폴백) /
    // "plain"(새 학원: 모든 과목이 교시마다 한 줄). 소비처 = settingsToPeriodsConfig(periods.ts). 2026-09-22 방향 B.
    // 🔴 기본값("chinsan")을 두는 이유: 배포 순간 열려 있던 옛 화면이 이 칸 없이 저장해도 거절하지 않는다(침산 보호).
    periodStyle: z.enum(["chinsan", "plain"]).default("chinsan"),
    // 학교명 저장 별칭(`일중` → `대구일중`) — 저장 경로가 canonicalSchoolName에 넘긴다. 침산 기본값은 한 줄, 새 학원은 빈 목록.
    // 배열 그릇인 이유: deepMerge가 record의 새 키를 떨어뜨린다(navigation과 같은 이유).
    // 기본값 = 침산 목록(옛 화면이 칸 없이 저장한 경우 — 저장 액션이 침산 기본값과 같은 값은 행에 안 남긴다).
    schoolSaveAliases: z
      .array(z.object({ from: z.string().trim().min(1).max(40), to: z.string().trim().min(1).max(60) }))
      .max(50)
      .default(() => CHINSAN_SCHOOL_SAVE_ALIASES.map((a) => ({ ...a }))),
    weekdayPeriods: z.array(periodTimeSchema).max(20),
    weekendPeriods: z.array(periodTimeSchema).max(20),
    terms: z.array(termSchema).max(20),
    holidays: z.array(holidaySchema).max(200),
    shuttle: shuttleSchema,
    /**
     * 자리 출석부 공개 PIN — 비로그인 태블릿(`/seat/lab`·`/seat/jj`)에서 입력.
     * **비우면 그 자리 공개 접속이 꺼진다**(기본값은 defaults, 랩실·JJ실 모두 0000 — 원장 2026-09-22, 종전 7099).
     *
     * ⚠️ `jj`는 `.optional()` — 이 칸이 없는 **옛 폼 번들**이 저장을 보내도 ① 운영 섹션 전체가 거부되지
     *    않고 ② 키가 빠진 채 저장돼 resolve가 기본값으로 채우므로 **이미 열린 문이 조용히 닫히지 않는다**.
     *    원장이 실제로 지우면 빈 문자열이 저장돼 그때는 닫힌다(그게 의도된 끄기 방법).
     */
    seatPins: z.object({
      lab: z.string().max(12),
      jj: z.string().max(12).optional(),
    }),
  })
  .superRefine((v, ctx) => {
    // 과목 중복 방지(저장 거부) — 내부 키·과목명(라벨) 모두 유일해야 한다. 클라 편집기 경고와 이중 방어.
    const keys = new Set<string>();
    const labels = new Set<string>();
    v.subjects.forEach((s, i) => {
      const k = s.key.trim();
      if (k && keys.has(k)) {
        // 내부 식별자를 문구에 싣지 않는다 — 사용자가 아는 것은 과목 이름이다.
        ctx.addIssue({
          code: "custom",
          message: "다른 과목과 같은 과목으로 저장되어 있습니다. 이 과목 줄을 지우고 다시 추가해 주세요",
          path: ["subjects", i, "key"],
        });
      }
      keys.add(k);
      const l = s.label.trim();
      if (l && labels.has(l)) {
        ctx.addIssue({ code: "custom", message: `과목명이 중복됩니다: ${l}`, path: ["subjects", i, "label"] });
      }
      labels.add(l);
      // ECS 영역(skillAreas) 중복 방지 — 과목 안에서 key·라벨 모두 유일해야 한다.
      if (s.skillAreas) {
        const areaKeys = new Set<string>();
        const areaLabels = new Set<string>();
        s.skillAreas.forEach((a, j) => {
          const ak = a.key.trim();
          if (ak && areaKeys.has(ak)) {
            ctx.addIssue({
              code: "custom",
              message: "다른 영역과 같은 영역으로 저장되어 있습니다. 이 영역 줄을 지우고 다시 추가해 주세요",
              path: ["subjects", i, "skillAreas", j, "key"],
            });
          }
          areaKeys.add(ak);
          const al = a.label.trim();
          if (al && areaLabels.has(al)) {
            ctx.addIssue({ code: "custom", message: `영역 이름이 중복됩니다: ${al}`, path: ["subjects", i, "skillAreas", j, "label"] });
          }
          areaLabels.add(al);
        });
      }
    });
    const groupingIds = new Set<string>();
    const groupingKeys = new Set<string>();
    v.weekdayGroupings.forEach((grouping, i) => {
      if (groupingIds.has(grouping.id)) {
        ctx.addIssue({ code: "custom", message: "요일 병합 ID가 중복됩니다", path: ["weekdayGroupings", i, "id"] });
      }
      groupingIds.add(grouping.id);
      const parsed = parseWeekdayPartition(grouping.groups);
      if (!parsed) {
        ctx.addIssue({
          code: "custom",
          message: "월~금을 빠짐없이, 한 번씩만 나누세요",
          path: ["weekdayGroupings", i, "groups"],
        });
        return;
      }
      const key = weekdayPartitionKey(parsed);
      if (groupingKeys.has(key)) {
        ctx.addIssue({ code: "custom", message: "같은 요일 병합이 이미 있습니다", path: ["weekdayGroupings", i] });
      }
      groupingKeys.add(key);
    });
    const hidden = new Set(v.hiddenBuiltinWeekdayGroupings);
    if (hidden.size !== v.hiddenBuiltinWeekdayGroupings.length) {
      ctx.addIssue({ code: "custom", message: "숨긴 요일 병합이 중복됩니다", path: ["hiddenBuiltinWeekdayGroupings"] });
    }
    if (WEEKDAY_GROUPINGS.length - hidden.size + v.weekdayGroupings.length === 0) {
      ctx.addIssue({ code: "custom", message: "요일 병합 선택지를 하나 이상 남겨 주세요", path: ["hiddenBuiltinWeekdayGroupings"] });
    }
    v.subjects.forEach((subject, i) => {
      const chosen = subject.weekdayGrouping;
      if (hidden.has(chosen as WeekdayGrouping)) {
        ctx.addIssue({
          code: "custom", message: "사용 중인 요일 병합은 목록에서 뺄 수 없습니다", path: ["subjects", i, "weekdayGrouping"],
        });
        return;
      }
      if ((WEEKDAY_GROUPINGS as readonly string[]).includes(chosen) || groupingIds.has(chosen)) return;
      ctx.addIssue({
        code: "custom",
        message: "없는 요일 병합입니다",
        path: ["subjects", i, "weekdayGrouping"],
      });
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
  sessionPrices: z.array(z.object({
    price: z.number().int("단가는 원 단위 정수로 입력해 주세요").positive("단가는 0원보다 커야 합니다").max(1_000_000_000),
    label: z.string().trim().max(80),
  })).max(100).superRefine((rows, ctx) => {
    const seen = new Set<number>();
    rows.forEach((row, index) => {
      if (seen.has(row.price)) ctx.addIssue({
        code: "custom", path: [index, "price"], message: "같은 금액은 하나만 등록해 주세요",
      });
      seen.add(row.price);
    });
  }).default(() => DEFAULT_SESSION_PRICES.map((row) => ({ ...row }))),
  eieMonthlyPrice: z.number().int().positive("EiE 월 수강료는 0원보다 커야 합니다").max(1_000_000_000)
    .default(DEFAULT_EIE_MONTHLY_PRICE),
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
        // 내부 식별자를 문구에 싣지 않는다 — 어느 양식인지는 오류 문구가 그 줄의 이름으로 가리킨다(settings-error.ts).
        ctx.addIssue({
          code: "custom",
          message: "다른 양식과 같은 양식으로 저장되어 있습니다. 이 양식 줄을 지우고 다시 추가해 주세요",
          path: ["templates", i, "key"],
        });
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
  // 보고서 전용 로고(원장 2026-10-26 *"시지입시관 이름 빼"* — 학원 로고엔 지점명이 박혀 있다). 비우면 학원 로고(profile.logoUrl).
  // 소비처 = reportLogoPath() → /r 공유 페이지 · 보고서 인쇄 · 원스크린 미리보기.
  logoUrl: z.string().max(400).default(""),
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
  // 오늘 수학 채점 결과로 원스크린 수학 행의 일일·확인테스트 빈칸 채우기(2026-10-17 · 개발 중 — 원장 *"원장 설정에서 오늘의
  // 수학 탭에서 토글 온 되어있어야 연동되게"*). 기본 꺼짐. 지점 라이선스(todays_math)도 켜져 있어야 동작한다.
  // 화면 = 학원 설정 → 연동 → 오늘 수학 · 소비처 = onescreen/server/todays-math-fill.ts(로스터).
  todaysMathTestFill: z.boolean().default(false),
  // 오늘 수학 월말평가 결과로 성적관리 수학 월말평가 빈칸 채우기(2026-10-17 · 개발 중 — 원장 *"같은 탭에 토글로"*). 기본 꺼짐.
  // 자동 저장이 아니다 — 성적 입력 화면에 '채우기' 단추가 서고, 저장은 선생님이 평소처럼 누른다(저장 단일 경로 writeGradeCells).
  // 소비처 = exams/input/page.tsx → features/grades/server/todays-math-monthly.ts.
  todaysMathMonthlyFill: z.boolean().default(false),
  // 오늘 수학 월말평가 성적표(확정된 PDF)를 그 학생의 그날 수학 보고서 첨부에 붙이기(2026-10-18 · 개발 중 — 원장 *"오늘 수학에
  // 완성되면 pdf 첨부하는 방향으로"*). 기본 꺼짐 · 지점 라이선스(todays_math)도 켜져 있어야 동작한다. 안 보낸 보고서에만 붙는다.
  // 소비처 = integrations/todays-math/exam-report-attach.ts(결과 동기화 뒤 · 0373a).
  todaysMathReportPdf: z.boolean().default(false),
  // 영상 제출 검사 대상 — 과목·학생 학교급·반 중 하나라도 꺼지면 강사 체크와 관리자 당일 명단에서 제외.
  // 기존 검사 이력은 보존한다. 옛 설정에는 키가 없으므로 전체 사용으로 폴백한다.
  videoHomeworkPolicy: z.object({
    enabled: z.boolean(),
    disabledSubjectKeys: z.array(z.string().min(1).max(24)).max(40),
    disabledSchoolLevels: z.array(z.enum(["elem", "middle", "high", "preschool", "etc"])).max(5),
    disabledClassIds: z.array(z.string().uuid()).max(1000),
  }).default(DEFAULT_VIDEO_HOMEWORK_POLICY),
  // 🔴 테스트 점수 표기 모드(0148a `dailyTestScoreMode`/`checkTestScoreMode`)는 **제거됐다**(원장 2026-08-11
  //    "점은 제거하고 갯수로만"). 표기는 "20문제 중 18개 맞음" 하나뿐이다(report-comment.ts formatTestScore).
  //    저장된 jsonb에 옛 키가 남아 있어도 읽는 곳이 없다 — 다시 만들지 말 것.
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
  // (옛 '수학 발송 경로' `classnoteMathRoute`·`classnoteMathRoutePilot`는 2026-11-05에 걷었다 — 수학은 반별 발송 하나뿐.
  //  저장돼 있던 값은 이 스키마가 모르는 키라 다음 보고서 설정 저장 때 빠진다. 워커도 그 값을 읽지 않는다.)
  // 학부모 글·댓글에 답글·공감(0317a·0319a, 원장 2026-10-01) — aywa에서 쓰면 연동 PC가 ClassNote 그 글에 올린다.
  // off = 없는 기능(버튼·면·서버·워커 전부) · test = 학원이 테스트 보드의 학원이 글에만 · on = 확정 연결이 맞는 모든 글.
  // 🔴 기본 off(학부모에게 바로 알림이 가는 쓰기라 원장이 켜기 전엔 아무것도 안 나간다). 값은 이 셋뿐이다.
  // 소비처 = 앱 `classnoteReplyMode`(classnote-gate.ts — 모듈이 꺼지면 off) + 워커 `loadReplyMode`
  // (classnote-parent-reply-core.mjs, raw SQL 직독 — 폴마다 다시 읽어 끄면 곧 멈춘다).
  classnoteParentReplyMode: z.enum(["off", "test", "on"]).default("off"),
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
// 개인 예외 — 특정 사용자(users.id)에게만 메뉴 셀을 덮어쓴다(역할 override보다 우선). 소비처 =
// applyUserOverrides(perm-matrix)와 SQL 미러 auth_menu_access(0170a). 선례: 직원관리를 원장+개발팀
// 4인으로 좁히기(2026-08-01 — 설현·이승엽은 admin이라 역할 축으론 다른 관리자와 구분 불가).
export const userPermissionOverrideSchema = z.object({
  userId: z.string().uuid(),
  menu: z.enum(MENU_KEYS as unknown as [MenuKey, ...MenuKey[]]),
  access: accessEnum,
});
/** 직원관리 과목 범위 한 줄 — 이 사람은 직원관리에서 고른 과목의 선생님만 본다(과목 키 = `operations.subjects[].key`). */
const staffSubjectScopeSchema = z.object({
  userId: z.string().uuid(),
  subjects: z.array(z.string().trim().min(1).max(64)).min(1, "과목을 하나 이상 골라 주세요").max(30),
});
/**
 * 개인별 기능 권한 — 메뉴 권한과 별개로 **사람을 지정해서** 여는 기능(원장 2026-10-06 *"개인 역할은 전부다 편집기"*).
 * 코드에 계정 명단을 두지 않는다 — 급여명세서 열람 · 연차 조정 · 수업 나누기 · 직원관리 과목 범위가 전부 여기서 정해진다.
 * 🔴 칸을 더하면 함께 고칠 곳: 기본값 둘(defaults · generic-defaults) · 기준 token(permissions-canonical) · 운영 계정 보호(platform-settings)
 *    · 옛 화면 저장 보존(preset.ts prepareSectionForSave — 요청에 없던 칸은 저장값을 지킨다) · 변경 내역 라벨(settings-diff).
 */
const specialAccessSchema = z.object({
  payslipViewerIds: z.array(z.string().uuid()).max(80).default([]),
  // Optional for old forms; absence in persisted settings preserves the previous viewers' management.
  payslipManagerIds: z.array(z.string().uuid()).max(80).optional(),
  leaveAdjusterIds: z.array(z.string().uuid()).max(80).default([]),
  classSplitterIds: z.array(z.string().uuid()).max(80).default([]),
  // 새 칸을 모르는 화면·기존 저장값과 호환. 미지정은 빈 명단과 같다.
  enrollmentDateEditorIds: z.array(z.string().uuid()).max(80).optional(),
  // Raw absence preserves legacy operators until the owner explicitly switches to a list.
  studentStatusManagerIds: z.array(z.string().uuid()).max(80).optional(),
  // 업무 처리 현황(모든 직원의 할 일 · 0377a) — 원장 역할은 지정 없이 본다. 새 칸이라 옛 화면·저장값엔 없다(없음 = 빈 명단).
  // 소비처 = `getStaffTaskViewer`(staff-tasks/server/gate.ts).
  staffTaskMonitorIds: z.array(z.string().uuid()).max(80).optional(),
  // 업체리스트 — 2026-10-28부터 안 읽는다(재고관리를 여는 직원 전원이 본다 · `canViewVendorsNow`). 저장된 값을 깨지 않으려 칸만 남긴다.
  vendorViewerIds: z.array(z.string().uuid()).max(80).optional(),
  // JJ 보고서 담당(원장 2026-10-26 *"jj관리자로 해서 수업보고서 쓸수있게 · 영어 jj는 김동후"*) — 그날 JJ 자리 교시가 있는 반의
  // 수업보고서를 원스크린에서 쓸 수 있다(시간표 JJ 칸은 그대로 — 담당을 채우면 자리 판정이 깨진다). 없음 = 아무도 아니다.
  // 소비처 = `getTeachingClassIds`·`getTeachingClasses`(classes/server/delegation.ts)의 JJ 갈래.
  jjReportManagerIds: z.array(z.string().uuid()).max(80).optional(),
  // 비포클래스 보고서 표(원장 2026-11-02 *"전체선생님이 아니라 이수진 선생님만 보고서에"*) — 여기 지정한 선생님이 쓰는
  // 수학 보고서에만 '수업 평가' 표에 비포클래스체크리스트 줄을 붙인다(체크리스트 반 · 그날 체크가 있을 때). 없음 = 아무도 아니다
  // (테스트 학생 보고서는 종전대로 붙는다). 소비처 = `beforeClassReportEnabled`(before-class/server/report-rows.ts).
  beforeClassReportIds: z.array(z.string().uuid()).max(80).optional(),
  // 퇴원보고서 승인자(원장 2026-10-30 *"관리자는 수학의 경우 허은진 부원장 한명만 승인하면 끝나도록"*) — 과목 단위로 좁힌다:
  // 여기 지정한 사람이 승인 담당인 과목은 그 사람들만 관리자 승인 후보, 지정한 사람이 없는 과목은 종전대로 그 과목 관리자 전원.
  // 없음 = 빈 명단 = 종전 그대로. 소비처 = `reportStaff`(withdrawal-reports/server/queries.ts) → `narrowApprovalSubjects`.
  withdrawalApproverIds: z.array(z.string().uuid()).max(80).optional(),
  // 퇴원보고서 데스크 담당자(원장 2026-11-06 *"데스크 담당자는 학원 설정에서 지정"*) — 퇴원보고서에서 원장이 환불을 승인할 때 고르는 데스크 담당은
  // 여기 지정한 사람(그중 수납 쓰기 권한이 있는 사람 — `billingWriters`)만. 없음 = 빈 명단 = 환불 승인을 막는다(원장 등으로 대신하지 않는다).
  // 소비처 = `loadDeskStaff`(withdrawal-reports/server/refund.ts) · DB `attach_withdrawal_report_refund`(s2_0033 — 같은 칸을 읽는다).
  withdrawalDeskIds: z.array(z.string().uuid()).max(80).optional(),
  staffSubjectScopes: z.array(staffSubjectScopeSchema).max(80).default([]),
});
/** 사람 id 목록인 칸(과목 범위는 줄 모양이 달라 따로 다룬다). */
export const SPECIAL_ACCESS_ID_LISTS = ["payslipViewerIds", "payslipManagerIds", "leaveAdjusterIds", "classSplitterIds", "enrollmentDateEditorIds", "studentStatusManagerIds", "staffTaskMonitorIds", "vendorViewerIds", "jjReportManagerIds", "beforeClassReportIds", "withdrawalApproverIds", "withdrawalDeskIds"] as const;
export const permissionsSchema = z
  .object({
    overrides: z.array(permissionOverrideSchema).max(MENU_KEYS.length * SYSTEM_ROLES.length),
    // .default([]) — 기존 저장분(키 없음)이 그대로 파싱되도록. 폼 저장 시엔 payload가 이 키를
    // 관통시켜야 한다(permissions-section) — 빠뜨리면 매트릭스 저장 한 번에 개인 예외가 전멸한다.
    userOverrides: z.array(userPermissionOverrideSchema).max(80).default([]),
    // 사람을 지정해서 여는 기능(어느 학원에서나) — 메뉴 권한과 별개의 문이다.
    specialAccess: specialAccessSchema.default({ payslipViewerIds: [], leaveAdjusterIds: [], classSplitterIds: [], staffSubjectScopes: [] }),
  })
  .superRefine((v, ctx) => {
    // 가드레일을 스키마에서 강제(저장 자체 거부) — resolveMatrix 적용 단계와 이중 방어.
    if ([...v.overrides, ...v.userOverrides].some((r) => r.menu === "teacher_view" && r.access === "scoped")) {
      ctx.addIssue({ code: "custom", message: "강사뷰 접근은 전체·읽기·없음 중에서 선택해 주세요" });
    }
    // ⚠️ 연결 앱 칸의 '담당'·'읽기'(전체·없음만 — 원장 2026-11-05)는 **여기서 보지 않는다** — 아래 '담당' 주석과 같은 까닭이다(이 스키마는 저장된 값도 읽는다).
    //    저장 액션(saveOwnerSection)이 요청 값만 보고 거절하고, 저장돼 있던 그런 칸은 적용 단계가 건너뛴다(isPermissionLocked).
    for (const r of v.overrides) {
      if (r.menu === "teacher_onescreen" || r.menu === "my_learning") {
        ctx.addIssue({ code: "custom", message: "역할 전용 화면(원스크린/내 학습)은 편집할 수 없습니다" });
      }
      if (r.role === "student") {
        ctx.addIssue({ code: "custom", message: "학생 계정은 '내 학습' 전용이라 메뉴 권한을 줄 수 없습니다" });
      }
      // ⚠️ 강사보다 낮은 직급의 '담당'(원장 2026-11-05)은 **여기서 보지 않는다** — 이 스키마는 이미 저장된 값을 읽는 데도 쓰여서
      //    (운영 설정 보호 검사 `platformSettingsError`), 그런 칸이 저장돼 있는 학원은 역할·권한을 아예 저장할 수 없게 된다(리뷰 2026-11-05).
      //    저장 액션(saveOwnerSection)이 **요청 값만** 보고 같은 문구로 거절한다(같은 칸 중복 검사와 같은 자리).
      if (r.role === "master" && (r.menu === "owner" || r.menu === "admin" || r.menu === "dashboard") && r.access === "none") {
        ctx.addIssue({
          code: "custom",
          message: `원장의 ${MENU_LABEL.owner} · ${MENU_LABEL.admin} · ${MENU_LABEL.dashboard} 접근은 잠글 수 없습니다`,
        });
      }
    }
    for (const r of v.userOverrides) {
      // 역할 전용 화면은 개인 예외로도 못 연다(applyUserOverrides의 isPermissionLocked와 동일 규약 —
      // 역할별 가드는 적용 시점에 그 사용자의 실제 역할로 한 번 더 걸린다).
      if (r.menu === "teacher_onescreen" || r.menu === "my_learning") {
        ctx.addIssue({ code: "custom", message: "역할 전용 화면(원스크린/내 학습)은 개인 예외로 편집할 수 없습니다" });
      }
    }
    for (const key of SPECIAL_ACCESS_ID_LISTS) {
      const ids = v.specialAccess[key] ?? [];
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: "custom", message: "담당자를 중복 지정할 수 없습니다" });
      }
    }
    const scoped = v.specialAccess.staffSubjectScopes.map((r) => r.userId);
    if (new Set(scoped).size !== scoped.length) {
      ctx.addIssue({ code: "custom", message: "같은 사람의 과목 범위를 두 번 지정할 수 없습니다" });
    }
    if (v.specialAccess.staffSubjectScopes.some((r) => new Set(r.subjects).size !== r.subjects.length)) {
      ctx.addIssue({ code: "custom", message: "과목 범위에 같은 과목을 두 번 넣을 수 없습니다" });
    }
    const menuCells = v.userOverrides.map((r) => `${r.userId}:${r.menu}`);
    if (new Set(menuCells).size !== menuCells.length) {
      ctx.addIssue({ code: "custom", message: "같은 사람의 같은 메뉴 예외를 중복 지정할 수 없습니다" });
    }
  });
export type PermissionsSettings = z.infer<typeof permissionsSchema>;

// === 탭 및 메뉴 구성(관리자뷰 사이드바 + 강사뷰 '내 메뉴') — 보기 설정, 권한 아님 ===
// 규약·적용은 [`menu-layout.ts`](./menu-layout.ts) 단일 소스. 여기 담기는 건 **바뀐 줄만**(sparse)이고,
// 비어 있으면 지금과 똑같이 동작한다(전부 표시·코드 순서). 판정 단위가 menuKey가 아니라 목적지 주소인
// 이유도 그 파일에 적혀 있다(한 메뉴가 버튼 여럿을 갖는다 — 출석부 3면·설정 11면…).
const menuOrderSchema = z.object({
  href: z.string().min(1).max(120).regex(/^\//, "앱 안 주소여야 합니다"),
  hidden: z.boolean().optional(),
  order: z.number().int().min(0).max(199).optional(),
});
const menuIconSchema = z.custom<AywaIconName>((v) => typeof v === "string" && hasMenuGlyph(v), "목록에서 아이콘을 선택해 주세요");
const groupIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/, "탭 식별자가 올바르지 않습니다");
export const menuLayoutRowSchema = menuOrderSchema.extend({
  label: z.string().trim().min(1, "메뉴 이름을 입력해 주세요").max(40).optional(),
  icon: menuIconSchema.optional(),
  groupId: groupIdSchema.optional(),
});
const menuGroupSchema = z.object({
  id: groupIdSchema,
  label: z.string().trim().min(1, "탭 이름을 입력해 주세요").max(24).optional(),
  icon: menuIconSchema.optional(),
  order: z.number().int().min(0).max(MAX_NAV_GROUPS - 1).optional(),
  hidden: z.boolean().optional(),
});
export const navigationSchema = z
  .object({
    // 상한은 목적지 총수보다 넉넉히 — 목적지가 늘어도 저장이 막히지 않게(지금 47개).
    menus: z.array(menuLayoutRowSchema).max(200),
    groups: z.array(menuGroupSchema).max(MAX_NAV_GROUPS).optional(),
    // 강사뷰 '내 메뉴' 구성(원장 2026-09-22 *"'관리자뷰' '강사뷰' 메뉴를 따로 구성할 수 있게"*) — 규약은 menus와 같다
    // (sparse · 목적지 단위 · 권한 아님, 적용 = teacher-navigation.ts). 기본값이 있어 배포 순간 열린
    // 옛 화면이 이 칸 없이 저장해도 거절하지 않는다 — 그 경우 저장돼 있던 값을 지킨다(preset.ts `prepareSectionForSave`).
    teacherMenus: z.array(menuLayoutRowSchema).max(60).default([]),
    teacherGroups: z.array(menuGroupSchema).max(MAX_NAV_GROUPS).optional(),
  })
  .superRefine((v, ctx) => {
    const knownGroups = new Set([...HUB_GROUPS, ...SUPPORT_GROUPS].map((g) => g.id));
    const knownHrefs = new Set([...HUB_GROUPS, ...SUPPORT_GROUPS].flatMap((g) => g.items.map((d) => d.href)));
    const menuLabelOf = new Map([...HUB_GROUPS, ...SUPPORT_GROUPS].flatMap((g) => g.items.map((d) => [d.href, d.label] as const)));
    const groupIds = new Set<string>();
    for (const g of v.groups ?? []) {
      if (groupIds.has(g.id)) ctx.addIssue({ code: "custom", message: "같은 탭이 두 번 담겼습니다" });
      groupIds.add(g.id);
      if (FIXED_GROUP_IDS.has(g.id)) ctx.addIssue({ code: "custom", message: "대시보드·설정·고객센터는 고정 탭입니다" });
      if (!knownGroups.has(g.id) && (!g.id.startsWith("custom-") || !g.label)) ctx.addIssue({ code: "custom", message: "새 탭의 이름을 입력해 주세요" });
    }
    const seen = new Set<string>();
    for (const r of v.menus) {
      if (seen.has(r.href)) {
        // 주소 대신 그 메뉴의 이름을 적는다(모르는 주소면 이름 없이).
        const name = menuLabelOf.get(r.href);
        ctx.addIssue({ code: "custom", message: `같은 메뉴가 두 번 담겼습니다${name ? ` (${name})` : ""}` });
      }
      seen.add(r.href);
      if ((r.label || r.icon || r.groupId) && !knownHrefs.has(r.href)) ctx.addIssue({ code: "custom", message: "현재 사용할 수 없는 메뉴입니다. 화면을 새로고침해 주세요" });
      if (isFixedDestination(r.href) && (r.label || r.icon || r.groupId)) ctx.addIssue({ code: "custom", message: "기본 사용 메뉴는 이름·아이콘·탭을 바꿀 수 없습니다" });
      if (r.groupId && (FIXED_GROUP_IDS.has(r.groupId) || (!knownGroups.has(r.groupId) && !groupIds.has(r.groupId)))) ctx.addIssue({ code: "custom", message: "메뉴를 넣을 탭을 다시 선택해 주세요" });
      // 자기잠금 방지 — 적용 단계(isMenuHiddenByLayout)와 이중 방어(DB 직접 변조 대비).
      if (r.hidden && isLayoutHideLocked(r.href)) {
        ctx.addIssue({ code: "custom", message: "학원 설정 자신은 사이드바에서 감출 수 없습니다" });
      }
    }
    const teacherGroupIds = new Set([TEACHER_DEFAULT_GROUP]);
    const seenTeacherGroups = new Set<string>();
    for (const g of v.teacherGroups ?? []) {
      if (seenTeacherGroups.has(g.id)) ctx.addIssue({ code: "custom", message: "강사뷰에 같은 탭이 두 번 담겼습니다" });
      seenTeacherGroups.add(g.id);
      teacherGroupIds.add(g.id);
      if (g.id !== TEACHER_DEFAULT_GROUP && (!g.id.startsWith("custom-") || !g.label)) ctx.addIssue({ code: "custom", message: "강사뷰의 새 탭 이름을 입력해 주세요" });
    }
    const teacherHrefs = new Set(TEACHER_NAV_GROUPS.flatMap((g) => g.items.map((d) => d.href)));
    const teacherLabelOf = new Map(TEACHER_NAV_GROUPS.flatMap((g) => g.items.map((d) => [d.href, d.label] as const)));
    const seenTeacher = new Set<string>();
    for (const r of v.teacherMenus) {
      if (seenTeacher.has(r.href)) {
        const name = teacherLabelOf.get(r.href);
        ctx.addIssue({ code: "custom", message: `강사뷰에 같은 메뉴가 두 번 담겼습니다${name ? ` (${name})` : ""}` });
      }
      seenTeacher.add(r.href);
      if ((r.label || r.icon || r.groupId) && !teacherHrefs.has(r.href)) ctx.addIssue({ code: "custom", message: "강사뷰에서 사용할 수 없는 메뉴입니다" });
      if (r.groupId && !teacherGroupIds.has(r.groupId)) ctx.addIssue({ code: "custom", message: "강사뷰 메뉴를 넣을 탭을 다시 선택해 주세요" });
    }
  });
export type NavigationSettings = z.infer<typeof navigationSchema>;

/**
 * 기능 켜기·끄기 — **끈 모듈만** 담는다(비면 전부 켜짐). 모듈 정의·게이트는 `lib/modules.ts`.
 * 배열 그릇인 이유는 navigation과 같다(deepMerge가 base 키만 돌아 record 새 키가 탈락한다 — 배열은 통째 교체).
 */
export const modulesSchema = z.object({
  disabled: z.array(z.enum(MODULE_IDS)).max(MODULE_IDS.length),
});
export type ModulesSettings = z.infer<typeof modulesSchema>;

/**
 * 운영실 배치(학원 설정 '대시보드 관리') — 역할 묶음별 카드 배치(**순서 + 크기**, 좌표 없음 — `features/dashboard/layout/types.ts`).
 * **저장값이 있는 역할만** 담는다(없으면 코드의 기본 배치를 따른다 — 저장 경로가 기본과 같은 역할을 지운다).
 * 배열 그릇인 이유는 navigation·modules와 같다(deepMerge가 base 키만 돌아 record 새 키가 탈락한다 — 배열은 통째 교체).
 * 모르는 카드 id·크기 이탈은 읽을 때·저장할 때 걸러 낸다(`normalize.ts`) — 스키마는 모양과 한도만 본다.
 */
export const dashboardItemSchema = z.object({
  id: z.string().min(1).max(64),
  w: z.number().int().min(1).max(GRID_COLS),
  h: z.number().int().min(1).max(MAX_ROW_SPAN),
  x: z.number().int().min(0).max(GRID_COLS - 1).optional(),
  y: z.number().int().min(0).max(MAX_GRID_Y - 1).optional(),
  mode: z.literal("summary").optional(),
  title: z.string().trim().max(40).optional(),
  note: z.string().trim().max(80).optional(),
  amounts: z.boolean().optional(),
  phones: z.boolean().optional(),
});
export const dashboardRoleLayoutSchema = z.object({
  role: z.enum(BUNDLES),
  subject: z.string().trim().min(1).max(64).optional(),
  items: z.array(dashboardItemSchema).max(MAX_ITEMS),
}).refine((v) => !v.subject || v.role === "subject", "과목별 배치는 과목 관리자에게만 적용됩니다");
export const dashboardAssignmentSchema = z.object({
  userId: z.string().uuid(),
  scope: z.enum(["all", "subjects", "unassigned"]),
  subjects: z.array(z.string().trim().min(1).max(64)).max(100),
  adminLayout: z.enum(["subject", "desk"]),
}).refine((v) => v.scope !== "subjects" || v.subjects.length > 0, "담당 과목을 하나 이상 선택하세요");
export const dashboardSchema = z
  .object({
    version: z.literal(DASHBOARD_VERSION),
    layouts: z.array(dashboardRoleLayoutSchema).max(BUNDLES.length + 100),
    assignments: z.array(dashboardAssignmentSchema).max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    const roles = new Set<string>();
    value.layouts.forEach((layout, i) => {
      const key = `${layout.role}:${layout.subject ?? ""}`;
      if (roles.has(key)) ctx.addIssue({ code: "custom", path: ["layouts", i, "role"], message: "같은 역할·과목의 배치가 두 번 들어 있습니다" });
      roles.add(key);
    });
    const users = new Set<string>();
    value.assignments?.forEach((assignment, i) => {
      if (users.has(assignment.userId)) ctx.addIssue({ code: "custom", path: ["assignments", i, "userId"], message: "같은 직원의 배정이 두 번 들어 있습니다" });
      users.add(assignment.userId);
    });
  });
export type DashboardSettingsData = z.infer<typeof dashboardSchema>;

/**
 * 학원 출발점(프리셋) — `chinsan` = 첫 학원(인재원 침산)의 운영 방식 그대로 / `generic` = 새로 여는 학원의 중립 기본값.
 * 원장 2026-09-22: *"'침산'은 그대로 두고 나머지 모든 지점, 새로 시작하는 지점 포함 … 일반화"* (방향 B).
 * 판정·기본값은 `preset.ts` 한 곳이고, 🔴 다른 코드는 이 값을 직접 읽지 않는다(풀린 설정·모듈·수업 규칙만 본다).
 */
export const TENANT_PRESETS = ["chinsan", "generic"] as const;
export type TenantPreset = (typeof TENANT_PRESETS)[number];

export const tenantSettingsSchema = z.object({
  version: z.literal(1),
  preset: z.enum(TENANT_PRESETS),
  profile: profileSchema,
  operations: operationsSchema,
  billing: billingSchema,
  notifications: notificationsSchema,
  consultations: consultationsSchema,
  report: reportSchema,
  permissions: permissionsSchema,
  navigation: navigationSchema,
  modules: modulesSchema,
  dashboard: dashboardSchema,
  makeups: makeupSettingsSchema,
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
  navigation: navigationSchema,
  modules: modulesSchema,
  dashboard: dashboardSchema,
  makeups: makeupSettingsSchema,
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
  navigation: "탭 및 메뉴 구성",
  modules: "기능 켜기·끄기",
  dashboard: "대시보드 배치",
  makeups: "보강관리 운영",
};
