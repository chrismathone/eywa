"use client";
import { tipProps } from "@/components/hover-tip/tip";

import { memo, useMemo, useRef, useState } from "react";
import { useDraggable, type DraggableAttributes, type DraggableSyntheticListeners } from "@dnd-kit/core";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import {
  fitSeatName,
  fluidNameFontSize,
  LAB_CHIP_NAME_FILL,
  NAME_FILL_MAX_PX,
  NAME_FILL_MIN_PX,
  SEAT_CHIP_NAME_LADDER,
} from "@/features/attendance/seat/name-fit";
import { seatNoteTitle } from "@/features/attendance/seat/note-title";
import { seatCellKey } from "@/features/attendance/seat/prev-period";
import { seatMoveBlockReason, type PlacedStudent } from "@/features/attendance/seat/placement";
import type { SeatDragHint } from "@/features/attendance/seat/drop-verdict";
import type { SeatClassRoster, SeatStudent } from "@/features/attendance/seat/server/queries";
import type { SeatStatus } from "@/features/attendance/seat/server/actions";
import { SEAT_TONE } from "./seat-status";
import { seatPointerDown, seatPointerUp, swallowSeatClickAfterDrag } from "./seat-drag";
import { SeatMarkTriad, SeatMemoMark, SeatNotePopover } from "./seat-mark-extras";
import { SeatPeriodHints, type SeatPeriodHintData } from "./seat-period-hints";

/** 배치를 얹은 명단 — 학생마다 **원래 반**(`homeClassId`)을 들고 다닌다(출결은 언제나 그 반으로). */
export type PlacedSeatRoster = Omit<SeatClassRoster, "students"> & {
  students: PlacedStudent<SeatStudent>[];
};

/** 드래그 데이터 — id 파싱 금지(시간표 규약과 같다), 판정은 `data`로만. */
export type CardDrag = {
  studentId: string;
  /** 출결이 저장되는 반(= 수강 반). 배치가 바뀌어도 이 값은 안 바뀐다. */
  homeClassId: string;
  /**
   * 이 카드가 서 있는 **교시**("HH:MM") — 어디서 어디로 끌었는지 가르는 축이다(같은 교시 = 제자리 = 취소).
   * 🔴 교시 하나만 그리는 보기에서도 채운다 — 비면 모든 교시가 "다른 시간"으로 오인된다.
   */
  start: string;
  /**
   * 이미 출결이 찍힌 카드인가 — 원장 *"출결이 찍힌 학생은 드래그 절대 불가"*.
   * 🔴 손잡이가 꺼져 있어 평소엔 여기 올 일이 없지만, 판정을 **드롭 쪽에서도** 같은 함수로 한 번 더
   *    본다(둘이 갈리면 어느 쪽이 진짜인지 알 수 없다).
   */
  marked: boolean;
  name: string;
  meta: string;
};

/**
 * 드롭 대상 데이터 — **교시만**이다. 원장 2026-09-11 *"LAB실에서 내가 드래그하고 싶은건, '다른 시간대'의 수업임.
 * 같은 시간대의 수업으로 옮기고 싶은게 아니야."* — 그 교시의 어디(칩·판)에 놓든 그 교시로 옮기고, 떨군 묶음의 반은
 * 보지 않는다(같은 교시 안 반 묶음 이동은 없앴다).
 */
export type SeatDropTarget = { start: string };

/**
 * 끌고 있는 카드의 모습 + 그 아래 한 줄(`seatDragHint` — 놓을 곳의 판정을 그대로 옮겨 적는다).
 * 색: 옮긴다 = 초록(놓을 곳 표식과 같은 색) · 못 옮긴다 = 결석 잉크 · 안내(제자리·놓을 곳 밖) = 흐린 글자.
 */
export function SeatDragCard({ drag, hint }: { drag: CardDrag; hint?: SeatDragHint | null }) {
  const tone = hint?.ok === true ? "text-green" : hint?.ok === false ? "text-att-absent-ink" : "text-text-dim";
  return (
    <div className="bg-card border-primary text-foreground pointer-events-none rounded-xl border-2 px-2.5 py-2 text-left shadow-lg">
      <span className="block leading-none font-bold">{drag.name}</span>
      <span className="text-text-dim text-xs">{drag.meta || " "}</span>
      {hint ? <span className={`mt-1 block text-xs font-semibold ${tone}`}>{hint.text}</span> : null}
    </div>
  );
}

