"use client";

import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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

import { Loader2 } from "@/components/icons/aywa-icon-compat";
import { endSingleEnrollment, holdSingleEnrollment } from "@/features/students/server/actions";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";
import { ReasonFields } from "@/features/withdrawals/reason-fields";
import { SPLIT_X_ATTR } from "@/features/timetable-memo/ui/split-panes";

/**
 * 드래그 자동 스크롤 — 시간표 | 메모 시트 두 칸의 **바깥 가로 상자는 굴리지 않는다**(split-panes.tsx).
 * 굴리면 오른쪽 가장자리로 학생을 끌 때 화면이 시트 쪽으로 미끄러져 놓을 반이 사라진다. 시간표 판의 세로·줄의 가로는 그대로.
 */
const AUTO_SCROLL = { canScroll: (el: Element) => !el.hasAttribute(SPLIT_X_ATTR) };
import type { StudentBusyWindow } from "@/features/timetable/lib/student-busy";
import {
  noteDragPointerDown,
  noteDragPointerUp,
  setTimetableDragging,
  swallowClickAfterDrag,
  swallowDoubleClickAfterDrag,
  useSmallScreen,
} from "./drag-flag";
import { useTimetableEdit } from "./edit-context";
import { EndScopeNote } from "./end-scope-note";
import { annotateStudentBlocks, clearDropCells } from "./grid-drop-cell";
import { refuse } from "./move-toast";

/**
 * 통합뷰 명단 드래그 — **대기/퇴원 칸**(2026-09-07)과 **다른 반의 재원 칸**(2026-09-09)을 함께 받는다.
 *
 * 2026-09-07 원장: *"학생을 드래그해서 대기/퇴원으로 이동할 수 있도록 만들것. 퇴원으로 이동시 다시 알림이
 *  뜨도록하고 해당 과목에서 수강종료 시킬것"* → *"오늘 날자가 아니라 날짜를 지정할 수 있게(디폴트를
 *  오늘날짜)"* → *"대기도 마찬가지"* → *"통합뷰에서만"*.
 * 2026-09-09 원장: *"드래그만 되고 적용이 안되네. 통합뷰에서도 학생 드래그 기능 추가시켜"* → (무엇을?)
 *  *"드래그 이동"* — 즉 **반과 반 사이 이동**. 종전엔 드롭 대상이 대기·퇴원 둘뿐이라 한 반 **안**에서만
 *  움직였다.
 *
 * 🔴 **저장 경로를 새로 만들지 않는다** — 퇴원 = `endSingleEnrollment`, 대기 = `holdSingleEnrollment`,
 *    **반 이동 = 기본뷰와 같은 큐**(`useTimetableEdit().openMoveDate` → `queueMove` → 저장에서
 *    `moveEnrollmentsBatch`). 두 벌이 되면 한쪽만 고쳐진다.
 * 🔴 **떨어뜨리는 것만으로 바뀌지 않는다** — 대기·퇴원은 확인 팝업, 반 이동은 **적용일 팝업**을 거친다
 *    (원장 2026-09-09 *"드랍을 하면 날짜지정 팝업"*).
 * 🔴 **축이 둘이라 권한도 둘이다** — 대기·퇴원은 학생 기록 변경(students full, `canEdit` prop),
 *    반 이동은 시간표 편집(classes manage, `useTimetableEdit().canDrag`). 한쪽만 있어도 그쪽은 된다.
 * 🔴 **다른 반의 대기·퇴원 칸은 받지 않는다** — "남의 반 대기로 보내기"는 지금 어떤 저장 경로도 없다.
 *    조용히 무시하지 않고 **왜 안 되는지 말한다**(거절인지 고장인지 구분되게).
 * 🔴 못 가는 반은 기본뷰와 **같은 기계**로 미리 막는다 — 집는 순간 그 학생의 다른 과목 일정을 받아
 *    (`/api/timetable/student-busy`) `annotateStudentBlocks`가 반 카드에 빗금을 친다.
 *    ⚠️ **서버 액션이 아니라 라우트 핸들러**여야 한다([[#102]]) — 서버 액션 응답은 현재 라우트의 RSC
 *       트리를 다시 적용해서, 드래그 도중이면 끌던 줄이 언마운트되고 드래그가 통째로 죽는다.
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
  /** 이 학생의 등원 요일(분리등원, 비면 전 요일) — 반 이동 시 출발 요일(no-op 판정·요일 승계). */
  attendanceDays?: string[];
  /** 지금 어느 칸에 있나 — 같은 칸에 다시 놓는 것은 아무 일도 아니다(팝업조차 뜨면 안 된다). */
  from: "active" | "hold";
};

