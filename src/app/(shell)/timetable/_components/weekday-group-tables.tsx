import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import type { ScheduleSlotWithStudents } from "@/features/timetable/server/queries";
import {
  slotPeriodRow,
  subjectPeriodRows,
  DEFAULT_PERIODS_CONFIG,
  type DayOfWeek,
  type PeriodRow,
  type PeriodsConfig,
  type TimetableSubject,
} from "@/features/timetable/lib/periods";
import { cellClassKey, computeBlocks, sortDaysByGroup } from "@/features/timetable/lib/grid";
import { weekdayPartition, type WeekdayGrouping } from "@/features/timetable/lib/weekday-groups";
import type { TeacherColorMap } from "@/features/timetable/lib/class-grid";
import { ClassCell } from "./class-cell";

const DAY_LABEL: Record<string, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};

// 요일 그룹 — 과목별 프리셋(weekdayPartition)으로 동적 구성. band=그룹타이틀 색, tint=요일헤더 색.
type GroupDef = { title: string; days: DayOfWeek[]; band: string; tint: string; merge: boolean };

// 그룹 밴드/헤더 색 팔레트 — 그룹 수가 과목별로 가변이라 고정색 대신 인덱스 순환.
const GROUP_PALETTE: { band: string; tint: string }[] = [
  { band: "bg-blue-soft text-blue", tint: "bg-blue-soft/50" },
  { band: "bg-purple-soft text-purple", tint: "bg-purple-soft/50" },
  { band: "bg-primary-soft text-primary", tint: "bg-primary-soft/50" },
  { band: "bg-rose-soft text-rose", tint: "bg-rose-soft/50" },
  { band: "bg-amber-soft text-amber", tint: "bg-amber-soft/50" },
];

// 과목 프리셋 → 평일 그룹 정의. 묶인 요일(길이≥2)=병합 표시, 단독(길이1)=풀너비. 색은 팔레트 순환.
function buildWeekdayGroupDefs(grouping: WeekdayGrouping): GroupDef[] {
  return weekdayPartition(grouping).map((days, i) => {
    const pal = GROUP_PALETTE[i % GROUP_PALETTE.length];
    return {
      title: days.map((d) => DAY_LABEL[d] ?? d).join("/"),
      days,
      band: pal.band,
      tint: pal.tint,
      merge: days.length >= 2,
    };
  });
}

const WEEKEND_GROUP: GroupDef = {
  title: "주말", days: ["sat", "sun"], band: "bg-amber-soft text-amber", tint: "bg-amber-soft/50", merge: false,
};
const WEEKEND_KEYS = new Set<DayOfWeek>(["sat", "sun"]);

// 엑셀식 격자 — table-layout:fixed + colgroup으로 요일 컬럼 폭을 못박는다(줄맞춤).
// 폭은 스프레드시트/엑셀 기준(실측 교시 79·요일 51px)에서 **가독성 위해 요일열만 +**(52→60px). 단독(수)/주말(토·일) 2배(120px).
// (좁은 셀 본문은 이름 우선 — 생략(…) 없이 넘치면 잘림(clip), 전체 정보는 hover 카드. 스프레드시트식 고밀도.)
const PERIOD_COL_W = 80;
const DAY_COL_W = 60;
// 단독(병합 안 되는) 요일은 2배 폭 — wide 집합은 호출부가 그룹 구성에서 도출(평일=단독 그룹 요일, 주말=토/일).
const dayColW = (d: DayOfWeek, wide: Set<DayOfWeek>) => (wide.has(d) ? DAY_COL_W * 2 : DAY_COL_W);
// 모든 교시 행을 동일 높이로 통일 → 평일·주말 표가 같은 격자선에 정렬(ijw식). 넘치면 셀 내부 스크롤.
// 셀 명단이 최소 10명 보이도록 + 글자 30% 확대(가독성)에 맞춰 비례 상향(256→330).
// 셀 스크롤 maxHeight = rowSpan*ROW_H - 16, 헤더(~48) + 학생행(~25)×10 ≈ 298. (주말은 ROW_H/2로 격자 정렬.)
const ROW_H = 330;

