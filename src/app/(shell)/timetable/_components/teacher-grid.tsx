import type { ReactElement } from "react";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { readableTextColor } from "@/lib/color-utils";
import type { ScheduleSlotWithStudents } from "@/features/timetable/server/queries";
import type { DayOfWeek } from "@/features/timetable/lib/periods";
import {
  breakBlocksForColumn,
  buildSlotIntervals,
  buildTenMinuteRows,
  minToHM,
  packGroups,
  parseBreakRanges,
  slotRowSpan,
  type ClassInterval,
} from "@/features/timetable/lib/ten-minute-grid";
import type { TeacherColorMap } from "@/features/timetable/lib/class-grid";
import { DAY_LABEL } from "@/features/timetable/lib/split-attendance";
import {
  ENGLISH_SHEET_TEACHERS,
  buildTeacherComparator,
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

// 요일 라벨은 공용 단일 소스(split-attendance) — 파일마다 같은 맵을 다시 적지 않는다.
const DAY_ORDER: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_OFFSET: Record<DayOfWeek, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };

const TIME_COL_W = 48; // "14:20" 한 줄 라벨
const DAY_COL_W = 65; // 반명+방 chip(학생 없음). 강사×요일이 많아 가로 스크롤(2026-07-06 96→65 사용자 지정).
const LANE_COL_W = 64; // 다중 레인(LAB 서브컬럼) 폭 — 레벨코드 반명(LT2 등) 기준. 시트도 좁은 서브컬럼.
// 행 높이 = 분당 1.4px 고정(스텝 무관 블록 높이 동일 — step 10=14px/행, step 30=42px/행: 60분 수업은 항상 84px).
const PX_PER_MIN = 1.4;
const HEAD_TEACHER_H = 30; // 강사 밴드 행 높이(sticky top 오프셋 계산용) — 이름 16px 수용
const HEAD_DAY_H = 30; // 요일 행 높이

// 격자선 — 수학 기본뷰와 동일한 균일 톤(엑셀식 균일 격자, 2026-07-06 사용자 지정).
// main 기본뷰 가독성 리워크(weekday-group-tables const GRID = border-ink/25)와 동일 값으로 유지할 것 —
// 어긋나면 뷰 토글 한 번에 격자 톤이 갈라진다(병합 적대리뷰 2026-07-06).
const GRID = "border-ink/25";
// 강사 밴드 경계 세로줄 — 일반 격자(연회색)와 구분되게 **찐한 회색 2px**(사용자 지정).
// border-r-ink/40(변 전용 색)이 GRID의 shorthand border-color를 우선한다.
const TEACHER_EDGE = "border-r-2 border-r-ink/40";
// 수업시간(교시) 경계 가로줄 — 세로 강사 경계선과 동일 톤(시트의 검은 교시선 미러).
// 위치는 과목 설정(operations.subjects[].teacherViewLines, 학원설정 과목 운영)에서 — props로 주입.
const PERIOD_EDGE = "border-b-2 border-b-ink/40";

