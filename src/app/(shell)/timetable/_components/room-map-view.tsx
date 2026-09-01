"use client";

import {
  TOOLBAR_CHIP,
  TOOLBAR_CHIP_OFF,
  TOOLBAR_CHIP_ON,
  TOOLBAR_SEG_BOX,
  TOOLBAR_SEG_BOX_WRAP,
  TOOLBAR_SEG_ITEM,
  TOOLBAR_SEG_OFF,
  TOOLBAR_SEG_ON_PRIMARY,
} from "@/components/toolbar-controls";

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
  buildRoomTimelineRows,
  buildRoomWeekRows,
  collectRoomConflicts,
  collectSeatOver,
  summarizeDay,
  type DayWindows,
} from "@/features/timetable/lib/room-metrics";
import { RoomWeekPanel } from "./room-week-panel";

// 교실뷰 컨테이너 — 요일 선택(기본=오늘)·과목 하이라이트는 **클라 상태**(주간 데이터가 이미 다 와 있어
// 서버 왕복 불필요 = 즉시 전환). 과목 하이라이트는 필터가 아니라 **딤 처리** — 다른 과목 블록을 숨기면
// 그 교실이 비어 보이는 거짓 지도가 된다. "지금" 표시는 서버 렌더 시점 KST 고정(타이머 없음 — 새로고침/
// 주 이동 시 갱신, #11·#25 회피).
// 예외: **특강 숨김 토글**(원장 요청 2026-08-03)만 진짜 필터 — 방학 단기강좌가 정규 운영 시야를 흐릴 때
// 걷어내는 용도. 🔴 이때 **분자(점유)와 분모(운영 창)를 함께** 바꿔야 한다(`windowsNoSpecial`) —
// 2026-08-04 적대 리뷰 전까지는 분자만 줄어서 특강을 숨길수록 가동률이 거짓으로 떨어졌다. 기본은 표시.

