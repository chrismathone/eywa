import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import type { ScheduleSlotWithStudents } from "@/features/timetable/server/queries";
import {
  slotPeriodRow,
  subjectPeriodRows,
  type DayOfWeek,
  type PeriodRow,
  type TimetableSubject,
} from "@/features/timetable/lib/periods";
import { cellClassKey, computeBlocks, sortDaysByGroup } from "@/features/timetable/lib/grid";
import { ClassCell } from "./class-cell";

const DAY_LABEL: Record<string, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};

// 요일 그룹 — ijw식 월목/화금/수/주말. band=그룹타이틀 색, tint=요일헤더 색.
type GroupDef = { title: string; days: DayOfWeek[]; band: string; tint: string; merge: boolean };

const WEEKDAY_GROUPS: GroupDef[] = [
  { title: "월/목", days: ["mon", "thu"], band: "bg-blue-soft text-blue", tint: "bg-blue-soft/50", merge: true },
  { title: "화/금", days: ["tue", "fri"], band: "bg-purple-soft text-purple", tint: "bg-purple-soft/50", merge: true },
  { title: "수", days: ["wed"], band: "bg-primary-soft text-primary", tint: "bg-primary-soft/50", merge: true },
];
const WEEKEND_GROUP: GroupDef = {
  title: "주말", days: ["sat", "sun"], band: "bg-amber-soft text-amber", tint: "bg-amber-soft/50", merge: false,
};
const WEEKEND_KEYS = new Set<DayOfWeek>(["sat", "sun"]);

// 엑셀식 격자 — table-layout:fixed + colgroup으로 모든 요일 컬럼을 동일 폭으로 못박는다(줄맞춤).
const PERIOD_COL_W = 92;
const DAY_COL_W = 150;
// 모든 교시 행을 동일 높이로 통일 → 평일·주말 표가 같은 격자선에 정렬(ijw식). 넘치면 셀 내부 스크롤.
const ROW_H = 132;

type TeacherCol = { name: string; days: DayOfWeek[] };
type GroupCols = GroupDef & { teachers: TeacherCol[]; dayCount: number };

/** 슬롯에서 그룹별 컬럼(강사→요일) 구성. 해당 그룹 요일에 수업 있는 강사만, 요일은 그룹 순서. */
function buildGroups(slots: ScheduleSlotWithStudents[], defs: GroupDef[]): GroupCols[] {
  const teachers = Array.from(new Set(slots.map((s) => s.teacherName ?? "—"))).sort((a, b) =>
    a.localeCompare(b, "ko"),
  );
  const out: GroupCols[] = [];
  for (const def of defs) {
    const groupDaySet = new Set(def.days);
    const cols: TeacherCol[] = [];
    for (const t of teachers) {
      const days = sortDaysByGroup(
        Array.from(
          new Set(
            slots
              .filter((s) => (s.teacherName ?? "—") === t && groupDaySet.has(s.dayOfWeek as DayOfWeek))
              .map((s) => s.dayOfWeek as DayOfWeek),
          ),
        ),
      );
      if (days.length > 0) cols.push({ name: t, days });
    }
    if (cols.length > 0) {
      out.push({ ...def, teachers: cols, dayCount: cols.reduce((a, c) => a + c.days.length, 0) });
    }
  }
  return out;
}

