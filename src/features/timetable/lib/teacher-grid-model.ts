// 강사뷰(강사-major 10분 격자) **순수 레이아웃 모델** — 화면([teacher-grid.tsx])과
// 엑셀 익스포터([features/exports/english-timetable/teacher-grid-sheet.ts])가 **공유하는 단일 소스**.
// 시트 "강사별영어시간표" 기하(강사=세로 블록·요일 가로·10분 행·수업 블록 rowSpan 병합·병렬 LAB 레인)를
// 한 곳에서 계산해, 화면과 엑셀의 셀 배치가 구조적으로 정확히 일치하게 한다.
// ⚠️ 순수 모듈 — server-only 금지([[#61]]). px·테두리·JSX 같은 표현은 각 소비처가 담당.
import {
  buildTenMinuteRows,
  buildSlotIntervals,
  packGroups,
  slotRowSpan,
  breakBlocksForColumn,
  parseBreakRanges,
  minToHM,
  STEP_MIN,
  type TenMinuteRow,
  type PlacedGroup,
  type ClassInterval,
} from "./ten-minute-grid";
import type { DayOfWeek } from "./periods";
import { ENGLISH_SHEET_TEACHERS, buildTeacherComparator } from "./english-teacher-sheet";
import { readableTextColor } from "@/lib/color-utils";
import type { TeacherColorMap } from "./class-grid";

const DAY_ORDER: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** 모델이 요구하는 슬롯 최소 필드(teacherOf + 격자 계산). ScheduleSlotWithStudents가 구조 호환. */
export type TeacherGridSlot = {
  classId: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  slotTeacherLabel: string | null;
  teacherName: string | null;
};

/** 한 강사×요일 컬럼의 렌더 모델 — (행,레인)별 앵커 블록/피복/쉬는시간.
 *  ⚠️ 두 표현을 함께 제공: **그룹 병합**(anchors/covered — 화면이 병렬 반을 한 테두리 안 colSpan 셀로) +
 *     **레인별**(laneAnchors/laneCovered — 엑셀이 병렬 반을 개별 컬럼 셀로, 스프레드시트에 자연스러운 서브컬럼).
 *     둘은 같은 packGroups 결과의 다른 렌더용이라 laneCount=1인 일반 강사에선 동일하다. */
export type TeacherColLayout<T> = {
  day: DayOfWeek;
  /** 이 요일에 필요한 총 레인 수(병렬 반 없으면 1). */
  laneCount: number;
  /** [화면] `${rowIndex}:${lane}` → 앵커 그룹(colSpan=laneWidth 병합 + rowSpan). */
  anchors: Map<string, { group: PlacedGroup<T>; span: number }>;
  /** [화면] 그룹 앵커에 피복된 (행,레인) 셀 — skip. */
  covered: Set<string>;
  /** [엑셀] `${rowIndex}:${lane}` → 그 레인의 앵커 블록(반 1개, colSpan=1 + rowSpan). */
  laneAnchors: Map<string, { interval: ClassInterval<T>; span: number; startMin: number; endMin: number }>;
  /** [엑셀] 레인 앵커의 세로 rowSpan 연속에 피복된 (행,레인) 셀 — skip(가로 이웃은 별도 앵커). */
  laneCovered: Set<string>;
  /** 행index → 쉬는시간 밴드(전 레인 colSpan, rowSpan). */
  breakAnchors: Map<number, { span: number }>;
  /** 쉬는시간에 피복된 행 index. */
  breakCovered: Set<number>;
};

export type TeacherGridColumn<T> = {
  name: string;
  /** 강사 헤더색(DB 저장색 우선 → 시트 미러색 폴백). null=색 없음(중립). */
  color: { bg: string; text: string } | null;
  cols: TeacherColLayout<T>[];
  /** 가로줄(교시 경계) 미표시 강사(과목 설정 teacherViewLineExcluded). */
  lineExcluded: boolean;
};

export type TeacherGridModel<T> = {
  rows: TenMinuteRow[];
  teachers: TeacherGridColumn<T>[];
};

/** 슬롯 강사 라벨(컬럼 키) — slot_teacher_label 우선, 없으면 담임. */
export function teacherOf(s: TeacherGridSlot): string {
  return s.slotTeacherLabel ?? s.teacherName ?? "—";
}

/** 강사 헤더색 — DB 저장색(직원 등록) 우선, 미등록은 시트 미러색(ENGLISH_SHEET_TEACHERS) 폴백. */
export function resolveTeacherColor(
  name: string,
  teacherColors?: TeacherColorMap,
): { bg: string; text: string } | null {
  const db = teacherColors?.[name];
  if (db) return { bg: db.bg, text: db.text ?? readableTextColor(db.bg) };
  const sheet = ENGLISH_SHEET_TEACHERS[name]?.color;
  if (sheet) return { bg: sheet, text: readableTextColor(sheet) };
  return null;
}

