import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { readableTextColor } from "@/lib/color-utils";
import type { ScheduleSlotWithStudents } from "@/features/timetable/server/queries";
import type { DayOfWeek } from "@/features/timetable/lib/periods";
import {
  buildSlotIntervals,
  buildTenMinuteRows,
  minToHM,
  packGroups,
  slotRowSpan,
  type ClassInterval,
} from "@/features/timetable/lib/ten-minute-grid";
import type { TeacherColorMap } from "@/features/timetable/lib/class-grid";
import {
  ENGLISH_SHEET_TEACHERS,
  compareSheetTeachers,
} from "@/features/timetable/lib/english-teacher-sheet";
import { TeacherChip } from "./teacher-chip";

// 시트 "강사별영어시간표(7월)" = 강사-major 그리드(강사가 세로 블록, 그 안에 월~토가 가로).
// ⚠️ 축 = 시트와 동일한 **10분 단위 행**(2026-07-06 재작업 — 이전엔 교시 1행이라 40/60분 수업이
// 전부 같은 높이로 뭉개졌음). 수업 블록은 실제 길이만큼 rowSpan 세로 병합 = 시트 병합 셀 미러.
// - 컬럼: [시각] + 강사별(시트 좌→우 순서) → 요일. **같은 시간 범위의 병렬 반(합반·LAB)은
//   한 셀(colSpan)로 묶어 amber 테두리 안에 나란히**(packGroups) — 낱개 레인으로 흩어지지 않는다.
//   시간 범위가 다른 겹침만 별도 레인. 일반 강사는 병렬이 없어 레인 1개(화면 무변).
// - 셀: 반명+방 칩(TeacherChip) — 클릭하면 그 자리에서 재원 학생 명단으로 전환(다시 클릭=복귀).
//   한 수업이 2교시 연속이어도 시트처럼 **교시별 셀 2개**(슬롯=블록 1:1, 접기 없음 — 검은 교시선 미러).

const DAY_LABEL: Record<string, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};
const DAY_ORDER: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_OFFSET: Record<DayOfWeek, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };

const TIME_COL_W = 48; // "14:20" 한 줄 라벨
const DAY_COL_W = 96; // 반명+방 chip(학생 없음). 강사×요일이 많아 가로 스크롤.
const LANE_COL_W = 64; // 다중 레인(LAB 서브컬럼) 폭 — 레벨코드 반명(LT2 등) 기준. 시트도 좁은 서브컬럼.
const ROW_H = 14; // 10분 = 1행. 40분 수업 = 4행(56px) 블록.
const HEAD_TEACHER_H = 26; // 강사 밴드 행 높이(sticky top 오프셋 계산용)
const HEAD_DAY_H = 30; // 요일 행 높이

// 격자선 — 기본은 옅게(빈 셀 다수 = 모눈종이 톤), 정시 경계만 진하게.
const GRID_FAINT = "border-line/60";
const GRID_HOUR = "border-ink/25";

// ⚠️ [[#71]] border-collapse×sticky: 병합 모드에선 셀 테두리가 표에 속해 가로 스크롤 시 sticky
// 좌측 시각열의 좌 프레임·우 divider가 표와 함께 밀려 사라진다. box-shadow도 병합모드 td에선 불안정
// → **가상요소(::before=왼쪽, ::after=오른쪽) 1px 실선**으로 셀에 붙여 그린다(main weekday-group-tables
// 패턴 로컬 복제 — 이 브랜치는 그 픽스 커밋 이전이라 공유 상수 hoist 금지). sticky 셀에 `relative` 금지
// (position을 덮어써 sticky가 죽는다 — sticky 자체가 containing block).
const STICKY_EDGES =
  "before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-ink/25 before:content-[''] " +
  "after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-ink/25 after:content-['']";
// sticky-top 헤더 셀 — 세로 스크롤에서 하단 경계가 표와 함께 사라지는 같은 함정의 세로판.
// before=하단 h-px, after=오른쪽 w-px (한 셀에 가상요소 2개 한도라 조합 상수 분리).
const STICKY_HEAD_EDGES =
  "before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-ink/25 before:content-[''] " +
  "after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-ink/25 after:content-['']";

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

