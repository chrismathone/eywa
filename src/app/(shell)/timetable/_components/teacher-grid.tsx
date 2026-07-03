import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { readableTextColor } from "@/lib/color-utils";
import type { ScheduleSlotWithStudents } from "@/features/timetable/server/queries";
import {
  slotPeriodRow,
  subjectPeriodRows,
  DEFAULT_PERIODS_CONFIG,
  type DayOfWeek,
  type PeriodRow,
  type PeriodsConfig,
} from "@/features/timetable/lib/periods";
import { cellClassKey, computeBlocks } from "@/features/timetable/lib/grid";
import type { TeacherColorMap } from "@/features/timetable/lib/class-grid";
import {
  ENGLISH_SHEET_TEACHERS,
  compareSheetTeachers,
} from "@/features/timetable/lib/english-teacher-sheet";
import { ClassCell } from "./class-cell";

// 시트 "강사별영어시간표(7월)" = 강사-major 그리드(강사가 세로 블록, 그 안에 월~토가 가로, 왼쪽 단일 시각열).
// 통합영어시간표는 이걸 수식 파생(반-major + 학생명단) = eywa 통합뷰. 이 컴포넌트가 강사별(마스터) 그리드를 옮긴다.
// - 컬럼: [교시] + 강사별(시트 좌→우 순서) → 그 강사가 가르치는 요일(월→토 자연순). 강사마다 자기 요일만.
// - 셀: 반명 + 방만(roster="none") — 시트 강사별 탭엔 학생 없음(학생은 통합 탭). 연속 교시는 세로 병합(rowSpan).
// - 요일 병합 안 함(각 요일 독립 컬럼 = 시트). 토요일도 오후 영어 교시 축에 정렬(주말 09:00 교시 미사용).

const DAY_LABEL: Record<string, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};
const DAY_ORDER: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_OFFSET: Record<DayOfWeek, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };

const PERIOD_COL_W = 74;
const DAY_COL_W = 96; // 반명+방 chip(학생 없음)이라 기본뷰보다 좁게. 강사×요일이 많아 가로 스크롤.
const ROW_H = 52; // 교시 1칸 높이 — 반 chip(헤더만) 한 줄. 다교시 반은 rowSpan으로 늘어남.

/** 슬롯 강사 라벨(컬럼 키) — slot_teacher_label 우선, 없으면 담임. */
const teacherOf = (s: ScheduleSlotWithStudents) => s.slotTeacherLabel ?? s.teacherName ?? "—";

/** 요일 헤더 "M/D" 라벨(주 월요일 기준, UTC 롤오버 안전). */
function dayDateLabels(weekMonday?: string): Partial<Record<DayOfWeek, string>> {
  if (!weekMonday) return {};
  const [y, m, d] = weekMonday.split("-").map(Number);
  if (!y || !m || !d) return {};
  const out: Partial<Record<DayOfWeek, string>> = {};
  for (const day of DAY_ORDER) {
    const dt = new Date(Date.UTC(y, m - 1, d + DAY_OFFSET[day]));
    out[day] = `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`;
  }
  return out;
}