/** 같은 반(classId) 슬롯들을 한 카드로 합침 — 시간 범위 min~max, 학생은 반 기준 동일. */
function mergeSlotsByClass(slots: ScheduleSlotWithStudents[]): ScheduleSlotWithStudents[] {
  const byClass = new Map<string, ScheduleSlotWithStudents[]>();
  for (const s of slots) {
    (byClass.get(s.classId) ?? byClass.set(s.classId, []).get(s.classId)!).push(s);
  }
  const out: ScheduleSlotWithStudents[] = [];
  for (const g of byClass.values()) {
    const first = g[0]!;
    const startTime = g.reduce((m, s) => (s.startTime < m ? s.startTime : m), first.startTime);
    const endTime = g.reduce((m, s) => (s.endTime > m ? s.endTime : m), first.endTime);
    out.push({ ...first, startTime, endTime });
  }
  return out.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/**
 * 그룹밴드 시간표 한 판 — 좌측 교시열 + (그룹타이틀 → 강사 → 요일) 3단 헤더 + 교시 행.
 * 같은 반은 연속 교시(세로 rowSpan)·인접 요일(가로 colSpan)에 걸쳐 한 칸으로 병합(computeBlocks).
 * 주말 그룹은 가로 병합 끔(merge=false, 토/일 분리). 평일/주말 각각 호출.
 */
function GroupTable({
  slots,
  subject,
  groups,
  weekend,
  rowHeight,
  stickyPeriod = true,
}: {
  slots: ScheduleSlotWithStudents[];
  subject: TimetableSubject;
  groups: GroupCols[];
  weekend: boolean;
  rowHeight: number;
  stickyPeriod?: boolean;
}) {
  // 평일 표만 교시열 sticky(좌측 고정). 우측 주말 표는 자기 교시열이라 non-sticky(겹침 방지).
  const periodHeadSticky = stickyPeriod ? "sticky left-0 z-20" : "";
  const periodCellSticky = stickyPeriod ? "sticky left-0 z-10" : "";
  const rowOf = (s: ScheduleSlotWithStudents) =>
    slotPeriodRow(subject, s.startTime, s.dayOfWeek as DayOfWeek);

  // 표준 교시 전체(수업 없어도 표시 — 빈 교시도 균일 높이) + 데이터에만 있는 비표준 시각(폴백) 합집합.
  const rowMap = new Map<string, PeriodRow>();
  for (const r of subjectPeriodRows(subject, weekend)) rowMap.set(r.key, r);
  for (const s of slots) {
    const r = rowOf(s);
    if (!rowMap.has(r.key)) rowMap.set(r.key, r);
  }
  const rows = Array.from(rowMap.values()).sort((a, b) => a.order - b.order);

  // (teacher::day::rowKey) → slots
  const cell = new Map<string, ScheduleSlotWithStudents[]>();
  for (const s of slots) {
    const k = `${s.teacherName ?? "—"}::${s.dayOfWeek}::${rowOf(s).key}`;
    (cell.get(k) ?? cell.set(k, []).get(k)!).push(s);
  }

  // 그룹×강사별 2D 병합 사전계산. cellAt(행,열)=그 교시·요일 슬롯, blocks=병합 블록(anchor만).
  const prepared = groups.map((g) => ({
    ...g,
    teachers: g.teachers.map((t) => {
      const cellAt = (ri: number, ci: number) =>
        cell.get(`${t.name}::${t.days[ci]}::${rows[ri]!.key}`) ?? [];
      const blocks = computeBlocks(
        rows.length,
        t.days.length,
        (ri, ci) => cellClassKey(cellAt(ri, ci).map((s) => s.classId)),
        g.merge,
      );
      return { ...t, cellAt, blocks };
    }),
  }));

  // 평탄 요일 컬럼 목록 — colgroup으로 균일 폭 고정(엑셀 줄맞춤).
  const dayCols = groups.flatMap((g) => g.teachers.flatMap((t) => t.days));
  const tableW = PERIOD_COL_W + dayCols.length * DAY_COL_W;

  return (
    <table className="border-collapse text-sm" style={{ tableLayout: "fixed", width: tableW }}>
      <colgroup>
        <col style={{ width: PERIOD_COL_W }} />
        {dayCols.map((_, i) => (
          <col key={i} style={{ width: DAY_COL_W }} />
        ))}
      </colgroup>
      <thead>
        {/* 그룹타이틀 밴드 */}
        <tr>
          <th
            rowSpan={3}
            className={`bg-bg-soft border-line ${periodHeadSticky} w-[92px] border-b border-r p-2 text-left align-bottom`}
          >
            <span className="micro">교시</span>
          </th>
          {groups.map((g) => (
            <th
              key={g.title}
              colSpan={g.dayCount}
              className={`${g.band} border-line border-b border-r px-2 py-1.5 text-center text-[12px] font-bold`}
            >
              {g.title}
            </th>
          ))}
        </tr>
        {/* 강사 행 */}
        <tr>
          {groups.flatMap((g) =>
            g.teachers.map((t) => (
              <th
                key={`${g.title}-${t.name}`}
                colSpan={t.days.length}
                className="bg-bg-soft border-line border-b border-r px-2 py-1.5 text-center"
              >
                <span className="text-foreground block truncate text-[12px] font-bold">{t.name}</span>
              </th>
            )),
          )}
        </tr>
        {/* 요일 행 */}
        <tr>
          {groups.flatMap((g) =>
            g.teachers.flatMap((t) =>
              t.days.map((d) => (
                <th
                  key={`${g.title}-${t.name}-${d}`}
                  className={`${g.tint} border-line text-text-dim border-b border-r px-2 py-1 text-center font-mono text-[10px] font-bold`}
                >
                  {DAY_LABEL[d] ?? d}
                </th>
              )),
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={row.key}>
            <td
              className={`bg-bg-soft border-line text-foreground ${periodCellSticky} border-b border-r px-2 py-2 align-top text-[12px] font-bold whitespace-nowrap`}
              style={{ height: rowHeight }}
            >
              {row.label}
              <div className="text-text-faint mt-0.5 font-mono text-[10px]">{row.time}</div>
            </td>
            {prepared.flatMap((g) =>
              g.teachers.flatMap((t) =>
                t.days.map((d, ci) => {
                  const block = t.blocks.get(`${ri}:${ci}`);
                  if (!block) return null; // 위/왼쪽 병합에 피복됨 — 렌더 스킵
                  // 블록 전체(rowSpan×colSpan) 슬롯 모아 같은 반 합치기(시간 범위 병합)
                  const acc: ScheduleSlotWithStudents[] = [];
                  for (let rr = ri; rr < ri + block.rowSpan; rr++) {
                    for (let cc = ci; cc < ci + block.colSpan; cc++) acc.push(...t.cellAt(rr, cc));
                  }
                  const merged = mergeSlotsByClass(acc);
                  return (
                    <td
                      key={`${g.title}-${t.name}-${d}-${row.key}`}
                      rowSpan={block.rowSpan}
                      colSpan={block.colSpan}
                      className="border-line border-b border-r p-1.5 align-top"
                    >
                      {merged.length === 0 ? (
                        <span className="text-text-faint text-[11px]">—</span>
                      ) : (
                        <div
                          className="space-y-1.5 overflow-y-auto"
                          style={{ maxHeight: block.rowSpan * rowHeight - 16 }}
                        >
                          {merged.map((s) => (
                            <ClassCell key={s.id} slot={s} roster="names" />
                          ))}
                        </div>
                      )}
                    </td>
                  );
                }),
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * 시간표 기본뷰 — ijw식 요일그룹(월목/화금/수) 한 판 + 주말 한 판(시작시각이 달라 분리).
 * 두 판을 세로로 스택(각자 교시열·교시 행 — 평일 14:30~ / 주말 09:00~). 과목 단일 선택.
 */
export function WeekdayGroupTables({ slots }: { slots: ScheduleSlotWithStudents[] }) {
  const subject = (slots[0]?.subject ?? "math") as TimetableSubject;
  const weekdaySlots = slots.filter((s) => !WEEKEND_KEYS.has(s.dayOfWeek as DayOfWeek));
  const weekendSlots = slots.filter((s) => WEEKEND_KEYS.has(s.dayOfWeek as DayOfWeek));

  const weekdayGroups = buildGroups(weekdaySlots, WEEKDAY_GROUPS);
  const weekendGroups = buildGroups(weekendSlots, [WEEKEND_GROUP]);

  return (
    <DragScrollArea className="bg-card border-line shadow-card min-h-0 flex-1 rounded-2xl border p-1">
      {/* ijw식 가로 배치 — 평일 그룹(월목/화금/수) 한 판 + 주말 한 판을 우측에 나란히
          (주말은 시작시각이 달라 자체 교시열). 세로 스택 대신 가로로 공간 효율. */}
      <div className="flex items-start gap-3">
        {weekdayGroups.length > 0 ? (
          <GroupTable
            slots={weekdaySlots}
            subject={subject}
            groups={weekdayGroups}
            weekend={false}
            rowHeight={ROW_H}
          />
        ) : null}
        {weekendGroups.length > 0 ? (
          <GroupTable
            slots={weekendSlots}
            subject={subject}
            groups={weekendGroups}
            weekend
            rowHeight={ROW_H / 2}
            stickyPeriod={false}
          />
        ) : null}
      </div>
    </DragScrollArea>
  );
}
