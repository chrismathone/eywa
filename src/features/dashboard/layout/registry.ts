/**
 * 운영실 카드 **레지스트리 — 단일 소스**. 카드 하나의 이름·읽는 스냅샷 영역·필요한 메뉴 권한·허용 크기·민감 옵션이 여기 한 곳에 있다.
 *
 * 🔴 새 카드를 운영실에 더하면 여기에도 한 줄(가드 `registry.test.ts`가 `PanelId`·KPI 칸·서버 `add()`와 어긋나면 실패시킨다).
 *    빠뜨리면 편집기 갤러리에 안 올라와 "있는데 못 넣는 카드"가 된다(write-only-orphan의 역방향).
 * 🔴 `areas`·`AREA_MENUS`는 서버 `loadOverview`의 `add(area, menus, …)`와 같은 표다 — 배치에 없는 카드의 영역은
 *    서버가 **조회 자체를 하지 않는다**(데이터가 만들어지지 않으면 샌 데이터도 없다).
 * ⚠️ 순수 모듈 — 서버·클라 공용(#61).
 */
import { MENU_LABEL, type MenuKey } from "@/lib/permissions";
import { KPI_KEYS, type KpiKey, type PanelId } from "@/features/dashboard/overview/layout";
import type { Area } from "@/features/dashboard/overview/model";
import { isCoreId, isStructuralId, type Item } from "./types";

/** 영역 → 그 영역을 읽으려면 필요한 메뉴 권한(서버 `add()`의 두 번째 인자와 같다 — `registry.test.ts`가 대조). */
export const AREA_MENUS: Record<Area, readonly MenuKey[]> = {
  students: ["students"],
  changes: ["students"],
  enrolledTrend: ["students"],
  courses: ["students"],
  courseTrend: ["students"],
  withdrawals: ["withdrawals"],
  earlyExits: ["withdrawals"],
  intake: ["enrollment"],
  enrolledToday: ["enrollment"],
  firstClass: ["students"],
  makeup: ["attendance"],
  absent: ["attendance"],
  attendance: ["attendance"],
  processing: ["attendance"],
  holidayAttendance: ["attendance"],
  attendanceTrend: ["attendance"],
  billing: ["billing"],
  expenses: ["billing"],
  absences: ["attendance"],
  admissions: ["enrollment"],
  consultations: ["consultations"],
  newcomers: ["newcomers"],
  homework: ["lesson_reports"],
  unread: ["lesson_reports"],
  schedule: ["timetable"],
  staff: ["staff"],
  operations: [],
  notices: [],
  calendar: ["calendar"],
  consultProgress: ["enrollment"],
  englishSheet: ["ecs"],
  mathSheet: ["mcs"],
  teacherWork: ["lesson_reports"],
};

export type ThumbKind = "number" | "donut" | "bars" | "columns" | "line" | "list" | "table" | "schedule" | "stack";
export type CardGroup = "KPI" | "학생·재원" | "출결·수업" | "수납·지출" | "상담·신입" | "학원 운영";

/** 위젯 크기 — 24열 격자에서 1칸(1×1) = 6열. ½×1(3열)은 요약형(숫자 한 줄)이다. */
export type SizePreset = { key: string; label: string; hint: string; w: number; h: number; mode?: "summary" };
export type CardOption = "amounts" | "phones";

const Z = {
  summary: { key: "s", label: "½×1", hint: "작게 · 숫자 요약", w: 3, h: 1, mode: "summary" },
  one: { key: "1x1", label: "1×1", hint: "기본", w: 6, h: 1 },
  tall: { key: "1x2", label: "1×2", hint: "세로로 길게", w: 6, h: 2 },
  wide: { key: "2x1", label: "2×1", hint: "가로로 넓게", w: 12, h: 1 },
  big: { key: "2x2", label: "2×2", hint: "크게", w: 12, h: 2 },
  full: { key: "4x1", label: "4×1", hint: "한 줄 전체", w: 24, h: 1 },
} satisfies Record<string, SizePreset>;
const KPI_SIZES: readonly SizePreset[] = [
  // ⅓×1 = 9칸 이상의 KPI 띠를 한 줄에 맞출 때(`classicToItems` · 강좌수가 더해진 2026-10-20부터).
  { key: "k-third", label: "⅓×1", hint: "좁게", w: 2, h: 1 },
  { key: "k-half", label: "½×1", hint: "기본", w: 3, h: 1 },
  { key: "k-one", label: "1×1", hint: "넓게", w: 6, h: 1 },
];

