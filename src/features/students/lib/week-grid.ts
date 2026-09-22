import {
  subjectWeekdayPeriods,
  subjectWeekendPeriods,
  periodListLabel,
  type DayOfWeek,
  type PeriodsConfig,
  DEFAULT_PERIODS_CONFIG,
} from "@/features/timetable/lib/periods";
import { buildPeriodMatcher } from "@/features/timetable/lib/period-match";
import { computeBlocks, type CellBlock } from "@/features/timetable/lib/grid";
import { keepUsedRows } from "@/features/timetable/lib/used-rows";
import { mergeRunKeys } from "./week-grid-merge";

/**
 * 학생 개인 주간 시간표(과목별)의 순수 배치 로직 — 서버/클라 무관 순수함수 → Vitest로 고정.
 * **교시 행 × 요일 열** — 단일 과목. 연속 교시는 세로 rowSpan으로 병합(시간표와 같은 엔진 `computeBlocks`).
 * 과목 교시표가 하나라 교시 축이 명확(전 과목 통합은 교시 체계가 달라 시각축이라야 정확 → v1에서 제거).
 *
 * 🔴 2026-09-11 원장 *"왜 영어 학생들의 수업탭의 시간표 표시는 실제 영어 시간표와 다른것 같지?"* — 셋이 달랐다:
 *  ① 교시 행을 **시작시각만**으로 골라 60분 수업(인재원 16:20~17:20)이 40분 행(EiE 16:20~17:00)에 앉았다
 *     → (시작,종료) 짝 먼저([[#106]] `buildPeriodMatcher` — 시간표 기본뷰와 같은 매처).
 *  ② 반만 같으면 이어 붙여 둘째 교시의 담당·자리가 가려졌다 → 보이는 내용이 같고 시간이 이어질 때만
 *     (`week-grid-merge.ts`).
 *  ③ 영어 교시표 15줄(두 체계)을 전부 그려 다른 체계의 빈 행이 사이사이 끼었다 → 그 과목 시간표가 처음 여는
 *     뷰의 행 규칙을 따른다(`rowModeForDefaultView` — 통합뷰면 수업 있는 교시만, `keepUsedRows`).
 */

export type WeekGridRow = {
  classId: string;
  subject: string;
  className: string;
  teacherName: string | null;
  /**
   * ⚠️ `teacherName`은 **그 교시의 담당**이다(반 담임이 아니다) — 원장 2026-09-07 *"영어 주간 시간표에서
   * 스케줄마다 다 선생님이 다르고 JJ실도 있을텐데 표현 제대로"*. 영어는 한 반이 교시마다 담당이 갈리고
   * 자리(LAB·JJ) 교시도 섞인다. 없으면 반 담임으로 떨어진다(로더가 정한다).
   */
  slots: {
    day: DayOfWeek;
    startTime: string;
    /** 종료시각 — 있으면 교시 행을 (시작,종료) 짝으로 고르고, 연속 교시를 이을지 이 값으로 본다. */
    endTime?: string;
    periodLabel: string;
    room?: string | null;
    teacherName?: string | null;
    /** 자리(LAB·JJ) 교시면 그 이름 — 사람이 아니라 방이라 화면이 다르게 그린다. */
    seat?: string | null;
    /** 그 자리가 '따로 수업(*LAB)' 교시인가(0271a). */
    labSeparate?: true;
  }[];
};

const DAY_ORDER: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKEND = new Set<DayOfWeek>(["sat", "sun"]);

