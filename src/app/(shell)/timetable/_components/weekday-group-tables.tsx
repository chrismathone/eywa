import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import type { ScheduleSlotWithStudents } from "@/features/timetable/server/queries";
import {
  periodListLabel,
  subjectWeekdayPeriods,
  subjectWeekendPeriods,
  DEFAULT_PERIODS_CONFIG,
  type DayOfWeek,
  type PeriodRow,
  type PeriodsConfig,
  type TimetableSubject,
} from "@/features/timetable/lib/periods";
import { buildPeriodMatcher } from "@/features/timetable/lib/period-match";
import {
  cellClassKey,
  computeBlocks,
  expandHalfPeriodBlocks,
  sortDaysByGroup,
  type SubSlot,
} from "@/features/timetable/lib/grid";
import {
  PERIOD_ROW_H,
  periodRowHeight,
  stackedHeights,
} from "@/features/timetable/lib/empty-period-rows";
import { weekdayPartition, type WeekdayGrouping } from "@/features/timetable/lib/weekday-groups";
import { DAY_LABEL } from "@/features/timetable/lib/split-attendance";
import { ClassCell } from "./class-cell";
import { HapbanCell } from "./hapban-cell";

// 요일 라벨은 공용 단일 소스(split-attendance) — 파일마다 같은 맵을 다시 적지 않는다.

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
// 교시 1칸 높이 — 개별 교시 행(2026-07-07 ijw식). 수업은 실제 쓰는 연속 교시 수만큼 세로 rowSpan 병합(엑셀 셀병합).
// ⚠️ 2026-08-04부터 **셀 높이가 기준**이다(CELL_H = 헤더 60 + 학생 12행 + 패딩 16 = 352):
//   · 수학계열 평일 = 교시 2칸이 한 그룹 = 셀 1개 → 행 = CELL_H/2. 4-1만 하는 수업도 `expandHalfPeriodBlocks`가
//     그룹 높이로 늘려(수업명만 위/아래 절반) **학생 명단 영역이 어느 셀이나 같다**.
//   · 영어·주말 = 교시 1칸이 셀 1개 → 행 = CELL_H(SINGLE_PERIOD_ROW_H).
// 값은 empty-period-rows 단일 소스 — '빈 교시 접기'의 편집 모드 확장(EmptyPeriodScope)이 같은 값을 쓴다.
const ROW_H = PERIOD_ROW_H;
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
// 요일 그룹(월목 / 화금 / 수) 사이 굵은 구분선 — 그룹의 **첫 컬럼 왼쪽**에 2px 진한 선(첫 그룹 제외).
// 헤더 3단(그룹밴드/강사/요일)+본문 셀에 모두 얹어 세로 전체를 관통. border-collapse에선 2px가 인접
// 1px GRID보다 넓어 자동 우선하므로 이웃 셀은 손대지 않아도 이중선이 안 생긴다.
const GROUP_DIVIDER = "border-l-2 border-l-ink/50";

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

