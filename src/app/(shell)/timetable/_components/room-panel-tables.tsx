"use client";

import { useMemo } from "react";
import { minToHM } from "@/features/timetable/lib/ten-minute-grid";
import { groupRooms } from "@/features/timetable/lib/room-groups";
import { useSubjectMaps } from "@/features/owner/operations-context";
import {
  TIMELINE_STEP_MIN,
  timelineColumnCells,
  type RoomTimelineCell,
  type RoomTimelineRow,
  type TimelineAxis,
} from "@/features/timetable/lib/room-metrics";
import { RoomCapacityCell } from "./room-capacity-cell";

/**
 * 교실 활성도 타임라인 — 교실 × **10분 격자**, 수업 시간대로 **병합(colspan)된 블록**.
 *
 * 원장 지시 2026-08-04:
 *  · *"시간대별로 활성화된 인원률을 보면 그게 바로 교실 활성화 지표"* · *"정원 10명이면 30%는 3명뿐이니 충원 대상"*
 *    → 블록에 **인원 + 인원률**을 적고, 색 농도도 인원률로 칠한다(옅다 = 자리가 남는다).
 *  · *"10분단위로 쪼개고 하단에 %를 수업 시간에 맞춰서 병합처리"* · *"15:00~16:20 수업은 80분을 병합"*
 *    → 1시간 밴드를 버렸다. 교시가 80·110분이라 시간 경계와 안 맞아, 1시간 칸은 **한 수업을 둘로 쪼개
 *      각각 다른 %**를 적고 있었다. 병합 블록이면 수업 하나 = 블록 하나다.
 *  · *"열너비를 최소화하고 병합처리하면 80분수업이 적당한 너비"* → 10분 칸은 균등·최소, 블록이 폭을 갖는다.
 *  · *"너무 좁은 수업은 모두 표기하기 힘드므로 마우스오버시 호버링"* → 좁은 블록은 글자를 접고 **툴팁**이 전부 말한다.
 *  · *"요일별을 없애고 시간대별 하나로 통일 — 요일은 상단에서 누르면 됨"* → 교실×요일 표는 폐지.
 */

const NAME_W = 116;
const CAP_W = 52;
/** 10분 칸 최소폭 — 창이 넓으면 이보다 넓게 퍼지고, 좁아지면 여기서 멈추고 [DragScrollArea]가 끌어서 넘긴다. */
const SLOT_MIN_W = 13;
/** 이보다 좁은 블록은 글자가 안 들어간다 → 툴팁만(원장: "너무 좁은 수업은 마우스오버"). */
const COMPACT_SPAN = 4;

const SLOTS_PER_HOUR = 60 / TIMELINE_STEP_MIN;

const TH = "border-line border-b px-1 py-1 text-center font-medium whitespace-nowrap";

/**
 * 10분 눈금 — **점선으로 보일락 말락**(원장 2026-08-04). 격자가 또렷하면 읽어야 할 블록보다 눈에 먼저 든다.
 * 정시만 조금 진하게 해서 시간 감각의 기준점을 준다.
 */
/**
 * 눈금·구분선은 **인라인 style**로 긋는다 — 유틸 클래스로 세 번 헛디딘 자리다(2026-08-04 실측):
 *  ① `border-dotted`는 전 방향이라 같은 칸의 **위 테두리까지 점선**이 되어 층 구분선이 눈금과 섞였다.
 *  ② `border-l-line/…`은 이 프로젝트 토큰(`border-line`)과 접두사가 안 붙어 **선이 통째로 사라졌다**.
 *  ③ `--line`은 불투명도가 **9%**다. 토큰을 제대로 걸어도 1px 점선은 화면에서 안 보인다.
 * → 변마다 색·스타일을 따로 줘야 하고 농도도 직접 정해야 해서, 클래스보다 style이 정직하다.
 */
const dottedTick = (i: number): string =>
  `1px dotted color-mix(in srgb, var(--foreground) ${i % SLOTS_PER_HOUR === 0 ? 30 : 14}%, transparent)`;

/** 시간이 가로일 때의 눈금 = 세로선. */
const tick = (i: number): React.CSSProperties =>
  i === 0 ? {} : { borderLeft: dottedTick(i) };

/** 시간이 세로일 때의 눈금 = 가로선(축을 뒤집으면 눈금도 같이 눕는다). */
const tickY = (i: number): React.CSSProperties =>
  i === 0 ? {} : { borderTop: dottedTick(i) };