/** 같은 반(classId) 슬롯을 한 chip으로 — 시간범위 min~max. (한 교시 셀 안 같은 반 중복 제거.) */
function mergeByClass(slots: ScheduleSlotWithStudents[]): ScheduleSlotWithStudents[] {
  const byClass = new Map<string, ScheduleSlotWithStudents[]>();
  for (const s of slots) (byClass.get(s.classId) ?? byClass.set(s.classId, []).get(s.classId)!).push(s);
  const out: ScheduleSlotWithStudents[] = [];
  for (const g of byClass.values()) {
    const first = g[0]!;
    const startTime = g.reduce((mn, s) => (s.startTime < mn ? s.startTime : mn), first.startTime);
    const endTime = g.reduce((mx, s) => (s.endTime > mx ? s.endTime : mx), first.endTime);
    out.push({ ...first, startTime, endTime });
  }
  return out.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

type TeacherCol = { name: string; days: DayOfWeek[]; color: { bg: string; text: string } | null };

export function TeacherGridView({
  slots,
  config = DEFAULT_PERIODS_CONFIG,
  weekMonday,
  teacherColors,
}: {
  slots: ScheduleSlotWithStudents[];
  config?: PeriodsConfig;
  weekMonday?: string;
  /** 강사 헤더색(DB getTeacherColorMap) — 직원 등록된 강사 우선. 미등록은 시트 미러색 폴백. */
  teacherColors?: TeacherColorMap;
}) {
  const dayDates = dayDateLabels(weekMonday);

  // 강사 목록 = 슬롯 강사 라벨, 시트 좌→우 순서. 각 강사의 요일은 실제 가르치는 요일만(자연순 월→토).
  const teacherNames = Array.from(new Set(slots.map(teacherOf))).sort(compareSheetTeachers);
  const colorFor = (name: string): { bg: string; text: string } | null => {
    const db = teacherColors?.[name]; // 직원 등록 강사 = DB 저장색 우선
    if (db) return { bg: db.bg, text: db.text ?? readableTextColor(db.bg) };
    const sheet = ENGLISH_SHEET_TEACHERS[name]?.color; // 미등록 = 시트 미러색
    if (sheet) return { bg: sheet, text: readableTextColor(sheet) };
    return null;
  };
  const teachers: TeacherCol[] = teacherNames
    .map((name) => {
      const daySet = new Set(slots.filter((s) => teacherOf(s) === name).map((s) => s.dayOfWeek as DayOfWeek));
      const days = DAY_ORDER.filter((d) => daySet.has(d));
      return { name, days, color: colorFor(name) };
    })
    .filter((t) => t.days.length > 0);

  // 행(교시) = 영어 표준 10교시 + 데이터에만 있는 비정렬 시각(기타 폴백). 토요일도 오후라 영어 평일 교시 축 공유.
  // ⚠️ rowOf는 요일과 무관하게 항상 'mon'을 넘겨 영어 평일 교시표로 매핑(주말 09:00 교시 미사용 → 토 오후가 정렬).
  const rowOf = (s: ScheduleSlotWithStudents): PeriodRow => slotPeriodRow("english", s.startTime, "mon", config);
  const rowMap = new Map<string, PeriodRow>();
  for (const r of subjectPeriodRows("english", false, config)) rowMap.set(r.key, r);
  for (const s of slots) {
    const r = rowOf(s);
    if (!rowMap.has(r.key)) rowMap.set(r.key, r);
  }
  const rows = Array.from(rowMap.values()).sort((a, b) => a.order - b.order);

  // (teacher::day::rowKey) → slots
  const cellMap = new Map<string, ScheduleSlotWithStudents[]>();
  for (const s of slots) {
    const k = `${teacherOf(s)}::${s.dayOfWeek}::${rowOf(s).key}`;
    (cellMap.get(k) ?? cellMap.set(k, []).get(k)!).push(s);
  }

  // 강사×요일 컬럼별 세로 병합(연속 교시=같은 반 → rowSpan). merge=false: 요일 병합 안 함(colSpan=1).
  const prepared = teachers.map((t) => {
    const cols = t.days.map((day) => {
      const cellAt = (ri: number) => cellMap.get(`${t.name}::${day}::${rows[ri]!.key}`) ?? [];
      const blocks = computeBlocks(rows.length, 1, (ri) => cellClassKey(cellAt(ri).map((s) => s.classId)), false);
      return { day, cellAt, blocks };
    });
    return { ...t, cols };
  });

  const dayCols = teachers.flatMap((t) => t.days);
  const tableW = PERIOD_COL_W + dayCols.length * DAY_COL_W;

  return (
    <DragScrollArea barX className="bg-card border-line shadow-card min-h-0 flex-1 rounded-2xl border p-1">
      <table className="border-collapse text-sm" style={{ tableLayout: "fixed", width: tableW }}>
        <colgroup>
          <col style={{ width: PERIOD_COL_W }} />
          {dayCols.map((_, i) => (
            <col key={i} style={{ width: DAY_COL_W }} />
          ))}
        </colgroup>
        <thead>
          {/* 강사 밴드 — 시트 강사 헤더색(강사별 탭 r1). 미등록 강사도 시트색으로 채워 시트 패리티. */}
          <tr>
            <th rowSpan={2} aria-hidden className="bg-bg-soft border-line sticky left-0 z-20 border-b border-r" />
            {teachers.map((t) => (
              <th
                key={t.name}
                colSpan={t.days.length}
                className="border-line border-b border-r px-2 py-1.5 text-center"
                style={t.color ? { backgroundColor: t.color.bg, color: t.color.text } : undefined}
              >
                <span className={`block overflow-hidden whitespace-nowrap text-clip text-[12px] font-bold ${t.color ? "" : "text-foreground bg-bg-soft"}`}>
                  {t.name}
                </span>
              </th>
            ))}
          </tr>
          {/* 요일 행 */}
          <tr>
            {teachers.flatMap((t) =>
              t.days.map((d) => (
                <th
                  key={`${t.name}-${d}`}
                  className="bg-bg-soft border-line text-text-dim border-b border-r px-1 py-1 text-center font-mono text-[10px] leading-tight font-bold"
                >
                  {DAY_LABEL[d] ?? d}
                  {dayDates[d] ? <span className="text-text-faint block text-[9px] font-normal">{dayDates[d]}</span> : null}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={row.key}>
              <td
                className="bg-bg-soft border-line text-foreground sticky left-0 z-10 border-b border-r px-2 py-1 align-top text-[11px] font-bold whitespace-nowrap"
                style={{ height: ROW_H }}
              >
                {row.label}
                <div className="text-text-faint mt-0.5 font-mono text-[9px]">{row.time}</div>
              </td>
              {prepared.flatMap((t) =>
                t.cols.map((col) => {
                  const block = col.blocks.get(`${ri}:0`);
                  if (!block) return null; // 위 병합에 피복됨
                  const acc: ScheduleSlotWithStudents[] = [];
                  for (let rr = ri; rr < ri + block.rowSpan; rr++) acc.push(...col.cellAt(rr));
                  const merged = mergeByClass(acc);
                  return (
                    <td
                      key={`${t.name}-${col.day}-${row.key}`}
                      rowSpan={block.rowSpan}
                      className={`border-line border-b border-r p-1 align-top ${merged.length === 0 ? "bg-bg-soft/40" : ""}`}
                    >
                      {merged.length === 0 ? null : (
                        <div className="flex flex-col gap-1">
                          {merged.map((s) => (
                            <ClassCell key={s.id} slot={s} roster="none" coveringDays={[col.day]} />
                          ))}
                        </div>
                      )}
                    </td>
                  );
                }),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </DragScrollArea>
  );
}