/**
 * 랩실 출석부 — 이름 카드에 출결만. JJ 전용 칸은 여기에 넣지 않는다.
 *
 * 🔴 **드래그 컨텍스트를 여기서 만들지 않는다** — 드래그의 뜻은 '다른 시간으로' 하나이고(원장 2026-09-11) 판정·놓을
 *    곳·드롭은 바깥 `SeatAllDay`의 컨텍스트 한 벌이 받는다(교시 하나 보기에서도 — 그때 놓을 곳은 교시 칩이다).
 *    여기는 카드를 **집을 수 있게**만 한다.
 * 🔴 **배치(0254a)는 출결 귀속이 아니다** — 이미 옮겨 둔 카드도 저장은 언제나 `s.homeClassId`(= 그 학생의 수강 반)로
 *    나간다. 자세한 근거는 [`placement.ts`](src/features/attendance/seat/placement.ts) 머리 주석.
 * 🔴 **묶음의 `r.classId`로 저장하지 말 것** — 옮겨 온 학생의 출결이 남의 반으로 가고, 낙관 오버레이
 *    키가 갈려 방금 찍은 체크가 화면에서 사라진다.
 */
export function SeatLabGrid({
  rosters,
  statusOf,
  noteOf,
  onSave,
  onSaveNote,
  showReason,
  hints,
  onFillClass,
  readOnly,
  writeLocked = false,
  pending,
  canMove,
  onResetClass,
  resetCounts,
  periodStart,
  periodChoiceCounts,
  onClearPeriodChoices,
  canDrag = false,
}: {
  /** 자리 출석부 **읽기 권한**(보드의 `readOnlyReason === "permission"`) — 출결 세 단추 대신 상태 글자(`SeatMarkTriad statusOnly`). */
  writeLocked?: boolean;
  rosters: PlacedSeatRoster[];
  statusOf: (classId: string, student: SeatClassRoster["students"][number]) => SeatStatus | null;
  noteOf: (classId: string, student: SeatClassRoster["students"][number]) => string | null;
  onSave: (classId: string, studentId: string, next: SeatStatus | null, prev: SeatStatus | null) => void;
  onSaveNote: (classId: string, studentId: string, note: string, status: SeatStatus | null) => void;
  /** 사유 칸을 그릴 것인가 — 비로그인 PIN 화면은 false(그 경로는 사유를 조회하지 않는다). */
  showReason: boolean;
  /** 같은 날 교시 사이 신호(앞 교시 결석 · 다음 교시) — 표시 전용. */
  hints: SeatPeriodHintData;
  onFillClass: (classId: string) => void;
  readOnly: boolean;
  pending: boolean;
  /** 이미 옮겨 둔 자리(배치 0254a)를 [초기화]할 수 있나 — 로그인 + 쓰기 가능 + 0254a 적용됨. */
  canMove: boolean;
  onResetClass: (classId: string) => void;
  /** 반 묶음 id → 그 묶음으로 옮겨 온 학생 수. 0(키 없음)이면 [초기화]를 세우지 않는다. */
  resetCounts: Readonly<Record<string, number>>;
  /**
   * 이 격자가 그리는 교시("HH:MM") — 드래그 데이터의 축이다.
   * 🔴 '전체' 보기에선 교시가 여럿이라 이 값이 없으면 어디서 어디로 끌었는지 알 수 없다.
   */
  periodStart: string;
  /** 반 묶음 id → 그 반에서 **교시가 지정된** 학생 수(0255a). 0이면 [교시 지정 해제]를 안 세운다. */
  periodChoiceCounts?: Readonly<Record<string, number>>;
  onClearPeriodChoices?: (classId: string) => void;
  /**
   * 카드를 **집을 수 있나** — 교시 이동(0255a)의 가용성 하나다(바깥 `SeatAllDay` 컨텍스트가 받는다).
   * 🔴 배치(0254a) 가용성과 **따로**다 — 배치를 새로 만드는 드래그는 없으므로 배치 표가 안 돌아도 교시 이동은 산다.
   */
  canDrag?: boolean;
}) {
  return (
    <>
      {rosters.map((r) => (
        <SeatClassSection
          key={r.classId}
          roster={r}
          statusOf={statusOf}
          noteOf={noteOf}
          onSave={onSave}
          onSaveNote={onSaveNote}
          showReason={showReason}
          hints={hints}
          onFillClass={onFillClass}
          readOnly={readOnly}
          writeLocked={writeLocked}
          pending={pending}
          canMove={canMove}
          onResetClass={onResetClass}
          resetCount={resetCounts[r.classId] ?? 0}
          periodStart={periodStart}
          periodChoiceCount={periodChoiceCounts?.[r.classId] ?? 0}
          onClearPeriodChoices={onClearPeriodChoices}
          canDrag={canDrag}
        />
      ))}
    </>
  );
}