// ⚠️⚠️ 이 표는 border-collapse가 아니라 **border-separate(border-spacing-0)** 다 — collapse로 되돌리지 말 것.
// collapse 모드에선 ① 셀 테두리가 표 소유라 sticky 시각열/헤더에서 선이 표와 함께 밀려 사라지고([[#71]] —
// 그래서 가상요소·셀 안 span 실선으로 우회했었다) ② collapse 테두리는 경계선 **중앙**에 걸쳐 그려져(2px =
// 경계 위 1px + 아래 1px) 셀 안 span(경계 위쪽 전부)과 같은 가로줄인데도 세로로 1px 어긋나 보였고
// ③ 굵은 경계(2px)의 절반이 행 높이에 얹혀 10분 축(rowH 고정)이 행마다 미세 드리프트했다 —
// "가로줄 굵기가 달라 어긋나 보인다" 제보(2026-07-06)의 원인. separate 모드는 셀이 테두리를 소유해
// sticky를 그대로 따라오고(가상요소 불필요) 테두리가 셀 박스 안(border-box)에 그려져 **모든 가로줄이
// 단일 경로로 렌더** → 굵기·위치 균일, 행 높이 정확히 rowH. 세로줄은 border-r만·왼쪽 프레임은 시각열
// border-l 하나만 = 이중선 없음.

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
  sectionLineMins,
  stepMin = 10,
  pxPerMin,
  breakRanges,
  excludedTeachers,
  teacherOrder,
  showUnusedDays = true,
}: {
  slots: ScheduleSlotWithStudents[];
  weekMonday?: string;
  /** 강사 헤더색(DB getTeacherColorMap) — 직원 등록된 강사 우선. 미등록은 시트 미러색 폴백. */
  teacherColors?: TeacherColorMap;
  /** 내부 가로줄 시각(자정 기준 분) — 과목 설정 teacherViewLines. page.tsx가 도출. */
  sectionLineMins?: number[];
  /** 격자 단위(분, 60의 약수) — 과목 설정 teacherViewStep. */
  stepMin?: number;
  /** 세로 밀도(분당 px) — 과목 설정 teacherViewPxPerMin. 미설정 = 폴백 PX_PER_MIN(1.4). */
  pxPerMin?: number;
  /** 강사 컬럼 순서 — 과목 설정 teacherViewOrder. 미설정 = 시트 미러 + 자리(JJ·LAB) 최우측. */
  teacherOrder?: readonly string[];
  /** 쉬는 시간 범위(HH:MM~HH:MM) — 과목 설정 teacherViewBreaks. 앞뒤 수업 붙은 강사 컬럼에만 셀 표시. */
  breakRanges?: { start: string; end: string }[];
  /** 가로줄(큰 섹션 경계) 미표시 강사 라벨 — 과목 설정 teacherViewLineExcluded. */
  excludedTeachers?: string[];
  /** true(기본) = 강사마다 월~토 전 요일 컬럼(수업 없는 요일도 빈 컬럼으로). false = 수업 있는 요일만. */
  showUnusedDays?: boolean;
}) {
  const dayDates = dayDateLabels(weekMonday);
  // 행 높이 = 분당 px 고정(스텝 무관 블록 크기 동일). 가로줄 시각은 step 격자에 스냅(격자 밖이면 silent drop 방지).
  // 밀도는 과목 설정(teacherViewPxPerMin) 우선, 미설정이면 PX_PER_MIN(=DEFAULT_TEACHER_VIEW_PX_PER_MIN).
  const rowH = Math.round(stepMin * (pxPerMin ?? PX_PER_MIN));
  const periodEdgeMins = new Set(
    (sectionLineMins ?? []).map((m) => Math.floor(m / stepMin) * stepMin),
  );
  // 쉬는 시간(격자 스냅) + 가로줄 제외 강사 집합.
  const breaks = parseBreakRanges(breakRanges, stepMin);
  const excludedSet = new Set(excludedTeachers ?? []);

  // 강사 목록 = 슬롯 강사 라벨, 시트 좌→우 순서. 각 강사의 요일은 실제 가르치는 요일만(자연순 월→토).
  const teacherNames = Array.from(new Set(slots.map(teacherOf))).sort(
    buildTeacherComparator(teacherOrder),
  );
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
      // 기본 = 월~토 전 컬럼(빈 요일 포함, 일요일은 수업 있을 때만). 토글 해제 시 수업 요일만.
      const days = DAY_ORDER.filter((d) =>
        showUnusedDays ? d !== "sun" || daySet.has(d) : daySet.has(d),
      );
      return { name, days, color: colorFor(name) };
    })
    .filter((t) => t.days.length > 0);

  // 행 = 시간 격자(데이터 범위 ∪ 시트 폴백 14:20~22:00, 단위=stepMin). 절대 시각축이라 토요일 오후도
  // 자연 정렬(옛 교시축의 rowOf 'mon' 주말 핵이 필요 없어짐).
  const rows = buildTenMinuteRows(slots, undefined, stepMin);

  // 강사×요일: 같은 시간 범위 병렬 반 = 한 그룹(합반, colSpan 셀) → 그룹 단위 레인 패킹.
  const prepared = teachers.map((t) => {
    const cols = t.days.map((day) => {
      const colSlots = slots.filter((s) => teacherOf(s) === t.name && s.dayOfWeek === day);
      // ⚠️ 슬롯=블록 1:1(접기 없음) — 한 수업이 2교시 연속이어도 시트처럼 교시별 셀 2개로(2026-07-06).
      const intervals = buildSlotIntervals(colSlots, stepMin);
      const { groups, laneCount } = packGroups(intervals);
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
      // 쉬는 시간 블록(앞뒤 수업 붙은 경우만) — 전 레인 폭(colSpan=laneCount). 앵커 행 + 피복 행.
      const breakAnchors = new Map<number, { span: number }>();
      const breakCovered = new Set<number>();
      for (const bl of breakBlocksForColumn(rows, intervals, breaks)) {
        breakAnchors.set(bl.index, { span: bl.span });
        for (let r = bl.index; r < bl.index + bl.span; r++) breakCovered.add(r);
      }
      // 레인 폭 — 1레인=기본 65, 다중(병렬)=레인당 64(시트도 좁은 서브컬럼).
      const laneW = laneCount > 1 ? LANE_COL_W : DAY_COL_W;
      return { day, laneCount, laneW, anchors, covered, breakAnchors, breakCovered };
    });
    return { ...t, cols, lineExcluded: excludedSet.has(t.name) };
  });

  const laneColsFlat = prepared.flatMap((t) =>
    t.cols.flatMap((col) => Array.from({ length: col.laneCount }, () => col.laneW)),
  );
  const tableW = TIME_COL_W + laneColsFlat.reduce((a, w) => a + w, 0);

  // 강사 경계 세로줄 — 그 강사의 마지막 요일·마지막 레인(또는 거기까지 걸친 그룹 셀)에 2px.
  const isTeacherBoundary = (col: { laneCount: number }, isLastDay: boolean, laneEnd: number) =>
    isLastDay && laneEnd === col.laneCount;
  // 교시 경계 가로줄 — 이 행의 하단(=다음 행 시작)이 설정된 가로줄 시각이면 진한 2px, 아니면 옅은 1px.
  // px = 블록 셀 내부 래퍼 높이 계산용(border-box: 셀 콘텐츠 높이 = span*rowH − 자기 border-b 굵기).
  // ⚠️ 표 최하단(m==null)은 외곽 프레임이라 전 컬럼 진하게(제외 강사도 동일 — 프레임 균일).
  // 내부 섹션선만 제외 강사 컬럼에서 옅게(가로줄 미표시) — 시각열은 항상 전역 참조라 excluded=false.
  const bottomEdge = (nextRi: number, excluded = false) => {
    const m = rows[nextRi]?.startMin;
    if (m == null) return { cls: PERIOD_EDGE, px: 2 };
    return !excluded && periodEdgeMins.has(m)
      ? { cls: PERIOD_EDGE, px: 2 }
      : { cls: "border-b", px: 1 };
  };

  return (
    <DragScrollArea barX className="bg-card border-line shadow-card min-h-0 flex-1 rounded-2xl border p-1">
      <table className="border-separate border-spacing-0 text-sm" style={{ tableLayout: "fixed", width: tableW }}>
        <colgroup>
          <col style={{ width: TIME_COL_W }} />
          {laneColsFlat.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          {/* 강사 밴드 — 시트 강사 헤더색. sticky top(46행 세로 스크롤 실재) — separate 모드라 셀 border가 sticky를 따라온다. */}
          <tr>
            <th
              rowSpan={2}
              aria-hidden
              className={`bg-bg-soft sticky top-0 left-0 z-30 border-r border-b border-l ${GRID}`}
              style={{ height: HEAD_TEACHER_H + HEAD_DAY_H }}
            />
            {prepared.map((t) => (
              <th
                key={t.name}
                colSpan={t.cols.reduce((a, c) => a + c.laneCount, 0)}
                // ⚠️ 색이 없는 강사(색 미지정 + 영어 시트 강사 목록 밖)면 th 자체가 투명이라, sticky 헤더
                // 아래로 흐르는 본문이 px-2 py-1 패딩 링 사이로 비쳐 보였다(#74와 같은 부류). 안쪽 span만
                // bg를 갖고 있었기 때문 → th에도 불투명 배경 폴백.
                className={`sticky top-0 z-20 border-b px-2 py-1 text-center ${t.color ? "" : "bg-bg-soft"} ${TEACHER_EDGE} ${GRID}`}
                style={{
                  height: HEAD_TEACHER_H,
                  ...(t.color ? { backgroundColor: t.color.bg, color: t.color.text } : {}),
                }}
              >
                <span className={`block overflow-hidden text-[16px] leading-tight font-bold whitespace-nowrap text-clip ${t.color ? "" : "text-foreground bg-bg-soft"}`}>
                  {t.name}
                </span>
              </th>
            ))}
          </tr>
          {/* 요일 행 — 강사 밴드 바로 아래에 sticky. 다중 레인 요일은 레인 수만큼 가로 병합. */}
          <tr>
            {prepared.flatMap((t) =>
              t.cols.map((col, ci) => (
                <th
                  key={`${t.name}-${col.day}`}
                  colSpan={col.laneCount}
                  className={`bg-bg-soft text-foreground sticky z-20 border-b px-1 py-0.5 text-center text-[10px] leading-tight font-bold ${GRID} ${
                    ci === t.cols.length - 1 ? TEACHER_EDGE : "border-r"
                  }`}
                  style={{ top: HEAD_TEACHER_H, height: HEAD_DAY_H }}
                >
                  {DAY_LABEL[col.day] ?? col.day}
                  {dayDates[col.day] ? (
                    <span className="text-ink/80 block text-[9px] font-bold">{dayDates[col.day]}</span>
                  ) : null}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={row.key}>
              {/* 시각열 — sticky left. 매 행 라벨(시트 미러), 정시 라벨만 강조. separate 모드라 좌·우·하단
                  전부 **본문 셀과 동일한 실제 border**(같은 렌더 경로 = 굵기·위치가 본문 가로줄과 정확히 일치). */}
              <td
                className={`bg-bg-soft sticky left-0 z-10 border-r border-l px-1 py-0 text-right align-middle num leading-none ${GRID} ${bottomEdge(ri + 1).cls} ${
                  row.isHour ? "text-foreground text-[9px] font-bold" : "text-ink/80 text-[9px] font-bold"
                }`}
                style={{ height: rowH }}
              >
                {row.key}
              </td>
              {prepared.flatMap((t) =>
                t.cols.flatMap((col, ci) => {
                  const isLastDay = ci === t.cols.length - 1;
                  const excluded = t.lineExcluded;
                  const cells: (ReactElement | null)[] = [];
                  // 쉬는 시간 셀(앵커 행) — 전 레인 폭(colSpan=laneCount), 수업 사이 밴드.
                  const brk = col.breakAnchors.get(ri);
                  if (brk) {
                    const bottom = bottomEdge(ri + brk.span, excluded);
                    cells.push(
                      <td
                        key={`${t.name}-${col.day}-break-${row.key}`}
                        rowSpan={brk.span}
                        colSpan={col.laneCount}
                        className={`bg-ink/[0.06] p-0 align-top ${bottom.cls} ${GRID} ${
                          isTeacherBoundary(col, isLastDay, col.laneCount) ? TEACHER_EDGE : "border-r"
                        }`}
                      >
                        <div
                          className="flex items-center justify-center"
                          style={{ height: brk.span * rowH - bottom.px }}
                        >
                          <span className="text-text-faint text-[10px] whitespace-nowrap">
                            쉬는 시간
                          </span>
                        </div>
                      </td>,
                    );
                  }
                  const inBreak = col.breakCovered.has(ri); // 쉬는 시간 셀이 이 행 전 레인을 덮음
                  for (let li = 0; li < col.laneCount; li++) {
                    if (inBreak) continue;
                    const key = `${t.name}-${col.day}-${li}-${row.key}`;
                    if (col.covered.has(`${ri}:${li}`)) continue; // 그룹 셀에 피복됨
                    const anchor = col.anchors.get(`${ri}:${li}`);
                    // 빈 1×1 셀 — 균일 격자 프레임(수학 기본뷰와 동일 border-line).
                    if (!anchor) {
                      cells.push(
                        <td
                          key={key}
                          className={`bg-bg-soft/40 ${bottomEdge(ri + 1, excluded).cls} ${GRID} ${
                            isTeacherBoundary(col, isLastDay, li + 1) ? TEACHER_EDGE : "border-r"
                          }`}
                        />,
                      );
                      continue;
                    }
                    const { group, span } = anchor;
                    const bottom = bottomEdge(ri + span, excluded);
                    // 그룹 셀 — rowSpan = 실길이/10분, colSpan = 병렬 반 수(합반, 테두리 없이 나란히).
                    // 내용은 **고정높이 래퍼**(td height는 최소값이라 칩이 넘치면 10분 축 전체가 깨짐 — 넘침은 내부 스크롤).
                    // 래퍼 높이 = span*rowH − 자기 border-b(1|2px) — 1px라도 넘치면 그 행이 늘어나 10분 축이 어긋난다.
                    cells.push(
                      <td
                        key={key}
                        rowSpan={span}
                        colSpan={group.laneWidth}
                        className={`p-0 align-top ${bottom.cls} ${GRID} ${
                          isTeacherBoundary(col, isLastDay, group.laneStart + group.laneWidth)
                            ? TEACHER_EDGE
                            : "border-r"
                        }`}
                      >
                        <div className="p-px" style={{ height: span * rowH - bottom.px }}>
                          <div className="flex h-full min-w-0 gap-px">
                            {group.intervals.map((iv) => {
                              const s = intervalSlot(iv);
                              // 비수업 블록(감독·준비·회의·연차, 0138a) = 반이 아니다 → 학생 명단 토글도
                              // 반 링크도 없는 **읽기 전용 라벨**. 시트가 이 칸을 그리므로 자리는 지키되,
                              // 수업 칩과 헷갈리지 않게 톤을 낮춘다(테두리 점선 + 흐린 글자).
                              if (s.blockKind) {
                                return (
                                  <div
                                    key={s.id}
                                    title={s.blockKind === "supervise" ? `${s.className} 수업 감독` : s.className}
                                    // ⚠️ cursor-default 필수 — 바깥 DragScrollArea가 컨테이너에
                                    // cursor-grab(펼친 손)을 깔아서, 안 덮으면 **끌어서 옮길 수 있는 것처럼**
                                    // 보인다(원장 지적 2026-07-22). 이 블록은 읽기 전용 라벨이다.
                                    className="border-line text-text-dim bg-bg-soft/60 flex h-full min-w-0 flex-1 cursor-default items-center justify-center rounded-lg border border-dashed px-1 text-center text-[11px] leading-tight break-keep"
                                  >
                                    {s.className}
                                  </div>
                                );
                              }
                              // 방 = 슬롯 방(slot_room_label)만 — classroomName은 반의 "기본" 강의실이라
                              // 시트 미러가 아니다(JJ LAB=305인데 반 기본방이 뜨는 오류). 이주희(라벨 null)는
                              // 시트 셀처럼 방 미표기.
                              return <TeacherChip key={s.id} slot={{ ...s, classroomName: s.slotRoomLabel }} />;
                            })}
                          </div>
                        </div>
                      </td>,
                    );
                  }
                  return cells;
                }),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </DragScrollArea>
  );
}
