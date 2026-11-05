import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadRecentImports, type ImportHistoryItem } from "@/features/textbooks/server/import-batch";
import { eieModuleOn } from "./eie-on";
import { fetchAllPaged } from "@/lib/supabase/batch";
// 슬롯 담당 해석 — 주간 시트(`queries.ts`)·시간표 3뷰와 **같은 두 함수**를 쓴다(갈리면 같은 교시가
// 화면마다 다른 담당으로 보인다).
import { fetchInChunks } from "@/lib/supabase/batch";
import { getTeacherLabelMap } from "@/features/timetable/server/queries";
import { resolveTeacherLabel } from "@/features/timetable/lib/teacher-label";
// 🔴 방 이름 규약은 좌석표·주간 시트와 **같은 두 함수**다(단일 소스).
import { canonicalRoomName, resolveRoomName } from "@/features/attendance/live/seating-floors";
import { kstMonth, kstToday, monthLabel, monthRange } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
// 휴일 판정 자료는 학원설정 하나뿐 — 내장 법정공휴일 표는 쓰지 않는다([[holiday.ts]]).
import { buildHolidayMap } from "@/features/attendance/calendar";
import { settingsToPeriodsConfig, weekdayTableFor } from "@/features/timetable/lib/periods";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { resolvePeriodLabel, tableToEntries } from "../lib/period-label";
import { isWeekendDow } from "../lib/grid-rows";
import { dowKeyOf } from "../lib/week";
import { normalizeMonth, activeDowsOf, rangeDates, rangeWeeks, type MonthWeek } from "../lib/month";
// 세션 기간(0189a) — 해석은 `resolvePeriodWindow` 한 곳(폴백 분기를 여기 두지 않는다).
import { getPeriodDefsForYears } from "@/features/periods/server/queries";
import { resolvePeriodWindow, type PeriodDef } from "@/features/periods/resolve";
import { mondayOf, shiftDays } from "@/features/timetable/lib/week";
import {
  monthFillStats,
  slotKey,
  slotsByDateOf,
  type MonthScheduleRow,
  type MonthSlot,
} from "../lib/month-assemble";
import type { MonthGoalMap } from "../lib/goal-match";
import {
  clampEcsMonthView,
  normalizeEcsMonthPeriod,
  readEcsMonthDisplay,
  readEcsMonthPeriod,
  readEcsMonthView,
  type EcsMonthDisplay,
  type EcsMonthPeriod,
  type EcsMonthView,
} from "../view-prefs";
import { mpFooterDate, type MpCell, type MpColKind } from "../lib/month-plan";
import { isMeaningfulPlanLine } from "../lib/plan-codec";
import { planLineFromRow } from "../lib/plan-line";
import type { PlanLineDTO } from "./actions";
import { getClassPlannedLines, type PlannedLine } from "@/features/textbooks/server/month-plan";
import type { LessonIndex } from "@/features/textbooks/plan-compare";
import { requireEcsClassAccess } from "./access";
import { loadViewerUiPrefs } from "./viewer-prefs";
import type { DowKey } from "../lib/week";

/**
 * ECS **월간 뷰** 조회 — 반 1개 × 달 1개. 주간 시트(`getClassSheetWeek`)와 같은 게이트
 * (`requireEcsClassAccess`)를 통과하고, 같은 표(`class_sheet_plan_lines`·`class_sheet_goals`)를 읽는다.
 * **새 표도 새 쓰기 경로도 없다**(목표 저장은 기존 `upsertGoal` 그대로).
 *
 * 주간과 다른 점 — 월간은 **훑는 화면**이라 로스터·출결·마크를 아예 안 읽는다. 한 반 한 달이
 * 계획 줄 ~50행 · 배정 교시 ~40개라(실측 중등E_초6 SKY 2026-08) 날짜 범위로 좁힌 조회 3개면 끝난다.
 */
export type MonthPlanLine = PlanLineDTO & { seat: boolean };

