import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import type { ScheduleSlotWithStudents } from "@/features/timetable/server/queries";
import {
  slotPeriodRow,
  subjectPeriodRows,
  weekdayTableFor,
  DEFAULT_PERIODS_CONFIG,
  type DayOfWeek,
  type PeriodRow,
  type PeriodsConfig,
  type TimetableSubject,
} from "@/features/timetable/lib/periods";
import { cellClassKey, computeBlocks, sortDaysByGroup } from "@/features/timetable/lib/grid";
import { weekdayPartition, type WeekdayGrouping } from "@/features/timetable/lib/weekday-groups";
import { ClassCell } from "./class-cell";
import { HapbanCell } from "./hapban-cell";

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
// 교시 셀 높이 — 헤더 + 재원 10칸 + 대기 2칸 + 퇴원 3칸을 담게 잡음(2026-07-07 사용자 지정: 재원만
// 이 영역 스크롤+페이드, 대기/퇴원은 고정 박스 각자 스크롤). 재원은 셀 안에서 flex-1로 ~10칸 확보(대기/퇴원이
// 있으면 그만큼 줄고 없으면 더 넓게 채움). 실측: 셀 래퍼(-16 패딩) + 헤더 47 + 재원 10칸 232 + 대기 63 + 퇴원 86 ≈ 444. (주말은 ROW_H/2.)
const ROW_H = 444;
// 격자선 — 전 격자를 **하나의 동일한 테두리**(색·굵기 통일)로. 얇은 --line(연회색)은 셀 경계가 뭉개져 가독성↓ → 진한 ink 1px.
// ⚠️ 구조선/안쪽선 굵기 구분 없이 균일 + 셀 카드 중복 테두리 제거(사용자 요청). 색값은 아래 sticky 교시열 box-shadow와 동일.
const GRID = "border-ink/25"; // 전 셀·헤더 공통 1px 격자
// ⚠️ sticky 좌측 교시열의 좌·우 테두리 — border-collapse에선 셀 테두리가 표(외곽 border 포함)에 속해 sticky 셀을 안 따라온다
// (가로 스크롤 시 표가 밀리며 교시열 왼쪽 프레임·오른쪽 divider가 둘 다 사라짐). box-shadow도 병합모드 td에선 불안정 →
// **셀 자식 가상요소(::before=왼쪽 프레임, ::after=오른쪽 divider) 1px 실선**으로 그린다(셀과 함께 고정, GRID와 동일 색).
// sticky일 때만 pseudo(비-sticky 주말표는 스크롤로 안 밀려 일반 border-r로 충분 — 아래 GroupTable).
const STICKY_EDGES =
  "before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-ink/25 before:content-[''] " +
  "after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-ink/25 after:content-['']";

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
  // ⚠️ 과목별 평일 교시 override(weekdayBySubject) 반영 — config.weekday 직접 참조는
  // 수학계 커스텀 교시 시 서브슬롯(1-1/1-2) 판정이 엉뚱한 시각과 비교된다(2026-07-06).
  const table = weekdayTableFor(card.subject, config);
  const firstEnd = table[String(2 * g - 1)]?.endTime;
  const secondStart = table[String(2 * g)]?.startTime;
  const hm5 = (t: string) => t.slice(0, 5);
  if (secondStart && hm5(card.startTime) === hm5(secondStart)) return "bottom";
  if (firstEnd && hm5(card.endTime) === hm5(firstEnd)) return "top";
  return "full";
}

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
 * 그룹 셀의 한 서브슬롯(4-1 또는 4-2) 내용 — 그 서브슬롯 수업. 2개반+이면 진짜 합반(같은 교시·시간)이라
 * 앰버 박스 + "합반 N반" 배지. 서브슬롯 반쪽 위치가 곧 4-1/4-2를 나타내므로 subSlot 밴드는 안 씀(subSlot="full").
 */