// 요일 → 월요일로부터의 오프셋(일수). 요일 헤더 날짜 라벨 계산용.
const DAY_OFFSET: Record<DayOfWeek, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };

/**
 * 주 월요일("YYYY-MM-DD") → 요일별 "M/D" 라벨(스프레드시트처럼 요일 헤더에 날짜 표시).
 * 모듈 레벨 순수 함수(입력만으로 결정 — RSC purity 안전). UTC 기준으로 월말 롤오버 안전.
 */
function dayDateLabels(weekMonday: string): Partial<Record<DayOfWeek, string>> {
  const [y, m, d] = weekMonday.split("-").map(Number);
  if (!y || !m || !d) return {};
  const out: Partial<Record<DayOfWeek, string>> = {};
  for (const day of Object.keys(DAY_OFFSET) as DayOfWeek[]) {
    const dt = new Date(Date.UTC(y, m - 1, d + DAY_OFFSET[day]));
    out[day] = `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`;
  }
  return out;
}

/**
 * 카드가 그룹 셀(m-g)의 어느 서브슬롯에 있는지 — top(1-1만)/bottom(1-2만)/full(둘 다).
 * ijw식 헤더 분할용. 그룹 행(m-1..m-4)만 판정; 주말(w-)·영어(e-)·폴백(x-)은 full(분할 없음).
 * 그룹 g의 첫 서브슬롯 periodId=2g-1, 둘째=2g. 카드 시작시각이 둘째 시작=bottom, 끝시각이 첫째 끝=top, 그 외 full.
 */
function subSlotOf(
  card: ScheduleSlotWithStudents,
  config: PeriodsConfig,
  rowKey: string,
): "top" | "bottom" | "full" {
  const m = /^m-(\d+)$/.exec(rowKey);
  if (!m) return "full";
  const g = Number(m[1]);
  const firstEnd = config.weekday[String(2 * g - 1)]?.endTime;
  const secondStart = config.weekday[String(2 * g)]?.startTime;
  const hm5 = (t: string) => t.slice(0, 5);
  if (secondStart && hm5(card.startTime) === hm5(secondStart)) return "bottom";
  if (firstEnd && hm5(card.endTime) === hm5(firstEnd)) return "top";
  return "full";
}

type TeacherCol = { name: string; days: DayOfWeek[] };
type GroupCols = GroupDef & { teachers: TeacherCol[]; dayCount: number };

/** 컬럼(강사) 키 — 기본뷰=반 담임, 강사뷰=슬롯 강사(시트 강사별 배치, 라벨 없으면 담임 폴백). */
type TeacherOf = (s: ScheduleSlotWithStudents) => string;
const byClassTeacher: TeacherOf = (s) => s.teacherName ?? "—";
const bySlotTeacher: TeacherOf = (s) => s.slotTeacherLabel ?? s.teacherName ?? "—";

/**
 * 강사뷰 컬럼 순서 — 최빈 방(시트의 물리 배치: 본원301→…→본원SKY) → 이름. 방 없는 강사(Dom)는 뒤.
 * 기본뷰는 기존대로 이름순(호출부에서 order 미전달).
 */
function teacherOrderByRoom(slots: ScheduleSlotWithStudents[], teacherOf: TeacherOf): Map<string, string> {
  const rooms = new Map<string, Map<string, number>>();
  for (const s of slots) {
    const t = teacherOf(s);
    if (!s.slotRoomLabel) continue;
    const m = rooms.get(t) ?? rooms.set(t, new Map()).get(t)!;
    m.set(s.slotRoomLabel, (m.get(s.slotRoomLabel) ?? 0) + 1);
  }
  const order = new Map<string, string>();
  for (const [t, m] of rooms) {
    order.set(t, [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0]);
  }
  return order;
}

