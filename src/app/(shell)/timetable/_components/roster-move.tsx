"use client";

import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";

import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { endSingleEnrollment, holdSingleEnrollment } from "@/features/students/server/actions";
import {
  noteDragPointerDown,
  noteDragPointerUp,
  setTimetableDragging,
  swallowClickAfterDrag,
  swallowDoubleClickAfterDrag,
} from "./drag-flag";

/**
 * 통합뷰 명단 이동 — 학생 줄을 **대기/퇴원 칸으로 끌어다 놓는다**(원장 2026-09-07).
 *
 * *"학생을 드래그해서 대기/퇴원으로 이동할 수 있도록 만들것. 퇴원으로 이동시 다시 알림이 뜨도록하고 해당
 *  과목에서 수강종료 시킬것"* → *"오늘 날자가 아니라 날짜를 지정할 수 있게(디폴트를 오늘날짜)"* →
 * *"대기도 마찬가지"* → *"통합뷰에서만"*.
 *
 * 🔴 **저장 경로를 새로 만들지 않는다** — 퇴원 = `endSingleEnrollment`(반 상세·학생 상세와 같은 액션,
 *    종료 규약은 `endEnrollmentById` 단일 소스), 대기 = `holdSingleEnrollment`. 화면이 게이트가 아니므로
 *    두 액션 모두 서버에서 `canManageStudentRecords`(students full)로 한 번 더 막는다(#77).
 * 🔴 **떨어뜨리는 것만으로 바뀌지 않는다** — 되돌리기 어려운 변경이라 확인 팝업을 한 번 거친다(기본뷰
 *    Delete=수강 종료와 같은 규약).
 * 🔴 드롭은 **같은 반 안에서만** 받는다 — 남의 반 대기 칸에 떨어뜨리는 것은 '반 이동'이라 다른 동작이고,
 *    통합뷰엔 그 판정(학생·강사·강의실 충돌)이 없다.
 * ⚠️ DndContext는 zoom 래퍼 **바깥**에 있다 — 안쪽이면 `position:fixed`인 DragOverlay가 zoom 좌표계로
 *    들어가 커서와 어긋난다([[#98]], 기본뷰와 같은 배치).
 */

export type RosterDragData = {
  enrollmentId: string;
  studentId?: string;
  classId: string;
  className: string;
  name: string;
  meta: string;
  tone: string;
  /** 지금 어느 칸에 있나 — 같은 칸에 다시 놓는 것은 아무 일도 아니다(팝업조차 뜨면 안 된다). */
  from: "active" | "hold";
};

export type RosterDropKind = "hold" | "withdrawn";

/** 드롭 칸 id — `classId`를 담아 **같은 반인지**를 놓는 순간 판정한다. */
export function rosterDropId(classId: string, kind: RosterDropKind): string {
  return `roster-drop:${classId}:${kind}`;
}

function parseDropId(id: string): { classId: string; kind: RosterDropKind } | null {
  const m = /^roster-drop:(.+):(hold|withdrawn)$/.exec(id);
  return m ? { classId: m[1]!, kind: m[2] as RosterDropKind } : null;
}

/**
 * 이 화면에서 명단을 옮길 수 있나 + 오늘 날짜.
 * 🔴 값은 **드래그 중에 안 바뀐다**(권한·날짜뿐) — 끄는 상태를 여기 넣으면 집는 순간 카드 전부가 다시
 *    그려진다(기본뷰에서 실제로 났던 픽업 렉. `drag-flag.ts` 주석).
 */
const RosterMoveContext = createContext<{ enabled: boolean; today: string }>({
  enabled: false,
  today: "",
});

export function useRosterMove() {
  return useContext(RosterMoveContext);
}

/**
 * 충돌 판정 = **포인터가 들어간 칸**이 우선(사각형 겹침이 아니라). 명단 칸은 한 줄(32px)까지 얇아질 수 있어
 * 끌고 있는 줄의 사각형으로 재면 위아래 칸과 함께 걸치거나 아예 안 걸린다 — 손끝이 어디에 있는지가 뜻이다.
 * ⚠️ 포인터가 어느 칸에도 안 들어간 순간(칸 사이 경계)엔 사각형 겹침으로 물러선다(놓을 곳을 아예 못 찾는 것보다 낫다).
 */
const collisionDetection: CollisionDetection = (args) => {
  const hit = pointerWithin(args);
  return hit.length > 0 ? hit : rectIntersection(args);
};

