"use client";

import { useMemo, useState } from "react";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { DAY_LABEL } from "@/features/timetable/lib/split-attendance";
import type { DayOfWeek } from "@/features/timetable/lib/periods";
import {
  buildRoomBuckets,
  type RoomInfo,
  type RoomSlotLite,
} from "@/features/timetable/lib/room-grid";
import {
  ROOM_DAY_ORDER,
  buildRoomWeekRows,
  summarizeDay,
  type DayWindows,
} from "@/features/timetable/lib/room-metrics";
import { RoomMapGrid } from "./room-map-grid";
import { RoomWeekPanel } from "./room-week-panel";

// 교실뷰 컨테이너 — 요일 선택(기본=오늘)·과목 하이라이트는 **클라 상태**(주간 데이터가 이미 다 와 있어
// 서버 왕복 불필요 = 즉시 전환). 과목 하이라이트는 필터가 아니라 **딤 처리** — 다른 과목 블록을 숨기면
// 그 교실이 비어 보이는 거짓 지도가 된다. "지금" 표시는 서버 렌더 시점 KST 고정(타이머 없음 — 새로고침/
// 주 이동 시 갱신, #11·#25 회피).

export function RoomMapView({
  slots,
  rooms,
  windows,
  weekMonday,
  todayDay,
  isCurrentWeek,
  nowMin,
}: {
  slots: RoomSlotLite[];
  rooms: RoomInfo[];
  windows: DayWindows;
  weekMonday: string;
  todayDay: DayOfWeek;
  isCurrentWeek: boolean;
  nowMin: number;
}) {
  const subjects = useSubjectMaps();
  const [day, setDay] = useState<DayOfWeek>(isCurrentWeek ? todayDay : "mon");
  const [focusSubject, setFocusSubject] = useState<string | null>(null);

  const { buckets, unassigned } = useMemo(() => buildRoomBuckets(slots, rooms), [slots, rooms]);
  const weekRows = useMemo(() => buildRoomWeekRows(buckets, windows), [buckets, windows]);
  const summary = useMemo(
    () => summarizeDay(buckets, windows, day, nowMin),
    [buckets, windows, day, nowMin],
  );
  const isToday = isCurrentWeek && day === todayDay;
  // 과목 칩 = 설정 순서 ∩ 데이터 존재(빈 칩 방지 — 시간표 툴바와 같은 규약).
  const presentSubjects = useMemo(() => {
    const present = new Set(slots.map((s) => s.subject));
    return subjects.options.map((o) => o.value).filter((k) => present.has(k));
  }, [slots, subjects]);
  // 요일 헤더 M/D — 주 월요일 기준 UTC 산술(teacher-grid dayDateLabels와 동일 규약).
  const dayDates = useMemo(() => {
    const [y, m, d] = weekMonday.split("-").map(Number);
    const out: Partial<Record<DayOfWeek, string>> = {};
    if (!y || !m || !d) return out;
    ROOM_DAY_ORDER.forEach((dow, i) => {
      const dt = new Date(Date.UTC(y, m - 1, d + i));
      out[dow] = `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`;
    });
    return out;
  }, [weekMonday]);

  if (rooms.length === 0 && buckets.length === 0) {
    return (
      <div className="bg-card border-line shadow-card text-text-dim rounded-2xl border p-8 text-center text-sm">
        등록된 강의실이 없습니다 — 학원설정 · 운영 체계 · 강의실에서 강의실을 먼저 등록해 주세요.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* 요일·과목 선택 + 요약 스탯 — 지도 위 한 줄 레일 */}
      <div className="bg-card shadow-card toolbar-rail flex shrink-0 flex-wrap items-center gap-3 rounded-2xl px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1">
          {ROOM_DAY_ORDER.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDay(d)}
              className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${
                day === d
                  ? "border-primary bg-primary text-primary-foreground font-medium"
                  : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              {DAY_LABEL[d] ?? d}
              {dayDates[d] ? <span className="num ml-1 text-[10px] opacity-70">{dayDates[d]}</span> : null}
            </button>
          ))}
        </div>
        <span className="bg-line h-4 w-px" aria-hidden />
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setFocusSubject(null)}
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${
              focusSubject === null
                ? "border-foreground bg-foreground text-background font-medium"
                : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
            }`}
          >
            전체
          </button>
          {presentSubjects.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFocusSubject(focusSubject === k ? null : k)}
              className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${
                focusSubject === k
                  ? "border-foreground bg-foreground text-background font-medium"
                  : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              {subjects.labelOf(k)}
            </button>
          ))}
        </div>
        <div className="rail-spacer ml-auto" aria-hidden />
        <div className="text-text-dim flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span>
            강의실 <span className="num text-foreground font-semibold">{summary.roomsTotal}</span>
          </span>
          <span>
            {DAY_LABEL[day] ?? day} 사용{" "}
            <span className="num text-foreground font-semibold">{summary.roomsUsed}</span>실
          </span>
          {isToday ? (
            <span>
              지금 수업 중{" "}
              <span className="num text-primary font-semibold">{summary.roomsInUseNow}</span>실
            </span>
          ) : null}
          <span>
            가동률{" "}
            <span className="num text-foreground font-semibold">
              {summary.dayUtilPct == null ? "—" : `${summary.dayUtilPct}%`}
            </span>
          </span>
          {summary.conflictPairs > 0 ? (
            <span className="text-red-600">
              시간 겹침 <span className="num font-semibold">{summary.conflictPairs}</span>건
            </span>
          ) : null}
          {unassigned.length > 0 ? (
            <span className="text-amber-700">
              미배정 <span className="num font-semibold">{unassigned.length}</span>교시
            </span>
          ) : null}
        </div>
      </div>

      <RoomMapGrid
        buckets={buckets}
        day={day}
        window={windows[day]}
        nowMin={nowMin}
        isToday={isToday}
        focusSubject={focusSubject}
      />

      <RoomWeekPanel rows={weekRows} unassigned={unassigned} />
    </div>
  );
}