/**
 * 강사뷰 레이아웃 모델 계산 — teacher-grid.tsx의 teachers/prepared/rows 산출과 **동일 알고리즘**.
 * 소비처(화면/엑셀)는 이 모델만 순회해 각자 렌더한다. stepMin·breaks·excluded·색은 과목 설정에서.
 */
export function buildTeacherGridModel<T extends TeacherGridSlot>(
  slots: readonly T[],
  opts: {
    stepMin?: number;
    breakRanges?: { start: string; end: string }[];
    excludedTeachers?: string[];
    teacherColors?: TeacherColorMap;
    /** 강사 컬럼 순서(학원설정). 미지정 = 시트 미러 순서 + 자리(JJ·LAB) 최우측. */
    teacherOrder?: readonly string[];
  } = {},
): TeacherGridModel<T> {
  const stepMin = opts.stepMin ?? STEP_MIN;
  const breaks = parseBreakRanges(opts.breakRanges, stepMin);
  const excludedSet = new Set(opts.excludedTeachers ?? []);

  // 강사 목록 = 슬롯 강사 라벨, 시트 좌→우 순서. 각 강사의 요일은 실제 가르치는 요일만(자연순 월→토).
  const teacherNames = Array.from(new Set(slots.map(teacherOf))).sort(
    buildTeacherComparator(opts.teacherOrder),
  );
  const teacherCols = teacherNames
    .map((name) => {
      const daySet = new Set(slots.filter((s) => teacherOf(s) === name).map((s) => s.dayOfWeek as DayOfWeek));
      const days = DAY_ORDER.filter((d) => daySet.has(d));
      return { name, days, color: resolveTeacherColor(name, opts.teacherColors) };
    })
    .filter((t) => t.days.length > 0);

  // 행 = 시간 격자(데이터 범위 ∪ 시트 폴백 14:20~22:00, 단위=stepMin).
  const rows = buildTenMinuteRows(slots, undefined, stepMin);

  const teachers: TeacherGridColumn<T>[] = teacherCols.map((t) => {
    const cols: TeacherColLayout<T>[] = t.days.map((day) => {
      const colSlots = slots.filter((s) => teacherOf(s) === t.name && s.dayOfWeek === day);
      // ⚠️ 슬롯=블록 1:1(접기 없음) — 한 수업이 2교시 연속이어도 시트처럼 교시별 셀 2개(검은 교시선 미러).
      const intervals = buildSlotIntervals(colSlots, stepMin);
      const { groups, laneCount } = packGroups(intervals);
      const anchors = new Map<string, { group: PlacedGroup<T>; span: number }>();
      const covered = new Set<string>();
      const laneAnchors = new Map<
        string,
        { interval: ClassInterval<T>; span: number; startMin: number; endMin: number }
      >();
      const laneCovered = new Set<string>();
      for (const g of groups) {
        const { index, span } = slotRowSpan(rows, minToHM(g.startMin), minToHM(g.endMin));
        // [화면] 그룹 병합 셀 — 앵커 (index,laneStart), 나머지 rowSpan×laneWidth 사각형은 covered.
        anchors.set(`${index}:${g.laneStart}`, { group: g, span });
        for (let r = index; r < index + span; r++)
          for (let l = g.laneStart; l < g.laneStart + g.laneWidth; l++)
            if (!(r === index && l === g.laneStart)) covered.add(`${r}:${l}`);
        // [엑셀] 병렬 반을 레인별 개별 셀로 — 반 k를 레인 (laneStart+k)에 두고, 그 레인의 rowSpan만 피복.
        g.intervals.forEach((interval, k) => {
          const lane = g.laneStart + k;
          laneAnchors.set(`${index}:${lane}`, { interval, span, startMin: g.startMin, endMin: g.endMin });
          for (let r = index + 1; r < index + span; r++) laneCovered.add(`${r}:${lane}`);
        });
      }
      // 쉬는 시간 블록(앞뒤 수업 붙은 경우만) — 전 레인 폭. 앵커 행 + 피복 행.
      const breakAnchors = new Map<number, { span: number }>();
      const breakCovered = new Set<number>();
      for (const bl of breakBlocksForColumn(rows, intervals, breaks)) {
        breakAnchors.set(bl.index, { span: bl.span });
        for (let r = bl.index; r < bl.index + bl.span; r++) breakCovered.add(r);
      }
      return { day, laneCount, anchors, covered, laneAnchors, laneCovered, breakAnchors, breakCovered };
    });
    return { name: t.name, color: t.color, cols, lineExcluded: excludedSet.has(t.name) };
  });

  return { rows, teachers };
}