/** 새 대시보드의 KPI 칸 — 옛 9칸 + '오늘 입테'(전일 입테와 같은 일정 영역을 오늘 하루로 · 한눈에 보기 머리 칸). */
export type BoardKpi = KpiKey | "todayTests";
export const BOARD_KPIS: readonly BoardKpi[] = [...KPI_KEYS, "todayTests"];

export type CardDef = {
  id: string;
  kind: "kpi" | "panel";
  key: BoardKpi | PanelId;
  /** 기본 이름(편집기·팔레트). 운영실 화면의 실제 제목은 날짜가 들어가는 카드가 있어 조금 다를 수 있다(`9월 수납 현황`). */
  label: string;
  group: CardGroup;
  thumb: ThumbKind;
  areas: readonly Area[];
  /**
   * 과목 관리자 화면에서 담당 과목으로 좁혀지는가 — `academy`면 학원 전체 값이라 '(학원 전체)'가 붙는다. `none` = 과목과 무관(공지).
   * 2026-10-14 2단계(원장 *"과목별로 나눠서"*)로 카드 대부분이 `subject`다(`slices.ts` · 서버 `addSliced`). 원천에 과목이 없는
   * 지출·행정 두 카드만 학원 전체로 남는다.
   */
  subjectScope: "subject" | "academy" | "none";
  options: readonly CardOption[];
  /** 허용 크기(작은 것부터). 첫 번째가 아니라 `size`가 기본 크기다. */
  sizes: readonly SizePreset[];
  /** 지금 운영실의 크기 — 기본 배치·새로 넣을 때의 크기. */
  size: { w: number; h: number };
};

type PanelSpec = Pick<CardDef, "label" | "group" | "thumb" | "areas"> &
  Partial<Pick<CardDef, "subjectScope" | "options" | "size">> & { sizes: readonly SizePreset[] };

const LIST = [Z.one, Z.tall, Z.wide, Z.big];
const LIST_S = [Z.summary, ...LIST];
const CHART = [Z.one, Z.wide];
const CHART_S = [Z.summary, ...CHART];
const TREND_S = [Z.summary, Z.one, Z.wide, Z.full];