export type ClassSheetMonthData = {
  classId: string;
  className: string;
  /** 반 담임(`classes.teacher_id`) — 계획서 인쇄물 머리말의 강사 닉네임을 찾는 키. */
  teacherId: string | null;
  /** 담임 표시 이름 — 상단 반 표기 오른쪽(`SheetClassPicker teacherName`). 담임 없음·조회 실패면 null. */
  teacherName: string | null;
  /** 라벨월 `YYYY-MM` — 세션으로 봐도 **라벨**은 달이다(9월 세션 = `2026-09`). 목표·메모·꼬리말의 키. */
  month: string;
  monthLabel: string;
  today: string;
  /**
   * 이 화면이 그린 **기간** — 달력월 또는 세션 창(원장 2026-09-21 *"세션으로 뷰가 보일 수 있게 월/세션 전환"*).
   * `weeks`·`slotsByDate`·계획 줄·MP 칸·휴일이 전부 이 창으로 잘린다(목표·메모는 라벨월 그대로).
   * ⚠️ `mode`는 고른 축, `kind`는 실제로 그린 창이다 — 세션을 골랐어도 그 달 세션이 정의돼 있지 않으면
   *    `kind: "month"`(달력월 폴백)이고, 화면은 그 사실을 말한다(조용히 달력월로 보여 주지 않는다).
   */
  period: { mode: EcsMonthPeriod; kind: "session" | "month"; start: string; end: string };
  /**
   * 오늘이 속한 라벨월 — '이번 달/이번 세션으로' 링크와 과거·미래 배지의 기준.
   * 🔑 세션 축이면 **오늘이 든 세션**의 라벨이다(11/2는 10월 세션 — 달력으로 11월이라 부르면 오늘이 없는
   *    11월 세션(11/3~)을 연다).
   */
  currentMonth: string;
  /** 이 기간에 배정이 있는 요일만(열의 정체) — 없으면 빈 배열. */
  dows: DowKey[];
  /** 기간을 덮는 주(월요일 시작) — 각 주는 **기간 안의 날짜만** 담는다(`rangeWeeks`). */
  weeks: MonthWeek[];
  slotsByDate: Record<string, MonthSlot[]>;
  /** `YYYY-MM-DD|HH:MM` → 그 교시의 계획 줄(line_no 순). */
  linesBySlot: Record<string, MonthPlanLine[]>;
  /**
   * **원래 월간계획**(교재 배정에서 계산, 미루기 미반영) — `"날짜|교시"` → 그 칸에 오기로 된 차수(원장 2026-09-22·28).
   * 🔴 **실제가 아니다.** 실제는 위 `linesBySlot` 하나뿐이고, 계획이 거기 들어가는 길은 시트의
   *    [월간계획 가져오기]뿐이다. 그래서 달력은 둘을 **다른 자리에 다른 색**으로 그린다.
   */
  plannedBySlot: Record<string, PlannedLine[]>;
  /** 배정 교재들의 차수표 — 실제 진도 → 차수(달력 비교 배지의 늦음·빠름, plan-compare). */
  lessonIndex: LessonIndex;
  /** 미루기·당기기 표식(0282a) — `"날짜|교시"` → `skip` | `advance`. 달력의 토글 상태다. */
  shiftBySlot: Record<string, "skip" | "advance">;
  /** 그 반의 아직 안 되돌린 교재 배정 반영, 최신 먼저 최대 5건 — 툴바 [되돌리기 ▾] 메뉴. 없으면 빈 배열. */
  recentImports: ImportHistoryItem[];
  /** 계획 줄 전체(평면) — 경고 판정·목표 대조가 날짜를 넘나들며 쓴다. */
  lines: MonthPlanLine[];
  /** `YYYY-MM-DD|HH:MM` → 교시 라벨(표시 전용, 학원설정이 단일 소스). */
  periodLabelBySlot: Record<string, string>;
  goals: { homeroom: MonthGoalMap; assistant: MonthGoalMap };
  skillAreas: SkillAreaSetting[];
  canEdit: boolean;
  /** 배정된 전 교시 기준(표시 토글과 무관 — month-assemble 🔴 참조). 휴일은 [[holiday.ts]] 규약. */
  fill: { filled: number; total: number; pct: number };
  /**
   * 학원 지정 휴일(`YYYY-MM-DD` → 이름) — 이 달 범위로 좁힌 것. **한 벌을 셋이 쓴다**:
   * 달력·진도표의 휴일 표식 · 작성률 분모([[holiday.ts]] 규약) · 계획(MP)의 휴강 기본 판정.
   * 🔴 **칸을 없애는 값이 아니다**(원장 2026-09-01) — 달력 칸·진도표 열은 그대로 서고 계획도 그대로
   *    고칠 수 있다. 달라지는 건 표식과 작성률 분모뿐이다.
   * ⚠️ MP만 여기에 **반별 예외**(`col_kind='off'`)를 한 겹 더 얹는다(그건 MP 칸에만 있다).
   */
  holidays: Record<string, string>;
  /** 마지막에 본 보기 + 보기별 표시 토글(계정 귀속 — `users.ui_prefs.ecs`). */
  view: EcsMonthView;
  display: Record<EcsMonthView, EcsMonthDisplay>;
  /**
   * EiE 반인가 — **계획(MP) 보기가 서는 유일한 조건**(원장 2026-09-01). 판정은 `classes.english_track`
   * 컬럼 하나고 반 이름으로 추측하지 않는다. 화면은 이 값으로 탭을 세우고, 저장·인쇄는 서버에서 다시 본다(#77).
   */
  isEie: boolean;
  /**
   * 월간 계획서(MP)의 칸들 — **EiE 반일 때만** 담는다(그 외는 빈 배열 + `status: "off"`).
   * 🔴 0239a 미적용이어도 화면은 산다(`missing-table` → 한글 배너, 달력·진도표는 이 값을 아예 안 읽는다).
   */
  mp: { cells: MpCell[]; status: MpDataStatus };
  /**
   * 이 달 **특이사항 메모**(0246a) — 달력 보기의 월간계획 아래 한 칸. 반 × 달 하나뿐이다.
   * 🔴 0246a 미적용이어도 화면은 산다(`missing-table` → 한글 배너 + 편집만 잠금, [[#95]]).
   * ⚠️ 담임/부담임으로 안 가른다 — 특이사항은 그 반의 사실이지 역할별 기록이 아니다.
   */
  memo: { body: string; status: MonthMemoStatus };
};

