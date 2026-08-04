"use client";

import { useState } from "react";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { WindowLink } from "@/components/workspace/window-link";
import { useSubjectMaps } from "@/features/owner/operations-context";
import type { RoomSlotLite } from "@/features/timetable/lib/room-grid";
import type {
  RoomConflictRow,
  RoomSeatOverRow,
  RoomTimelineRow,
  RoomWeekRow,
  TimelineAxis,
} from "@/features/timetable/lib/room-metrics";
import { minToHM } from "@/features/timetable/lib/ten-minute-grid";
import { saveTimetableViewPrefs } from "@/features/timetable/server/view-prefs-actions";
import { RoomHourTable, RoomTimeColumnTable } from "./room-panel-tables";

/**
 * 시간축 방향 — 라벨이 **현재 상태를 그대로 말한다**("바꾸기" 같은 동작 이름은 지금이 어느 쪽인지 안 알려준다).
 * 저장은 누르는 즉시(닫기 버튼에 매달면 체크만 하고 이동할 때 유실된다 — 뷰 세팅 규약).
 */
/**
 * 하단 목록 미리보기 상한 — 표를 밀어내지 않게. 스코프가 **하루**라 실측 건수는 요일당 0~2건이고,
 * 이 상한에 걸리는 일은 사실상 없다(걸리면 아래 [Rest]가 남은 수를 정직하게 말한다).
 * ⚠️ **배열 길이를 건수로 쓰지 않는다**([[#89]]: 상한만큼만 보여주면서 그 수를 "건수"로 적으면
 * 34건이 영원히 "6건"이 된다).
 */
const LIST_MAX = 8;

function Rest({ total }: { total: number }) {
  const rest = total - LIST_MAX;
  return rest > 0 ? (
    <li className="text-text-dim">
      외 <span className="num">{rest}</span>건 (총 <span className="num">{total}</span>건)
    </li>
  ) : null;
}

/** 반 이름 = 수업 상세로 가는 문(원장 2026-08-04 "누르면 수업상세 들어가도록"). 창 시스템이라 WindowLink. */
function ClassLink({ id, name }: { id: string; name: string }) {
  return (
    <WindowLink href={`/classes/${id}`} className="underline underline-offset-2">
      {name}
    </WindowLink>
  );
}

/**
 * 경고 목록 한 덩어리 — **한 건 = 한 줄**(원장 2026-08-04: *"너무 나열되어있어 가독성 현저히 떨어짐"*).
 *
 * 가운뎃점으로 잇던 한 문단을 표처럼 세운다: `시각` `강의실`은 **고정폭 열**이라 눈이 세로로 훑을 수 있고
 * (위 표를 보다 내려와도 자리를 안 잃는다), 반 이름만 색과 링크를 가져간다.
 * ⚠️ 좁은 창에서는 `flex-wrap`으로 접힌다 — 고정폭 칸이 넘쳐 옆 칸을 덮는 사고를 막는다(디자인 규칙).
 */
function IssueBlock({
  title,
  dayLabel,
  total,
  children,
}: {
  title: string;
  dayLabel: string;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <p className="text-red-600">
        <span className="font-semibold">{title}</span>
        <span className="text-text-dim"> · {dayLabel}요일</span> <span className="num font-semibold">{total}</span>건
      </p>
      <ul className="mt-0.5 flex flex-col gap-0.5 pl-0.5">{children}</ul>
    </section>
  );
}

/** 한 줄의 앞머리(시각·강의실) — 두 목록이 같은 자리에 같은 폭으로 찍혀야 세로로 훑힌다. */
function RowHead({ startMin, endMin, room }: { startMin: number; endMin: number; room: string }) {
  return (
    <>
      <span className="num text-text-dim w-[86px] shrink-0">
        {minToHM(startMin)}~{minToHM(endMin)}
      </span>
      <span className="text-text-dim w-[58px] shrink-0 truncate" title={room}>
        {room}
      </span>
    </>
  );
}