export function RoomMapView({
  slots,
  rooms,
  windows,
  windowsNoSpecial,
  weekMonday,
  todayDay,
  isCurrentWeek,
  nowMin,
  canEditCapacity,
  groupLines,
  timeVertical,
  showIssues,
}: {
  slots: RoomSlotLite[];
  rooms: RoomInfo[];
  windows: DayWindows;
  /** '특강 숨김'일 때 쓸 운영 창 — 분자만 줄고 분모가 그대로면 가동률이 거짓으로 떨어진다. */
  windowsNoSpecial: DayWindows;
  weekMonday: string;
  todayDay: DayOfWeek;
  isCurrentWeek: boolean;
  nowMin: number;
  canEditCapacity: boolean;
  /** 건물·층 구분선 초기값 — 계정에 저장된 뷰 설정(users.ui_prefs). */
  groupLines: boolean;
  /** 시간축 방향 초기값(true=시간이 세로) — 같은 뷰 설정. */
  timeVertical: boolean;
  /** 하단 경고 목록(정원 초과·시간 겹침) 펼침 초기값 — 같은 뷰 설정. */
  showIssues: boolean;
}) {
  const subjects = useSubjectMaps();
  const [day, setDay] = useState<DayOfWeek>(isCurrentWeek ? todayDay : "mon");
  const [focusSubject, setFocusSubject] = useState<string | null>(null);
  const [hideSpecial, setHideSpecial] = useState(false);

  const hasSpecial = useMemo(() => slots.some((s) => s.isSpecialLecture), [slots]);
  const effSlots = useMemo(
    () => (hideSpecial ? slots.filter((s) => !s.isSpecialLecture) : slots),
    [slots, hideSpecial],
  );
  const { buckets, unassigned } = useMemo(() => buildRoomBuckets(effSlots, rooms), [effSlots, rooms]);
  // 🔴 창(분모)도 토글을 따라간다 — 특강을 숨기면 분자만 줄고 창은 그대로여서 가동률이 거짓으로
  //    떨어지고 있었다(2026-08-04 적대 리뷰: 주석은 "지표가 함께 제외된다"고 적혀 있었지만 사실이 아니었다).
  const effWindows = hideSpecial ? windowsNoSpecial : windows;
  const weekRows = useMemo(() => buildRoomWeekRows(buckets, effWindows), [buckets, effWindows]);
  // 시간대별 = **선택 요일의 절대 데이터**(요일 칩을 따라감) — 주중 평균 비채택(원장 확정 08-03).
  const timeline = useMemo(
    () => buildRoomTimelineRows(buckets, effWindows, day),
    [buckets, effWindows, day],
  );
  const summary = useMemo(
    () => summarizeDay(buckets, effWindows, day, nowMin),
    [buckets, effWindows, day, nowMin],
  );
  // 하단 반 목록 = **선택 요일만**(원장 2026-08-04: "현재 요일 선택한것만 나오면 됨. 정원 초과건도 마찬가지").
  // 덕분에 표의 빨간 테두리·위 요약의 "N건"·아래 목록이 전부 같은 하루를 말한다(스코프 혼선 제거).
  const conflicts = useMemo(() => collectRoomConflicts(buckets, day), [buckets, day]);
  const seatOver = useMemo(() => collectSeatOver(buckets, day), [buckets, day]);
  const isToday = isCurrentWeek && day === todayDay;
  // "지금"은 **서버 렌더 시점 고정**이다(타이머 없음 — #11·#25 회피). 창을 띄워 두면 몇 시간 전 사실을
  // 계속 말하게 되므로, 기준 시각을 함께 적어 사용자가 낡음을 알아볼 수 있게 한다(2026-08-04 적대 리뷰).
  const nowLabel = `${String(Math.floor(nowMin / 60)).padStart(2, "0")}:${String(nowMin % 60).padStart(2, "0")}`;
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
      {/* 🔴 툴바 카드 껍데기 제거(원장 2026-09-01) — 아래 지도가 자기 테두리를 가져 선이 겹쳤다. */}
      <div className="toolbar-rail flex shrink-0 flex-wrap items-center gap-3 px-1 py-1">
        <div className={TOOLBAR_SEG_BOX}>
          {ROOM_DAY_ORDER.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDay(d)}
              className={`${TOOLBAR_SEG_ITEM} shrink-0 ${day === d ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
            >
              {DAY_LABEL[d] ?? d}
              {dayDates[d] ? <span className="num ml-1 text-[10px] opacity-70">{dayDates[d]}</span> : null}
            </button>
          ))}
        </div>
        <span className="bg-line h-4 w-px" aria-hidden />
        <div className={TOOLBAR_SEG_BOX_WRAP}>
          <button
            type="button"
            onClick={() => setFocusSubject(null)}
            className={`${TOOLBAR_SEG_ITEM} shrink-0 ${focusSubject === null ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
          >
            전체
          </button>
          {presentSubjects.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFocusSubject(focusSubject === k ? null : k)}
              className={`${TOOLBAR_SEG_ITEM} shrink-0 ${focusSubject === k ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
            >
              {subjects.labelOf(k)}
            </button>
          ))}
        </div>
        {/* 특강 숨김 — 유일한 진짜 필터(지도·지표 동시 제외, 위 헤더 주석). 특강이 있을 때만 노출. */}
        {hasSpecial ? (
          <>
            <span className="bg-line h-4 w-px" aria-hidden />
            <button
              type="button"
              onClick={() => setHideSpecial((v) => !v)}
              className={`${TOOLBAR_CHIP} ${hideSpecial ? TOOLBAR_CHIP_ON : TOOLBAR_CHIP_OFF}`}
            >
              특강 숨김
            </button>
          </>
        ) : null}
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
              지금({nowLabel}) 수업 중{" "}
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
            // ⚠️ 이 수치는 **선택 요일**이다(하단 목록도 같은 하루) — 요일을 안 적으면 다른 스코프처럼 읽힌다.
            <span className="text-danger">
              {DAY_LABEL[day] ?? day} 겹침 <span className="num font-semibold">{summary.conflictPairs}</span>건
            </span>
          ) : null}
          {unassigned.length > 0 ? (
            <span className="text-amber-700">
              미배정 <span className="num font-semibold">{unassigned.length}</span>교시
            </span>
          ) : null}
        </div>
      </div>

      <RoomWeekPanel
        rows={weekRows}
        axis={timeline.axis}
        hourRows={timeline.rows}
        hourDayLabel={DAY_LABEL[day] ?? day}
        focusSubject={focusSubject}
        groupLines={groupLines}
        timeVertical={timeVertical}
        showIssues={showIssues}
        conflicts={conflicts}
        seatOver={seatOver}
        unassigned={unassigned}
        canEditCapacity={canEditCapacity}
      />
    </div>
  );
}
