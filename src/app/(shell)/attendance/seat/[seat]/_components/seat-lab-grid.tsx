"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
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
import { SEAT_DRAG_THRESHOLD_PX, type PlacedStudent } from "@/features/attendance/seat/placement";
import type { SeatClassRoster, SeatStudent } from "@/features/attendance/seat/server/queries";
import type { SeatStatus } from "@/features/attendance/seat/server/actions";
import { SEAT_LABEL, SEAT_TONE } from "./seat-status";
import { beginSeatDrag, endSeatDrag, seatPointerDown, seatPointerUp, swallowSeatClickAfterDrag } from "./seat-drag";
import {
  PrevAbsenceHint,
  SeatMarkButtons,
  SeatPeriodHints,
  SeatReasonInput,
  type SeatPeriodHintData,
} from "./seat-mark-extras";

/** 배치를 얹은 명단 — 학생마다 **원래 반**(`homeClassId`)을 들고 다닌다(출결은 언제나 그 반으로). */
export type PlacedSeatRoster = Omit<SeatClassRoster, "students"> & {
  students: PlacedStudent<SeatStudent>[];
};

/** 드래그 데이터 — id 파싱 금지(시간표 규약과 같다), 판정은 `data`로만. */
type CardDrag = {
  studentId: string;
  /** 출결이 저장되는 반(= 수강 반). 배치가 바뀌어도 이 값은 안 바뀐다. */
  homeClassId: string;
  /** 지금 **화면에서 서 있는** 묶음 — 같은 묶음에 도로 놓는 것은 아무 일도 아니다. */
  sectionClassId: string;
  name: string;
  meta: string;
};

/**
 * 랩실 출석부 — 이름 카드에 출결만. JJ 전용 칸은 여기에 넣지 않는다.
 *
 * 🔴 **드래그로 옮기는 것은 '자리'이지 출결 귀속이 아니다**(원장 2026-09-10) — 카드가 어느 반 묶음에
 *    놓이는지만 바뀌고, 저장은 언제나 `s.homeClassId`(= 그 학생의 수강 반)로 나간다. 자세한 근거는
 *    [`placement.ts`](src/features/attendance/seat/placement.ts) 머리 주석.
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
  pending,
  canMove,
  onMove,
  onResetClass,
  resetCounts,
}: {
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
  /** 드래그로 자리를 옮길 수 있나 — 로그인 + 쓰기 가능 + 0254a 적용됨. */
  canMove: boolean;
  onMove: (studentId: string, toClassId: string) => void;
  onResetClass: (classId: string) => void;
  /** 반 묶음 id → 그 묶음으로 옮겨 온 학생 수. 0(키 없음)이면 [초기화]를 세우지 않는다. */
  resetCounts: Readonly<Record<string, number>>;
}) {
  const [drag, setDrag] = useState<CardDrag | null>(null);
  // 🔑 문턱 = 순수 함수와 **같은 상수**. 이보다 덜 움직이면 드래그가 시작조차 안 하고 클릭(출결)이 나간다.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: SEAT_DRAG_THRESHOLD_PX } }),
  );

  const body = (
    <div
      className="contents"
      onPointerDownCapture={seatPointerDown}
      onPointerUpCapture={seatPointerUp}
      onClickCapture={swallowSeatClickAfterDrag}
    >
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
          pending={pending}
          canMove={canMove}
          onResetClass={onResetClass}
          resetCount={resetCounts[r.classId] ?? 0}
        />
      ))}
    </div>
  );

  if (!canMove) return body;

  return (
    <DndContext
      id="seat-lab-grid"
      sensors={sensors}
      onDragStart={(e: DragStartEvent) => {
        beginSeatDrag();
        setDrag((e.active.data.current as CardDrag | undefined) ?? null);
      }}
      onDragCancel={() => {
        endSeatDrag();
        setDrag(null);
      }}
      onDragEnd={(e: DragEndEvent) => {
        endSeatDrag();
        const card = e.active.data.current as CardDrag | undefined;
        const to = e.over?.data.current as { classId?: string } | undefined;
        setDrag(null);
        // 🔴 집는 순간의 스냅샷이 비면 아무것도 하지 않는다([[#129]]: 끌던 줄이 언마운트되면 data가 빈다).
        if (!card || !to?.classId) return;
        // 🔵 있던 묶음에 도로 놓기 = 아무 일도 아니다 — 서버에 보내면 바뀐 것 없는 감사로그가 남는다.
        if (to.classId === card.sectionClassId) return;
        // 제 반(수강 반)으로 도로 놓기 = 그 학생만 초기화. 서버가 같은 판정을 하고 줄을 지운다.
        onMove(card.studentId, to.classId);
      }}
    >
      {body}
      <DragOverlay dropAnimation={null}>
        {drag ? (
          <div className="bg-card border-primary text-foreground pointer-events-none rounded-xl border-2 px-2.5 py-2 text-left shadow-lg">
            <span className="block leading-none font-bold">{drag.name}</span>
            <span className="text-text-dim text-xs">{drag.meta || " "}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** 반 묶음 한 덩어리 — 드롭 대상이자 초기화 단위. */
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
  pending,
  canMove,
  onResetClass,
  resetCount,
}: {
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
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `seat-drop:${r.classId}`,
    data: { classId: r.classId },
    disabled: !canMove,
  });
  const left = r.students.filter((s) => statusOf(s.homeClassId, s) === null).length;
  /**
   * 반 이름 알약 — **반이 들고 있는 색**(`classes.bg_color`)이 있을 때만 칠한다(원장 2026-09-10).
   * 🔴 색이 없으면 지금 모습 그대로다(지어낸 색 금지). 🔴 **의미색(출결 초록·앰버·빨강)과 다투지 않게
   *    이름 알약에만** 두른다 — 학생 카드 배경을 칠하면 출결 상태가 안 읽힌다.
   * ⚠️ `text_color`가 비어 있으면 본문 글자색(#121212)으로 — 시간표 카드 헤더와 같은 폴백이다.
   */
  const namePill = r.bgColor
    ? { background: r.bgColor, color: r.textColor ?? "#121212" }
    : undefined;

  return (
    <section
      ref={setNodeRef}
      className={`overflow-hidden rounded-2xl border ${isOver ? "border-primary bg-primary-soft/40" : "border-line"}`}
    >
      <header className="bg-bg-soft border-line flex items-center gap-2 border-b px-3 py-1.5 text-sm">
        <span
          className={`font-bold ${namePill ? "rounded-md px-2 py-0.5" : ""}`}
          style={namePill}
        >
          {r.className}
        </span>
        <span className="text-text-faint text-xs tabular-nums">{r.students.length}명</span>
        <span className="text-text-faint text-xs tabular-nums">~{r.end}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {/* 🔴 되돌릴 것이 있을 때만 선다 — 0건인데 [초기화]가 서 있으면 "뭔가 꼬였나" 싶어 누르게 된다. */}
          {canMove && resetCount > 0 ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => onResetClass(r.classId)}
              title="이 반으로 끌어다 놓은 학생을 원래 반으로 되돌립니다 — 출결 기록은 그대로입니다"
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
            sectionClassId={r.classId}
            statusOf={statusOf}
            noteOf={noteOf}
            onSave={onSave}
            onSaveNote={onSaveNote}
            showReason={showReason}
            hints={hints}
            readOnly={readOnly}
            pending={pending}
            canMove={canMove}
          />
        ))}
      </ul>
    </section>
  );
}

