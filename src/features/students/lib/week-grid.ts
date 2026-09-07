import {
  subjectWeekdayPeriods,
  subjectWeekendPeriods,
  periodListLabel,
  type DayOfWeek,
  type PeriodsConfig,
  DEFAULT_PERIODS_CONFIG,
} from "@/features/timetable/lib/periods";
import { computeBlocks, cellClassKey, type CellBlock } from "@/features/timetable/lib/grid";

/**
 * 학생 개인 주간 시간표(과목별)의 순수 배치 로직 — 서버/클라 무관 순수함수 → Vitest로 고정.
 * **교시 행 × 요일 열** — 단일 과목. 실제 시간표 기본뷰처럼 연속 교시를 세로 rowSpan으로 병합(computeBlocks).
 * 과목 교시표가 하나라 교시 축이 명확(전 과목 통합은 교시 체계가 달라 시각축이라야 정확 → v1에서 제거).
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
    periodLabel: string;
    room?: string | null;
    teacherName?: string | null;
    /** 자리(LAB·JJ) 교시면 그 이름 — 사람이 아니라 방이라 화면이 다르게 그린다. */
    seat?: string | null;
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
  teacherName: string | null;
  subject: string;
  /** 그 슬롯의 강의실(slot_room_label ?? 반 기본 classroom). 없으면 null. */
  room: string | null;
  /** 자리(LAB·JJ) 교시면 그 이름 — 담당 자리에 사람 이름 대신 방을 적는다. */
  seat: string | null;
};

/** 교시 행 1개(개별 교시). 수학계열 '2교시 묶음' 라벨은 렌더 단계에서 rowSpan=2로 표시(축은 개별 교시). */
export type PeriodGridRow = { key: string; label: string; time: string; order: number };

export type SubjectPeriodGrid = {
  days: DayOfWeek[]; // 그 과목·평일/주말에 실제 등장하는 요일, 월→일
  rows: PeriodGridRow[]; // 표준 교시 전체(빈 교시 포함) + 데이터의 비표준 시각(폴백) 합집합, 시각순
  /** (행,열) 슬롯 — 학생은 한 칸에 0/1개. */
  cellAt: (ri: number, ci: number) => PeriodCell | null;
  /** 병합 블록(anchor `${ri}:${ci}`만). 없는 좌표는 위 블록에 피복(렌더 스킵). 세로(연속 교시)만 병합. */
  blocks: Map<string, CellBlock>;
};

/**
 * 단일 과목의 (교시 × 요일) 격자 + 연속 교시 세로 병합.
 * @param weekend true=주말표(토·일, 과목무관 시간단위 교시) / false=평일표(과목별 교시).
 */
export function buildSubjectPeriodGrid(
  rows: WeekGridRow[],
  subject: string,
  weekend: boolean,
  config: PeriodsConfig = DEFAULT_PERIODS_CONFIG,
): SubjectPeriodGrid {
  const periodList = weekend ? subjectWeekendPeriods(config) : subjectWeekdayPeriods(subject, config);
  const startToId = new Map<string, string>();
  for (const p of periodList) if (!startToId.has(hm5(p.startTime))) startToId.set(hm5(p.startTime), p.id);
  const rowKeyOfStart = (st: string) =>
    startToId.has(hm5(st)) ? `p-${startToId.get(hm5(st))!}` : `x-${hm5(st)}`;

  // 표준 교시 행(수업 없어도 표시 — 균일 격자·수학 묶음 라벨 유지).
  const rowMap = new Map<string, PeriodGridRow>();
  for (const p of periodList) {
    rowMap.set(`p-${p.id}`, {
      key: `p-${p.id}`,
      // 교시 이름은 학원설정이 단일 소스 — 코드가 "N교시"를 지어내지 않는다(비운 이름은 빈 문자열로
      // 내려가 렌더가 시간대만 그린다, 2026-08-13). 수학계열 '묶음' 라벨만 렌더 단계에서 따로 만든다.
      label: periodListLabel(p),
      time: `${hm5(p.startTime)}~${hm5(p.endTime)}`,
      order: toMin(p.startTime),
    });
  }

  // 셀 수집 + 등장 요일 + 비표준 시각(폴백) 행 추가. 평일/주말 슬롯 분리.
  const daySet = new Set<DayOfWeek>();
  const cellMap = new Map<string, PeriodCell>(); // key `${rowKey}::${day}`
  for (const r of rows) {
    if (r.subject !== subject) continue;
    for (const s of r.slots) {
      if (WEEKEND.has(s.day) !== weekend) continue;
      daySet.add(s.day);
      const rk = rowKeyOfStart(s.startTime);
      if (rk.startsWith("x-") && !rowMap.has(rk)) {
        rowMap.set(rk, { key: rk, label: hm5(s.startTime), time: hm5(s.startTime), order: toMin(s.startTime) });
      }
      cellMap.set(`${rk}::${s.day}`, {
        classId: r.classId,
        className: r.className,
        // 🔴 **교시 담당이 먼저**다 — 반 담임은 그게 없을 때의 폴백이다(영어는 교시마다 갈린다).
        teacherName: s.teacherName ?? r.teacherName,
        subject: r.subject,
        room: s.room ?? null,
        seat: s.seat ?? null,
      });
    }
  }

  const gridRows = Array.from(rowMap.values()).sort((a, b) => a.order - b.order);
  const days = DAY_ORDER.filter((d) => daySet.has(d));
  const cellAt = (ri: number, ci: number): PeriodCell | null =>
    cellMap.get(`${gridRows[ri]?.key}::${days[ci]}`) ?? null;
  const blocks = computeBlocks(
    gridRows.length,
    days.length,
    (ri, ci) => cellClassKey([cellAt(ri, ci)?.classId].filter((x): x is string => Boolean(x))),
    false, // 세로(연속 교시)만 병합 — 요일은 각자 열(단일 학생이라 가로 병합 불필요).
  );
  return { days, rows: gridRows, cellAt, blocks };
}