/** 반 묶음 한 덩어리 — 초기화 단위(드롭 대상은 교시 칩·교시 판이다, `seat-drop-zones.tsx`). */
function SeatClassSection({
  roster: r,
  statusOf,
  noteOf,
  onSave,
  onSaveNote,
  showReason,
  hints,
  onFillClass,
  readOnly,
  writeLocked,
  pending,
  canMove,
  onResetClass,
  resetCount,
  periodStart,
  periodChoiceCount,
  onClearPeriodChoices,
  canDrag,
}: {
  writeLocked: boolean;
  roster: PlacedSeatRoster;
  statusOf: (classId: string, student: SeatClassRoster["students"][number]) => SeatStatus | null;
  noteOf: (classId: string, student: SeatClassRoster["students"][number]) => string | null;
  onSave: (classId: string, studentId: string, next: SeatStatus | null, prev: SeatStatus | null) => void;
  onSaveNote: (classId: string, studentId: string, note: string, status: SeatStatus | null) => void;
  showReason: boolean;
  hints: SeatPeriodHintData;
  onFillClass: (classId: string) => void;
  readOnly: boolean;
  pending: boolean;
  canMove: boolean;
  onResetClass: (classId: string) => void;
  resetCount: number;
  periodStart: string;
  periodChoiceCount: number;
  onClearPeriodChoices?: (classId: string) => void;
  canDrag: boolean;
}) {
  const left = r.students.filter((s) => statusOf(s.homeClassId, s) === null).length;
  /**
   * 반 머리줄 색 — **반이 들고 있는 색**(`classes.bg_color`)으로 **줄 전체**를 칠한다(원장 2026-09-10
   * *"반이름은 설정된 반색상으로 색칠해주고"* → *"색상은 행전체를 색칠해"*). 처음엔 이름 알약에만 둘렀는데,
   * 원장이 줄 전체로 정정했다 — 알약으로 되돌리지 말 것.
   * 🔴 색이 없으면 지금 모습 그대로다(지어낸 색 금지). 🔴 **학생 카드는 칠하지 않는다** — 카드 배경은 출결
   *    의미색(초록·앰버·빨강)의 자리라, 거기까지 반 색을 깔면 출결 상태가 안 읽힌다. 머리줄까지만이다.
   * ⚠️ `text_color`가 비어 있으면 본문 글자색(#121212)으로 — 시간표 카드 헤더와 같은 폴백이다. 칠해진 줄에선
   *    보조 글자(인원·종료시각)를 옅은 회색 토큰 대신 **같은 글자색의 투명도**로 낮춘다(회색은 반 색 위에서 안 읽힌다).
   */
  const headColor = r.bgColor
    ? { background: r.bgColor, color: r.textColor ?? "var(--ink)" }
    : undefined;
  const subText = headColor ? "opacity-75" : "text-text-faint";

  return (
    <section className="border-line overflow-hidden rounded-2xl border">
      <header
        className={`border-line flex items-center gap-2 border-b px-3 py-1.5 text-sm ${headColor ? "" : "bg-bg-soft"}`}
        style={headColor}
      >
        <span className="font-bold">{r.className}</span>
        <span className={`${subText} text-xs tabular-nums`}>{r.students.length}명</span>
        {/* 🔑 다른 시간에서 옮겨 온 묶음은 끝나는 시각 대신 **어디서 왔는지**를 적는다 — 이 교시엔 그 반
            슬롯이 없어 `~끝` 시각이 이 교시의 것이 아니다. 출결이 원래 반으로 가는 이유도 이 표식이 말한다. */}
        {r.visiting ? (
          <span
            className="border-line bg-card text-text-dim rounded-full border px-2 py-0.5 text-xs font-semibold"
            title="이 교시에 수업이 없는 반에서 옮겨 온 학생입니다 — 출결은 원래 반으로 기록됩니다"
          >
            다른 시간에서 옴 · 원래 {r.visiting.fromSlots.join("·")}
          </span>
        ) : (
          <span className={`${subText} text-xs tabular-nums`}>~{r.end}</span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {/* 🔴 교시가 지정된 학생이 있을 때만 선다(배치 [초기화]와 같은 규약) — 누르면 그 반의 **그날
              지정과 그 요일 고정을 함께** 지운다(하나만 지우면 다음 날 도로 옮겨지거나 오늘이 안 돌아온다).
              🔴 조건에 `canMove`(배치 가용성)를 넣지 말 것 — 0254a만 안 돌아도 해제가 함께 죽는다. */}
          {periodChoiceCount > 0 && onClearPeriodChoices ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => onClearPeriodChoices(r.classId)}
              title="이 반의 교시 지정(오늘 이동 + 이 요일 고정)을 지웁니다 — 출결 기록은 그대로입니다"
              className="border-line bg-card text-text-dim rounded-full border px-2.5 py-0.5 text-xs font-semibold disabled:opacity-50"
            >
              교시 지정 {periodChoiceCount}명 해제
            </button>
          ) : null}
          {/* 🔴 되돌릴 것이 있을 때만 선다 — 0건인데 [초기화]가 서 있으면 "뭔가 꼬였나" 싶어 누르게 된다.
              배치를 새로 만드는 드래그는 없어졌지만(2026-09-11) 이미 옮겨 둔 자리는 여기서 되돌린다. */}
          {canMove && resetCount > 0 ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => onResetClass(r.classId)}
              title="이 반으로 옮겨 둔 학생을 원래 반으로 되돌립니다 — 출결 기록은 그대로입니다"
              className="border-line bg-card text-text-dim rounded-full border px-2.5 py-0.5 text-xs font-semibold disabled:opacity-50"
            >
              초기화 {resetCount}명
            </button>
          ) : null}
          {!readOnly && left > 0 ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => onFillClass(r.classId)}
              className="border-line bg-card text-primary rounded-full border px-2.5 py-0.5 text-xs font-semibold disabled:opacity-50"
            >
              이 반 출석
            </button>
          ) : null}
        </span>
      </header>
      <ul className="grid gap-2 p-3 [grid-template-columns:repeat(auto-fill,minmax(148px,1fr))]">
        {r.students.map((s) => (
          <SeatCard
            key={`${s.homeClassId}|${s.id}`}
            student={s}
            periodStart={periodStart}
            statusOf={statusOf}
            noteOf={noteOf}
            onSave={onSave}
            onSaveNote={onSaveNote}
            showReason={showReason}
            hints={hints}
            readOnly={readOnly}
            writeLocked={writeLocked}
            pending={pending}
            canMove={canDrag}
          />
        ))}
      </ul>
    </section>
  );
}

