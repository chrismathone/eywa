"use client";

import { useMemo } from "react";
import { minToHM } from "@/features/timetable/lib/ten-minute-grid";
import { groupRooms } from "@/features/timetable/lib/room-groups";
import { useSubjectMaps } from "@/features/owner/operations-context";
import {
  TIMELINE_STEP_MIN,
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
const tick = (i: number): React.CSSProperties =>
  i === 0
    ? {}
    : {
        borderLeft: `1px dotted color-mix(in srgb, var(--foreground) ${
          i % SLOTS_PER_HOUR === 0 ? 30 : 14
        }%, transparent)`,
      };

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
    return <p className="text-text-dim px-2 py-3 text-[11px]">운영 시간이 없어 시간대별 표를 만들 수 없습니다.</p>;
  }
  return (
    <table
      className="w-full table-fixed border-separate border-spacing-0 text-[11px]"
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
                <span className="text-foreground absolute top-1 left-0.5 text-[11px] font-bold whitespace-nowrap">
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
                    subjectLabel={subjects.labelOf(c.subject)}
                    dim={focusSubject != null && c.subject !== focusSubject}
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
  subjectLabel,
  dim,
  style,
}: {
  cell: Extract<RoomTimelineCell, { kind: "class" }>;
  subjectLabel: string;
  dim: boolean;
  /** 행 테두리(교실/층 구분선) + 이 칸 시작 위치의 10분 눈금 — 행 전체가 같은 값을 받아야 선이 안 끊긴다. */
  style: React.CSSProperties;
}) {
  const over = cell.seatPct != null && cell.seatPct > 100;
  const compact = cell.span < COMPACT_SPAN;
  const tip =
    `${cell.className} · ${subjectLabel}` +
    (cell.teacherLabel ? ` · ${cell.teacherLabel}` : "") +
    ` · ${minToHM(cell.startMin)}~${minToHM(cell.endMin)}` +
    ` · ${cell.students}명` +
    (cell.seatPct != null ? ` (정원의 ${cell.seatPct}%)` : " (정원 미입력)") +
    (cell.overlap === "conflict" ? " · 시간 겹침 주의" : cell.overlap === "joint" ? " · 합반" : "");
  return (
    <td colSpan={cell.span} className="p-px align-middle" style={style}>
      <div
        title={tip}
        className={`flex h-full min-h-[30px] min-w-0 items-center justify-center gap-1 rounded-md px-1 py-0.5 leading-tight transition-opacity ${
          dim ? "opacity-30" : ""
        } ${seatFill(cell.seatPct)} ${
          cell.overlap === "conflict"
            ? "ring-1 ring-red-500"
            : cell.overlap === "joint"
              ? "ring-1 ring-amber-500"
              : ""
        }`}
      >
        {compact ? (
          // 좁은 블록은 인원만 — %까지 넣으면 글자가 잘려 **아무것도 못 읽는다**. 나머지는 툴팁이 말한다.
          <span className="num truncate font-semibold">{cell.students}</span>
        ) : (
          <>
            <span className="num truncate font-semibold">{cell.students}명</span>
            <span className={`num truncate text-[10px] ${over ? "font-bold text-red-600" : "opacity-70"}`}>
              {cell.seatPct == null ? "정원?" : `${cell.seatPct}%`}
            </span>
          </>
        )}
      </div>
    </td>
  );
}

/** 인원률 농도 — **옅을수록 자리가 남는다**(충원 대상). 100% 초과만 색을 바꿔 별도 신호로 뺀다. */
const seatFill = (pct: number | null): string => {
  if (pct == null) return "bg-bg-soft text-text-dim";
  if (pct > 100) return "bg-red-500/20 text-red-700";
  if (pct >= 80) return "bg-primary/70 text-primary-foreground";
  if (pct >= 60) return "bg-primary/50 text-primary-foreground";
  if (pct >= 40) return "bg-primary/30";
  if (pct >= 20) return "bg-primary/15";
  return "bg-primary/8";
};