function SubSlotContent({
  slots,
  coveringDays,
}: {
  slots: ScheduleSlotWithStudents[];
  coveringDays: DayOfWeek[];
}) {
  const merged = mergeSlotsByClass(slots);
  const isHapban = merged.length >= 2;
  return (
    <div
      className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
        isHapban ? "border-amber/50 bg-amber/5 gap-1 rounded-md border p-1" : ""
      }`}
    >
      {isHapban ? (
        <span className="text-amber bg-amber/15 -mx-1 -mt-1 mb-0.5 shrink-0 rounded-t-md px-1 py-0.5 text-center font-mono text-[9px] font-bold whitespace-nowrap">
          합반 {merged.length}반
        </span>
      ) : null}
      {isHapban ? (
        <HapbanCell slots={merged} subSlot="full" coveringDays={coveringDays} />
      ) : (
        <ClassCell slot={merged[0]!} roster="names" subSlot="full" coveringDays={coveringDays} />
      )}
    </div>
  );
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
}) {
  // 교시열 좌측 고정(가로 스크롤) — 평일 표만(주말은 자체 교시열이라 겹침 방지로 비고정).
  // 헤더 상단 고정(세로 스크롤) — 두 표 모두(아래 thead th에 sticky top-0/30/60). 스크롤해도 강사·요일 헤더가 붙어 있음.
  // z 계층: 본문(0) < 헤더 day-th(10) < 교시열 본문(20) < 좌상단 코너(30, 세로·가로 둘 다 고정).
  const periodHeadSticky = stickyPeriod ? "sticky left-0 top-0 z-30" : "sticky top-0 z-30"; // 좌상단 코너(rowSpan=3)
  const periodCellSticky = stickyPeriod ? "sticky left-0 z-20" : "";
  // 교시열 오른쪽 divider — sticky일 때는 셀 자식 가상요소(::after 실선)로 셀과 함께 고정(가로 스크롤 시 사라짐 방지).
  // sticky 셀은 그 자체가 positioned라 after:absolute의 기준이 됨(relative 추가 시 sticky가 깨지므로 넣지 않음).
  // 비-sticky(주말)는 스크롤로 밀릴 일이 없어 일반 border-r로 충분.
  const periodDivider = stickyPeriod ? STICKY_EDGES : `border-r ${GRID}`;
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

  // 평탄 요일 컬럼 목록 — colgroup으로 폭 고정(엑셀 줄맞춤). 수·토·일은 2배 폭.
  const dayCols = groups.flatMap((g) => g.teachers.flatMap((t) => t.days));
  const tableW = PERIOD_COL_W + dayCols.reduce((sum, d) => sum + dayColW(d, wideDays), 0);

  return (
    <table className={`border-collapse border ${GRID} text-sm`} style={{ tableLayout: "fixed", width: tableW }}>
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
            className={`bg-bg-soft ${GRID} ${periodHeadSticky} ${periodDivider} w-[80px] border-b p-2`}
          />
          {groups.map((g) => (
            <th
              key={g.title}
              colSpan={g.dayCount}
              className={`bg-card ${GRID} sticky top-0 z-10 border-b border-r`}
            >
              {/* sticky 헤더는 불투명 base(bg-card) 위에 반투명 밴드색을 얹는다 — soft 토큰은 12% 알파라
                  셀 자체를 그 색으로 두면 스크롤 시 본문(학생 이름)이 비쳐 보인다. */}
              <div className={`${g.band} px-2 py-1.5 text-center text-[12px] font-bold`}>{g.title}</div>
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
                className={`bg-bg-soft ${GRID} sticky top-[30px] z-10 border-b border-r px-2 py-1.5 text-center`}
              >
                <span className="text-foreground block overflow-hidden whitespace-nowrap text-clip text-[12px] font-bold">{t.name}</span>
              </th>
            )),
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
                    className={`bg-card ${GRID} sticky top-[60px] z-10 border-b border-r`}
                  >
                    {/* 불투명 base + 반투명 tint(위 그룹밴드와 동일 이유 — 비침 방지). */}
                    <div className={`${g.tint} text-text-dim px-1 py-1 text-center font-mono text-[10px] leading-tight font-bold`}>
                      {DAY_LABEL[d] ?? d}
                      {date ? (
                        <span className="text-text-faint block text-[9px] font-normal">{date}</span>
                      ) : null}
                    </div>
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
              className={`bg-bg-soft text-foreground ${periodCellSticky} ${periodDivider} border-b ${GRID} px-2 py-2 align-top text-[12px] font-bold whitespace-nowrap`}
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
                  // 이 병합 블록이 덮는 요일 — 분리등원 요일 칸 분할용(월목 병합이면 [mon,thu]). 단독 셀이면 [그 요일].
                  const coveringDays = t.days.slice(ci, ci + block.colSpan);
                  const cellH = block.rowSpan * rowHeight - 16;
                  // 서브슬롯 분리 — m-그룹(수학계열)에서 4-1(상)·4-2(하)로 나눠 렌더. 4-1만 하는 수업이 4-2까지
                  // 걸친 듯 보이거나, 같은 강사·요일의 4-1·4-2가 한 셀로 합반 오인되던 것을 해소(2026-07-07).
                  // 영어(e-)·주말(w-)은 subSlotOf가 "full"이라 자동으로 비분리(개별 교시 행이라 분리 불필요).
                  const topSlots = acc.filter((s) => subSlotOf(s, config, row.key) === "top");
                  const bottomSlots = acc.filter((s) => subSlotOf(s, config, row.key) === "bottom");
                  // 그룹 전체(full) 슬롯이 없고 전부 4-1/4-2일 때만 분리. full 섞이면 기존 풀높이(안전).
                  const canSplit = acc.length > 0 && topSlots.length + bottomSlots.length === acc.length;
                  return (
                    <td
                      key={`${g.title}-${t.name}-${d}-${row.key}`}
                      rowSpan={block.rowSpan}
                      colSpan={block.colSpan}
                      className={`border-b border-r ${GRID} p-1.5 align-top ${
                        acc.length === 0 ? "bg-ink/[0.06]" : ""
                      }`}
                    >
                      {acc.length === 0 ? null : canSplit ? (
                        // 상(4-1)·하(4-2) 서브슬롯 분리. 빈 반쪽은 옅은 틴트로 "그 교시 비어있음"을 표시.
                        <div className="flex flex-col" style={{ height: cellH }}>
                          <div className={`flex min-h-0 flex-1 flex-col overflow-hidden border-b ${GRID}`}>
                            {topSlots.length > 0 ? (
                              <SubSlotContent slots={topSlots} coveringDays={coveringDays} />
                            ) : (
                              <div className="bg-ink/[0.04] flex-1" aria-hidden />
                            )}
                          </div>
                          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                            {bottomSlots.length > 0 ? (
                              <SubSlotContent slots={bottomSlots} coveringDays={coveringDays} />
                            ) : (
                              <div className="bg-ink/[0.04] flex-1" aria-hidden />
                            )}
                          </div>
                        </div>
                      ) : (
                        // 그룹 전체를 차지하는 수업(full) 또는 비-수학(영어·주말 = 개별 교시 행) — 기존 풀높이 렌더.
                        <div className="flex flex-col" style={{ height: cellH }}>
                          <SubSlotContent slots={acc} coveringDays={coveringDays} />
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
}: {
  slots: ScheduleSlotWithStudents[];
  config?: PeriodsConfig;
  /** 조회 중인 주의 월요일("YYYY-MM-DD") — 요일 헤더에 날짜(M/D) 표시(스프레드시트 패리티). */
  weekMonday?: string;
  /** 과목별 평일 요일 병합 프리셋(미설정 시 월목·화금). 단독 그룹 요일은 풀너비. */
  weekdayGrouping?: WeekdayGrouping;
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

  const weekdayGroups = buildGroups(weekdaySlots, weekdayDefs);
  const weekendGroups = buildGroups(weekendSlots, [WEEKEND_GROUP]);

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
          />
        ) : null}
      </div>
    </DragScrollArea>
  );
}