/** 재원 칸은 **다른 반에서 오는 학생**을 받는다(반 이동). 대기·퇴원은 같은 반 안의 상태 변경. */
export type RosterDropKind = "active" | "hold" | "withdrawn";

/** 드롭 칸 id — dnd-kit 안에서 유일하기만 하면 된다(판정은 `data`로 한다, id 파싱 금지). */
export function rosterDropId(classId: string, kind: RosterDropKind): string {
  return `roster-drop:${classId}:${kind}`;
}

/**
 * 드롭 칸이 싣는 것 — **id를 쪼개지 말 것**(기본뷰 드롭존과 같은 규약: 반 이름이 필요한데 id엔 없다).
 */
export type RosterDropData = { classId: string; className: string; kind: RosterDropKind };

/**
 * 이 화면에서 명단을 옮길 수 있나 + 오늘 날짜.
 * 🔴 값은 **드래그 중에 안 바뀐다**(권한·날짜뿐) — 끄는 상태를 여기 넣으면 집는 순간 카드 전부가 다시
 *    그려진다(기본뷰에서 실제로 났던 픽업 렉. `drag-flag.ts` 주석).
 */
const RosterMoveContext = createContext<{ enabled: boolean; canMoveClass: boolean; today: string }>({
  enabled: false,
  canMoveClass: false,
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
  /** 학생 기록을 바꿀 수 있나(students full) — **대기·퇴원** 축의 문. */
  canEdit: boolean;
  today: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  // 🔴 **반 이동 축**은 시간표 편집 권한(classes manage)이고 큐도 기본뷰와 공유한다 — 저장 경로를 두 벌로
  //    만들지 않는다. `canDrag`는 권한 + 이번/미래 주라서 과거 주에선 이 축이 통째로 닫힌다(#77).
  const { canDrag, openMoveDate, dateFloor } = useTimetableEdit();
  const [drag, setDrag] = useState<RosterDragData | null>(null);
  const [pending, setPending] = useState<(RosterDragData & { kind: RosterDropKind }) | null>(null);
  // 집는 순간의 drag data 스냅샷 — 끌던 줄이 언마운트되면 dnd-kit `active.data`가 빈 객체가 된다(timetable-board와
  // 같은 안전망, drag-flag.ts `holdArmedRow` 주석).
  const dragRef = useRef<RosterDragData | null>(null);
  /**
   * 지금 끌고 있는 학생이 **못 가는 반** → 이유(기본뷰와 같은 맵·같은 문구).
   * 🔴 화면(빗금)과 드롭 거절이 **같은 맵**을 읽는다 — 갈리면 "빗금인데 들어가네"가 된다.
   * 🔴 비어 있는 것이 정상 상태다(fail-open) — 조회가 늦거나 실패하면 아무것도 안 막는다(표식은 게이트가 아니다).
   */
  const blockRef = useRef<Map<string, string>>(new Map());
  // 5px 넘게 끌어야 드래그 — 그래야 줄의 더블클릭(학생 정보)이 그대로 산다([[#97]]와 같은 규약).
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  // 🔴 폰(≤640px)에선 **두 축 모두** 닫는다(원장 2026-09-12 *"작은 모바일화면에서는 시간표상의 드래그를
  //    원천봉쇄시켜"*). `canDrag`는 이미 작은 화면에서 false지만, 대기·퇴원 축(`enabled`)은 학생 기록 권한이라
  //    따로 열려 있어 명단 줄이 여전히 집혔다 — 한쪽만 막으면 봉쇄가 아니다.
  const smallScreen = useSmallScreen();
  const value = useMemo(
    () => ({ enabled: canEdit && !smallScreen, canMoveClass: canDrag, today }),
    [canEdit, canDrag, smallScreen, today],
  );

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setTimetableDragging(false);
      setDrag(null);
      const data = dragRef.current ?? (e.active.data.current as RosterDragData | undefined);
      dragRef.current = null;
      // 🔴 막힌 반 목록을 **먼저 읽고** 표식을 걷는다 — 순서가 바뀌면 놓는 순간 맵이 비어 빗금이 무의미해진다.
      const blocked = new Map(blockRef.current);
      blockRef.current = new Map();
      clearDropCells(document);
      const target = (e.over?.data.current as RosterDropData | undefined) ?? null;
      if (!data || !target) return; // 아무 데도 아닌 곳 = 취소(사용자가 의도한 무동작이라 말하지 않는다)
      if (target.classId === data.classId) {
        // ── 같은 반 안 ── 재원 칸에 도로 놓은 것은 제자리다(팝업조차 뜨면 안 된다).
        // 🔴 단 **대기 → 재원**은 제자리가 아니라 "여기선 못 한다" — 조용히 삼키면 고장으로 읽힌다
        //    (원장 2026-09-08 *"드랍해도 아무런 반응이 없음"*). 수강 단위 대기 해제는 지금 저장 경로가
        //    학생 상세(재원 복구)뿐이라 그 자리를 알려 준다.
        if (target.kind === "active") {
          if (data.from === "hold")
            refuse(`${data.name} 학생의 대기 해제는 학생 상세에서 합니다 — 여기서는 되돌릴 수 없습니다.`);
          return;
        }
        if (target.kind === "hold" && data.from === "hold") return;
        if (!canEdit) return refuse("학생 기록을 바꿀 권한이 없습니다.");
        setPending({ ...data, kind: target.kind });
        return;
      }
      // ── 다른 반 ── 재원 칸만 '반 이동'이다. 대기·퇴원 칸엔 저장 경로가 없어 **왜 안 되는지 말한다**.
      if (target.kind !== "active")
        return refuse(
          `${target.className} 반의 ${target.kind === "hold" ? "대기" : "퇴원"} 칸으로는 옮길 수 없습니다 — 반을 옮기려면 그 반의 재원 명단에 놓아 주세요.`,
        );
      if (!canDrag) return refuse("반 이동은 시간표 편집 권한이 있어야 합니다(과거 주는 조회 전용).");
      const why = blocked.get(target.classId);
      if (why) return refuse(`${data.name} 학생은 ${target.className} 반으로 옮길 수 없습니다 — ${why}`);
      // 🔴 큐잉은 **적용일 팝업 확인 뒤**(원장 2026-09-09) — 여기서 바로 넣으면 날짜를 물어볼 자리가 없다.
      // ⚠️ 통합뷰 명단 칸엔 요일 축이 없다 → 목적지 등원 요일은 **전 요일**([]). 요일을 나누려면 기본뷰에서.
      openMoveDate({
        enrollmentId: data.enrollmentId,
        fromClassId: data.classId,
        fromClassName: data.className,
        toClassId: target.classId,
        toClassName: target.className,
        name: data.name,
        toDays: [],
        fromDays: data.attendanceDays ?? [],
        // 휴원 중인 수강은 반을 옮겨도 휴원이 승계된다(RPC 0228a) → 도착 반 미리보기는 **대기** 칸에.
        fromHold: data.from === "hold",
      });
    },
    [canEdit, canDrag, openMoveDate],
  );

  /**
   * 집는 순간 그 학생의 **다른 과목 일정**을 받아 못 가는 반에 빗금을 친다(기본뷰와 같은 기계).
   * 🔴 늦게 도착해도 괜찮다 — 도착하면 그때 빗금이 서고, 그 전에 놓으면 종전처럼 서버 규칙만 적용된다.
   *    이미 다른 드래그가 시작됐으면 버린다(응답이 뒤늦게 와서 남의 드래그에 빗금을 치지 않게).
   */
  const loadBlocks = useCallback(
    (d: RosterDragData | null) => {
      blockRef.current = new Map();
      if (!d?.studentId || !dateFloor || !canDrag) return;
      const q = new URLSearchParams({ studentId: d.studentId, week: dateFloor, exclude: d.classId });
      void fetch(`/api/timetable/student-busy?${q.toString()}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<{ windows: StudentBusyWindow[] }>) : { windows: [] }))
        .then(({ windows }) => {
          if (dragRef.current !== d || windows.length === 0) return;
          blockRef.current = annotateStudentBlocks(document, windows);
        })
        .catch(() => {
          /* 표식은 도움이지 게이트가 아니다 — 실패하면 아무것도 안 막는다 */
        });
    },
    [dateFloor, canDrag],
  );

  // 🔴 두 축 중 **하나라도** 열려 있으면 끌 수 있어야 한다 — 종전엔 `canEdit`(학생 기록)만 봐서,
  //    시간표는 편집할 수 있는데 학생 기록 권한이 없는 계정은 반 이동조차 못 했다.
  if (!canEdit && !canDrag) return <>{children}</>;

  return (
    <RosterMoveContext.Provider value={value}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        autoScroll={AUTO_SCROLL}
        onDragStart={(e) => {
          setTimetableDragging(true);
          const d = (e.active.data.current as RosterDragData | undefined) ?? null;
          dragRef.current = d;
          setDrag(d);
          loadBlocks(d);
        }}
        onDragCancel={() => {
          dragRef.current = null;
          blockRef.current = new Map();
          clearDropCells(document);
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
  const formRef = useRef<HTMLFormElement>(null);
  // 퇴원 칸이면 첫 칸(종료 사유)에 바로 초점 — 시간표 Delete 종료 창과 같다.
  useEffect(() => {
    if (isWithdraw) formRef.current?.querySelector<HTMLSelectElement>("select[name=reason]")?.focus();
  }, [isWithdraw]);
  const futureHold = !isWithdraw && date > today;

  /** 퇴원 칸이면 창의 사유 칸(대분류 · 세부 · 메모)도 함께 — 서버가 같은 규칙으로 다시 본다(`readReasonForm`). */
  async function submit(form: HTMLFormElement) {
    setBusy(true);
    setError(null);
    const fd = new FormData(form);
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
    notifyTermPlansChanged();
    onClose(true);
  }

  return (
    <div
      className="bg-ink/30 fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={isWithdraw ? "마지막 수업일 확인" : "대기 전환 확인"}
      onClick={() => (busy ? null : onClose(false))}
    >
      <form
        ref={formRef}
        className="bg-card shadow-modal max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-xl p-5"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && date) void submit(e.currentTarget);
        }}
      >
        {/* 🔴 퇴원 칸 드롭은 '수강 종료'라 부르지 않는다 — 퇴원관리 유형(한 과목만 끝난 재원생)과
            같은 글자라 고른 날짜가 그 유형인 것처럼 읽힌다. 여기는 그 반의 마지막 수업일이다. */}
        <p className="text-foreground text-base font-bold">{isWithdraw ? "마지막 수업일" : "대기 전환"}</p>
        <p className="text-text-dim mt-2 text-sm">
          {isWithdraw ? (
            <>
              <b className="text-foreground">{target.name}</b> 학생의{" "}
              <b className="text-foreground">{target.className}</b> 반 마지막 수업일을 정할까요?
            </>
          ) : (
            <>
              <b className="text-foreground">{target.name}</b> 학생을{" "}
              <b className="text-foreground">{target.className}</b> 반 대기로 옮길까요?
            </>
          )}
        </p>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <span className="text-text-dim shrink-0">{isWithdraw ? "마지막 수업일" : "대기 시작일"}</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={`border-line bg-card text-foreground rounded-lg border px-2 ${CONTROL_H} ${CONTROL_LABEL}`}
          />
        </label>
        {/* '퇴원 칸'에 놓았어도 실제로는 이 반 수강만 끝난다 — 무엇이 되는지(종강·과목 수강종료·퇴원)를 사실대로. */}
        {isWithdraw ? <EndScopeNote enrollmentId={target.enrollmentId} date={date} /> : null}
        {/* 사유를 고른다(원장 2026-10-15 *"기타는 모든 곳을 일치하게"*) — 상태 전환 창과 같은 칸. 대기 칸은 사유가 없다. */}
        {isWithdraw ? (
          <div className="mt-3 space-y-2">
            <ReasonFields
              reasonLabel="종료 사유"
              initialReason={null}
              memoPlaceholder="배경 정보 (선택)"
              labelClassName="text-foreground block text-sm font-medium"
              controlClassName={`border-line bg-card text-foreground w-full rounded-lg border px-2 py-1.5 ${CONTROL_LABEL}`}
              idPrefix="roster-end"
            />
          </div>
        ) : null}
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
            type="submit"
            disabled={busy || !date}
            autoFocus={!isWithdraw}
            className={`${CONTROL_H} ${CONTROL_LABEL} inline-flex items-center gap-1.5 rounded-lg px-3 font-bold text-white disabled:opacity-60 ${
              isWithdraw ? "bg-danger" : "bg-primary"
            }`}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {isWithdraw ? "확인" : "대기로 옮기기"}
          </button>
        </div>
      </form>
    </div>
  );
}
