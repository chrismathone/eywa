import type { DayOfWeek } from "@/features/timetable/lib/periods";

/**
 * 학생 개인 주간 시간표의 순수 배치 로직 — 수강 행(등원 필터된 slots 포함)을
 * (요일 × 시각) 격자로 접는다. 과목마다 교시 체계가 달라 **시각(HH:MM) 기준**으로 병합한다
 * (교시 번호로 묶으면 과목 간 실제 시각이 어긋남). 서버/클라 무관 순수함수 → Vitest로 고정.
 */
export type WeekGridCell = {
  subject: string;
  className: string;
  teacherName: string | null;
  periodLabel: string;
};

export type WeekGridRow = {
  subject: string;
  className: string;
  teacherName: string | null;
  slots: { day: DayOfWeek; startTime: string; periodLabel: string }[];
};

export type WeekGrid = {
  days: DayOfWeek[]; // 실제 등장하는 요일만, 월→일 순
  times: string[]; // 실제 등장하는 시작시각만, 오름차순("HH:MM" 제로패딩 → 문자열 정렬)
  cells: Map<string, WeekGridCell[]>; // key = weekCellKey(day,time)
};

const DAY_ORDER: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const weekCellKey = (day: DayOfWeek, time: string) => `${day}|${time}`;

export function buildWeekGrid(rows: WeekGridRow[]): WeekGrid {
  const cells = new Map<string, WeekGridCell[]>();
  const daySet = new Set<DayOfWeek>();
  const timeSet = new Set<string>();
  for (const r of rows) {
    for (const s of r.slots) {
      daySet.add(s.day);
      timeSet.add(s.startTime);
      const key = weekCellKey(s.day, s.startTime);
      const arr = cells.get(key) ?? [];
      arr.push({
        subject: r.subject,
        className: r.className,
        teacherName: r.teacherName,
        periodLabel: s.periodLabel,
      });
      cells.set(key, arr);
    }
  }
  const days = DAY_ORDER.filter((d) => daySet.has(d));
  const times = [...timeSet].sort();
  return { days, times, cells };
}