const PANELS: Record<PanelId, PanelSpec> = {
  teacherWork: { label: "강사별 업무 현황", group: "출결·수업", thumb: "table", areas: ["teacherWork"], subjectScope: "subject", size: { w: 24, h: 1 }, sizes: [...LIST, Z.full] },
  studentsComp: { label: "재원생 구성", subjectScope: "subject", group: "학생·재원", thumb: "donut", areas: ["students"], sizes: CHART_S },
  attendance: { label: "출결 현황", subjectScope: "subject", group: "출결·수업", thumb: "donut", areas: ["attendance", "processing", "holidayAttendance"], sizes: CHART_S },
  billingMonth: { label: "이번 달 수납 현황", subjectScope: "subject", group: "수납·지출", thumb: "donut", areas: ["billing"], options: ["amounts"], sizes: CHART_S },
  newcomerStages: { label: "신규생 단계별 관리", subjectScope: "subject", group: "상담·신입", thumb: "bars", areas: ["newcomers"], sizes: LIST_S },
  changes: { label: "등록 · 퇴원 추이", subjectScope: "subject", group: "학생·재원", thumb: "columns", areas: ["changes"], size: { w: 12, h: 1 }, sizes: TREND_S },
  // 원장 2026-10-15 — 이번 달 퇴원 중 등록 후 30·60·90일 안에 그만둔 학생(`early-exit.ts`). 과목 관리자에겐 퇴원 명단이라 '민감'(badges.ts).
  earlyExits: { label: "등록 후 3개월 내 퇴원", subjectScope: "subject", group: "학생·재원", thumb: "list", areas: ["earlyExits"], sizes: LIST_S },
  billing6: { label: "6개월 청구 · 수납", subjectScope: "subject", group: "수납·지출", thumb: "columns", areas: ["billing"], size: { w: 12, h: 1 }, sizes: TREND_S },
  enrolledTrend: { label: "재원생 추이", subjectScope: "subject", group: "학생·재원", thumb: "columns", areas: ["enrolledTrend"], size: { w: 24, h: 1 }, sizes: TREND_S },
  // 원장 2026-10-20 '강좌수 추이 카드 따로' — 재원생 추이와 같은 원본·날짜로 센 강좌수(`course-trend.ts`).
  courseTrend: { label: "강좌수 추이", subjectScope: "subject", group: "학생·재원", thumb: "columns", areas: ["courseTrend"], size: { w: 24, h: 1 }, sizes: TREND_S },
  subjects: { label: "과목별 수강", group: "학생·재원", thumb: "bars", areas: ["students"], subjectScope: "subject", sizes: LIST_S },
  grades: { label: "학년별 재원생", subjectScope: "subject", group: "학생·재원", thumb: "bars", areas: ["students"], sizes: LIST },
  schools: { label: "학교별 학생", subjectScope: "subject", group: "학생·재원", thumb: "list", areas: ["students"], size: { w: 6, h: 2 }, sizes: LIST_S },
  admissions: { label: "신규 콜&상담 전환", subjectScope: "subject", group: "상담·신입", thumb: "table", areas: ["admissions"], sizes: LIST_S },
  repeatAbsence: { label: "반복 결석 학생", subjectScope: "subject", group: "출결·수업", thumb: "list", areas: ["absences"], sizes: LIST_S },
  attendance14: { label: "최근 14일 등원율", subjectScope: "subject", group: "출결·수업", thumb: "line", areas: ["attendanceTrend"], sizes: TREND_S },
  consultProgress: { label: "상담 진행", subjectScope: "subject", group: "상담·신입", thumb: "stack", areas: ["consultProgress"], sizes: LIST_S },
  reports: { label: "학습 · 학부모 보고", subjectScope: "subject", group: "학생·재원", thumb: "stack", areas: ["homework", "unread"], size: { w: 12, h: 1 }, sizes: LIST_S },
  studentConsult: { label: "학생 상담", subjectScope: "subject", group: "학생·재원", thumb: "stack", areas: ["consultations"], size: { w: 12, h: 1 }, sizes: LIST_S },
  newcomerChecks: { label: "신규생 체크 진행", subjectScope: "subject", group: "상담·신입", thumb: "stack", areas: ["newcomers"], sizes: LIST_S },
  sheets: { label: "강사 시트 작성 현황", group: "출결·수업", thumb: "stack", areas: ["englishSheet", "mathSheet"], subjectScope: "subject", sizes: LIST_S },
  nowClasses: { label: "현재 수업 현황", group: "출결·수업", thumb: "schedule", areas: ["schedule"], subjectScope: "subject", sizes: [...LIST_S, Z.full] },
  admissionsSchedule: { label: "레벨테스트 및 첫수업 일정", subjectScope: "subject", group: "상담·신입", thumb: "schedule", areas: ["calendar"], options: ["phones"], sizes: LIST_S },
  staff: { label: "직원 구성", subjectScope: "subject", group: "학원 운영", thumb: "bars", areas: ["staff"], sizes: LIST_S },
  operations: { label: "행정 · 자산", group: "학원 운영", thumb: "list", areas: ["operations"], sizes: LIST_S },
  expenses: { label: "이번 달 지출 내역", group: "수납·지출", thumb: "bars", areas: ["expenses"], sizes: LIST_S },
  notices: { label: "학원 공지", group: "학원 운영", thumb: "list", areas: ["notices"], subjectScope: "none", sizes: LIST_S },
};

type KpiSpec = Pick<CardDef, "label"> & Partial<Pick<CardDef, "subjectScope" | "options">>;
const KPIS: Record<BoardKpi, KpiSpec & { areas?: readonly Area[] }> = {
  todayTests: { label: "오늘 입테", subjectScope: "subject", options: ["phones"], areas: ["calendar"] },
  students: { label: "재원생", subjectScope: "subject" },
  courses: { label: "강좌수", subjectScope: "subject" },
  withdrawals: { label: "퇴원", subjectScope: "subject" },
  intake: { label: "신규문의", subjectScope: "subject" },
  calendar: { label: "전일 입테", subjectScope: "subject", options: ["phones"] },
  enrolledToday: { label: "전일 / 이달 신규", subjectScope: "subject" },
  firstClass: { label: "오늘첫수업", subjectScope: "subject" },
  absent: { label: "최근 결석", subjectScope: "subject" },
  makeup: { label: "보강예정", subjectScope: "subject" },
};

/**
 * 대시보드에서 뺀 카드 — 갤러리에 없고, 저장된 배치에 남아 있어도 모르는 카드로 걸러진다(view.ts · 영역도 읽지 않는다).
 * - teacherWork(강사별 업무 현황): 직원 평가 '업무 현황' 면으로 옮김 — 원장 2026-10-29 *"강사 자료는 강사평가로"* ·
 *   2026-10-30 *"원장만"*(class_review 권한 · 포트폴리오와 같은 판정).
 */