const hm5 = (t: string) => t.slice(0, 5);
const toMin = (t: string) => {
  const [h, m] = hm5(t).split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export type PeriodCell = {
  classId: string;
  className: string;
  /** 그 교시의 담당(없으면 반 담임). 자리(LAB·JJ) 칸은 null — 사람이 아니라 방이다. */
  teacherName: string | null;
  subject: string;
  /** 그 슬롯의 강의실(로더 규칙: FK 이름 → 라벨 정정 → 반 기본). 없으면 null. */
  room: string | null;
  /** 자리(LAB·JJ) 교시면 그 이름 — 담당 자리에 사람 이름 대신 방을 적는다. */
  seat: string | null;
  /** 그 자리가 '따로 수업(*LAB)' 교시인가(0271a) — 칸이 `LAB` 대신 `*LAB`으로 선다. */
  labSeparate?: true;
  /** 그 칸 수업의 실제 시각 `HH:MM` — 세로 병합이 '시간이 이어지나'를 본다. 종료 미상이면 null. */
  startTime: string;
  endTime: string | null;
};

/** 교시 행 1개(개별 교시). 수학계열 '2교시 묶음' 라벨은 렌더 단계에서 rowSpan=2로 표시(축은 개별 교시). */
export type PeriodGridRow = { key: string; label: string; time: string; order: number };

/** 행 구성 — `all` = 교시표 전부(기본뷰 규칙) / `used` = 수업 있는 교시만(통합뷰 규칙, `keepUsedRows`). */
export type GridRowMode = "all" | "used";

/**
 * 학생 격자의 행 구성 = 그 과목 시간표가 **처음 여는 뷰**의 규칙(학원설정 `subjects[].defaultView` 단일 소스 —
 * 판정은 `subjectDefaultView`). 통합뷰는 섹션이 실제 쓰는 교시만 그리고, 기본뷰·강사뷰는 교시표 전부를 그린다.
 * ⚠️ 영어처럼 두 교시 체계(EiE 40분·인재원 60분)가 한 표에 섞인 과목을 전 행으로 그리면 다른 체계의 빈 행이
 *    사이사이 끼어 원본(통합뷰)과 다른 모양이 된다. 수학(기본뷰)은 종전대로 전부 — 균일 격자·묶음 라벨 유지.
 */
export function rowModeForDefaultView(view: string): GridRowMode {
  return view === "integrated" ? "used" : "all";
}

export type SubjectPeriodGrid = {
  days: DayOfWeek[]; // 그 과목·평일/주말에 실제 등장하는 요일, 월→일
  rows: PeriodGridRow[]; // `all`=표준 교시 전체(빈 교시 포함) · `used`=쓴 교시만 — + 비표준 시각(폴백), 시각순
  /** (행,열) 슬롯 — 학생은 한 칸에 0/1개. */
  cellAt: (ri: number, ci: number) => PeriodCell | null;
  /** 병합 블록(anchor `${ri}:${ci}`만). 없는 좌표는 위 블록에 피복(렌더 스킵). 세로(연속 교시)만 병합. */
  blocks: Map<string, CellBlock>;
};

/**
 * 단일 과목의 (교시 × 요일) 격자 + 연속 교시 세로 병합.
 * @param weekend true=주말표(토·일, 과목무관 시간단위 교시) / false=평일표(과목별 교시).
 * @param rowMode 행 구성(`rowModeForDefaultView`). 기본 `all`.
 */
export function buildSubjectPeriodGrid(
  rows: WeekGridRow[],
  subject: string,
  weekend: boolean,
  config: PeriodsConfig = DEFAULT_PERIODS_CONFIG,
  rowMode: GridRowMode = "all",
): SubjectPeriodGrid {
  const periodList = weekend ? subjectWeekendPeriods(config) : subjectWeekdayPeriods(subject, config);
  // 🔴 (시작, 종료) 짝이 먼저, 종료가 어긋난 옛 행만 시작시각으로 폴백 — 시간표 기본뷰와 **같은 매처**([[#106]]).
  const matchPeriod = buildPeriodMatcher(periodList);
  const periodEnd = new Map(periodList.map((p) => [p.id, hm5(p.endTime)]));

  // 표준 교시 행(`all`이면 수업 없어도 표시 — 균일 격자·수학 묶음 라벨 유지).
  // order = 시작(분) + 같은 시작 교시끼리 소수부(periods.ts `periodAxisOrder`와 같은 규약) — 행마다 달라야
  // `keepUsedRows`가 시작이 같은 두 교시 중 **쓴 쪽만** 남긴다.
  const rowMap = new Map<string, PeriodGridRow>();
  const seenStart = new Map<string, number>();
  for (const p of periodList) {
    const st = hm5(p.startTime);
    const nth = seenStart.get(st) ?? 0;
    seenStart.set(st, nth + 1);
    rowMap.set(`p-${p.id}`, {
      key: `p-${p.id}`,
      // 교시 이름은 학원설정이 단일 소스 — 코드가 "N교시"를 지어내지 않는다(비운 이름은 빈 문자열로
      // 내려가 렌더가 시간대만 그린다, 2026-08-13). 수학계열 '묶음' 라벨만 렌더 단계에서 따로 만든다.
      label: periodListLabel(p),
      time: `${st}~${hm5(p.endTime)}`,
      order: toMin(st) + nth / 1000,
    });
  }

  // 셀 수집 + 등장 요일 + 비표준 시각(폴백) 행 추가. 평일/주말 슬롯 분리.
  const daySet = new Set<DayOfWeek>();
  const cellMap = new Map<string, PeriodCell>(); // key `${rowKey}::${day}`
  const usedKeys = new Set<string>();
  for (const r of rows) {
    if (r.subject !== subject) continue;
    for (const s of r.slots) {
      if (WEEKEND.has(s.day) !== weekend) continue;
      daySet.add(s.day);
      const pid = matchPeriod({ startTime: s.startTime, endTime: s.endTime });
      const rk = pid ? `p-${pid}` : `x-${hm5(s.startTime)}`;
      if (!rowMap.has(rk)) {
        rowMap.set(rk, { key: rk, label: hm5(s.startTime), time: hm5(s.startTime), order: toMin(s.startTime) });
      }
      usedKeys.add(rk);
      cellMap.set(`${rk}::${s.day}`, {
        classId: r.classId,
        className: r.className,
        // 🔴 **교시 담당이 먼저**다 — 반 담임은 그게 없을 때의 폴백이다(영어는 교시마다 갈린다).
        //    자리(LAB·JJ) 칸엔 사람을 싣지 않는다(실으면 담임 이름이 병합 비교에 섞인다).
        teacherName: s.seat ? null : (s.teacherName ?? r.teacherName),
        subject: r.subject,
        room: s.room ?? null,
        seat: s.seat ?? null,
        ...(s.labSeparate === true ? { labSeparate: true as const } : {}),
        startTime: hm5(s.startTime),
        // 종료를 안 실은 슬롯은 짝지은 교시의 끝으로(교시표에 없는 시각이면 모른다 = 잇지 않는다).
        endTime: s.endTime ? hm5(s.endTime) : pid ? (periodEnd.get(pid) ?? null) : null,
      });
    }
  }

  const sorted = Array.from(rowMap.values()).sort((a, b) => a.order - b.order);
  const gridRows =
    rowMode === "used"
      ? keepUsedRows(sorted, new Set(sorted.filter((r) => usedKeys.has(r.key)).map((r) => r.order)))
      : sorted;
  const days = DAY_ORDER.filter((d) => daySet.has(d));
  const cellAt = (ri: number, ci: number): PeriodCell | null =>
    cellMap.get(`${gridRows[ri]?.key}::${days[ci]}`) ?? null;
  const blocks = computeBlocks(
    gridRows.length,
    days.length,
    mergeRunKeys(gridRows.length, days.length, cellAt, periodList.map((p) => p.startTime)),
    false, // 세로(연속 교시)만 병합 — 요일은 각자 열(단일 학생이라 가로 병합 불필요).
  );
  return { days, rows: gridRows, cellAt, blocks };
}