function SeatCard({
  student: s,
  sectionClassId,
  statusOf,
  noteOf,
  onSave,
  onSaveNote,
  showReason,
  hints,
  readOnly,
  pending,
  canMove,
}: {
  student: PlacedStudent<SeatStudent>;
  /** 이 카드가 지금 서 있는 묶음 — 드래그 no-op 판정에만 쓴다(저장 축은 `homeClassId`). */
  sectionClassId: string;
  statusOf: (classId: string, student: SeatClassRoster["students"][number]) => SeatStatus | null;
  noteOf: (classId: string, student: SeatClassRoster["students"][number]) => string | null;
  onSave: (classId: string, studentId: string, next: SeatStatus | null, prev: SeatStatus | null) => void;
  onSaveNote: (classId: string, studentId: string, note: string, status: SeatStatus | null) => void;
  showReason: boolean;
  hints: SeatPeriodHintData;
  readOnly: boolean;
  pending: boolean;
  canMove: boolean;
}) {
  const meta = schoolGradeLabel(s.school, s.grade);
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `seat-card:${s.homeClassId}:${s.id}`,
    data: {
      studentId: s.id,
      homeClassId: s.homeClassId,
      sectionClassId,
      name: s.name,
      meta,
    } satisfies CardDrag,
    disabled: !canMove,
  });
  // 🔴 저장·상태 조회는 **원래 반**으로 — 놓인 묶음이 아니다(머리 주석).
  const cur = statusOf(s.homeClassId, s);
  // 긴 이름(동명이인 알파벳 접미사)은 잘라내지 않고 그 칩만 글씨를 줄인다.
  const fit = fitSeatName(s.name, SEAT_CHIP_NAME_LADDER);
  // 사유 메모는 카드 전체의 툴팁이다(원장 2026-08-28 "마우스 오버시 결석사유") — 카드 안
  // 어디에 올려도 뜨도록 <li>에 단다. 자기 title을 가진 자식(잘린 이름)만 자기 것을 띄운다.
  const noteTitle = seatNoteTitle(cur, s.note);

  // ⚠️ 카드에 `touch-none`을 걸지 않는다 — dnd-kit 권장이지만 이 화면은 카드가 격자를 가득 채워서
  //    손가락으로 목록을 굴릴 자리가 카드밖에 없다(자리 태블릿에서 스크롤이 통째로 죽는다). 터치에서
  //    드래그가 잘 안 걸리는 쪽을 택한다 — 자리 옮기기는 데스크의 편의 기능이고, 출결은 그대로 된다.
  return (
    <li className={`relative ${isDragging ? "opacity-40" : ""}`} title={noteTitle ?? undefined}>
      <button
        type="button"
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        disabled={readOnly || pending}
        onClick={() => onSave(s.homeClassId, s.id, cur === "present" ? null : "present", cur)}
        className={`@container border-line flex h-full min-h-[54px] w-full flex-col items-start rounded-xl border px-2.5 py-2 text-left transition disabled:cursor-default ${
          cur ? SEAT_TONE[cur] : "bg-card border-dashed"
        }`}
      >
        {/* `pr-5` = 오른쪽 위 상태 배지·'결' 버튼 자리를 비워 둔다(안 비우면 긴 이름이
            배지 밑으로 들어간다). 글자는 칩 폭에 비례(name-fit.ts `fluidNameFontSize`, 원장 2026-09-04
            "출결에도 이름 꽉 차게") — 배지 자리를 뺀 폭만 쓴다(`LAB_CHIP_NAME_FILL`). 하한에서도 넘칠 때만
            말줄임 + 전체 이름 툴팁. 버튼은 `h-full` — 격자 한 줄 안에서 이름이 상한(24px)에 닿은 칩과
            긴 이름이라 작아진 칩의 높이가 갈리지 않게(li가 줄 높이로 늘고 버튼이 그걸 채운다). */}
        <span
          className="w-full truncate pr-5 leading-none font-bold"
          style={{
            fontSize: fluidNameFontSize(s.name, {
              minPx: NAME_FILL_MIN_PX.labChip,
              maxPx: NAME_FILL_MAX_PX,
              fill: LAB_CHIP_NAME_FILL,
            }),
          }}
          // 이름이 잘린 칩에서는 이름 툴팁이 <li>의 사유를 가린다 → 둘을 이어 붙인다.
          title={fit.clipped ? (noteTitle ? `${s.name} · ${noteTitle}` : s.name) : (noteTitle ?? undefined)}
        >
          {s.name}
        </span>
        <span className="text-xs opacity-80">{meta || " "}</span>
      </button>
      {cur ? (
        <span className="pointer-events-none absolute top-1.5 right-2 text-xs font-extrabold">
          {SEAT_LABEL[cur]}
        </span>
      ) : null}
      {!readOnly ? (
        <span className="absolute top-1.5 right-1.5 flex items-center gap-1">
          <SeatMarkButtons
            cur={cur}
            studentName={s.name}
            pending={pending}
            compact
            onMark={(next) => onSave(s.homeClassId, s.id, next, cur)}
          />
        </span>
      ) : null}
      {/* 옮겨 온 카드는 **어디서 왔는지 적는다** — 출결은 원래 반으로 가므로, 안 적으면 화면이
          "이 반 학생"이라는 거짓말을 한다. */}
      {s.movedFromClassId ? (
        <span
          className="border-line bg-bg-soft text-text-dim pointer-events-none absolute bottom-1 left-1.5 rounded border px-1 text-xs font-semibold"
          title="드래그로 옮겨 온 자리입니다 — 출결은 원래 반으로 기록됩니다"
        >
          자리 이동
        </span>
      ) : null}
      {/* 결석·지각이면 그 자리에서 사유를 적는다(원장 2026-09-08) — 아직 안 찍힌 칸엔
          **지난 결석**을 대신 적어 "왜 안 왔었는지"를 묻지 않고도 알 수 있게 한다. */}
      <div className="mt-1 px-0.5">
        {showReason ? (
          <SeatReasonInput
            value={noteOf(s.homeClassId, s)}
            status={cur}
            studentName={s.name}
            disabled={readOnly || pending}
            onChange={(next) => onSaveNote(s.homeClassId, s.id, next, cur)}
          />
        ) : null}
        <PrevAbsenceHint prev={s.prevAbsence} cur={cur} />
        {/* 같은 날 교시 사이 신호 — 앞 교시 결석 · 다음 교시(표시 전용, JJ실과 같은 부품). */}
        <SeatPeriodHints
          prevAbsentStart={hints.prevAbsentByCell?.[seatCellKey(s.homeClassId, s.id)]}
          nextStart={hints.nextStartByStudent?.[s.id]}
          seatName={hints.seatName}
          cur={cur}
        />
      </div>
    </li>
  );
}
