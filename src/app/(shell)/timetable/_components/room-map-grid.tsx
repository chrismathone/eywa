"use client";

import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { readableTextColor } from "@/lib/color-utils";
import { useSubjectMaps } from "@/features/owner/operations-context";
import type { DayOfWeek } from "@/features/timetable/lib/periods";
import {
  buildTenMinuteRows,
  minToHM,
  packGroups,
  slotRowSpan,
} from "@/features/timetable/lib/ten-minute-grid";
import type { RoomBucket, RoomInterval } from "@/features/timetable/lib/room-grid";
import { dayIntervalsOf, utilPct, type DayWindow } from "@/features/timetable/lib/room-metrics";
import { subjectHeaderStyle, useTimetableColorMode } from "./timetable-color";

// 교실 지도 — 세로 = 10분 시각축(강사뷰와 동일 문법), 가로 = 강의실. 셀 = 그 교실을 쓰는 수업 블록.
// 빈 칸이 곧 "빈 교실"이라 여백도 정보다(접기 없음). 같은 시간 범위 병렬 = 합반(amber, 강사뷰 packGroups와
// 같은 해석), 부분 겹침 = 이중예약 의심(red). 읽기전용.

const TIME_COL_W = 48;
const ROOM_COL_W = 96;
const LANE_COL_W = 72;
const PX_PER_MIN = 1.4; // 강사뷰와 동일 밀도(60분 = 84px)
const STEP = 10;
const HEAD_H = 44;
const GRID = "border-ink/25"; // 강사뷰·기본뷰와 동일 격자 톤

