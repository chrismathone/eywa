"use client";

import { useState } from "react";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { WindowLink } from "@/components/workspace/window-link";
import { useSubjectMaps } from "@/features/owner/operations-context";
import type { RoomSlotLite } from "@/features/timetable/lib/room-grid";
import type { RoomTimelineRow, RoomWeekRow, TimelineAxis } from "@/features/timetable/lib/room-metrics";
import { saveTimetableViewPrefs } from "@/features/timetable/server/view-prefs-actions";
import { RoomHourTable } from "./room-panel-tables";

/**
 * 교실 활성도 — **교실뷰의 본체**(원장 2026-08-04: 점유 지도를 걷어내고 *"이제 2번 사진 하나만으로 할거니까"*).
 *
 * 지도(room-map-grid)가 하던 일은 이 표가 이어받았다: 시간축은 10분 격자, 수업은 병합 블록, 겹침은 테두리,
 * 과목 칩은 **딤**(필터가 아니다 — 다른 과목을 지우면 그 교실이 비어 보이는 거짓 지도가 된다).
 * 지도에만 있던 것 = 반 이름 표기와 반 상세 링크 → 겹침을 파고들 땐 기본뷰/통합뷰로 간다.
 *
 * ⚠️ 아래 요약줄(주중 저활용·정원 초과)은 여전히 **주간** 집계라 rows(RoomWeekRow)를 계속 받는다.
 * ⚠️ 옛 리사이즈 경계선·접기 토글은 없앴다 — 지도를 잠식하지 않게 만든 장치였는데 지도가 사라졌다.
 */
export function RoomWeekPanel({
  rows,
  axis,
  hourRows,
  hourDayLabel,
  focusSubject,
  groupLines,
  unassigned,
  canEditCapacity,
}: {
  rows: RoomWeekRow[];
  axis: TimelineAxis;
  hourRows: RoomTimelineRow[];
  /** 표의 기준 요일 라벨 — 상단 요일 칩 선택을 따른다(평균 아님, 원장 확정 08-03). */
  hourDayLabel: string;
  focusSubject: string | null;
  groupLines: boolean;
  unassigned: RoomSlotLite[];
  canEditCapacity: boolean;
}) {
  const subjects = useSubjectMaps();
  // 구분선 토글 — 낙관적으로 즉시 반영하고 계정에 저장한다(뷰 세팅은 기기가 아니라 계정, 원장 2026-08-04).
  // 저장 실패는 화면을 되돌리지 않는다: 선 하나 때문에 클릭이 씹히는 것보다, 다음 새로고침에 옛 값으로
  // 돌아가는 쪽이 덜 나쁘다(색 강도 토글과 같은 규약).
  const [lines, setLines] = useState(groupLines);

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

  return (
    <section className="bg-card border-line shadow-card flex min-h-0 flex-1 flex-col rounded-2xl border px-4 py-3">
      <header className="flex shrink-0 flex-wrap items-center gap-2 pb-2">
        <span className="text-foreground text-[12px] font-bold">교실 활성도 · {hourDayLabel}요일</span>
        <span className="micro compact-chrome:hidden">
          인원률(인원 ÷ 정원) — 옅을수록 자리가 남습니다 · 요일은 위 칩에서 · 평일은 14시부터
        </span>
        <button
          type="button"
          onClick={() => {
            const next = !lines;
            setLines(next);
            void saveTimetableViewPrefs({ roomGroupLines: next });
          }}
          aria-pressed={lines}
          title="건물·층이 바뀌는 자리에 구분선을 긋습니다 (내 계정에 저장)"
          className={`ml-auto shrink-0 rounded-full border px-2 py-0 text-[11px] leading-5 transition ${
            lines
              ? "border-primary bg-primary text-primary-foreground font-medium"
              : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
          }`}
        >
          층 구분선
        </button>
      </header>

      {/* 열너비는 창을 채우되(원장: "창 크기를 활용") 10분 칸이 최소폭 아래로는 안 줄고, 그때만 잡고 끌기. */}
      <DragScrollArea className="min-h-0 flex-1">
        <RoomHourTable
          axis={axis}
          rows={hourRows}
          canEditCapacity={canEditCapacity}
          focusSubject={focusSubject}
          groupLines={lines}
        />
      </DragScrollArea>

      <div className="mt-3 flex shrink-0 flex-col gap-1 text-[11px]">
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
            <span className="text-text-dim"> — 반 편집에서 강의실을 지정하면 표에 나타납니다</span>
          </p>
        ) : null}
        {noCapacity ? (
          <p className="text-text-faint">
            {canEditCapacity
              ? "강의실 정원이 아직 없습니다 — 위 표의 '정원' 칸에서 바로 입력하면 인원률이 열립니다."
              : "강의실 정원이 아직 입력되지 않았습니다 — 학원설정 · 운영 체계 · 강의실에서 정원을 넣으면 인원률이 열립니다."}
          </p>
        ) : null}
      </div>
    </section>
  );
}
