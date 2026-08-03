"use client";

import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical } from "@/components/icons/eywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { useSubjectMaps } from "@/features/owner/operations-context";
import type { RoomSlotLite } from "@/features/timetable/lib/room-grid";
import type { RoomHourBand, RoomHourRow, RoomWeekRow } from "@/features/timetable/lib/room-metrics";
import { RoomDayTable, RoomHourTable } from "./room-panel-tables";

// 주간 활성도 패널 — 지도와의 사이에 **리사이즈 경계선**(창 크기 조절처럼 위아래 드래그) + 접기 토글
// (원장 피드백 2026-08-03: 패널이 거대해 지도를 잠식). 높이는 고정값 state — 접거나 줄이면 지도(flex-1)가
// 그만큼 즉시 넓어진다. ⚠️ 드래그 중 height에 transition 금지(#57 얼음 함정 — 커서를 못 따라와 뻑뻑해진다).
// 표는 요일별/시간대별 2모드(원장 요청: "시간대별 활성도도 교실별로").

const MIN_H = 96;
const DEFAULT_H = 224;

export function RoomWeekPanel({
  rows,
  hourBands,
  hourRows,
  unassigned,
  canEditCapacity,
}: {
  rows: RoomWeekRow[];
  hourBands: RoomHourBand[];
  hourRows: RoomHourRow[];
  unassigned: RoomSlotLite[];
  canEditCapacity: boolean;
}) {
  const subjects = useSubjectMaps();
  const [open, setOpen] = useState(true);
  const [panelH, setPanelH] = useState(DEFAULT_H);
  const [mode, setMode] = useState<"day" | "hour">("day");
  const dragging = useRef(false);

  const registered = rows.filter((r) => r.registered);
  const idle = registered
    .filter((r) => r.weekdayUtilPct != null)
    .sort((a, b) => (a.weekdayUtilPct ?? 0) - (b.weekdayUtilPct ?? 0))
    .slice(0, 3);
  const noCapacity = registered.length > 0 && registered.every((r) => r.capacity == null);
  const seatOver = registered.filter((r) => r.seatOver);
  const byClass = new Map<string, { className: string; subject: string; count: number }>();
  for (const s of unassigned) {
    const cur = byClass.get(s.classId);
    if (cur) cur.count++;
    else byClass.set(s.classId, { className: s.className, subject: s.subject, count: 1 });
  }

  // 경계선 드래그 — 포인터 캡처로 표/지도 위를 지나도 계속 추적. 위로 끌면 패널이 커진다.
  const onDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!open) return;
    const startY = e.clientY;
    const startH = panelH;
    const el = e.currentTarget;
    dragging.current = true;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!dragging.current) return;
      const max = Math.max(MIN_H, Math.round(window.innerHeight * 0.7));
      setPanelH(Math.min(max, Math.max(MIN_H, startH + (startY - ev.clientY))));
    };
    const up = () => {
      dragging.current = false;
      el.removeEventListener("pointermove", move);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up, { once: true });
    el.addEventListener("pointercancel", up, { once: true });
  };

  const chip = (active: boolean) =>
    `shrink-0 rounded-full border px-2 py-0 text-[11px] leading-5 transition ${
      active
        ? "border-primary bg-primary text-primary-foreground font-medium"
        : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
    }`;

  return (
    <>
      {/* 경계선 겸 패널 헤더 — 창 리사이즈처럼 위아래 드래그, 더블클릭/버튼으로 접기 */}
      <div
        onPointerDown={onDividerPointerDown}
        onDoubleClick={() => setOpen((v) => !v)}
        className={`bg-card shadow-card flex shrink-0 items-center gap-2 rounded-2xl px-3 py-1 select-none ${
          open ? "cursor-row-resize" : ""
        }`}
        title={open ? "드래그해서 높이 조절 · 더블클릭으로 접기" : undefined}
      >
        <GripVertical size={12} strokeWidth={1.8} className="text-text-faint rotate-90" aria-hidden />
        <span className="text-foreground text-[12px] font-bold">주간 교실 활성도</span>
        {open ? (
          <span className="micro compact-chrome:hidden">
            가동률 = 점유 ÷ 운영 시간(교시 설정) · 주중 = 월~금
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
          {open ? (
            <>
              <button type="button" onClick={() => setMode("day")} className={chip(mode === "day")}>
                요일별
              </button>
              <button type="button" onClick={() => setMode("hour")} className={chip(mode === "hour")}>
                시간대별
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-text-dim hover:text-foreground hover:bg-bg-soft rounded-full p-1"
            aria-label={open ? "패널 접기" : "패널 펼치기"}
          >
            {open ? <ChevronDown size={14} strokeWidth={1.8} /> : <ChevronUp size={14} strokeWidth={1.8} />}
          </button>
        </div>
      </div>

      {open ? (
        <section
          className="bg-card border-line shadow-card shrink-0 overflow-auto rounded-2xl border px-4 py-3"
          style={{ height: panelH }}
        >
          <div className="overflow-x-auto">
            {mode === "day" ? (
              <RoomDayTable rows={rows} canEditCapacity={canEditCapacity} />
            ) : (
              <RoomHourTable bands={hourBands} rows={hourRows} />
            )}
          </div>

          <div className="mt-3 flex flex-col gap-1 text-[11px]">
            {idle.length > 0 ? (
              <p className="text-text-dim">
                <span className="text-foreground font-semibold">주중 저활용</span>{" "}
                {idle.map((r, i) => (
                  <span key={r.key}>
                    {i > 0 ? " · " : ""}
                    {r.name} <span className="num">{r.weekdayUtilPct}%</span>
                  </span>
                ))}
              </p>
            ) : null}
            {seatOver.length > 0 ? (
              <p className="text-red-600">
                정원 초과:{" "}
                {seatOver.map((r) => `${r.name}(최대 ${r.maxStudents}명/정원 ${r.capacity}명)`).join(" · ")}
              </p>
            ) : null}
            {byClass.size > 0 ? (
              <p className="text-amber-700">
                강의실 미배정{" "}
                {[...byClass.entries()].map(([classId, c], i) => (
                  <span key={classId}>
                    {i > 0 ? " · " : ""}
                    <WindowLink href={`/classes/${classId}`} className="underline underline-offset-2">
                      {c.className}
                    </WindowLink>{" "}
                    ({subjects.labelOf(c.subject)} {c.count}교시)
                  </span>
                ))}
                <span className="text-text-dim"> — 반 편집에서 강의실을 지정하면 지도에 나타납니다</span>
              </p>
            ) : null}
            {noCapacity ? (
              <p className="text-text-faint">
                {canEditCapacity
                  ? "강의실 정원이 아직 없습니다 — 위 표의 '최대 인원/정원' 칸에서 바로 입력하면 좌석 활용 %가 열립니다."
                  : "강의실 정원이 아직 입력되지 않았습니다 — 학원설정 · 운영 체계 · 강의실에서 정원을 넣으면 좌석 활용 지표가 열립니다."}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