/** 구간 → 칩 표시용 슬롯(대표 슬롯 + 구간 전체 시간범위 — hover 시각이 병합 범위를 정확히 표시). */
function intervalSlot(iv: ClassInterval<ScheduleSlotWithStudents>): ScheduleSlotWithStudents {
  return { ...iv.slots[0]!, startTime: minToHM(iv.startMin), endTime: minToHM(iv.endMin) };
}

type TeacherCol = { name: string; days: DayOfWeek[]; color: { bg: string; text: string } | null };

export function TeacherGridView({
  slots,
  weekMonday,
  teacherColors,
}: {
  slots: ScheduleSlotWithStudents[];
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

  // 행 = 10분 격자(데이터 범위 ∪ 시트 폴백 14:20~22:00). 절대 시각축이라 토요일 오후도 자연 정렬
  // (옛 교시축의 rowOf 'mon' 주말 핵이 필요 없어짐).
  const rows = buildTenMinuteRows(slots);

  // 강사×요일: 같은 시간 범위 병렬 반 = 한 그룹(합반, colSpan 셀) → 그룹 단위 레인 패킹.
  const prepared = teachers.map((t) => {
    const cols = t.days.map((day) => {
      const colSlots = slots.filter((s) => teacherOf(s) === t.name && s.dayOfWeek === day);
      // ⚠️ 슬롯=블록 1:1(접기 없음) — 한 수업이 2교시 연속이어도 시트처럼 교시별 셀 2개로(2026-07-06).
      const { groups, laneCount } = packGroups(buildSlotIntervals(colSlots));
      // (행,레인) → 앵커 그룹 / 피복 셀 사전계산.
      const anchors = new Map<string, { group: (typeof groups)[number]; span: number }>();
      const covered = new Set<string>();
      for (const g of groups) {
        const { index, span } = slotRowSpan(rows, minToHM(g.startMin), minToHM(g.endMin));
        anchors.set(`${index}:${g.laneStart}`, { group: g, span });
        for (let r = index; r < index + span; r++)
          for (let l = g.laneStart; l < g.laneStart + g.laneWidth; l++)
            if (!(r === index && l === g.laneStart)) covered.add(`${r}:${l}`);
      }
      // 레인 폭 — 1레인=기본 96, 다중(병렬)=레인당 64(시트도 좁은 서브컬럼).
      const laneW = laneCount > 1 ? LANE_COL_W : DAY_COL_W;
      return { day, laneCount, laneW, anchors, covered };
    });
    return { ...t, cols };
  });

  const laneColsFlat = prepared.flatMap((t) =>
    t.cols.flatMap((col) => Array.from({ length: col.laneCount }, () => col.laneW)),
  );
  const tableW = TIME_COL_W + laneColsFlat.reduce((a, w) => a + w, 0);

  // 행 하단 경계 톤 — 다음 행이 정시면 진한 선(모눈종이의 굵은 눈금).
  const bottomGrid = (nextRowIndex: number) =>
    (rows[nextRowIndex]?.isHour ?? true) ? GRID_HOUR : GRID_FAINT;

  return (
    <DragScrollArea barX className="bg-card border-line shadow-card min-h-0 flex-1 rounded-2xl border p-1">
      <table className="border-collapse text-sm" style={{ tableLayout: "fixed", width: tableW }}>
        <colgroup>
          <col style={{ width: TIME_COL_W }} />
          {laneColsFlat.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          {/* 강사 밴드 — 시트 강사 헤더색. sticky top(46행 세로 스크롤 실재) — 경계는 가상요소(#71). */}
          <tr>
            <th
              rowSpan={2}
              aria-hidden
              className={`bg-bg-soft sticky top-0 left-0 z-30 ${STICKY_HEAD_EDGES}`}
              style={{ height: HEAD_TEACHER_H + HEAD_DAY_H }}
            />
            {prepared.map((t) => (
              <th
                key={t.name}
                colSpan={t.cols.reduce((a, c) => a + c.laneCount, 0)}
                className={`sticky top-0 z-20 px-2 py-1 text-center ${STICKY_HEAD_EDGES}`}
                style={{
                  height: HEAD_TEACHER_H,
                  ...(t.color ? { backgroundColor: t.color.bg, color: t.color.text } : {}),
                }}
              >
                <span className={`block overflow-hidden text-[12px] font-bold whitespace-nowrap text-clip ${t.color ? "" : "text-foreground bg-bg-soft"}`}>
                  {t.name}
                </span>
              </th>
            ))}
          </tr>
          {/* 요일 행 — 강사 밴드 바로 아래에 sticky. 다중 레인 요일은 레인 수만큼 가로 병합. */}
          <tr>
            {prepared.flatMap((t) =>
              t.cols.map((col) => (
                <th
                  key={`${t.name}-${col.day}`}
                  colSpan={col.laneCount}
                  className={`bg-bg-soft text-text-dim sticky z-20 px-1 py-0.5 text-center font-mono text-[10px] leading-tight font-bold ${STICKY_HEAD_EDGES}`}
                  style={{ top: HEAD_TEACHER_H, height: HEAD_DAY_H }}
                >
                  {DAY_LABEL[col.day] ?? col.day}
                  {dayDates[col.day] ? (
                    <span className="text-text-faint block text-[9px] font-normal">{dayDates[col.day]}</span>
                  ) : null}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={row.key}>
              {/* 시각열 — sticky left. 매 행 라벨(시트 미러), 정시 강조. 좌·우 경계는 가상요소(#71). */}
              <td
                className={`bg-bg-soft sticky left-0 z-10 border-b px-1 py-0 text-right align-top font-mono leading-none ${bottomGrid(ri + 1)} ${STICKY_EDGES} ${
                  row.isHour ? "text-foreground text-[9px] font-bold" : "text-text-faint text-[9px]"
                }`}
                style={{ height: ROW_H }}
              >
                {row.key}
              </td>
              {prepared.flatMap((t) =>
                t.cols.flatMap((col) =>
                  Array.from({ length: col.laneCount }, (_, li) => {
                    const key = `${t.name}-${col.day}-${li}-${row.key}`;
                    if (col.covered.has(`${ri}:${li}`)) return null; // 그룹 셀에 피복됨
                    const anchor = col.anchors.get(`${ri}:${li}`);
                    // 빈 1×1 셀 — 격자 프레임 유지(옅은 선, 정시 경계만 진하게).
                    if (!anchor) {
                      return (
                        <td
                          key={key}
                          className={`bg-bg-soft/40 border-r border-b ${GRID_FAINT} ${bottomGrid(ri + 1)}`}
                        />
                      );
                    }
                    const { group, span } = anchor;
                    const isMerged = group.intervals.length > 1; // 합반(같은 시간 병렬)
                    // 그룹 셀 — rowSpan = 실길이/10분, colSpan = 병렬 반 수. 내용은 **고정높이 래퍼**
                    // (td height는 최소값이라 칩이 넘치면 행이 늘어나 10분 축 전체가 깨짐 — 넘침은 내부 스크롤).
                    return (
                      <td
                        key={key}
                        rowSpan={span}
                        colSpan={group.laneWidth}
                        className={`border-r border-b p-0 align-top ${GRID_FAINT} ${bottomGrid(ri + span)}`}
                      >
                        <div className="p-px" style={{ height: span * ROW_H - 1 }}>
                          {/* 합반 = 하나의 amber 테두리로 묶고 그 안에 반 칩들을 나란히(시트 병렬 서브컬럼). */}
                          <div
                            className={`flex h-full min-w-0 gap-px ${
                              isMerged ? "border-amber overflow-hidden rounded-[4px] border-2" : ""
                            }`}
                          >
                            {group.intervals.map((iv) => {
                              const s = intervalSlot(iv);
                              // 방 = 슬롯 방(slot_room_label)만 — classroomName은 반의 "기본" 강의실이라
                              // 시트 미러가 아니다(JJ LAB=305인데 반 기본방이 뜨는 오류). 이주희(라벨 null)는
                              // 시트 셀처럼 방 미표기.
                              return <TeacherChip key={s.id} slot={{ ...s, classroomName: s.slotRoomLabel }} />;
                            })}
                          </div>
                        </div>
                      </td>
                    );
                  }),
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </DragScrollArea>
  );
}
