import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { sortTeachersByOrder, teacherGroupKey, type TeacherOrderByGroup } from "@/features/timetable/lib/teacher-order";
import { TeacherHeadCell } from "./teacher-head-cell";
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
  EMPTY_PERIOD_H,
  periodRowFullHeight,
  periodRowHeight,
  stackedHeights,
} from "@/features/timetable/lib/empty-period-rows";
import {
  isSeatSlot,
  slotRoomIdOf,
  slotRoomNameOf,
  slotRoomTokOf,
  slotTeacherOf,
  toMinutes,
  type MovePart,
} from "@/features/timetable/lib/class-move";
import { weekdayPartition, type WeekdayGrouping } from "@/features/timetable/lib/weekday-groups";
import { DAY_LABEL } from "@/features/timetable/lib/split-attendance";
import { ClassCell, HAPBAN_BADGE_H, HEADER_H } from "./class-cell";
import { GridDropCell } from "./grid-drop-cell";
// 🔴 속성 이름은 **일반 모듈**에서 — 이 파일은 서버 컴포넌트라 "use client" 모듈의 상수는 런타임 undefined다([[#81]]).
import { GRID_ID_ATTR, GRID_ROWS_ATTR } from "@/features/timetable/lib/grid-attrs";
import { HapbanCell } from "./hapban-cell";
import { SearchedCell } from "./search-context";

// 요일 라벨은 공용 단일 소스(split-attendance) — 파일마다 같은 맵을 다시 적지 않는다.

// 요일 그룹 — 과목별 프리셋(weekdayPartition)으로 동적 구성. tint=요일헤더 색.
// ⚠️ 그룹 이름(`title`)은 **화면에 안 적는다**(원장 2026-09-07 *"상단의 월목/화금 삭제"*) — 바로 아래
//    요일 줄이 이미 `월 9/7`·`목 9/10`을 적고 있어 한 줄을 통째로 되풀이하는 밴드였다. 이름은 키·툴팁으로만
//    남고, 그룹 경계는 색(tint)과 아래 GROUP_DIVIDER(진한 세로선)가 나른다.
type GroupDef = { title: string; days: DayOfWeek[]; tint: string; merge: boolean };

// 요일 헤더 색 팔레트 — 그룹 수가 과목별로 가변이라 고정색 대신 인덱스 순환.
const GROUP_PALETTE: { tint: string }[] = [
  { tint: "bg-blue-soft/50" },
  { tint: "bg-purple-soft/50" },
  { tint: "bg-primary-soft/50" },
  { tint: "bg-rose-soft/50" },
  { tint: "bg-amber-soft/50" },
];

// 과목 프리셋 → 평일 그룹 정의. 묶인 요일(길이≥2)=병합 표시, 단독(길이1)=풀너비. 색은 팔레트 순환.
function buildWeekdayGroupDefs(grouping: WeekdayGrouping): GroupDef[] {
  return weekdayPartition(grouping).map((days, i) => {
    const pal = GROUP_PALETTE[i % GROUP_PALETTE.length];
    return {
      title: days.map((d) => DAY_LABEL[d] ?? d).join("/"),
      days,
      tint: pal.tint,
      merge: days.length >= 2,
    };
  });
}

const WEEKEND_GROUP: GroupDef = {
  title: "주말", days: ["sat", "sun"], tint: "bg-amber-soft/50", merge: false,
};
const WEEKEND_KEYS = new Set<DayOfWeek>(["sat", "sun"]);