const RETIRED_PANELS: ReadonlySet<PanelId> = new Set<PanelId>(["teacherWork"]);
/** 뺀 카드만 읽던 영역 — 대시보드 관리 미리보기(full)도 조회하지 않는다. */
export const RETIRED_AREAS: ReadonlySet<Area> = new Set<Area>(["teacherWork"]);

/** 편집기 순서 = KPI 10칸(옛 9칸 + 오늘 입테) → 패널(배열 순서). */
export const CARDS: readonly CardDef[] = [
  ...BOARD_KPIS.map(
    (k): CardDef => ({
      id: `kpi:${k}`,
      kind: "kpi",
      key: k,
      label: KPIS[k].label,
      group: "KPI",
      thumb: "number",
      areas: KPIS[k].areas ?? [k as KpiKey],
      subjectScope: KPIS[k].subjectScope ?? "academy",
      options: KPIS[k].options ?? [],
      sizes: KPI_SIZES,
      size: { w: 3, h: 1 },
    }),
  ),
  ...(Object.keys(PANELS) as PanelId[]).filter((k) => !RETIRED_PANELS.has(k)).map(
    (k): CardDef => ({
      id: `panel:${k}`,
      kind: "panel",
      key: k,
      label: PANELS[k].label,
      group: PANELS[k].group,
      thumb: PANELS[k].thumb,
      areas: PANELS[k].areas,
      subjectScope: PANELS[k].subjectScope ?? "academy",
      options: PANELS[k].options ?? [],
      sizes: PANELS[k].sizes,
      size: PANELS[k].size ?? { w: 6, h: 1 },
    }),
  ),
];

const BY_ID = new Map(CARDS.map((c) => [c.id, c]));
export const cardDef = (id: string): CardDef | undefined => BY_ID.get(id);
export const isKnownId = (id: string) => isStructuralId(id) || isCoreId(id) || BY_ID.has(id);

/** 카드가 필요로 하는 메뉴 권한(영역 합집합). */
export function menusOf(def: CardDef): MenuKey[] {
  return [...new Set(def.areas.flatMap((a) => AREA_MENUS[a]))];
}

/** 이 메뉴 권한 집합으로 볼 수 있는 카드인가 — 영역 중 **하나라도** 읽을 수 있으면 카드가 선다(강사 시트 = 영어·수학 중 하나). */
export function canSeeCard(def: CardDef, allowed: ReadonlySet<MenuKey>): boolean {
  return def.areas.some((a) => AREA_MENUS[a].every((m) => allowed.has(m)));
}

/** 못 보는 이유(편집기 배지) — "수납관리 권한이 없어 보이지 않습니다". 볼 수 있으면 null. */
export function missingMenuLabel(def: CardDef, allowed: ReadonlySet<MenuKey>): string | null {
  if (canSeeCard(def, allowed)) return null;
  const missing = menusOf(def).filter((m) => !allowed.has(m));
  return missing.map((m) => MENU_LABEL[m] ?? "다른 메뉴").join(" · ");
}

/** 아이템의 지금 크기와 맞는 프리셋(없으면 null). */
export function presetOf(def: CardDef, item: Pick<Item, "w" | "h" | "mode">): SizePreset | null {
  return def.sizes.find((z) => z.w === item.w && z.h === item.h && (z.mode ?? undefined) === (item.mode ?? undefined)) ?? null;
}

/** 저장값·끌기로 만든 크기(소수 가능)에 가장 가까운 허용 프리셋 — 같은 거리면 지금 모드(요약/일반)를 유지한다. */
export function nearestPreset(def: CardDef, wantW: number, wantH: number, mode?: "summary"): SizePreset {
  const dist = (z: SizePreset) => Math.abs(z.w - wantW) / 6 + Math.abs(z.h - wantH) + ((z.mode ?? undefined) === mode ? 0 : 0.01);
  return [...def.sizes].sort((a, b) => dist(a) - dist(b))[0]!;
}

/** 기본 크기의 프리셋(없으면 첫 프리셋). */
export const defaultPreset = (def: CardDef): SizePreset => presetOf(def, def.size) ?? def.sizes[0]!;

/** 구역 머리줄 — 항상 한 줄 전체. */
export const HEADING_SIZE = { w: 24, h: 1 } as const;