/** 건물·층이 바뀌는 자리 — **또렷하게**(원장 2026-08-04 "층 구분선은 더 진하게"). */
const GROUP_SEP = "2px solid color-mix(in srgb, var(--foreground) 60%, transparent)";
/** 교실(행) 사이 — "보일까말까" 수준(원장 2026-08-04). 없으면 행이 붙어 읽기 힘들고, 진하면 격자가 시끄럽다. */
const ROW_SEP = "1px solid color-mix(in srgb, var(--foreground) 13%, transparent)";

export function RoomHourTable({
  axis,
  rows,
  canEditCapacity,
  focusSubject,
  groupLines,
}: {
  axis: TimelineAxis;
  rows: RoomTimelineRow[];
  canEditCapacity: boolean;
  /** 과목 칩 하이라이트 — 필터가 아니라 **딤**(다른 과목을 지우면 교실이 비어 보이는 거짓 지도가 된다). */
  focusSubject: string | null;
  /** 건물·층 구분선 표시(계정에 저장되는 뷰 설정). */
  groupLines: boolean;
}) {
  const subjects = useSubjectMaps();
  // 건물 → 층 → 호수 정렬 + 묶음 경계. 정렬은 구분선을 꺼도 유지한다(끌 때마다 행이 튀면 자리를 잃는다).
  const ordered = useMemo(() => groupRooms(rows), [rows]);
  if (axis.slots === 0) {
    return <p className="text-text-dim px-2 py-3 text-xs">운영 시간이 없어 시간대별 표를 만들 수 없습니다.</p>;
  }
  return (
    <table
      className="w-full table-fixed border-separate border-spacing-0 text-xs"
      style={{ minWidth: NAME_W + CAP_W + axis.slots * SLOT_MIN_W }}
    >
      {/* table-fixed + colgroup: 앞 2열만 고정폭, 10분 칸은 남은 폭을 **균등** 분배한다. */}
      <colgroup>
        <col style={{ width: NAME_W }} />
        <col style={{ width: CAP_W }} />
        {Array.from({ length: axis.slots }, (_, i) => (
          <col key={i} />
        ))}
      </colgroup>
      <thead>
        <tr className="text-text-dim">
          <th className={`${TH} text-left`}>강의실</th>
          <th className={`${TH} text-right`} title="정원 — 인원률의 분모(클릭해서 수정)">
            정원
          </th>
          {/* 머리글 = **10분 칸 그대로 6등분**(원장 2026-08-04) — 시각은 시점이지 구간이 아니라, 라벨을
              칸 가운데가 아니라 **그 시각이 시작되는 왼쪽 경계**에 적는다. 칸 폭(13px)보다 글자가 넓어
              `absolute`로 흘려 쓴다(칸 폭을 밀면 6등분이 깨진다). */}
          {Array.from({ length: axis.slots }, (_, i) => (
            <th key={i} className={`${TH} relative`} style={tick(i)}>
              {i % SLOTS_PER_HOUR === 0 ? (
                <span className="text-foreground absolute top-1 left-0.5 text-xs font-bold whitespace-nowrap">
                  {Math.floor((axis.startMin + i * TIMELINE_STEP_MIN) / 60)}시
                </span>
              ) : null}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ordered.map((r) => {
          const sepTop = groupLines && r.groupStart ? GROUP_SEP : undefined;
          const rowEdge: React.CSSProperties = { borderBottom: ROW_SEP, borderTop: sepTop };
          let slot = 0;
          return (
            <tr key={r.key}>
              <td
                className="text-foreground truncate px-2 py-2 font-medium whitespace-nowrap"
                style={rowEdge}
                title={groupLines ? `${r.group.label} · ${r.name}` : r.name}
              >
                {r.name}
                {r.registered ? "" : <span className="text-text-faint"> ※ 미등록</span>}
              </td>
              <td className="text-text-dim px-2 py-2 text-right" style={rowEdge}>
                {r.registered ? (
                  <RoomCapacityCell roomId={r.key} capacity={r.capacity} canEdit={canEditCapacity} />
                ) : (
                  <span className="text-text-faint">—</span>
                )}
              </td>
              {r.cells.flatMap((c, i) => {
                const at = slot;
                slot += c.span;
                // ⚠️ 빈 구간은 **10분마다 칸을 쪼갠다** — colspan으로 묶으면 그 구간엔 눈금이 한 줄도
                // 안 남아 "세로선이 하나도 안 보인다"가 된다(2026-08-04 제보). 수업 블록만 병합한다.
                if (c.kind === "gap") {
                  return Array.from({ length: c.span }, (_, k) => (
                    <td key={`${i}-${k}`} style={{ ...rowEdge, ...tick(at + k) }} />
                  ));
                }
                return [
                  <TimelineTd
                    key={i}
                    cell={c}
                    labelOf={subjects.labelOf}
                    // 블록에 여러 반이 있으면 과목도 여럿일 수 있다 — **하나라도** 맞으면 딤을 걸지 않는다.
                    dim={focusSubject != null && !c.members.some((m) => m.subject === focusSubject)}
                    style={{ ...rowEdge, ...tick(at) }}
                  />,
                ];
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TimelineTd({
  cell,
  labelOf,
  dim,
  style,
}: {
  cell: Extract<RoomTimelineCell, { kind: "class" }>;
  /** 과목 키 → 한글 라벨(설정 단일 소스). 블록 안 반마다 과목이 다를 수 있어 함수로 받는다. */
  labelOf: (subject: string) => string;
  dim: boolean;
  /** 행 테두리(교실/층 구분선) + 이 칸 시작 위치의 10분 눈금 — 행 전체가 같은 값을 받아야 선이 안 끊긴다. */
  style: React.CSSProperties;
}) {
  const over = cell.seatPct != null && cell.seatPct > 100;
  const compact = cell.span < COMPACT_SPAN;
  const tip = timelineTip(cell, labelOf);
  return (
    <td colSpan={cell.span} className="p-px align-middle" style={style}>
      <div
        title={tip}
        className={`flex h-full min-h-[30px] min-w-0 items-center justify-center gap-1 rounded-md px-1 py-0.5 leading-tight transition-opacity ${
          dim ? "opacity-30" : ""
        } ${seatFill(cell.seatPct)} ${
          cell.overlap === "conflict"
            ? "ring-1 ring-danger"
            : cell.overlap === "joint"
              ? "ring-1 ring-amber-500"
              : ""
        }`}
      >
        {compact ? (
          // 좁은 블록은 **%를 뺀다** — 둘 다 넣으면 글자가 잘려 아무것도 못 읽는다. 나머지는 툴팁이 말한다.
          // 🔴 단위('명')는 빼지 않는다. 옆 칸이 `13명 130%`인 표에서 홀로 `5`만 있으면 사람 수인지
          //    퍼센트인지 알 수 없다 — 단위 한 글자가 %를 뺀 것보다 폭을 훨씬 덜 먹는다.
          <span className="num truncate font-semibold">{cell.students}명</span>
        ) : (
          <>
            <span className="num truncate font-semibold">{cell.students}명</span>
            <span className={`num truncate text-xs ${over ? "font-bold text-danger" : "opacity-70"}`}>
              {cell.seatPct == null ? "정원?" : `${cell.seatPct}%`}
            </span>
          </>
        )}
      </div>
    </td>
  );
}

/**
 * 블록이 말하는 전부 — 좁거나 낮은 블록은 글자를 접으므로 툴팁이 진실의 단일 소스다(두 축이 공유).
 * 🔑 같은 시간에 여러 반이 있으면 **전부 이름을 부른다** — 화면엔 합산 인원만 찍히므로, 여기서 안 부르면
 *    그 반은 어디에도 안 남는다(2026-08-04 적대 리뷰: 합반 68쌍이 그렇게 사라져 있었다).
 */
function timelineTip(
  cell: Extract<RoomTimelineCell, { kind: "class" }>,
  labelOf: (subject: string) => string,
): string {
  const lines = cell.members.map(
    (m) =>
      `${m.className} · ${labelOf(m.subject)}` +
      (m.teacherLabel ? ` · ${m.teacherLabel}` : "") +
      ` · ${minToHM(m.startMin)}~${minToHM(m.endMin)} · ${m.students}명`,
  );
  const head =
    cell.members.length > 1
      ? `이 시간 이 교실 ${cell.members.length}개 반 · 합계 ${cell.students}명`
      : null;
  const tail =
    (cell.seatPct != null ? `정원의 ${cell.seatPct}%` : "정원 미입력") +
    (cell.overlap === "conflict" ? " · 시간 겹침 주의" : cell.overlap === "joint" ? " · 합반" : "");
  return [head, ...lines, tail].filter(Boolean).join("\n");
}

// ── 축 전환: 시간이 세로 ────────────────────────────────────────────────────────────────
//
// 원장 요청 2026-08-04: *"지금 가로가 시간 세로가 강의실인데, 반대로 가로 세로 축을 전환하는 기능"*.
// 같은 데이터를 그대로 눕힌다 — 위 표의 **colSpan 병합이 rowSpan 병합**이 되고, 10분 눈금(세로선)은
// 가로선([tickY])으로, 교실 사이 구분선(가로선)은 세로선([colEdge])으로 자리를 바꾼다.
// ⚠️ 데이터·정렬·색·툴팁은 한 벌을 공유한다(두 축이 다른 말을 하면 그게 곧 버그다).

/** 왼쪽 시각 열 폭 — "14시"가 들어가는 최소치. */
const TIME_W = 44;
/** 강의실 열 최소폭 — 창이 넓으면 균등하게 퍼진다(가로 모드의 SLOT_MIN_W와 같은 역할). */
const ROOM_MIN_W = 56;
/** 10분 한 칸의 높이. 80분 수업 = 8칸 ≒ 104px. */
const ROW_H = 13;
/** 이보다 낮은 블록엔 인원만 — 인원과 %를 두 줄로 쌓을 높이가 안 나온다(가로의 COMPACT_SPAN과 같은 이유). */
const VCOMPACT_SPAN = 3;

/** 강의실(열) 사이 세로선 — 층이 바뀌는 자리는 굵게. 가로 모드의 행 테두리와 같은 두 농도. */
const colEdge = (groupStart: boolean, groupLines: boolean): React.CSSProperties => ({
  borderLeft: groupLines && groupStart ? GROUP_SEP : ROW_SEP,
});

export function RoomTimeColumnTable({
  axis,
  rows,
  canEditCapacity,
  focusSubject,
  groupLines,
}: {
  axis: TimelineAxis;
  rows: RoomTimelineRow[];
  canEditCapacity: boolean;
  focusSubject: string | null;
  groupLines: boolean;
}) {
  const subjects = useSubjectMaps();
  // 정렬은 가로 모드와 **같은 함수**(건물 → 층 → 호수) — 축만 바뀌지 순서가 바뀌면 자리를 잃는다.
  const ordered = useMemo(() => groupRooms(rows), [rows]);
  // 열마다 "이 10분 칸에서 시작하는 셀" 색인(순수 함수 + Vitest — 병합 건너뛰기가 이 표의 유일한 함정).
  const columns = useMemo(
    () => ordered.map((r) => ({ room: r, at: timelineColumnCells(r.cells, axis.slots) })),
    [ordered, axis.slots],
  );

  if (axis.slots === 0) {
    return <p className="text-text-dim px-2 py-3 text-xs">운영 시간이 없어 시간대별 표를 만들 수 없습니다.</p>;
  }
  return (
    <table
      className="w-full table-fixed border-separate border-spacing-0 text-xs"
      style={{ minWidth: TIME_W + ordered.length * ROOM_MIN_W }}
    >
      <colgroup>
        <col style={{ width: TIME_W }} />
        {ordered.map((r) => (
          <col key={r.key} />
        ))}
      </colgroup>
      <thead>
        <tr className="text-text-dim">
          <th className={`${TH} text-left`}>시각</th>
          {ordered.map((r) => (
            <th
              key={r.key}
              className={`${TH} text-foreground overflow-hidden`}
              style={colEdge(r.groupStart, groupLines)}
              // 열이 좁아 이름이 잘린다 — 묶음(건물·층)과 미등록 여부까지 툴팁이 전부 말한다.
              title={`${groupLines ? `${r.group.label} · ` : ""}${r.name}${r.registered ? "" : " · 미등록"}`}
            >
              <span className="block truncate">
                {r.name}
                {r.registered ? "" : <span className="text-text-faint"> ※</span>}
              </span>
            </th>
          ))}
        </tr>
        <tr className="text-text-dim">
          <th className={`${TH} text-left font-normal`} title="정원 — 인원률의 분모(클릭해서 수정)">
            정원
          </th>
          {ordered.map((r) => (
            <th key={r.key} className={`${TH} font-normal`} style={colEdge(r.groupStart, groupLines)}>
              {r.registered ? (
                <RoomCapacityCell roomId={r.key} capacity={r.capacity} canEdit={canEditCapacity} />
              ) : (
                <span className="text-text-faint">—</span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: axis.slots }, (_, i) => {
          const onHour = i % SLOTS_PER_HOUR === 0;
          return (
            // 행 높이를 고정한다 — 안 그러면 빈 칸만 있는 행이 눌려 수업 블록의 길이가 시간과 안 맞는다.
            <tr key={i} style={{ height: ROW_H }}>
              <td
                className={`px-1 text-right align-top leading-none ${onHour ? "text-foreground font-bold" : ""}`}
                style={tickY(i)}
              >
                {onHour ? (
                  <span className="num text-xs">{Math.floor((axis.startMin + i * TIMELINE_STEP_MIN) / 60)}시</span>
                ) : null}
              </td>
              {columns.map(({ room, at }) => {
                const c = at[i];
                if (!c) return null; // 위 칸의 rowSpan이 덮는다
                const style = { ...tickY(i), ...colEdge(room.groupStart, groupLines) };
                if (c.kind === "gap") return <td key={room.key} style={style} />;
                return (
                  <TimelineTdVertical
                    key={room.key}
                    cell={c}
                    labelOf={subjects.labelOf}
                    // 블록에 여러 반이 있으면 과목도 여럿일 수 있다 — **하나라도** 맞으면 딤을 걸지 않는다.
                    dim={focusSubject != null && !c.members.some((m) => m.subject === focusSubject)}
                    style={style}
                  />
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TimelineTdVertical({
  cell,
  labelOf,
  dim,
  style,
}: {
  cell: Extract<RoomTimelineCell, { kind: "class" }>;
  /** 과목 키 → 한글 라벨(설정 단일 소스). 블록 안 반마다 과목이 다를 수 있어 함수로 받는다. */
  labelOf: (subject: string) => string;
  dim: boolean;
  /** 이 칸 시작 시각의 눈금(가로선) + 강의실 구분선(세로선). */
  style: React.CSSProperties;
}) {
  const over = cell.seatPct != null && cell.seatPct > 100;
  const compact = cell.span < VCOMPACT_SPAN;
  return (
    <td rowSpan={cell.span} className="p-px align-middle" style={style}>
      <div
        title={timelineTip(cell, labelOf)}
        // ⚠️ 높이는 `h-full`에만 맡기지 않는다 — td 안 100%는 표 높이 계산에 기대는 값이라, 안 잡히면
        // 80분 수업이 한 줄짜리 막대로 쪼그라든다(가로 모드는 실패해도 행 높이와 비슷해 안 보였을 뿐).
        // 병합 칸 수 × 행 높이를 최소치로 박아 두 경로 중 어느 쪽이든 시간에 비례한 길이가 나오게 한다.
        style={{ minHeight: cell.span * ROW_H - 2 }}
        className={`flex h-full min-w-0 flex-col items-center justify-center leading-none transition-opacity ${
          dim ? "opacity-30" : ""
        } ${seatFill(cell.seatPct)} ${
          cell.overlap === "conflict"
            ? "ring-1 ring-danger"
            : cell.overlap === "joint"
              ? "ring-1 ring-amber-500"
              : ""
        } rounded-md px-0.5`}
      >
        {/* 낮은 블록은 **%를 뺀다** — 세로로 쌓을 자리가 없다. 나머지는 툴팁이 말한다(가로 모드와 같은 규약).
            🔴 단위('명')는 세로 모드에서 특히 뺄 이유가 없다 — 여기서 좁은 건 **높이**고 폭은 강의실 열
               (≥56px)이 그대로 남는다. 가로 모드의 '폭이 없다'는 사정을 그대로 베껴 와서 `5`만 남았고,
               옆 칸이 `13명 130%`인 표에서 그 `5`는 사람 수인지 %인지 알 수 없었다(원장 지적 2026-08-06). */}
        <span className="num truncate font-semibold">{cell.students}명</span>
        {compact ? null : (
          <span className={`num truncate text-xs ${over ? "font-bold text-danger" : "opacity-70"}`}>
            {cell.seatPct == null ? "정원?" : `${cell.seatPct}%`}
          </span>
        )}
      </div>
    </td>
  );
}

/** 인원률 농도 — **옅을수록 자리가 남는다**(충원 대상). 100% 초과만 색을 바꿔 별도 신호로 뺀다. */
const seatFill = (pct: number | null): string => {
  if (pct == null) return "bg-bg-soft text-text-dim";
  if (pct > 100) return "bg-danger-soft text-danger"; // 정원 초과 = critical(앱 공통 위험색)
  if (pct >= 80) return "bg-primary/70 text-primary-foreground";
  if (pct >= 60) return "bg-primary/50 text-primary-foreground";
  if (pct >= 40) return "bg-primary/30";
  if (pct >= 20) return "bg-primary/15";
  return "bg-primary/8";
};