/** 카드 한 장의 재료 — 껍데기(`SeatCard`)와 본문(`SeatCardBody`)이 함께 받는다. */
type SeatCardProps = {
  student: PlacedStudent<SeatStudent>;
  statusOf: (classId: string, student: SeatClassRoster["students"][number]) => SeatStatus | null;
  noteOf: (classId: string, student: SeatClassRoster["students"][number]) => string | null;
  onSave: (classId: string, studentId: string, next: SeatStatus | null, prev: SeatStatus | null) => void;
  onSaveNote: (classId: string, studentId: string, note: string, status: SeatStatus | null) => void;
  showReason: boolean;
  hints: SeatPeriodHintData;
  readOnly: boolean;
  /** 읽기 권한 — 세 단추 대신 상태 글자(`SeatLabGrid` 주석). */
  writeLocked: boolean;
  pending: boolean;
};

/** 카드 손잡이 — 껍데기가 dnd 훅에서 받아 본문에 넘긴다(참조 고정 — 드래그 중엔 끄는 카드 한 장만 바뀐다). */
type SeatCardHandle = {
  /** 이 카드를 집을 수 있나(교시 이동 가용성 — 부모의 `canDrag`). */
  canMove: boolean;
  /** 옮길 수 없는 이유(출결이 찍혔다) — 없으면 null. */
  moveBlocked: string | null;
  setNodeRef: (el: HTMLElement | null) => void;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  isDragging: boolean;
};