// 엑셀식 격자 — table-layout:fixed + colgroup으로 요일 컬럼 폭을 못박는다(줄맞춤).
// 폭은 스프레드시트/엑셀 기준(실측 교시 79·요일 51px)에서 **가독성 위해 요일열만 +**(52→60px). 단독(수)/주말(토·일) 2배(120px).
// (좁은 셀 본문은 이름 우선 — 생략(…) 없이 넘치면 잘림(clip), 전체 정보는 hover 카드. 스프레드시트식 고밀도.)
// 80→96(2026-09-08 전수검사): '빈 교시 접기'의 접힌 밴드가 `3교시 14:30~16:20`을 한 줄에 못 담아 시각이
// `14:`에서 끊겼다. 시각은 시작만 적고(아래) 열도 넓힌다(96 − px 16 − 격자 1 = 79 ≥ 36+4+39).
const PERIOD_COL_W = 96;
// 60→66(2026-09-08 전수검사): 한 요일만 수업하는 강사의 머리칸(colSpan 1)이 20px 볼드 3자(60px)를 못 담았다.
const DAY_COL_W = 66;
// 단독(병합 안 되는) 요일은 2배 폭 — wide 집합은 호출부가 그룹 구성에서 도출(평일=단독 그룹 요일, 주말=토/일).
const dayColW = (d: DayOfWeek, wide: Set<DayOfWeek>) => (wide.has(d) ? DAY_COL_W * 2 : DAY_COL_W);
// 모든 교시 행을 동일 높이로 통일 → 평일·주말 표가 같은 격자선에 정렬(ijw식). 넘치면 셀 내부 스크롤.
// 교시 1칸 높이 — 개별 교시 행(2026-07-07 ijw식). 수업은 실제 쓰는 연속 교시 수만큼 세로 rowSpan 병합(엑셀 셀병합).
// ⚠️ 2026-08-04부터 **셀 높이가 기준**이다(CELL_H = 헤더 60 + 학생 12행 + 패딩 16 = 352):
//   · 수학계열 평일 = 교시 2칸이 한 그룹 = 셀 1개 → 행 = CELL_H/2. 4-1만 하는 수업도 `expandHalfPeriodBlocks`가
//     그룹 높이로 늘려(수업명만 위/아래 절반) **학생 명단 영역이 어느 셀이나 같다**.
//   · 영어·주말 = 교시 1칸이 셀 1개 → 행 = CELL_H(SINGLE_PERIOD_ROW_H).
// 값은 empty-period-rows 단일 소스 — '빈 교시 접기'의 편집 모드 확장(EmptyPeriodScope)이 같은 값을 쓴다.
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
// 구조선 — 얇은 격자(GRID)가 칸을 나눈다면 이 선은 **구조**를 나눈다: 세로 = 요일 그룹 경계(월목|화금),
// 가로 = 교시(셀) 경계. 원장 2026-09-07 *"월목과 화금 사이에 세로선을 좀더 진하게"* → *"가로선도 세로선과
// 동일한 서식으로"*.
// 🔴 두 상수는 **같은 굵기(2px)·같은 농도(ink/60)** 여야 한다 — 한쪽만 고치면 격자가 한 축으로 기울어 보인다.
// ⚠️ 값을 변수로 조립하지 말 것: Tailwind는 소스에 **적힌 글자 그대로**를 스캔하므로 `border-l-${ink}` 같은
//    템플릿은 클래스가 생성되지 않아 **에러 없이 색이 안 붙는다**(currentColor로 떨어진다).
const GROUP_DIVIDER = "border-l-2 border-l-ink/60"; // 그룹 첫 컬럼 왼쪽(첫 그룹 제외) — 세로 전체 관통
const ROW_DIVIDER = "border-b-2 border-b-ink/60"; // 교시(셀) 아래 — 병합 셀은 블록 끝에서만 그어진다
// border-collapse에선 2px가 인접 1px GRID보다 넓어 자동 우선하므로 이웃 셀은 손대지 않아도 이중선이 안 생긴다.
// 강사 이름 줄 높이(px) — 아래 요일 줄의 sticky top 오프셋과 **같은 값**이어야 한다(어긋나면 세로 스크롤에서
// 두 줄이 겹치거나 틈이 벌어진다). 이름 20px(line-height 1.35 = 27) + 상하 여백 12 = 39 → 40.
const TEACHER_HEAD_H = 40;

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
type GroupCols = GroupDef & { teachers: TeacherCol[] };