/** "HH:MM…" → 자정 기준 분(수업 셀 시각 위치/높이 계산용). */
function timeToMin(t: string): number {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * 한 시간대(band) 내용 — 같은 시각의 수업(들). 2개반+이면 진짜 합반(같은 교시·시간)이라 앰버 박스 +
 * "합반 N반" 배지. 셀 안에서 시각 범위로 위치가 정해지므로 subSlot 밴드는 안 씀(subSlot="full").
 */
function SubSlotContent({
  slots,
  coveringDays,
  subSlot = "full",
}: {
  slots: ScheduleSlotWithStudents[];
  coveringDays: DayOfWeek[];
  /** 그룹 한쪽 교시만 쓰는 수업이면 수업명을 그 절반에만(expandHalfPeriodBlocks가 판정). */
  subSlot?: SubSlot;
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
        <span className="text-amber bg-amber/15 -mx-1 -mt-1 mb-0.5 shrink-0 rounded-t-md px-1 py-0.5 text-center num text-[9px] font-bold whitespace-nowrap">
          합반 {merged.length}반
        </span>
      ) : null}
      {isHapban ? (
        <HapbanCell slots={merged} subSlot={subSlot} coveringDays={coveringDays} />
      ) : (
        <ClassCell slot={merged[0]!} roster="names" subSlot={subSlot} coveringDays={coveringDays} />
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
  collapseEmpty = false,
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
  /** '빈 교시 접기' — 이 표의 어느 열에도 수업이 없는 교시 행을 얇은 밴드로 축소(행 자체는 유지). */
  collapseEmpty?: boolean;
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
  // ⚠️ 핵심(2026-07-07 ijw 방식 이식): 수학계열도 **개별 교시 행**(8교시)으로 둔다. 예전엔 7·8교시를 묶은
  // "그룹(m-4)"을 통째로 처리해, 4-1(7교시)만 하는 수업이 그룹(4-2 포함) 전체를 먹었다(="스케줄과 렌더 배선
  // 어긋남"). 개별 교시로 두면 computeBlocks가 **실제 연속 교시만** rowSpan 병합(엑셀 셀병합, ijw getConsecutiveSpan
  // 대응) → 5·6·7교시 수업은 3칸 병합하고 8교시(4-2)는 별도. 교시 축은 라벨 컬럼이 그룹(3교시/4교시)을 2행
  // rowSpan으로 묶어 표시(아래 tbody) — 축은 8개로 안 늘어남. 수학계열만 그룹 라벨(영어는 개별 교시라 무관).
  const isMathFamily = !weekend && subject !== "english";
  const hm5 = (t: string) => t.slice(0, 5);
  const periodList = weekend ? subjectWeekendPeriods(config) : subjectWeekdayPeriods(subject, config);
  const matchPeriod = buildPeriodMatcher(periodList);
  const rowKeyOf = (s: ScheduleSlotWithStudents) => {
    const st = hm5(s.startTime);
    const periodId = matchPeriod({ startTime: s.startTime, endTime: s.endTime });
    return periodId ? `p-${periodId}` : `x-${st}`;
  };

  // 표준 교시 행 전체(수업 없어도 표시 — 빈 교시도 균일 높이) + 데이터에만 있는 비표준 시각(폴백) 합집합.
  const rowMap = new Map<string, PeriodRow>();
  for (const p of periodList) {
    rowMap.set(`p-${p.id}`, {
      key: `p-${p.id}`,
      label: periodListLabel(p),
      time: `${hm5(p.startTime)}~${hm5(p.endTime)}`,
      order: timeToMin(p.startTime),
    });
  }
  for (const s of slots) {
    const st = hm5(s.startTime);
    if (!matchPeriod({ startTime: s.startTime, endTime: s.endTime }) && !rowMap.has(`x-${st}`)) {
      rowMap.set(`x-${st}`, { key: `x-${st}`, label: st, time: st, order: timeToMin(st) });
    }
  }
  const rows = Array.from(rowMap.values()).sort((a, b) => a.order - b.order);

  // '빈 교시 접기'(C안, 2026-07-19) — 이 표(모든 강사×요일)에서 슬롯이 하나도 없는 행만 접는다.
  // 비표준(x-) 행은 슬롯이 있어야만 생기므로 접기 대상은 표준 교시 행뿐. 접힌 행도 tr/셀은
  // 그대로(숨김 아님)고, 편집 모드에선 EmptyPeriodScope가 CSS 변수·.tt-editing으로 평소 격자
  // 지형 그대로 펼친다(드롭 존은 점유 셀 안에만 등록되므로 접기가 편집 기능을 깨진 않는다).
  const occupiedKeys = new Set(slots.map(rowKeyOf));
  const isCollapsed = (key: string) => collapseEmpty && !occupiedKeys.has(key);

  // (teacher::day::rowKey) → slots
  const cell = new Map<string, ScheduleSlotWithStudents[]>();
  for (const s of slots) {
    const k = `${s.teacherName ?? "—"}::${s.dayOfWeek}::${rowKeyOf(s)}`;
    (cell.get(k) ?? cell.set(k, []).get(k)!).push(s);
  }

  // 수학계열 교시 그룹 쌍([1교시 윗칸, 아랫칸] …) — 반교시 셀을 그룹 높이로 늘리는 데 쓴다.
  // 영어·주말은 교시 1개가 곧 한 행이라 쌍이 없다(확장 대상 아님).
  const groupPairs: [number, number][] = [];
  if (isMathFamily) {
    for (let ri = 0; ri + 1 < rows.length; ri++) {
      const a = /^p-(\d+)$/.exec(rows[ri]!.key)?.[1];
      const b = /^p-(\d+)$/.exec(rows[ri + 1]!.key)?.[1];
      // 그룹 = 홀수 교시 + 그다음 짝수 교시(1·2 / 3·4 …). 라벨 rowSpan 판정과 같은 규칙.
      if (a && b && Number(a) % 2 === 1 && Number(b) === Number(a) + 1) groupPairs.push([ri, ri + 1]);
    }
  }

  // 그룹×강사별 2D 병합 사전계산. cellAt(행,열)=그 교시·요일 슬롯, blocks=병합 블록(anchor만).
  const prepared = groups.map((g) => ({
    ...g,
    teachers: g.teachers.map((t) => {
      const cellAt = (ri: number, ci: number) =>
        cell.get(`${t.name}::${t.days[ci]}::${rows[ri]!.key}`) ?? [];
      const raw = computeBlocks(
        rows.length,
        t.days.length,
        (ri, ci) => cellClassKey(cellAt(ri, ci).map((s) => s.classId)),
        g.merge,
      );
      // 반교시(그룹 한쪽 교시만) 수업은 셀을 그룹 전체 높이로 — 학생 명단 영역을 어느 셀이나 같게.
      const { blocks, subSlots } = expandHalfPeriodBlocks({
        blocks: raw,
        pairs: groupPairs,
        occupied: (ri, ci) => cellAt(ri, ci).length > 0,
      });
      return { ...t, cellAt, blocks, subSlots };
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
          {groups.map((g, gi) => (
            <th
              key={g.title}
              colSpan={g.dayCount}
              className={`bg-card ${GRID} sticky top-0 z-10 border-b border-r ${gi > 0 ? GROUP_DIVIDER : ""}`}
            >
              {/* sticky 헤더는 불투명 base(bg-card) 위에 반투명 밴드색을 얹는다 — soft 토큰은 12% 알파라
                  셀 자체를 그 색으로 두면 스크롤 시 본문(학생 이름)이 비쳐 보인다. */}
              <div className={`${g.band} px-2 py-1.5 text-center text-[12px] font-bold`}>{g.title}</div>
            </th>
          ))}
        </tr>
        {/* 강사 행 */}
        <tr>
          {groups.flatMap((g, gi) =>
            g.teachers.map((t, ti) => (
              <th
                key={`${g.title}-${t.name}`}
                colSpan={t.days.length}
                className={`bg-bg-soft ${GRID} sticky top-[30px] z-10 border-b border-r px-2 py-1.5 text-center ${gi > 0 && ti === 0 ? GROUP_DIVIDER : ""}`}
              >
                <span className="text-foreground block overflow-hidden whitespace-nowrap text-clip text-[12px] font-bold">{t.name}</span>
              </th>
            )),
          )}
        </tr>
        {/* 요일 행 */}
        <tr>
          {groups.flatMap((g, gi) =>
            g.teachers.flatMap((t, ti) =>
              t.days.map((d, ci) => {
                const date = dateOf?.(d);
                return (
                  <th
                    key={`${g.title}-${t.name}-${d}`}
                    className={`bg-card ${GRID} sticky top-[60px] z-10 border-b border-r ${gi > 0 && ti === 0 && ci === 0 ? GROUP_DIVIDER : ""}`}
                  >
                    {/* 불투명 base + 반투명 tint(위 그룹밴드와 동일 이유 — 비침 방지). */}
                    <div className={`${g.tint} text-text-dim px-1 py-1 text-center text-[10px] leading-tight font-bold`}>
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
        {rows.map((row, ri) => {
          // 라벨 셀 — 수학계열은 그룹(3교시/4교시)을 2행 rowSpan으로 묶어 표시(축은 8개로 안 늘어남),
          // 영어/주말/폴백은 개별 교시 라벨. 그룹 둘째 교시(짝수 id)는 위 rowSpan에 피복돼 라벨 셀 없음.
          const pid = /^p-(\d+)$/.exec(row.key)?.[1];
          const mathN = isMathFamily && pid ? Number(pid) : null;
          const isGroupSecond = mathN !== null && mathN % 2 === 0;
          const nextRow = rows[ri + 1];
          const nextPid = nextRow ? /^p-(\d+)$/.exec(nextRow.key)?.[1] : undefined;
          const paired = mathN !== null && nextPid !== undefined && Number(nextPid) === mathN + 1;
          // '빈 교시 접기' 높이 — 접힌 행은 CSS 변수(편집 모드엔 EmptyPeriodScope가 풀 높이로 확장),
          // 점유 행은 고정 px. 그룹 라벨(rowSpan=2)은 두 행 높이 합(접힌 행이 섞이면 calc()로 변수 보존).
          const rowH = periodRowHeight(isCollapsed(row.key), rowHeight);
          const labelH = paired
            ? stackedHeights([rowH, periodRowHeight(isCollapsed(nextRow!.key), rowHeight)])
            : rowH;
          // 라벨이 덮는 행이 **전부** 접혔을 때만 한 줄 압축 라벨(36px 밴드엔 두 줄이 안 들어감).
          // 접힌·점유 혼합 쌍(258px)은 공간이 충분해 기존 두 줄 라벨 유지.
          // 편집 모드(.tt-editing, EmptyPeriodScope가 행을 펼칠 때)엔 `[.tt-editing_&]` 변형으로 평소
          // 두 줄 스타일 복원 — 높이만 펼치면 라벨이 압축 스타일로 남아 이웃 라벨과 어긋난다(적대 리뷰 LOW).
          const labelCollapsed = paired
            ? isCollapsed(row.key) && isCollapsed(nextRow!.key)
            : isCollapsed(row.key);
          const labelBase = `bg-bg-soft ${periodCellSticky} ${periodDivider} border-b ${GRID} font-bold whitespace-nowrap`;
          const labelCls = labelCollapsed
            ? `${labelBase} text-text-dim overflow-hidden px-2 py-0 align-middle text-[10px] [.tt-editing_&]:text-foreground [.tt-editing_&]:py-2 [.tt-editing_&]:align-top [.tt-editing_&]:text-[12px]`
            : `${labelBase} text-foreground px-2 py-2 align-top text-[12px]`;
          const labelText = mathN !== null ? `${Math.ceil(mathN / 2)}교시` : row.label;
          const timeText =
            mathN !== null
              ? `${row.time.split("~")[0]}~${(paired ? nextRow! : row).time.split("~")[1]}`
              : row.time;
          return (
            // ⚠️ 교시 행 높이를 rowHeight로 **명시 고정** → 그룹 라벨(rowSpan=2)이 두 교시(예 4-1/4-2)를
            // 정확히 2등분(각 rowHeight). tr에 안 박으면 border-collapse 표에서 브라우저가 rowSpan=2 라벨의
            // 444를 두 행에 **내용량 비례로 분배** → 학생 많은 4-1이 커지고 4-2가 얇아짐(2026-07-07 사용자 지적).
            <tr key={row.key} style={{ height: rowH }}>
              {isGroupSecond ? null : (
                <td rowSpan={paired ? 2 : 1} className={labelCls} style={{ height: labelH }}>
                  {labelText}
                  {labelCollapsed ? (
                    <>
                      <span className="text-text-faint ml-1 num text-[9px] font-normal [.tt-editing_&]:hidden">
                        {timeText}
                      </span>
                      <div className="text-text-faint mt-0.5 hidden num text-[10px] [.tt-editing_&]:block">
                        {timeText}
                      </div>
                    </>
                  ) : (
                    <div className="text-text-faint mt-0.5 num text-[10px]">{timeText}</div>
                  )}
                </td>
              )}
              {prepared.flatMap((g, gi) =>
                g.teachers.flatMap((t, ti) =>
                  t.days.map((d, ci) => {
                    const block = t.blocks.get(`${ri}:${ci}`);
                    if (!block) return null; // 위/왼쪽 병합에 피복됨 — 렌더 스킵
                    // 블록 전체(rowSpan×colSpan) 슬롯 모아 같은 반 합치기.
                    const acc: ScheduleSlotWithStudents[] = [];
                    for (let rr = ri; rr < ri + block.rowSpan; rr++) {
                      for (let cc = ci; cc < ci + block.colSpan; cc++) acc.push(...t.cellAt(rr, cc));
                    }
                    // 이 병합 블록이 덮는 요일 — 분리등원 요일 칸 분할용(월목 병합이면 [mon,thu]). 단독 셀이면 [그 요일].
                    const coveringDays = t.days.slice(ci, ci + block.colSpan);
                    // 셀 높이 = 실제 연속 교시 수(block.rowSpan) × 교시 높이. 엑셀 셀병합처럼 수업이 쓰는
                    // 교시만큼만 세로로 차지(4-1만 하면 1칸, 5·6·7교시면 3칸). 안 쓰는 교시는 별도 빈칸.
                    const cellH = block.rowSpan * rowHeight - 16;
                    return (
                      <td
                        key={`${g.title}-${t.name}-${d}-${row.key}`}
                        rowSpan={block.rowSpan > 1 ? block.rowSpan : undefined}
                        colSpan={block.colSpan > 1 ? block.colSpan : undefined}
                        className={`border-b border-r ${GRID} p-1.5 align-top ${
                          acc.length === 0 ? "bg-ink/[0.06]" : ""
                        } ${gi > 0 && ti === 0 && ci === 0 ? GROUP_DIVIDER : ""}`}
                      >
                        {acc.length === 0 ? null : (
                          <div className="flex flex-col" style={{ height: cellH }}>
                            <SubSlotContent
                              slots={acc}
                              coveringDays={coveringDays}
                              subSlot={t.subSlots.get(`${ri}:${ci}`) ?? "full"}
                            />
                          </div>
                        )}
                      </td>
                    );
                  }),
                ),
              )}
            </tr>
          );
        })}
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
  collapseEmptyPeriods = false,
}: {
  slots: ScheduleSlotWithStudents[];
  config?: PeriodsConfig;
  /** 조회 중인 주의 월요일("YYYY-MM-DD") — 요일 헤더에 날짜(M/D) 표시(스프레드시트 패리티). */
  weekMonday?: string;
  /** 과목별 평일 요일 병합 프리셋(미설정 시 월목·화금). 단독 그룹 요일은 풀너비. */
  weekdayGrouping?: WeekdayGrouping;
  /** '빈 교시 접기' — 수업 없는 교시 행을 얇은 밴드로 축소(평일·주말 표 각각 판정). 편집 모드는 자동 펼침. */
  collapseEmptyPeriods?: boolean;
}) {
  const subject = (slots[0]?.subject ?? "math") as TimetableSubject;
  // 요일 헤더 날짜 라벨(스프레드시트처럼 "월 6/29"). weekMonday 없으면 요일만.
  const dayDates = weekMonday ? dayDateLabels(weekMonday) : {};
  const dateOf = (d: DayOfWeek) => dayDates[d];
  // 행 높이 = 교시 1칸(ROW_H), 과목 분기 없음. 수업은 실제 쓰는 연속 교시 수만큼 rowSpan 병합된다.
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
            collapseEmpty={collapseEmptyPeriods}
          />
        ) : null}
        {weekendGroups.length > 0 ? (
          <GroupTable
            slots={weekendSlots}
            subject={subject}
            groups={weekendGroups}
            weekend
            rowHeight={ROW_H}
            stickyPeriod={false}
            config={config}
            dateOf={dateOf}
            wideDays={weekendWide}
            collapseEmpty={collapseEmptyPeriods}
          />
        ) : null}
      </div>
    </DragScrollArea>
  );
}