const AXIS_OPTIONS = [
  { vertical: false, label: "시간 가로", title: "가로 = 시간 · 세로 = 강의실 (내 계정에 저장)" },
  { vertical: true, label: "시간 세로", title: "가로 = 강의실 · 세로 = 시간 (내 계정에 저장)" },
] as const;

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
  timeVertical,
  conflicts,
  seatOver,
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
  /** 시간축을 세로로 둘지 — 계정에 저장된 뷰 설정(users.ui_prefs)의 초기값. */
  timeVertical: boolean;
  /** 주간 시간 겹침(이중예약 의심) 쌍 — 표엔 대표 반 하나만 서므로 **가려진 반**은 여기서만 보인다. */
  conflicts: RoomConflictRow[];
  /** 주간 정원 초과 — 방 이름만 말하던 옛 줄의 후신(반까지 짚어 준다). */
  seatOver: RoomSeatOverRow[];
  unassigned: RoomSlotLite[];
  canEditCapacity: boolean;
}) {
  const subjects = useSubjectMaps();
  // 구분선 토글 — 낙관적으로 즉시 반영하고 계정에 저장한다(뷰 세팅은 기기가 아니라 계정, 원장 2026-08-04).
  // 저장 실패는 화면을 되돌리지 않는다: 선 하나 때문에 클릭이 씹히는 것보다, 다음 새로고침에 옛 값으로
  // 돌아가는 쪽이 덜 나쁘다(색 강도 토글과 같은 규약).
  const [lines, setLines] = useState(groupLines);
  // 축 방향도 같은 규약(낙관적 반영 + 계정 저장). 데이터는 한 벌이라 전환은 순수 렌더 — 서버 왕복이 없다.
  const [vertical, setVertical] = useState(timeVertical);

  const registered = rows.filter((r) => r.registered);
  const idle = registered
    .filter((r) => r.weekdayUtilPct != null)
    .sort((a, b) => (a.weekdayUtilPct ?? 0) - (b.weekdayUtilPct ?? 0))
    .slice(0, 3);
  const noCapacity = registered.length > 0 && registered.every((r) => r.capacity == null);
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
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <div
            role="group"
            aria-label="시간축 방향"
            className="border-line flex items-center gap-0.5 rounded-full border p-0.5"
          >
            {AXIS_OPTIONS.map((o) => (
              <button
                key={o.label}
                type="button"
                onClick={() => {
                  if (o.vertical === vertical) return;
                  setVertical(o.vertical);
                  void saveTimetableViewPrefs({ roomTimeVertical: o.vertical });
                }}
                aria-pressed={vertical === o.vertical}
                title={o.title}
                className={`rounded-full px-2 py-0 text-[11px] leading-5 transition ${
                  vertical === o.vertical
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !lines;
              setLines(next);
              void saveTimetableViewPrefs({ roomGroupLines: next });
            }}
            aria-pressed={lines}
            title="건물·층이 바뀌는 자리에 구분선을 긋습니다 (내 계정에 저장)"
            className={`shrink-0 rounded-full border px-2 py-0 text-[11px] leading-5 transition ${
              lines
                ? "border-primary bg-primary text-primary-foreground font-medium"
                : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
            }`}
          >
            층 구분선
          </button>
        </div>
      </header>

      {/* 칸 크기는 창을 채우되(원장: "창 크기를 활용") 최소폭/최소높이 아래로는 안 줄고, 그때만 잡고 끌기.
          ⚠️ `scrollY` — 세로 시간축은 표가 화면보다 길다(10분 × 8시간 = 48행). 이 패널은 높이가 이미
          제한돼 있어(부모 min-h-0 flex-1) 세로를 페이지에 넘기면 넘친 만큼이 **잘려서 안 보인다**. */}
      <DragScrollArea className="min-h-0 flex-1" scrollY>
        {vertical ? (
          <RoomTimeColumnTable
            axis={axis}
            rows={hourRows}
            canEditCapacity={canEditCapacity}
            focusSubject={focusSubject}
            groupLines={lines}
          />
        ) : (
          <RoomHourTable
            axis={axis}
            rows={hourRows}
            canEditCapacity={canEditCapacity}
            focusSubject={focusSubject}
            groupLines={lines}
          />
        )}
      </DragScrollArea>

      <div className="mt-3 flex shrink-0 flex-col gap-2 text-[11px]">
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
        {/* 정원 초과 — 방 이름만 말하던 옛 줄을 **반 목록**으로(원장 2026-08-04). 반을 누르면 수업 상세. */}
        {seatOver.length > 0 ? (
          <IssueBlock title="정원 초과" dayLabel={hourDayLabel} total={seatOver.length}>
            {seatOver.slice(0, LIST_MAX).map((r) => (
              <li key={r.key} className="flex flex-wrap items-baseline gap-x-2 text-red-600">
                <RowHead startMin={r.startMin} endMin={r.endMin} room={r.roomName} />
                <ClassLink id={r.classId} name={r.className} />
                <span className="num ml-auto shrink-0 font-semibold">
                  {r.students}/{r.capacity}명
                </span>
              </li>
            ))}
            <Rest total={seatOver.length} />
          </IssueBlock>
        ) : null}
        {/* 시간 겹침 — 표엔 대표 반 하나만 서서 **가려진 반**이 어디에도 안 보였다. 쌍으로 적고 둘 다 링크. */}
        {conflicts.length > 0 ? (
          <IssueBlock title="시간 겹침" dayLabel={hourDayLabel} total={conflicts.length}>
            {conflicts.slice(0, LIST_MAX).map((c) => (
              <li key={c.key} className="flex flex-wrap items-baseline gap-x-2 text-red-600">
                <RowHead startMin={c.startMin} endMin={c.endMin} room={c.roomName} />
                <span className="min-w-0">
                  <ClassLink id={c.classes[0].classId} name={c.classes[0].className} />
                  <span className="text-text-dim"> ↔ </span>
                  <ClassLink id={c.classes[1].classId} name={c.classes[1].className} />
                </span>
              </li>
            ))}
            <Rest total={conflicts.length} />
          </IssueBlock>
        ) : null}
        {byClass.size > 0 ? (
          <p className="text-amber-700">
            강의실 미배정{" "}
            {[...byClass.entries()].map(([classId, c], i) => (
              <span key={classId}>
                {i > 0 ? " · " : ""}
                <ClassLink id={classId} name={c.className} /> ({subjects.labelOf(c.subject)} {c.count}교시)
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