/**
 * MP 칸 조회의 결말 — 표가 아직 없는 것과 그냥 실패한 것은 **다른 사실**이라 한 문구로 뭉치지 않는다
 * (MCS `GoalsStatus`와 같은 규약: 권한·네트워크 실패를 "SQL 미적용"이라 부르면 화면이 거짓말을 한다).
 * `off` = 이 반은 MP 대상이 아니다(EiE 아님) — 조회를 아예 안 했다는 뜻.
 */
export type MpDataStatus = "ok" | "off" | "missing-table" | "failed";

/** 월 메모 조회의 결말 — MP와 같은 규약(표가 없는 것과 그냥 실패한 것은 다른 사실이다). */
export type MonthMemoStatus = "ok" | "missing-table" | "failed";

export type MonthResult = { ok: true; data: ClassSheetMonthData } | { ok: false; error: string };

/**
 * 내 보기 설정(`users.ui_prefs`) — **기간 축을 고르려면 조회 범위를 정하기 전에** 알아야 해서 게이트와
 * 나란히 먼저 읽는다(B4 — 게이트도 왕복이라 지연이 늘지 않는다). 자기 행만 읽는다.
 * ⚠️ admin은 RLS 우회라 `tenant_id`를 함께 건다([[#104]]).
 */
async function loadMyUiPrefs(): Promise<unknown> {
  // 보는 사람(실제 계정)의 값 — 쓰기(setMyEcsMonthView·MonthPeriod·MonthDisplay)가 실제 계정에 저장한다(viewer-prefs.ts).
  return (await loadViewerUiPrefs()).data?.ui_prefs ?? null;
}