/** 슬롯에서 그룹별 컬럼(강사→요일) 구성. 해당 그룹 요일에 수업 있는 강사만, 요일은 그룹 순서. */
function buildGroups(
  slots: ScheduleSlotWithStudents[],
  defs: GroupDef[],
  teacherOf: TeacherOf,
  roomOrder?: Map<string, string>,
): GroupCols[] {
  const teachers = Array.from(new Set(slots.map(teacherOf))).sort((a, b) => {
    if (roomOrder) {
      const ra = roomOrder.get(a) ?? "￿";
      const rb = roomOrder.get(b) ?? "￿";
      if (ra !== rb) return ra.localeCompare(rb, "ko");
    }
    return a.localeCompare(b, "ko");
  });
  const out: GroupCols[] = [];
  for (const def of defs) {
    const groupDaySet = new Set(def.days);
    const cols: TeacherCol[] = [];
    for (const t of teachers) {
      const days = sortDaysByGroup(
        Array.from(
          new Set(
            slots
              .filter((s) => teacherOf(s) === t && groupDaySet.has(s.dayOfWeek as DayOfWeek))
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
  config,
  dateOf,
  wideDays,
  teacherOf = byClassTeacher,
  teacherColors,
}: {
  slots: ScheduleSlotWithStudents[];
  subject: TimetableSubject;
  groups: GroupCols[];
  weekend: boolean;
  rowHeight: number;
  stickyPeriod?: boolean;
  config: PeriodsConfig;
  /** 요일 → "M/D" 라벨(스프레드시트처럼 요일 헤더에 날짜 표시). 없으면 요일만. */
  dateOf?: (d: DayOfWeek) => string | undefined;
  /** 2배 폭으로 그릴 요일(단독 그룹·주말) — 그룹 구성에서 호출부가 도출. */
  wideDays: Set<DayOfWeek>;
  /** 컬럼 키(기본=반 담임, 강사뷰=슬롯 강사) — buildGroups와 동일 함수를 써야 셀이 맞는다. */
  teacherOf?: TeacherOf;
  /** 강사 헤더 저장색(강사뷰 — 시트/ijw처럼 강사별 색 헤더). 없거나 미등록 강사는 기본 회색. */
  teacherColors?: TeacherColorMap;
}) {
  // 평일 표만 교시열 sticky(좌측 고정). 우측 주말 표는 자기 교시열이라 non-sticky(겹침 방지).
  const periodHeadSticky = stickyPeriod ? "sticky left-0 z-20" : "";
  const periodCellSticky = stickyPeriod ? "sticky left-0 z-10" : "";
  // 평일 수학계열은 4그룹 행(1교시=1-1+1-2). 셀은 풀높이(학생 공간 확보) — 1시간 수업도 풀높이 셀에
  // 카드로 표시되고 서브슬롯은 헤더 시각("15:25~16:20")으로 구분(ijw 방식). 1-1/1-2가 다른 반이면 셀 안 2카드 적층.
  const rowOf = (s: ScheduleSlotWithStudents) =>
    slotPeriodRow(subject, s.startTime, s.dayOfWeek as DayOfWeek, config);

  // 표준 교시 전체(수업 없어도 표시 — 빈 교시도 균일 높이) + 데이터에만 있는 비표준 시각(폴백) 합집합.
  const rowMap = new Map<string, PeriodRow>();
  for (const r of subjectPeriodRows(subject, weekend, config)) rowMap.set(r.key, r);
  for (const s of slots) {
    const r = rowOf(s);
    if (!rowMap.has(r.key)) rowMap.set(r.key, r);
  }
  const rows = Array.from(rowMap.values()).sort((a, b) => a.order - b.order);

  // (teacher::day::rowKey) → slots — teacher 키는 buildGroups와 동일한 teacherOf로.
  const cell = new Map<string, ScheduleSlotWithStudents[]>();
  for (const s of slots) {
    const k = `${teacherOf(s)}::${s.dayOfWeek}::${rowOf(s).key}`;
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

  // 평탄 요일 컬럼 목록 — colgroup으로 폭 고정(엑셀 줄맞춤). 수·토·일은 2배 폭.
  const dayCols = groups.flatMap((g) => g.teachers.flatMap((t) => t.days));
  const tableW = PERIOD_COL_W + dayCols.reduce((sum, d) => sum + dayColW(d, wideDays), 0);

  return (
    <table className="border-collapse text-sm" style={{ tableLayout: "fixed", width: tableW }}>
      <colgroup>
        <col style={{ width: PERIOD_COL_W }} />
        {dayCols.map((d, i) => (
          <col key={i} style={{ width: dayColW(d, wideDays) }} />
        ))}
      </colgroup>
      <thead>
        {/* 그룹타이틀 밴드 */}
        <tr>
          {/* 좌상단 코너 = 교시(세로축)와 요일·강사(가로축)의 교차점 → 어느 축 라벨도 아니므로 비워둔다. */}
          <th
            rowSpan={3}
            aria-hidden
            className={`bg-bg-soft border-line ${periodHeadSticky} w-[80px] border-b border-r p-2`}
          />
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
        {/* 강사 행 — 강사뷰(teacherColors)면 저장색 헤더(시트/ijw 강사색 패리티), 미등록 강사는 회색. */}
        <tr>
          {groups.flatMap((g) =>
            g.teachers.map((t) => {
              const c = teacherColors?.[t.name];
              return (
                <th
                  key={`${g.title}-${t.name}`}
                  colSpan={t.days.length}
                  className="bg-bg-soft border-line border-b border-r px-2 py-1.5 text-center"
                  style={c ? { backgroundColor: c.bg, color: c.text } : undefined}
                >
                  <span
                    className={`block overflow-hidden whitespace-nowrap text-clip text-[12px] font-bold ${c ? "" : "text-foreground"}`}
                  >
                    {t.name}
                  </span>
                </th>
              );
            }),
          )}
        </tr>
        {/* 요일 행 */}
        <tr>
          {groups.flatMap((g) =>
            g.teachers.flatMap((t) =>
              t.days.map((d) => {
                const date = dateOf?.(d);
                return (
                  <th
                    key={`${g.title}-${t.name}-${d}`}
                    className={`${g.tint} border-line text-text-dim border-b border-r px-1 py-1 text-center font-mono text-[10px] leading-tight font-bold`}
                  >
                    {DAY_LABEL[d] ?? d}
                    {date ? (
                      <span className="text-text-faint block text-[9px] font-normal">{date}</span>
                    ) : null}
                  </th>
                );
              }),
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
                  // 이 병합 블록이 덮는 요일 — 분리등원 요일 칸 분할용(월목 병합이면 [mon,thu]). 단독 셀이면 [그 요일].
                  const coveringDays = t.days.slice(ci, ci + block.colSpan);
                  // 합반(ijw식) — 같은 강사·교시·요일에 2개반+ = 합반. 셀을 그대로 적층하되 테두리로 묶고 배지 표시.
                  const isHapban = merged.length >= 2;
                  return (
                    <td
                      key={`${g.title}-${t.name}-${d}-${row.key}`}
                      rowSpan={block.rowSpan}
                      colSpan={block.colSpan}
                      className={`border-line border-b border-r p-1.5 align-top ${
                        merged.length === 0 ? "bg-bg-soft/60" : ""
                      }`}
                    >
                      {merged.length === 0 ? null : (
                        // 고정높이 flex-col — 대기·퇴원 있는 셀(ClassCell이 flex-1)이 칸을 채워
                        // 그 그룹을 셀 하단에 정렬. 재원만 있는 셀은 content 높이로 상단 정렬(기존과 동일).
                        // 합반이면 앰버 테두리 박스로 묶고 상단에 "합반 N반" 배지(ijw식 — 같은 강사·교시 여러 반).
                        <div
                          className={`flex flex-col overflow-y-auto ${
                            isHapban ? "border-amber/50 bg-amber/5 gap-1 rounded-md border p-1" : "gap-1.5"
                          }`}
                          style={{ height: block.rowSpan * rowHeight - 16 }}
                        >
                          {isHapban ? (
                            <span className="text-amber bg-amber/15 sticky top-0 z-10 -mx-1 -mt-1 mb-0.5 rounded-t-md px-1 py-0.5 text-center font-mono text-[9px] font-bold whitespace-nowrap">
                              합반 {merged.length}반
                            </span>
                          ) : null}
                          {merged.map((s) => (
                            <ClassCell
                              key={s.id}
                              slot={s}
                              roster="names"
                              subSlot={subSlotOf(s, config, row.key)}
                              coveringDays={coveringDays}
                            />
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
export function WeekdayGroupTables({
  slots,
  config = DEFAULT_PERIODS_CONFIG,
  weekMonday,
  weekdayGrouping = "mon-thu",
  groupBySlotTeacher = false,
  teacherColors,
}: {
  slots: ScheduleSlotWithStudents[];
  config?: PeriodsConfig;
  /** 조회 중인 주의 월요일("YYYY-MM-DD") — 요일 헤더에 날짜(M/D) 표시(스프레드시트 패리티). */
  weekMonday?: string;
  /** 과목별 평일 요일 병합 프리셋(미설정 시 월목·화금). 단독 그룹 요일은 풀너비. */
  weekdayGrouping?: WeekdayGrouping;
  /**
   * 강사뷰(시트 강사별 배치 패리티) — 컬럼을 반 담임이 아니라 **슬롯 강사**(slot_teacher_label,
   * 없으면 담임 폴백)로 구성. 컬럼 순서도 이름순 대신 최빈 방(시트 물리 배치)순.
   */
  groupBySlotTeacher?: boolean;
  /** 강사 헤더 저장색(강사뷰) — getTeacherColorMap() 결과. 미등록 강사는 회색 폴백. */
  teacherColors?: TeacherColorMap;
}) {
  const subject = (slots[0]?.subject ?? "math") as TimetableSubject;
  // 요일 헤더 날짜 라벨(스프레드시트처럼 "월 6/29"). weekMonday 없으면 요일만.
  const dayDates = weekMonday ? dayDateLabels(weekMonday) : {};
  const dateOf = (d: DayOfWeek) => dayDates[d];
  // 평일 행 높이 — 영어는 10개 개별 교시(행당 ROW_H), 그 외 수학계열은 4그룹(행당 ROW_H). 둘 다 풀높이.
  const weekdayRowH = ROW_H;
  const weekdaySlots = slots.filter((s) => !WEEKEND_KEYS.has(s.dayOfWeek as DayOfWeek));
  const weekendSlots = slots.filter((s) => WEEKEND_KEYS.has(s.dayOfWeek as DayOfWeek));

  // 과목 프리셋 → 평일 그룹. 단독(병합 안 되는) 요일은 2배 폭(wide). 주말은 토/일 항상 풀너비.
  const weekdayDefs = buildWeekdayGroupDefs(weekdayGrouping);
  const weekdayWide = new Set<DayOfWeek>(weekdayDefs.filter((g) => g.days.length === 1).flatMap((g) => g.days));
  const weekendWide = new Set<DayOfWeek>(["sat", "sun"]);

  // 컬럼 키 — 기본뷰=반 담임 / 강사뷰=슬롯 강사(+최빈 방 순서 = 시트 물리 배치).
  const teacherOf = groupBySlotTeacher ? bySlotTeacher : byClassTeacher;
  const roomOrder = groupBySlotTeacher ? teacherOrderByRoom(slots, teacherOf) : undefined;

  const weekdayGroups = buildGroups(weekdaySlots, weekdayDefs, teacherOf, roomOrder);
  const weekendGroups = buildGroups(weekendSlots, [WEEKEND_GROUP], teacherOf, roomOrder);

  return (
    <DragScrollArea barX className="bg-card border-line shadow-card min-h-0 flex-1 rounded-2xl border p-1">
      {/* ijw식 가로 배치 — 평일 그룹(월목/화금/수) 한 판 + 주말 한 판을 우측에 나란히
          (주말은 시작시각이 달라 자체 교시열). 세로 스택 대신 가로로 공간 효율. */}
      <div className="flex items-start gap-3">
        {weekdayGroups.length > 0 ? (
          <GroupTable
            slots={weekdaySlots}
            subject={subject}
            groups={weekdayGroups}
            weekend={false}
            rowHeight={weekdayRowH}
            config={config}
            dateOf={dateOf}
            wideDays={weekdayWide}
            teacherOf={teacherOf}
            teacherColors={groupBySlotTeacher ? teacherColors : undefined}
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
            config={config}
            dateOf={dateOf}
            wideDays={weekendWide}
            teacherOf={teacherOf}
            teacherColors={groupBySlotTeacher ? teacherColors : undefined}
          />
        ) : null}
      </div>
    </DragScrollArea>
  );
}