export function RosterMoveArea({
  canEdit,
  today,
  children,
}: {
  canEdit: boolean;
  today: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [drag, setDrag] = useState<RosterDragData | null>(null);
  const [pending, setPending] = useState<(RosterDragData & { kind: RosterDropKind }) | null>(null);
  // 집는 순간의 drag data 스냅샷 — 끌던 줄이 언마운트되면 dnd-kit `active.data`가 빈 객체가 된다(timetable-board와
  // 같은 안전망, drag-flag.ts `holdArmedRow` 주석).
  const dragRef = useRef<RosterDragData | null>(null);
  // 5px 넘게 끌어야 드래그 — 그래야 줄의 더블클릭(학생 정보)이 그대로 산다([[#97]]와 같은 규약).
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const value = useMemo(() => ({ enabled: canEdit, today }), [canEdit, today]);

  const onDragEnd = useCallback((e: DragEndEvent) => {
    setTimetableDragging(false);
    setDrag(null);
    const data = dragRef.current ?? (e.active.data.current as RosterDragData | undefined);
    dragRef.current = null;
    const target = e.over ? parseDropId(String(e.over.id)) : null;
    if (!data || !target) return;
    // 남의 반 칸 = 반 이동이라 여기서 처리하지 않는다(조용히 무시 — 화면은 제자리로 돌아간다).
    if (target.classId !== data.classId) return;
    // 제자리(대기 → 대기) — 바뀌는 게 없으니 확인 팝업도 띄우지 않는다.
    if (target.kind === "hold" && data.from === "hold") return;
    setPending({ ...data, kind: target.kind });
  }, []);

  if (!canEdit) return <>{children}</>;

  return (
    <RosterMoveContext.Provider value={value}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={(e) => {
          setTimetableDragging(true);
          const d = (e.active.data.current as RosterDragData | undefined) ?? null;
          dragRef.current = d;
          setDrag(d);
        }}
        onDragCancel={() => {
          dragRef.current = null;
          setTimetableDragging(false);
          setDrag(null);
        }}
        onDragEnd={onDragEnd}
      >
        {/* 드래그 직후의 더블클릭은 창 열기가 아니다 — 캡처에서 삼킨다(drag-flag.ts, 기본뷰 DnD 영역과 같은 규약). */}
        <div
          className="contents"
          onDoubleClickCapture={swallowDoubleClickAfterDrag}
          // 기본뷰와 **같은 규약** — 제자리 드롭이 클릭으로 새어 더블클릭이 되는 것을 막는다.
          onClickCapture={swallowClickAfterDrag}
          onPointerDownCapture={noteDragPointerDown}
          onPointerUpCapture={noteDragPointerUp}
        >
          {children}
        </div>
        {/* 고스트는 **원본 그대로**(이름/학교학년 + 같은 tone) — 파일 이동처럼 조금 연하게. */}
        <DragOverlay dropAnimation={null}>
          {drag ? (
            <div className={`shadow-card rounded px-2 py-[3px] text-sm leading-tight opacity-80 ${drag.tone}`}>
              {drag.name}
              {drag.meta ? <span className="text-xs opacity-90">/{drag.meta}</span> : null}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {pending ? (
        <RosterMoveDialog
          target={pending}
          today={today}
          onClose={(changed) => {
            setPending(null);
            if (changed) router.refresh();
          }}
        />
      ) : null}
    </RosterMoveContext.Provider>
  );
}

/**
 * 확인 팝업 — 날짜를 고른다(기본 오늘).
 * 🔴 퇴원과 대기의 날짜는 **무게가 다르다**: 퇴원은 `end_date`로 저장돼 그날부터 명단에서 내려가지만,
 *    대기는 담을 칸이 없어(스키마) 저장 즉시 대기가 되고 날짜는 감사로그에 남는다. 미래 날짜를 고르면
 *    그 사실을 팝업이 그대로 말한다 — 조용히 다른 일을 하지 않는다.
 */
function RosterMoveDialog({
  target,
  today,
  onClose,
}: {
  target: RosterDragData & { kind: RosterDropKind };
  today: string;
  onClose: (changed: boolean) => void;
}) {
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isWithdraw = target.kind === "withdrawn";
  const futureHold = !isWithdraw && date > today;

  async function submit() {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("enrollmentId", target.enrollmentId);
    if (target.studentId) fd.set("studentId", target.studentId);
    fd.set("date", date);
    const res = isWithdraw
      ? await endSingleEnrollment(undefined, fd)
      : await holdSingleEnrollment(undefined, fd);
    setBusy(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    onClose(true);
  }

  return (
    <div
      className="bg-ink/30 fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={isWithdraw ? "수강 종료 확인" : "대기 전환 확인"}
      onClick={() => (busy ? null : onClose(false))}
    >
      <div
        className="bg-card shadow-modal w-full max-w-sm rounded-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-foreground text-base font-bold">{isWithdraw ? "수강 종료" : "대기 전환"}</p>
        <p className="text-text-dim mt-2 text-sm">
          <b className="text-foreground">{target.name}</b> 학생을{" "}
          <b className="text-foreground">{target.className}</b>
          {isWithdraw ? " 반에서 수강 종료할까요?" : " 반 대기로 옮길까요?"}
        </p>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <span className="text-text-dim shrink-0">{isWithdraw ? "종료일" : "대기 시작일"}</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={`border-line bg-card text-foreground rounded-lg border px-2 ${CONTROL_H} ${CONTROL_LABEL}`}
          />
        </label>
        {futureHold ? (
          <p className="text-amber mt-2 text-xs">
            대기는 시작일을 담는 칸이 없어 <b>저장하면 바로</b> 대기로 바뀝니다(고른 날짜는 기록으로 남습니다).
          </p>
        ) : null}
        {error ? <p className="text-danger mt-2 text-xs">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onClose(false)}
            disabled={busy}
            className={`border-line text-text-dim hover:bg-bg-soft inline-flex items-center rounded-lg border px-3 font-bold ${CONTROL_H} ${CONTROL_LABEL}`}
          >
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !date}
            autoFocus
            className={`${CONTROL_H} ${CONTROL_LABEL} inline-flex items-center gap-1.5 rounded-lg px-3 font-bold text-white disabled:opacity-60 ${
              isWithdraw ? "bg-danger" : "bg-primary"
            }`}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {isWithdraw ? "수강 종료" : "대기로 옮기기"}
          </button>
        </div>
      </div>
    </div>
  );
}