/**
 * 카드 한 장의 **드래그 껍데기** — `useDraggable`만 든다. 무거운 본문은 `memo`인 `SeatCardBody`다.
 * 🔴 왜 나눴나: `useDraggable`은 dnd 컨텍스트(`active`·`over`)를 구독해서, 집는 순간·칸을 넘을 때마다 **모든 카드**가
 *    다시 불린다('전체' 보기는 150~200장). 본문(출결 버튼·사유 팝업·신호 줄)을 여기 두면 그 전부가 매번 다시
 *    그려졌다(적대 리뷰 2026-09-11). 손잡이 값은 끄는 카드 한 장만 바뀌므로 본문도 그 한 장만 다시 그려진다.
 * ⚠️ 시간표처럼 "마우스가 올라간 카드만 무장"은 쓰지 않았다 — 무장 스왑은 노드를 갈아 끼워 끄는 중 언마운트([[#129]])·
 *    hover 유실을 따로 막아야 한다. 여기선 본문 memo만으로 비용이 끄는 카드 한 장으로 준다.
 */
function SeatCard({
  periodStart,
  canMove,
  ...props
}: SeatCardProps & {
  /** 이 카드가 서 있는 교시 — 어디서 어디로 끌었는지 가르는 축. */
  periodStart: string;
  canMove: boolean;
}) {
  const s = props.student;
  /**
   * 출결이 찍혔으면 손잡이를 잠근다 — 원장 2026-09-10 *"출결이 찍힌 학생은 드래그 절대 불가"*.
   * 🔑 낙관 오버레이가 얹힌 `cur`를 본다(서버 왕복 전에도 곧바로 잠긴다) — 방금 찍고 바로 끄는
   *    동작이 서버 거절로 되돌아가는 것보다, 애초에 안 잡히는 쪽이 정직하다. 상태는 **원래 반**으로 읽는다.
   */
  const cur = props.statusOf(s.homeClassId, s);
  const moveBlocked = seatMoveBlockReason(cur);
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `seat-card:${periodStart}:${s.homeClassId}:${s.id}`,
    data: {
      studentId: s.id,
      homeClassId: s.homeClassId,
      start: periodStart,
      marked: moveBlocked !== null,
      name: s.name,
      meta: schoolGradeLabel(s.school, s.grade),
    } satisfies CardDrag,
    disabled: !canMove || moveBlocked !== null,
  });
  const handle = useMemo<SeatCardHandle>(
    () => ({ canMove, moveBlocked, setNodeRef, attributes, listeners, isDragging }),
    [canMove, moveBlocked, setNodeRef, attributes, listeners, isDragging],
  );
  return <SeatCardBody {...props} handle={handle} />;
}