/** 슬롯에서 그룹별 컬럼(강사→요일) 구성. 해당 그룹 요일에 수업 있는 강사만, 요일은 그룹 순서. */
function buildGroups(
  slots: ScheduleSlotWithStudents[],
  defs: GroupDef[],
  order?: TeacherOrderByGroup,
): GroupCols[] {
  const teachers = Array.from(new Set(slots.map((s) => s.teacherName ?? "—")));
  const out: GroupCols[] = [];
  for (const def of defs) {
    const groupDaySet = new Set(def.days);
    const cols: TeacherCol[] = [];
    // 묶음마다 **그 사람이 저장한 순서**(없으면 가나다순) — 원장 2026-09-08 "월목 / 화금 / 수 그룹 내에서".
    for (const t of sortTeachersByOrder(teachers, order?.[teacherGroupKey(def.days)])) {
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
      out.push({ ...def, teachers: cols });
    }
  }
  return out;
}

/**
 * 화면의 한 블록이 **함께 옮기는** 배치들 — **블록 앵커 칸**(그 `<td>`)에 대한 상대 위치로 접는다.
 *
 * 🔴 격자는 같은 반의 연속 교시(세로)·같은 그룹 요일(가로)을 한 칸으로 병합해 그린다 — 실측 2026-09-04:
 *    영어는 (반,요일) 121칸이 **전부** 교시 2개 이상이고 106칸이 두 요일에 걸쳐 있다. 기준 줄 하나만 옮기면
 *    화면은 블록이 통째로 간 것처럼 보이는데 나머지 줄이 제자리에 남는다.
 * 🔴 **기준은 앵커 칸이다**(실제 슬롯이 있는 첫 칸이 아니라) — 목적지 좌표가 칸 앵커(`rowIndex={ri}`)라
 *    프레임이 같아야 한다. 반교시 확장 블록(`expandHalfPeriodBlocks`가 앵커를 윗 교시로 올린 것)은 두 프레임이
 *    한 칸 어긋나서, **제자리에 놓아도** 교시가 한 칸 올라가고 무동작 가드가 안 걸렸다(적대 리뷰 2026-09-04).
 * 🔴 강사·강의실·자리 여부를 **줄마다** 싣는다 — 한 블록에 자리(LAB·JJ) 교시와 정규 교시가 섞일 수 있다.
 */