export function RoomMapGrid({
  buckets,
  day,
  window: win,
  nowMin,
  isToday,
  focusSubject,
}: {
  buckets: RoomBucket[];
  day: DayOfWeek;
  window: DayWindow | null;
  /** KST 현재 시각(분) — 서버 렌더 시점 고정(오늘 행 하이라이트용, 타이머 없음). */
  nowMin: number;
  isToday: boolean;
  /** 과목 하이라이트 — null=전체. 다른 과목 블록은 흐리게(숨기면 교실이 비어 보이는 거짓말이 된다). */
  focusSubject: string | null;
}) {
  const subjects = useSubjectMaps();
  const colorMode = useTimetableColorMode();
  const rowH = Math.round(STEP * PX_PER_MIN);

  // 컬럼 데이터 — 요일 구간(겹침 주석 포함)을 격자 스냅해 레인 패킹(강사뷰와 동일 파이프라인).
  const cols = buckets.map((b) => {
    const { intervals } = dayIntervalsOf(b, day);
    const packed = packGroups(
      intervals.map((iv) => ({
        classId: iv.classId,
        startMin: Math.floor(iv.startMin / STEP) * STEP,
        endMin: Math.max(Math.ceil(iv.endMin / STEP) * STEP, Math.floor(iv.startMin / STEP) * STEP + STEP),
        slots: [iv],
      })),
    );
    const occupied = intervals.reduce((a, iv) => a + (iv.endMin - iv.startMin), 0);
    return { bucket: b, intervals, ...packed, dayUtil: utilPct(occupied, win) };
  });

  // 시각축 = 운영 창 ∪ 실제 블록 범위(창 밖 수업도 지도에 나와야 한다).
  const spanSlots = cols.flatMap((c) =>
    c.groups.map((g) => ({ startTime: minToHM(g.startMin), endTime: minToHM(g.endMin) })),
  );
  const fallback = win
    ? { start: minToHM(win.startMin), end: minToHM(win.endMin) }
    : { start: "14:00", end: "22:00" };
  const rows = buildTenMinuteRows(spanSlots, fallback, STEP);

  // (컬럼 × 행 × 레인) 앵커/피복 사전계산 — 강사뷰와 같은 rowSpan 병합 렌더.
  const prepared = cols.map((c) => {
    const anchors = new Map<string, { group: (typeof c.groups)[number]; span: number }>();
    const covered = new Set<string>();
    for (const g of c.groups) {
      const { index, span } = slotRowSpan(rows, minToHM(g.startMin), minToHM(g.endMin));
      anchors.set(`${index}:${g.laneStart}`, { group: g, span });
      for (let r = index; r < index + span; r++)
        for (let l = g.laneStart; l < g.laneStart + g.laneWidth; l++)
          if (!(r === index && l === g.laneStart)) covered.add(`${r}:${l}`);
    }
    const laneW = c.laneCount > 1 ? LANE_COL_W : ROOM_COL_W;
    return { ...c, anchors, covered, laneW };
  });
  const laneColsFlat = prepared.flatMap((c) => Array.from({ length: c.laneCount }, () => c.laneW));
  const tableW = TIME_COL_W + laneColsFlat.reduce((a, w) => a + w, 0);
  const nowRow = isToday ? rows.findIndex((r) => r.startMin <= nowMin && nowMin < r.startMin + STEP) : -1;

  const blockStyle = (iv: RoomInterval) => {
    if (iv.classBgColor)
      return {
        className: "",
        style: {
          background: iv.classBgColor,
          color: iv.classTextColor ?? readableTextColor(iv.classBgColor),
        },
      };
    return subjectHeaderStyle(colorMode, subjects.colorOf(iv.subject));
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
          <tr>
            <th
              aria-hidden
              className={`bg-bg-soft sticky top-0 left-0 z-30 border-r border-b border-l ${GRID}`}
              style={{ height: HEAD_H }}
            />
            {prepared.map((c) => (
              <th
                key={c.bucket.key}
                colSpan={c.laneCount}
                className={`bg-bg-soft sticky top-0 z-20 border-r border-b px-1 py-1 text-center align-middle ${GRID}`}
                style={{ height: HEAD_H }}
              >
                <span className="text-foreground block truncate text-[12px] leading-tight font-bold">
                  {c.bucket.name}
                  {c.bucket.registered ? "" : " ※"}
                </span>
                <span className="text-text-dim block text-[10px] leading-tight font-normal">
                  {c.dayUtil != null ? <span className="num">{c.dayUtil}%</span> : "—"}
                  {c.bucket.capacity != null ? (
                    <span className="num"> · 정원{c.bucket.capacity}</span>
                  ) : null}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const isNow = ri === nowRow;
            return (
              <tr key={row.key}>
                <td
                  className={`sticky left-0 z-10 border-r border-b border-l px-1 py-0 text-right align-middle num leading-none ${GRID} ${
                    isNow
                      ? "bg-primary text-primary-foreground text-[9px] font-bold"
                      : row.isHour
                        ? "bg-bg-soft text-foreground text-[9px] font-bold"
                        : "bg-bg-soft text-ink/70 text-[9px]"
                  }`}
                  style={{ height: rowH }}
                >
                  {isNow ? "지금" : row.key}
                </td>
                {prepared.flatMap((c) => {
                  const cells = [];
                  for (let li = 0; li < c.laneCount; li++) {
                    const key = `${c.bucket.key}-${li}-${row.key}`;
                    if (c.covered.has(`${ri}:${li}`)) continue;
                    const anchor = c.anchors.get(`${ri}:${li}`);
                    if (!anchor) {
                      cells.push(
                        <td
                          key={key}
                          className={`border-r border-b ${GRID} ${isNow ? "bg-primary/5" : "bg-bg-soft/40"}`}
                        />,
                      );
                      continue;
                    }
                    const { group, span } = anchor;
                    cells.push(
                      <td key={key} rowSpan={span} colSpan={group.laneWidth} className={`border-r border-b p-0 align-top ${GRID}`}>
                        <div className="p-px" style={{ height: span * rowH - 1 }}>
                          <div className="flex h-full min-w-0 gap-px">
                            {group.intervals.map((giv) => {
                              const iv = giv.slots[0]!;
                              const dim = focusSubject != null && iv.subject !== focusSubject;
                              const { className, style } = blockStyle(iv);
                              // 좌석 활용(원장 요청 2026-08-03) — 정원 대비 학생 %(정원 미설정 방은 인원만).
                              const cap = c.bucket.capacity;
                              const seatPct =
                                cap != null && cap > 0 ? Math.round((iv.students / cap) * 100) : null;
                              const ring =
                                iv.overlap === "conflict"
                                  ? "ring-2 ring-inset ring-red-500"
                                  : iv.overlap === "joint"
                                    ? "ring-1 ring-inset ring-amber-400"
                                    : "";
                              return (
                                <div
                                  key={iv.classId + giv.startMin}
                                  title={`${iv.className} · ${minToHM(iv.startMin)}~${minToHM(iv.endMin)} · ${subjects.labelOf(iv.subject)}${iv.teacherLabel ? ` · ${iv.teacherLabel}` : ""} · 학생 ${iv.students}명${seatPct != null ? ` (정원 ${cap}명의 ${seatPct}%)` : ""}${iv.overlap === "conflict" ? " · 시간 겹침 주의" : iv.overlap === "joint" ? " · 합반" : ""}`}
                                  className={`flex h-full min-w-0 flex-1 cursor-default flex-col overflow-hidden rounded-lg px-1 py-0.5 text-left ${className} ${ring} ${dim ? "opacity-25" : ""}`}
                                  style={style}
                                >
                                  <span className="truncate text-[11px] leading-tight font-semibold break-keep">
                                    {iv.className}
                                  </span>
                                  <span className="truncate text-[10px] leading-tight opacity-80">
                                    {iv.teacherLabel ?? ""}
                                  </span>
                                  <span className="num mt-auto truncate text-[10px] leading-tight opacity-80">
                                    {iv.students}명
                                    {seatPct != null ? (
                                      <span className={seatPct > 100 ? "font-bold" : ""}> · {seatPct}%</span>
                                    ) : null}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </td>,
                    );
                  }
                  return cells;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </DragScrollArea>
  );
}