/** 카드 본문 — 드래그 중엔 끄는 카드 한 장만 다시 그려진다(`SeatCard` 주석). */
const SeatCardBody = memo(function SeatCardBody({
  student: s,
  statusOf,
  noteOf,
  onSave,
  onSaveNote,
  showReason,
  hints,
  readOnly,
  writeLocked,
  pending,
  handle,
}: SeatCardProps & { handle: SeatCardHandle }) {
  const { canMove, moveBlocked, setNodeRef, attributes, listeners, isDragging } = handle;
  const meta = schoolGradeLabel(s.school, s.grade);
  const anchorRef = useRef<HTMLLIElement | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  // 🔴 저장·상태 조회는 **원래 반**으로 — 놓인 묶음이 아니다(머리 주석).
  const cur = statusOf(s.homeClassId, s);
  const note = noteOf(s.homeClassId, s);
  // 긴 이름(동명이인 알파벳 접미사)은 잘라내지 않고 그 칩만 글씨를 줄인다.
  const fit = fitSeatName(s.name, SEAT_CHIP_NAME_LADDER);
  // 사유 메모는 카드 전체의 툴팁이다(원장 2026-08-28 "마우스 오버시 결석사유") — 카드 안
  // 어디에 올려도 뜨도록 <li>에 단다. 자기 title을 가진 자식(잘린 이름·특이사항)만 자기 것을 띄운다.
  /**
   * 카드 툴팁 — 사유 메모가 있으면 그것이 먼저다(그게 이 자리의 원래 쓰임이다).
   * 🔑 메모가 없고 **옮길 수 있는 사람인데 잠긴 카드**면 그 이유를 대신 띄운다 — 안 그러면
   *    "왜 이 카드만 안 잡히지"가 되고, 원인 없는 무반응은 고장으로 읽힌다.
   */
  const noteTitle = seatNoteTitle(cur, note) ?? (canMove ? moveBlocked : null);
  /** 사유·특이사항 창을 여는 유일한 문 — 공개 PIN 화면(showReason=false)에선 열리지 않는다. */
  const openNote = () => {
    if (showReason && !readOnly) setNoteOpen(true);
  };

  /**
   * 출결 세 버튼 — **고른 것을 다시 누르면 미체크로 되돌아간다**([[#103]] 되돌릴 문을 잠그지 말 것).
   * 결석·지각을 새로 고르면 사유 창이 **이어서** 열린다(상태는 이미 저장됐다 — 안 적어도 된다).
   */
  const mark = (next: SeatStatus) => {
    const same = cur === next;
    onSave(s.homeClassId, s.id, same ? null : next, cur);
    if (!same && (next === "absent" || next === "late")) openNote();
    else setNoteOpen(false);
  };

  // 카드에 `touch-none`을 걸지 않는다 — dnd-kit 권장이지만 이 화면은 카드가 격자를 가득 채워서
  // 손가락으로 목록을 굴릴 자리가 카드밖에 없다(자리 태블릿에서 스크롤이 통째로 죽는다). 터치에서
  // 드래그가 잘 안 걸리는 쪽을 택한다 — 교시 옮기기는 데스크의 편의 기능이고, 출결은 그대로 된다.
  return (
    <li
      ref={anchorRef}
      className={`relative flex flex-col gap-1 ${isDragging ? "opacity-40" : ""}`}
      {...tipProps(noteTitle)}
    >
      <SeatNotePopover
        open={noteOpen}
        onOpenChange={setNoteOpen}
        anchorRef={anchorRef}
        note={note}
        status={cur}
        studentName={s.name}
        onSave={(text) => onSaveNote(s.homeClassId, s.id, text, cur)}
      >
        {/* 카드 본체 = **드래그 손잡이 + 우클릭 특이사항**. 종전엔 이 자리가 '누르면 출석' 버튼이었는데,
            출결이 세 버튼으로 내려오면서 클릭 축이 하나로 정리됐다(원장 *"클릭으로 출결되는거랑
            중복액션되지않게"*) — 본체 클릭은 이제 아무 일도 안 한다.
            🔴 우클릭인 이유: 이 카드는 끌 수 있어서 좌클릭·더블클릭이 이미 다른 뜻이다([[#97]]).
               `preventDefault`는 **열 수 없는 칸에서도 항상** 부른다(브라우저 메뉴가 뜨면 드래그가 죽는다). */}
        {/* 🔴 못 끄는 카드엔 dnd 속성을 안 붙인다 — dnd-kit이 `role="button"`·`tabIndex`를 얹어서,
            아무 일도 안 하는 칸이 키보드로 눌리는 버튼처럼 보인다.
            🔴 드래그 직후의 클릭은 **이 손잡이에서만** 삼킨다 — 격자 루트에 걸면 방금 드래그한 뒤
               옆 카드의 출결 버튼을 누른 **진짜 클릭**까지 먹는다(세 버튼은 손잡이 밖 형제다). */}
        <div
          ref={setNodeRef}
          {...(canMove ? attributes : {})}
          {...(canMove ? listeners : {})}
          onPointerDownCapture={seatPointerDown}
          onPointerUpCapture={seatPointerUp}
          onClickCapture={swallowSeatClickAfterDrag}
          onContextMenu={(e) => {
            e.preventDefault();
            openNote();
          }}
          title={showReason && !readOnly ? "우클릭: 특이사항·사유 입력" : undefined}
          className={`@container border-line flex min-h-[54px] w-full flex-col items-start rounded-xl border px-2.5 py-2 text-left ${
            cur ? SEAT_TONE[cur] : "bg-card border-dashed"
          } ${canMove ? "cursor-grab" : ""}`}
        >
          {/* 글자는 칩 폭에 비례(name-fit.ts `fluidNameFontSize`, 원장 2026-09-04 "출결에도 이름 꽉 차게").
              `pr-3` = 모서리 메모 삼각형 자리만 비운다(옛 `pr-5`는 사라진 상태 배지·결/지 버튼 자리였다 —
              그 배지가 이름과 겹쳐 보인다는 제보가 2026-09-10 ⑤였고, 세 버튼으로 내려가며 함께 사라졌다).
              하한에서도 넘칠 때만 말줄임 + 전체 이름 툴팁. */}
          <span
            className="w-full truncate pr-3 leading-none font-bold"
            style={{
              fontSize: fluidNameFontSize(s.name, {
                minPx: NAME_FILL_MIN_PX.labChip,
                maxPx: NAME_FILL_MAX_PX,
                fill: LAB_CHIP_NAME_FILL,
              }),
            }}
            // 이름이 잘린 칩에서는 이름 툴팁이 <li>의 사유를 가린다 → 둘을 이어 붙인다.
            {...tipProps(noteTitle ? { title: s.name, lines: [noteTitle] } : null)}
            title={!noteTitle && fit.clipped ? s.name : undefined}
          >
            {s.name}
          </span>
          <span className="text-xs opacity-80">{meta || " "}</span>
          {/* 특이사항 한 줄 — 이름 아래(원장 2026-09-10 ④ *"길면 잘라버리고 마우스 올리면 전체"*).
              🔴 인라인 요소엔 자르기가 안 먹는다([[#111]]) — 블록으로 세운다. */}
          {showReason && note ? (
            <span className="block w-full truncate text-xs font-semibold opacity-80" {...tipProps(note)}>
              {note}
            </span>
          ) : null}
          {/* 같은 날 교시 사이 신호 — 앞 교시 결석 · 다음 교시(표시 전용, JJ실과 같은 부품). */}
          <SeatPeriodHints
            prevAbsentStart={hints.prevAbsentByCell?.[seatCellKey(s.homeClassId, s.id)]}
            nextStart={hints.nextStartByStudent?.[s.id]}
            nextRoom={hints.nextRoomByStudent?.[s.id]}
            last={hints.lastByStudent?.[s.id]}
            seatName={hints.seatName}
            cur={cur}
          />
        </div>
      </SeatNotePopover>
      {/* 메모가 있으면 모서리 삼각형(스프레드시트식) — 무채색이라 출결 의미색과 다투지 않는다. */}
      {showReason ? <SeatMemoMark note={note} /> : null}
      {/* 옮겨 온 카드는 **어디서 왔는지 적는다** — 출결은 원래 반으로 가므로, 안 적으면 화면이
          "이 반 학생"이라는 거짓말을 한다. */}
      {s.movedFromClassId ? (
        <span
          className="border-line bg-bg-soft text-text-dim pointer-events-none absolute top-1 left-1.5 rounded border px-1 text-xs font-semibold"
          title="자리를 옮겨 둔 학생입니다 — 출결은 원래 반으로 기록됩니다"
        >
          자리 이동
        </span>
      ) : null}
      {/* 🔴 지난 날짜(readOnly)에도 **숨기지 않고 잠근다** — 감추면 상태가 배경색으로만 남아
          "무슨 색이 무슨 뜻인지" 되짚어야 한다(색만으로 뜻을 나르지 않는다). 원장 지시의
          "버튼 수·폭이 상태에 따라 변하지 않는다"와도 같은 결이다.
          🔴 읽기 권한(`writeLocked`)은 잠긴 단추 대신 **상태 글자**만 — 같은 전폭이라 색만으로 뜻을 나르지 않는다(원장 2026-11-05). */}
      <SeatMarkTriad
        cur={cur}
        studentName={s.name}
        disabled={readOnly || pending}
        statusOnly={writeLocked}
        onMark={mark}
      />
    </li>
  );
});