export async function getClassSheetMonth(
  classId: string,
  monthRaw: string | null,
  opts: {
    /** 주소의 기간 축(`month`|`session`) — 이번 방문만 따른다. 없거나 모양이 아니면 계정 저장값. */
    period?: unknown;
    /** 주소의 "왔던 주"(주간 시트·반 목록에서 들어올 때) — 세션 축이면 이 주가 든 세션을 연다(아래). */
    week?: unknown;
  } = {},
): Promise<MonthResult> {
  const today = kstToday();
  // 주소에 달이 없으면(또는 모양이 아니면) 아래에서 **오늘이 든 기간**으로 정한다 — 축을 알아야 정해진다.
  const explicitMonth = monthRaw ? normalizeMonth(monthRaw, "") : "";
  const yearOf = (d: string) => Number(d.slice(0, 4));
  // ⚠️ 오늘 ±1년 밖의 주는 버린다 — 손으로 고친 주소(`week=9999-01-01`)가 그 해 세션 조회를 매번 새로 만들지 않게.
  const weekRaw =
    typeof opts.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(opts.week) ? mondayOf(opts.week) : null;
  const fromWeek = weekRaw && Math.abs(yearOf(weekRaw) - yearOf(today)) <= 1 ? weekRaw : null;
  // 세션 정의는 테넌트 캐시(B6)라 싸다. 후보 해 = 보는 달·오늘·왔던 주의 해 **와 그 전해**(1월에 12월 세션이
  // 이어질 수 있다). ⚠️ 오늘 해를 빼면 다른 해를 볼 때 '오늘이 든 세션'을 못 찾아 배지·'이번 세션으로'가 틀어진다.
  const years = [explicitMonth || kstMonth(), today, fromWeek ?? today].flatMap((d) => [yearOf(d) - 1, yearOf(d)]);
  const [gate, uiPrefs, periodDefs] = await Promise.all([
    requireEcsClassAccess(classId),
    loadMyUiPrefs(),
    getPeriodDefsForYears(years),
  ]);
  if (!gate.ok) return { ok: false, error: gate.error };
  const access = gate.access;

  const admin = createAdminClient();
  // 🔴 계획(MP)은 **EiE 반에만** 있다(원장 2026-09-01) — 판정은 `english_track` 컬럼 하나고 게이트가
  //    이미 읽어 왔다. EiE가 아니면 조회 자체를 안 한다(쓸데없는 왕복 0 + 화면에 탭도 안 선다).
  // EiE 구분(모듈)이 꺼진 학원은 EiE 반도 인재원 영어처럼 연다(2026-09-30 "꺼지면 흔적 없이").
  const isEie = access.englishTrack === "eie" && (await eieModuleOn());

  /**
   * 기간 축 — **EiE 반에서만** 세션을 쓴다(원장 2026-09-21). 인재원 영어의 달력·진도표는 월간 목표·메모가
   * 달 단위라 창을 넓히면 목표 밖 날짜가 섞이므로 언제나 달력월이다.
   * 🔴 창은 `resolvePeriodWindow` **한 곳**에서 정한다(반 예외 → 과목 기본 → 달력월 폴백) — 여기서 따로
   *    폴백하지 않는다. 출석부 날짜축과 같은 함수·같은 행이다.
   */
  const periodMode: EcsMonthPeriod = isEie
    ? (normalizeEcsMonthPeriod(opts.period) ?? readEcsMonthPeriod(uiPrefs))
    : "month";
  /**
   * 그 날짜가 든 세션의 **라벨월** — 창을 정하는 `resolvePeriodWindow`로 **거꾸로 확인**한 것만 돌려준다.
   * 🔑 이렇게 하는 이유: 반 예외 세션이 있으면 "날짜가 든 행"과 "그 라벨월이 실제로 여는 창"이 다를 수 있다
   *    (과목 기본 10/1~11/2 · 반 예외 10/5~11/4에서 10/2 → 과목 기본의 10월을 찾았는데 창은 반 예외라 10/2가 없다).
   *    같은 함수로 확인하면 "오늘이 든 세션"이라며 오늘이 없는 창을 여는 일이 없다. 반 예외를 먼저 본다.
   */
  const sessionLabelFor = (date: string): string | null => {
    const hits = periodDefs
      .filter((d: PeriodDef) => d.subjectKey === access.subject && d.startDate <= date && date <= d.endDate)
      .filter((d) => d.classId === null || d.classId === classId)
      .sort((a, b) => (a.classId === b.classId ? 0 : a.classId ? -1 : 1));
    for (const d of hits) {
      const label = `${d.labelYear}-${String(d.labelMonth).padStart(2, "0")}`;
      const w = resolvePeriodWindow({ period: label, subjectKey: access.subject, classId, defs: periodDefs });
      if (w.kind === "session" && w.start <= date && date <= w.end) return label;
    }
    return null;
  };
  const currentMonth = (periodMode === "session" ? sessionLabelFor(today) : null) ?? kstMonth();
  /**
   * 주간 시트·반 목록의 '달력' 링크는 `month=`를 **달력으로**(그 주 목요일의 달) 적어 보낸다 — 세션 축에선
   * 그게 틀린다: 오늘(11/2)이 든 주는 목요일이 11월이라 **오늘이 없는 11월 세션(11/3~)**이 열리고, 3/6~4/2 세션의
   * 3/30 주는 4월로 가서 그 주 월~목이 빈 칸이 된다(적대적 리뷰 2026-09-21). 그래서 세션 축이면 **그 주가 든 세션**을
   * 연다 — 그 주에 오늘이 있으면 오늘, 없으면 목요일(주의 과반, `monthOfWeek`와 같은 결)이 든 세션.
   * ⚠️ 못 찾으면(정의 없음) 주소의 달 그대로 — 거기서 다시 달력월로 폴백한다.
   */
  // 후보 순서: 오늘(그 주 안일 때만) → 목요일. 세션 사이 빈 날에 오늘이 걸려도 목요일로 한 번 더 찾는다.
  const weekAnchors = fromWeek
    ? [
        ...(today >= fromWeek && today <= shiftDays(fromWeek, 6) ? [today] : []),
        shiftDays(fromWeek, 3),
      ]
    : [];
  const weekMonth =
    periodMode === "session"
      ? (weekAnchors.map(sessionLabelFor).find((l): l is string => Boolean(l)) ?? "")
      : "";
  const month = weekMonth || explicitMonth || currentMonth;
  const monthBounds = monthRange(month);
  const window = resolvePeriodWindow({
    period: month,
    subjectKey: access.subject,
    classId,
    defs: periodDefs,
    mode: periodMode,
    todayIso: today,
  });
  // 그리는 기간. ⚠️ 목표·메모·꼬리말은 **라벨월**(`monthBounds.from`)이 키다 — 창으로 바꾸면 세션이
  //    달 중간에 시작하는 달(3/6~)에 목표·메모가 통째로 안 보인다.
  const from = window.start || monthBounds.from;
  const to = window.end || monthBounds.to;
  const footerDate = mpFooterDate(month);

  // 독립 조회는 병렬(B4). 계획 줄만 페이지네이션 — 20줄 × 40교시면 이론상 1,000행에 닿는다(B2).
  const [scheduleRes, lineRows, goalRes, settings, mpRes, teacherRes, memoRes, roomsRes, labelMap, plannedRes, recentImports] =
    await Promise.all([
    admin
      .from("class_schedules")
      .select(
        // ⚠️ FK를 함께 읽는다 — 라벨은 시트가 적은 대로라 같은 방이 두 표기다(주간 시트와 같은 규약).
        // 🔴 `teacher_id`도 같은 이유로 읽는다(2026-09-04 원장 제보 "강사 시트랑 배선이 다르게 되어있나?"):
        //    종전엔 라벨만 읽어서, 라벨이 빈 교시가 담당이 **배정돼 있는데도** `담당 미지정`으로 떴다
        //    (실측 `중등E_중1 정규 B` 화 19:20 = 라벨 null · teacher_id 추민아 → 시간표엔 추민아, 월간엔 미지정).
        "day_of_week, start_time, end_time, valid_from, valid_to, classroom_id, teacher_id, slot_teacher_label, slot_room_label",
      )
      .eq("tenant_id", access.tenantId)
      .eq("class_id", classId)
      .lte("valid_from", to)
      .or(`valid_to.is.null,valid_to.gte.${from}`),
    fetchAllPaged<Record<string, unknown>>((rangeFrom, rangeTo) =>
      admin
        .from("class_sheet_plan_lines")
        .select("*")
        .eq("tenant_id", access.tenantId)
        .eq("class_id", classId)
        .gte("plan_date", from)
        .lte("plan_date", to)
        .order("plan_date")
        .order("slot_start")
        .order("line_no")
        .order("id") // OFFSET 페이지가 흔들리지 않게 unique tie-break
        .range(rangeFrom, rangeTo),
    ),
    admin
      .from("class_sheet_goals")
      .select("role, skill_area, textbook, target_progress")
      .eq("tenant_id", access.tenantId)
      .eq("class_id", classId)
      .eq("scope", "month")
      .eq("period_start", monthBounds.from),
    getTenantSettings(),
    // 0239a. 한 반 한 달이 수업일 ~13일 × 칸 5종이라 페이지네이션 불요(B2 상한 근처에도 못 간다).
    // ⚠️ admin은 RLS 우회라 `tenant_id` 필터가 필수다([[#104]]).
    // 🔑 범위 = 기간 ∪ 라벨월 — 꼬리말은 라벨월 1일에 앉는데(0240a) 세션이 그 날보다 늦게 시작할 수 있다
    //    (11월 세션 = 11/3~). 아래에서 기간 밖 칸은 버리고 이 달 꼬리말만 남긴다.
    isEie
      ? admin
          .from("class_month_plan_cells")
          .select("plan_date, col_kind, body")
          .eq("tenant_id", access.tenantId)
          .eq("class_id", classId)
          .gte("plan_date", from < monthBounds.from ? from : monthBounds.from)
          .lte("plan_date", to > monthBounds.to ? to : monthBounds.to)
      : Promise.resolve(null),
    // 담임 이름 — 상단 반 표기 오른쪽에 이름만(원장 2026-09-02 *"ecs도 마찬가지"*). 담임 없는 반은 조회도 없다.
    access.teacherId
      ? admin
          .from("users")
          .select("display_name")
          .eq("id", access.teacherId)
          .eq("tenant_id", access.tenantId)
          .maybeSingle()
      : Promise.resolve(null),
    // 0246a 월 특이사항 메모 — 반 × 달 한 행. ⚠️ admin은 RLS 우회라 `tenant_id` 필터 필수([[#104]]).
    admin
      .from("class_sheet_month_memos")
      .select("body")
      .eq("tenant_id", access.tenantId)
      .eq("class_id", classId)
      .eq("month", monthBounds.from)
      .maybeSingle(),
    // 등록 강의실(id→이름) — 라벨을 aywa 기준 이름으로 맞추는 근거(주간 시트와 같은 규약).
    admin.from("classrooms").select("id, name").eq("tenant_id", access.tenantId),
    // 강사 라벨 해석기(닉네임 `Song` → 표시 이름 `송지혜`) — 주간 시트·시간표 3뷰와 **같은 함수**.
    getTeacherLabelMap({ supabase: admin, tenantId: access.tenantId })
      // ⚠️ 이름 조회가 실패해도 시트는 연다 — 표시 전용이라 원문 라벨로 떨어지는 편이 시트 전체가 죽는 것보다 낫다
      //    (시간표는 같은 함수가 던진다 — 감사 E5. 영어 강사 전원이 매일 여는 화면이라 여기선 삼킨다).
      .catch(() => undefined),
    // 월간계획(교재 배정에서 계산) — 🔴 **절대 throw하지 않는다**(그 안에서 상태로 접는다, [[#95]]).
    //    0266a/0268a 미적용이거나 배정이 0건이면 빈 계획으로 돌고 달력은 그대로 뜬다.
    getClassPlannedLines({
      tenantId: access.tenantId,
      subject: access.subject,
      classId,
      from,
      to,
    }),
    // 최근 반영(되돌리기 ▾ 메뉴) — 쓰기 권한이 있을 때만 읽는다. 표가 없거나 실패해도 빈 배열([[#95]]).
    access.canWrite ? loadRecentImports(admin, access.tenantId, classId) : Promise.resolve([]),
  ]);

  if (scheduleRes.error) return { ok: false, error: "시간표를 불러오지 못했습니다" };
  if (goalRes.error) return { ok: false, error: "월간 목표를 불러오지 못했습니다" };

  /**
   * MP 칸 — 🔴 **여기서 throw하지 않는다.** 0239a는 원장이 손으로 적용하므로 앱 배포와 적용 사이에
   * 항상 간격이 있고([[#95]]), 그 사이에 이 조회가 화면을 죽이면 **달력·진도표까지 함께** 못 쓰게 된다.
   * ⚠️ 원인을 단정하지 않는다 — 표가 없는 것(42P01·PGRST205)과 조회 실패는 다른 사실이다.
   */
  const mpErr = mpRes?.error ?? null;
  const mpCode = mpErr ? String(mpErr.code ?? "") : "";
  const mpStatus: MpDataStatus = !isEie
    ? "off"
    : !mpErr
      ? "ok"
      : mpCode === "42P01" ||
          mpCode === "PGRST205" ||
          /does not exist|could not find the table/i.test(mpErr.message ?? "")
        ? "missing-table"
        : "failed";
  /**
   * 월 메모 — MP와 **같은 이유로** throw하지 않는다([[#95]]). 0246a는 원장이 손으로 적용하므로
   * 배포와 적용 사이에 간격이 있고, 그 사이 이 조회가 죽으면 달력·진도표·계획까지 함께 못 쓰게 된다.
   */
  const memoErr = memoRes?.error ?? null;
  const memoCode = memoErr ? String(memoErr.code ?? "") : "";
  const memoStatus: MonthMemoStatus = !memoErr
    ? "ok"
    : memoCode === "42P01" ||
        memoCode === "PGRST205" ||
        /does not exist|could not find the table/i.test(memoErr.message ?? "")
      ? "missing-table"
      : "failed";
  const memoBody = typeof memoRes?.data?.body === "string" ? memoRes.data.body : "";

  const mpCells: MpCell[] = (mpRes?.data ?? [])
    .map((r) => ({
      planDate: String(r.plan_date).slice(0, 10),
      colKind: String(r.col_kind) as MpColKind,
      body: typeof r.body === "string" ? r.body : "",
    }))
    // 기간 밖 칸은 이 문서에 섞지 않는다 — 꼬리말·제목만 예외로 **이 라벨월의 것**을 남긴다(옆 달 것은 버린다).
    .filter((c) =>
      c.colKind === "footer" || c.colKind === "title" ? c.planDate === footerDate : c.planDate >= from && c.planDate <= to,
    );

  const roomRows = (roomsRes.data ?? []) as { id: string; name: string }[];
  const roomNameById = new Map(roomRows.map((r) => [r.id, r.name]));
  const roomNames = roomRows.map((r) => r.name);

  /**
   * 슬롯 담당 표시 이름 — 주간 시트(`queries.ts`)가 하는 것과 **같은 조회**(id → display_name).
   * 한 반 한 달의 담당은 많아야 서넛이라 청크 하나로 끝난다.
   */
  const slotTeacherIds = new Set<string>();
  for (const r of scheduleRes.data ?? []) {
    const id = (r.teacher_id as string | null) ?? null;
    if (id) slotTeacherIds.add(id);
  }
  const slotTeacherNames: Record<string, string> = {};
  if (slotTeacherIds.size > 0) {
    const rows = await fetchInChunks<{ id: string; display_name: string | null }>(
      [...slotTeacherIds],
      (chunk) => admin.from("users").select("id, display_name").eq("tenant_id", access.tenantId).in("id", chunk),
    );
    for (const u of rows) if (u.display_name) slotTeacherNames[u.id] = u.display_name;
  }
  const classTeacherName = (teacherRes?.data?.display_name as string | null | undefined) ?? null;

  /**
   * 교시 담당 표시명 — **주간 시트(`period-block.tsx`)와 글자 그대로 같은 순서**: 라벨 → 슬롯 담당 → 담임.
   *
   * 🔴 **라벨이 먼저다. 뒤집지 말 것** — 라벨과 FK가 서로 다른 사람을 가리키는 슬롯이 실제로 있어서,
   *    FK를 앞세우면 시간표·주간 시트와 어긋난 이름이 월간에만 뜬다(period-block.tsx 주석·changelog 2026-07-29).
   * ⚠️ 자리(LAB·JJ)는 라벨이 곧 이름이라 `resolveTeacherLabel`이 그대로 돌려주고, FK가 null이라
   *    폴백에도 안 걸린다 — 자리가 사람 이름으로 바뀌는 일은 구조적으로 없다.
   */
  const displayTeacherOf = (r: Record<string, unknown>): string | null => {
    const label = resolveTeacherLabel((r.slot_teacher_label as string | null) ?? null, labelMap);
    if (label) return label;
    const id = (r.teacher_id as string | null) ?? null;
    return (id ? (slotTeacherNames[id] ?? null) : null) ?? classTeacherName;
  };

  const scheduleRows: MonthScheduleRow[] = (scheduleRes.data ?? []).map((r) => ({
    dayOfWeek: String(r.day_of_week),
    startTime: String(r.start_time),
    endTime: r.end_time ? String(r.end_time) : null,
    validFrom: r.valid_from ? String(r.valid_from) : null,
    validTo: r.valid_to ? String(r.valid_to) : null,
    slotTeacherLabel: displayTeacherOf(r),
    // 🔴 주간 시트(`queries.ts`)와 **같은 두 함수**로 해석한다 — 갈리면 같은 반의 같은 교시가
    //    주간과 월간에서 다른 방 이름으로 뜬다.
    slotRoomLabel: canonicalRoomName(
      resolveRoomName({
        slotClassroomName: r.classroom_id ? (roomNameById.get(String(r.classroom_id)) ?? null) : null,
        slotRoomLabel: (r.slot_room_label as string | null) ?? null,
      }),
      roomNames,
    ),
  }));

  const dates = rangeDates(from, to);
  const slotsByDate = slotsByDateOf(dates, scheduleRows);
  const seatByKey = new Map<string, boolean>();
  for (const [date, slots] of Object.entries(slotsByDate)) {
    for (const slot of slots) seatByKey.set(slotKey(date, slot.slotStart), slot.seat !== null);
  }

  // 자리 여부는 **그 날 그 교시의 배정**에서 온다 — 계획 줄에는 그 사실이 없다.
  //
  // 🔴 **배정에 없는 '고아 줄'은 담지 않는다** — 시간표가 바뀌어 그 교시가 사라지면 줄만 남는데,
  //    월간 화면엔 그 줄을 놓을 칸이 없다(칸은 배정에서 나온다). 담아 두면 **툴바 요약과 카드 배지가
  //    서로 다른 수를 말한다**(요약은 줄 전체를, 카드는 배정 슬롯만 센다). 실측 2026-08 계획 930줄 중
  //    고아는 1줄이지만, 어긋난 숫자는 개수와 무관하게 화면을 못 믿게 만든다.
  //    ⚠️ 데이터가 사라지는 건 아니다 — **주간 시트가 고아 슬롯을 경고와 함께 그대로 보여준다**(정본).
  //
  // 🔴 **빈 줄(영역만 고른 placeholder)은 담지 않는다** — 월간은 읽는 화면이라 편집할 일이 없는데,
  //    그리면 알약 하나만 덩그러니 남고(실화면 8/19) 작성률도 "썼다"로 잡혀 화면과 숫자가 어긋난다.
  //    판정은 주간 시트·랜딩과 **같은 함수**(`isMeaningfulPlanLine` = SQL `ecs_is_meaningful_line` 미러).
  const lines: MonthPlanLine[] = lineRows
    .map((row) => {
      const dto = planLineFromRow(row);
      return { ...dto, seat: seatByKey.get(slotKey(dto.planDate, dto.slotStart)) ?? false };
    })
    .filter((l) => seatByKey.has(slotKey(l.planDate, l.slotStart)))
    .filter((l) =>
      isMeaningfulPlanLine({
        textbook: l.textbook,
        pageRange: l.pageRange,
        progress: l.progress,
        homework: l.homework,
      }),
    );

  const linesBySlot: Record<string, MonthPlanLine[]> = {};
  for (const line of lines) {
    const key = slotKey(line.planDate, line.slotStart);
    (linesBySlot[key] ??= []).push(line);
  }

  const goals: { homeroom: MonthGoalMap; assistant: MonthGoalMap } = { homeroom: {}, assistant: {} };
  for (const row of goalRes.data ?? []) {
    const role = row.role === "assistant" ? "assistant" : "homeroom";
    goals[role][String(row.skill_area)] = {
      textbook: (row.textbook as string | null) ?? null,
      targetProgress: (row.target_progress as string | null) ?? null,
    };
  }

  // 교시 라벨 — 요일별 표로 슬롯마다 확정(주간 시트와 같은 규약: 주말은 별도 교시표).
  const periodsConfig = settingsToPeriodsConfig(settings.operations);
  const periodTables = {
    weekday: tableToEntries(weekdayTableFor(access.subject, periodsConfig)),
    weekend: tableToEntries(periodsConfig.weekend),
  };
  const periodLabelBySlot: Record<string, string> = {};
  for (const [date, slots] of Object.entries(slotsByDate)) {
    const weekend = isWeekendDow(dowKeyOf(date));
    for (const slot of slots) {
      const label = resolvePeriodLabel(slot.slotStart, slot.slotEnd, periodTables, weekend);
      if (label) periodLabelBySlot[slotKey(date, slot.slotStart)] = label;
    }
  }

  const hasLines = (date: string, slotStart: string) => (linesBySlot[slotKey(date, slotStart)]?.length ?? 0) > 0;

  // 이 기간으로 좁힌 휴일 — 전 연도를 클라로 내려보낼 이유가 없다(설정엔 2027년까지 들어 있다).
  const holidays: Record<string, string> = {};
  for (const [date, name] of Object.entries(buildHolidayMap(settings.operations.holidays))) {
    if (date >= from && date <= to) holidays[date] = name;
  }

  return {
    ok: true,
    data: {
      classId,
      // ⚠️ 예약된 개명 예고는 아직 안 붙인다 — 그 규약은 **주 단위 축**(`classNameForWeek`)이라
      //    달 중간에 이름이 바뀌는 경우 헤더를 어느 이름으로 쓸지가 새 결정이다. 필요해지면 그때.
      className: access.className,
      teacherId: access.teacherId,
      teacherName: classTeacherName,
      month,
      monthLabel: monthLabel(month),
      today,
      period: { mode: periodMode, kind: window.kind, start: from, end: to },
      currentMonth,
      dows: activeDowsOf(Object.keys(slotsByDate)),
      weeks: rangeWeeks(from, to),
      slotsByDate,
      linesBySlot,
      // 🔑 **원래 계획**을 싣는다(원장 2026-09-28 *"계획 놔두고 일정만 밀리게"*) — 미루기는 가져오기(일정)에만
      //    반영되고 달력의 '계획' 표식·비교 배지는 처음 배정한 그대로를 기준으로 선다.
      plannedBySlot: plannedRes.baselineByCell,
      lessonIndex: plannedRes.lessonIndex,
      shiftBySlot: plannedRes.shiftByCell,
      recentImports,
      lines,
      periodLabelBySlot,
      goals,
      skillAreas: access.skillAreas,
      canEdit: access.canWrite,
      fill: monthFillStats(slotsByDate, hasLines, holidays),
      holidays,
      // 🔴 계정에 저장된 보기가 `mp`인데 인재원 영어 반을 열면 **달력으로 떨어뜨린다** — 저장값을
      //    그대로 믿으면 없는 보기가 빈 화면으로 선다(주소 `?view=mp`도 page.tsx에서 같은 함수를 탄다).
      view: clampEcsMonthView(readEcsMonthView(uiPrefs), isEie),
      display: {
        cal: readEcsMonthDisplay(uiPrefs, "cal"),
        rail: readEcsMonthDisplay(uiPrefs, "rail"),
        mp: readEcsMonthDisplay(uiPrefs, "mp"),
      },
      isEie,
      mp: { cells: mpCells, status: mpStatus },
      memo: { body: memoBody, status: memoStatus },
    },
  };
}