function blockMoveParts(
  placed: { slot: ScheduleSlotWithStudents; row: number; dayIdx: number }[],
  anchorRow: number,
  anchorDayIdx: number,
): MovePart[] {
  return placed.map((p) => ({
    slotId: p.slot.id,
    rowOffset: p.row - anchorRow,
    dayOffset: p.dayIdx - anchorDayIdx,
    durMin: Math.max(0, toMinutes(p.slot.endTime) - toMinutes(p.slot.startTime)),
    teacher: slotTeacherOf(p.slot),
    roomId: slotRoomIdOf(p.slot),
    roomTok: slotRoomTokOf(p.slot),
    roomName: slotRoomNameOf(p.slot),
    seat: isSeatSlot(p.slot),
  }));
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
  hideStudents = false,
  parts,
}: {
  slots: ScheduleSlotWithStudents[];
  coveringDays: DayOfWeek[];
  /** 학생 명단 접기 — 셀은 반 이름·강의실·인원만 남는다(뷰 설정). */
  hideStudents?: boolean;
  /** 그룹 한쪽 교시만 쓰는 수업이면 수업명을 그 절반에만(expandHalfPeriodBlocks가 판정). */
  subSlot?: SubSlot;
  /**
   * 이 블록이 **함께 옮기는** 배치들(반 드래그) — 화면의 한 블록이 실제로는 배치 여러 줄이다
   * (연속 교시 세로 병합·월목 가로 병합). 없으면(합반·읽기 전용) 반 드래그가 없다.
   */
  parts?: MovePart[];
}) {
  const merged = mergeSlotsByClass(slots);
  const isHapban = merged.length >= 2;
  return (
    // 학생 검색 — 걸린 반이 하나도 없는 칸은 **아예 안 그린다**(격자 축은 그대로).
    // 🔑 판정 단위가 '칸'이 아니라 '칸이 담은 반들'이라 합반 칸은 **한 반만 걸려도 통째로** 남는다 —
    //    그래야 그 아이가 합반 명단의 어디에 있는지가 읽힌다(원장 요구: 반 전체가 보여야 한다).
    <SearchedCell classIds={merged.map((m) => m.classId ?? m.id)}>
    <div
      className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
        isHapban ? "border-amber/50 bg-amber/5 gap-1 rounded-md border p-1" : ""
      }`}
    >
      {isHapban ? (
        <span className="text-amber bg-amber/15 -mx-1 -mt-1 mb-0.5 shrink-0 rounded-t-md px-1 py-0.5 text-center num text-xs font-bold whitespace-nowrap">
          합반 {merged.length}반
        </span>
      ) : null}
      {isHapban ? (
        <HapbanCell slots={merged} subSlot={subSlot} coveringDays={coveringDays} roster={hideStudents ? "none" : "names"} />
      ) : (
        <ClassCell
          slot={merged[0]!}
          roster={hideStudents ? "none" : "names"}
          subSlot={subSlot}
          coveringDays={coveringDays}
          moveParts={parts}
        />
      )}
    </div>
    </SearchedCell>
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
  hideStudents = false,
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
  /** '학생 명단 접기' — 셀에서 명단을 빼고(행 높이는 호출부가 `rowHeight`로 함께 줄인다). */
  hideStudents?: boolean;
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
  // 이 표의 식별자 — 교시 행 목록은 표마다 다르다(평일 14:30~ / 주말 09:00~). 반 블록 배치 계산이 쓴다.
  const gridId = weekend ? "we" : "wd";
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
  // 반 블록을 놓을 자리를 계산하려면 **이 표의 교시 행 시작시각이 순서대로** 필요하다(블록이 두 교시를 쓰면
  // 그 아래 행). 🔴 칸에서 되짚지 말 것 — 모든 열이 위쪽 rowSpan에 덮인 행은 칸이 하나도 없어 그 행이 빠진다.
  const rowStarts = rows.map((r) => `${r.time.split("~")[0]}:00`).join(",");

  return (
    <table
      className={`border-collapse border ${GRID} text-sm`}
      style={{ tableLayout: "fixed", width: tableW }}
      {...{ [GRID_ID_ATTR]: gridId, [GRID_ROWS_ATTR]: rowStarts }}
    >
      <colgroup>
        <col style={{ width: PERIOD_COL_W }} />
        {dayCols.map((d, i) => (
          <col key={i} style={{ width: dayColW(d, wideDays) }} />
        ))}
      </colgroup>
      <thead>
        {/* 강사 행 — 표의 첫 줄(그룹 밴드는 2026-09-07 삭제). */}
        <tr>
          {/* 좌상단 코너 = 교시(세로축)와 요일·강사(가로축)의 교차점 → 어느 축 라벨도 아니므로 비워둔다. */}
          <th
            rowSpan={2}
            aria-hidden
            className={`bg-bg-soft ${GRID} ${periodHeadSticky} ${periodDivider} ${ROW_DIVIDER} w-[80px] p-2`}
          />
          {groups.flatMap((g, gi) =>
            g.teachers.map((t, ti) => (
              // 머리칸 = 끌어서 순서 바꾸기(같은 요일 묶음 안에서, 계정 저장) — teacher-head-cell.tsx.
              // px-2 → px-0.5(2026-09-08 전수검사): colSpan 1(66px) 칸에 20px 볼드 3자가 들어가게 여백만 좁힌다.
              <TeacherHeadCell
                key={`${g.title}-${t.name}`}
                subject={subject}
                groupKey={teacherGroupKey(g.days)}
                teachers={g.teachers.map((x) => x.name)}
                name={t.name}
                colSpan={t.days.length}
                // 이름이 표의 첫 줄이라 sticky top=0. 높이는 아래 요일 줄의 오프셋과 묶여 있어 **명시**한다.
                style={{ height: TEACHER_HEAD_H }}
                className={`bg-bg-soft ${GRID} sticky top-0 z-10 border-b border-r px-0.5 py-1.5 text-center ${gi > 0 && ti === 0 ? GROUP_DIVIDER : ""}`}
              >
                {/* 이름 1.5배(원장 2026-09-07) — 격자에서 열을 찾는 기준이 강사 이름이라 가장 크게 읽혀야 한다.
                    토큰 스케일에 21px이 없어 한 칸 위인 20px(text-lg). 넘치면 잘린다(생략표 없음 = 고밀도 규약). */}
                <span className="text-foreground block overflow-hidden whitespace-nowrap text-clip text-lg font-bold">{t.name}</span>
              </TeacherHeadCell>
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
                    style={{ top: TEACHER_HEAD_H }}
                    className={`bg-card ${GRID} ${ROW_DIVIDER} sticky z-10 border-r ${gi > 0 && ti === 0 && ci === 0 ? GROUP_DIVIDER : ""}`}
                  >
                    {/* 그룹 색 띠 — 밴드를 없앤 뒤로 이 물들임이 월목|화금을 가르는 유일한 색 신호다(나머지는 진한 세로선).
                        불투명 base 위에 반투명 tint를 얹는다 — sticky 셀을 soft 토큰(12% 알파)으로만 두면 스크롤 시 본문(학생 이름)이 비친다. */}
                    <div className={`${g.tint} text-text-dim px-1 py-1 text-center text-xs leading-tight font-bold`}>
                      {DAY_LABEL[d] ?? d}
                      {date ? (
                        <span className="text-text-faint block text-xs font-normal">{date}</span>
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
          // 이 교시 행의 시작시각(`HH:MM:SS`) — 반을 여기로 옮기면 이 시각에 시작한다(길이는 원래 그대로).
          // `row.time`은 표준 행 `16:20~18:10` · 비표준(x-) 행 `16:20` 둘 다 앞쪽이 시작시각이다.
          const rowStart = `${row.time.split("~")[0]}:00`;
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
          const labelBase = `bg-bg-soft ${periodCellSticky} ${periodDivider} ${ROW_DIVIDER} font-bold whitespace-nowrap`;
          const labelCls = labelCollapsed
            ? `${labelBase} text-text-dim overflow-hidden px-2 py-0 align-middle text-xs [.tt-editing_&]:text-foreground [.tt-editing_&]:py-2 [.tt-editing_&]:align-top [.tt-editing_&]:text-xs`
            : `${labelBase} text-foreground px-2 py-2 align-top text-xs`;
          const labelText = mathN !== null ? `${Math.ceil(mathN / 2)}교시` : row.label;
          const timeText =
            mathN !== null
              ? `${row.time.split("~")[0]}~${(paired ? nextRow! : row).time.split("~")[1]}`
              : row.time;
          // 학원장이 교시 이름을 비우면 이름 줄을 없애고 **시간대를 이름 자리로 올린다**(2026-08-13).
          // 시각을 작은 회색 줄로만 남기면 축이 텅 빈 칸처럼 보인다.
          const timeOnly = labelText === "";
          return (
            // ⚠️ 교시 행 높이를 rowHeight로 **명시 고정** → 그룹 라벨(rowSpan=2)이 두 교시(예 4-1/4-2)를
            // 정확히 2등분(각 rowHeight). tr에 안 박으면 border-collapse 표에서 브라우저가 rowSpan=2 라벨의
            // 444를 두 행에 **내용량 비례로 분배** → 학생 많은 4-1이 커지고 4-2가 얇아짐(2026-07-07 사용자 지적).
            <tr key={row.key} style={{ height: rowH }}>
              {isGroupSecond ? null : (
                <td rowSpan={paired ? 2 : 1} className={labelCls} style={{ height: labelH }}>
                  {timeOnly ? (
                    // 이름이 없어도 시각은 **두 줄**(`14:30` / `~ 16:20`) — 한 줄 `14:30~16:20`은 교시 열 폭을 넘어
                    // 옆 칸으로 샌다(원장 캡처 2026-09-04. 이름 있는 갈래는 아래에서 이미 두 줄이었다).
                    <span className="num leading-tight">
                      <span className="block">{timeText.split("~")[0]}</span>
                      {timeText.includes("~") ? <span className="block">~ {timeText.split("~")[1]}</span> : null}
                    </span>
                  ) : (
                    <>
                      {labelText}
                      {labelCollapsed ? (
                        <>
                          {/* 접힌 밴드는 한 줄이라 시작 시각만(끝까지 적으면 96px에서도 끊긴다). 펼치면 두 줄 전체가 나온다. */}
                          <span className="text-text-faint ml-1 num text-xs font-normal [.tt-editing_&]:hidden">
                            {timeText.split("~")[0]}
                          </span>
                          <div className="text-text-faint mt-0.5 hidden num text-xs [.tt-editing_&]:block">
                            {timeText.split("~")[0]}
                          </div>
                        </>
                      ) : (
                        // 시각은 **두 줄**(`14:30` / `~ 16:20`) — 한 줄 `14:30~16:20`은 교시 열 폭을 넘쳐 옆 칸으로 새어 나갔다
                        // (원장 캡처 2026-09-04 *"왼쪽에 시간 텍스트가 벗어나지 않도록"*). 접힌 행(위)은 한 줄 압축 그대로.
                        <div className="text-text-faint mt-0.5 num text-xs leading-tight">
                          <div>{timeText.split("~")[0]}</div>
                          {timeText.includes("~") ? <div>~ {timeText.split("~")[1]}</div> : null}
                        </div>
                      )}
                    </>
                  )}
                </td>
              )}
              {prepared.flatMap((g, gi) =>
                g.teachers.flatMap((t, ti) =>
                  t.days.map((d, ci) => {
                    const block = t.blocks.get(`${ri}:${ci}`);
                    if (!block) return null; // 위/왼쪽 병합에 피복됨 — 렌더 스킵
                    // 블록 전체(rowSpan×colSpan) 슬롯 모아 같은 반 합치기.
                    // 🔴 **어느 줄이 어느 칸에서 왔는지**를 함께 기억한다 — 반 드래그는 블록 전체를 모양 그대로
                    //    옮기므로(class-move.ts) 줄마다 (교시 행, 그룹 안 요일) 오프셋이 필요하다.
                    const acc: ScheduleSlotWithStudents[] = [];
                    const placed: { slot: ScheduleSlotWithStudents; row: number; dayIdx: number }[] = [];
                    for (let rr = ri; rr < ri + block.rowSpan; rr++) {
                      for (let cc = ci; cc < ci + block.colSpan; cc++) {
                        const dayIdx = g.days.indexOf(t.days[cc]!);
                        for (const s of t.cellAt(rr, cc)) {
                          acc.push(s);
                          placed.push({ slot: s, row: rr, dayIdx });
                        }
                      }
                    }
                    // 이 블록이 담은 반이 하나일 때만 반 드래그(합반은 어느 반을 옮기는지 화면이 말할 수 없다).
                    const blockClassIds = new Set(acc.map((x) => x.classId));
                    const anchorDayIdx = g.days.indexOf(t.days[ci]!);
                    const moveParts =
                      blockClassIds.size === 1 && placed.length > 0 && anchorDayIdx >= 0 && placed.every((p) => p.dayIdx >= 0)
                        ? blockMoveParts(placed, ri, anchorDayIdx)
                        : undefined;
                    // 이 병합 블록이 덮는 요일 — 분리등원 요일 칸 분할용(월목 병합이면 [mon,thu]). 단독 셀이면 [그 요일].
                    const coveringDays = t.days.slice(ci, ci + block.colSpan);
                    // 셀 높이 = 실제 연속 교시 수(block.rowSpan) × 교시 높이. 엑셀 셀병합처럼 수업이 쓰는
                    // 교시만큼만 세로로 차지(4-1만 하면 1칸, 5·6·7교시면 3칸). 안 쓰는 교시는 별도 빈칸.
                    // 🔴 명단을 접으면 행이 38px이라 `rowSpan=1` 셀(영어·주말·수학 반쪽 그룹)은 22px가 되어
                    //    **반 이름 헤더(60)가 잘린다** — 최소 높이를 헤더 존으로 못박는다(합반은 배지 몫을 더한다).
                    //    그 행만 조금 높아질 뿐 격자 정렬은 유지된다(같은 행의 칸은 함께 늘어난다).
                    const isHapbanCell = blockClassIds.size >= 2;
                    const minCellH = hideStudents ? HEADER_H + (isHapbanCell ? HAPBAN_BADGE_H : 0) : 0;
                    const cellH = Math.max(minCellH, block.rowSpan * rowHeight - 16);
                    return (
                      <td
                        key={`${g.title}-${t.name}-${d}-${row.key}`}
                        rowSpan={block.rowSpan > 1 ? block.rowSpan : undefined}
                        colSpan={block.colSpan > 1 ? block.colSpan : undefined}
                        className={`${ROW_DIVIDER} border-r ${GRID} p-1.5 align-top ${
                          acc.length === 0 ? "bg-ink/[0.06]" : ""
                        } ${gi > 0 && ti === 0 && ci === 0 ? GROUP_DIVIDER : ""}`}
                      >
                        {/* 반 블록 드롭 대상 — 빈 칸도 포함한다(옮길 곳은 대개 빈 칸이다). 반을 끌고 있지 않으면
                            드롭존을 만들지 않아 학생 드래그가 느려지지 않는다(grid-drop-cell.tsx 주석). */}
                        <GridDropCell
                          day={d}
                          start={rowStart}
                          grid={gridId}
                          rowIndex={ri}
                          groupDays={g.days}
                          col={`${g.title}:${t.name}`}
                        >
                          {acc.length === 0 ? (
                            // 빈 칸도 높이를 잡아 둬야 하이라이트가 칸 전체로 보인다(내용은 없다).
                            // 🔴 **접힌 빈 교시 행은 예외** — 고정 px를 주면 행이 통째로 펴져 '빈 교시 접기'가 죽는다
                            //    (표 행 높이는 최솟값이라 내용이 이긴다). 접힌 행은 행과 **같은 변수**를 따라간다
                            //    (드래그 중엔 EmptyPeriodScope가 그 변수를 풀 높이로 올려 함께 펼쳐진다).
                            <div
                              style={{
                                // 🔴 빈 칸엔 **헤더 최소 높이(hideStudents)를 적용하지 않는다** — 지킬 반 이름이 없다.
                                //    적용하면 명단을 접었을 때 빈 칸이 60px을 잡아 38px 행이 도로 늘어난다.
                                height: isCollapsed(row.key)
                                  ? `calc(${EMPTY_PERIOD_H} - 12px)`
                                  : block.rowSpan * rowHeight - 16,
                              }}
                              aria-hidden
                            />
                          ) : (
                            <div className="flex flex-col" style={{ height: cellH }}>
                              <SubSlotContent
                                slots={acc}
                                coveringDays={coveringDays}
                                subSlot={t.subSlots.get(`${ri}:${ci}`) ?? "full"}
                                hideStudents={hideStudents}
                                parts={moveParts}
                              />
                            </div>
                          )}
                        </GridDropCell>
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
  hideStudents = false,
  teacherOrder,
}: {
  slots: ScheduleSlotWithStudents[];
  config?: PeriodsConfig;
  /** 조회 중인 주의 월요일("YYYY-MM-DD") — 요일 헤더에 날짜(M/D) 표시(스프레드시트 패리티). */
  weekMonday?: string;
  /** 과목별 평일 요일 병합 프리셋(미설정 시 월목·화금). 단독 그룹 요일은 풀너비. */
  weekdayGrouping?: WeekdayGrouping;
  /** '빈 교시 접기' — 수업 없는 교시 행을 얇은 밴드로 축소(평일·주말 표 각각 판정). 끄는 동안은 자동 펼침. */
  collapseEmptyPeriods?: boolean;
  /**
   * '학생 명단 접기'(뷰 설정, 계정 귀속) — 셀에 반 이름·강의실·인원만 남긴다.
   * 🔴 명단만 감추는 게 아니라 **행 높이도 함께** 줄인다(안 줄이면 칸의 4/5가 빈 채로 남아 접는 뜻이 없다).
   */
  hideStudents?: boolean;
  /** 이 과목의 **내** 강사 열 순서(요일 묶음 키 → 이름). 없으면 가나다순. 저장은 머리칸 드래그가 한다. */
  teacherOrder?: TeacherOrderByGroup;
}) {
  const subject = (slots[0]?.subject ?? "math") as TimetableSubject;
  // 요일 헤더 날짜 라벨(스프레드시트처럼 "월 6/29"). weekMonday 없으면 요일만.
  const dayDates = weekMonday ? dayDateLabels(weekMonday) : {};
  const dateOf = (d: DayOfWeek) => dayDates[d];
  // 행 높이 = 교시 1칸, 과목 분기 없음. 수업은 실제 쓰는 연속 교시 수만큼 rowSpan 병합된다.
  // 명단을 접으면 헤더 존만 남는 높이로 함께 줄어든다(단일 소스 = periodRowFullHeight).
  const rowH = periodRowFullHeight(hideStudents);
  const weekdayRowH = rowH;
  const weekdaySlots = slots.filter((s) => !WEEKEND_KEYS.has(s.dayOfWeek as DayOfWeek));
  const weekendSlots = slots.filter((s) => WEEKEND_KEYS.has(s.dayOfWeek as DayOfWeek));

  // 과목 프리셋 → 평일 그룹. 단독(병합 안 되는) 요일은 2배 폭(wide). 주말은 토/일 항상 풀너비.
  const weekdayDefs = buildWeekdayGroupDefs(weekdayGrouping);
  const weekdayWide = new Set<DayOfWeek>(weekdayDefs.filter((g) => g.days.length === 1).flatMap((g) => g.days));
  const weekendWide = new Set<DayOfWeek>(["sat", "sun"]);

  const weekdayGroups = buildGroups(weekdaySlots, weekdayDefs, teacherOrder);
  const weekendGroups = buildGroups(weekendSlots, [WEEKEND_GROUP], teacherOrder);

  return (
    <DragScrollArea barX className="bg-card border-line shadow-card min-h-0 flex-1 rounded-2xl border p-1">
      {/* ijw식 가로 배치 — 평일 그룹(월목/화금/수) 한 판 + 주말 한 판을 우측에 나란히
          (주말은 시작시각이 달라 자체 교시열). 세로 스택 대신 가로로 공간 효율. */}
      <div className="flex items-start gap-3">
        {/* 학생 검색 — 걸린 반이 한 반도 없는 **판**은 통째로 접는다. 칸만 지우면 교시 축만 남은 빈 표가
            옆에 계속 서 있어(특히 주말 판) "왜 아무것도 없지"로 읽힌다. 한 반이라도 걸리면 그 판은
            축까지 그대로 남는다 — 몇 교시 자리인지가 검색 결과의 절반이다. */}
        {weekdayGroups.length > 0 ? (
          <SearchedCell classIds={weekdaySlots.map((s) => s.classId ?? s.id)}>
            <GroupTable
              slots={weekdaySlots}
              subject={subject}
              groups={weekdayGroups}
              weekend={false}
              rowHeight={weekdayRowH}
              hideStudents={hideStudents}
              config={config}
              dateOf={dateOf}
              wideDays={weekdayWide}
              collapseEmpty={collapseEmptyPeriods}
            />
          </SearchedCell>
        ) : null}
        {weekendGroups.length > 0 ? (
          <SearchedCell classIds={weekendSlots.map((s) => s.classId ?? s.id)}>
            <GroupTable
              slots={weekendSlots}
              subject={subject}
              groups={weekendGroups}
              weekend
              rowHeight={rowH}
              hideStudents={hideStudents}
              stickyPeriod={false}
              config={config}
              dateOf={dateOf}
              wideDays={weekendWide}
              collapseEmpty={collapseEmptyPeriods}
            />
          </SearchedCell>
        ) : null}
      </div>
    </DragScrollArea>
  );
}
