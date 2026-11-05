"use client";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF } from "@/components/toolbar-controls";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  type DragStartEvent,
} from "@dnd-kit/core";
import { Check, Loader2, Pencil, X } from "@/components/icons/aywa-icon-compat";
import type { CSSProperties } from "react";
import {
  moveEnrollmentsBatch,
  updateEnrollmentsAttendanceBatch,
} from "@/features/enrollments/server/actions";
import { endSingleEnrollment } from "@/features/students/server/actions";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";
import { EndScopeNote } from "./end-scope-note";
import { compressMoves, type PendingMove } from "@/features/timetable/lib/move-compress";
import {
  freezeMoveDate,
  isScheduledMove,
  resolveApplyDate,
  shortMoveDate,
} from "@/features/timetable/lib/move-date";
import { resolveDropTarget, shouldOpenClassPick, type HapbanMemberClass } from "@/features/timetable/lib/hapban";
import { DAY_LABEL, sameDaySet, zoneAttendanceDays } from "@/features/timetable/lib/split-attendance";
import {
  TimetableEditContext,
  useTimetableEdit,
  type ClassPickCandidate,
  type ClassPickTarget,
  type DayEditTarget,
  type MoveDateTarget,
  type WholeSplitTarget,
  type QueuedClassMove,
  type HoveredStudent,
  type IncomingStudent,
  type PendingTarget,
} from "./edit-context";
import {
  noteDragPointerDown,
  noteDragPointerUp,
  setTimetableDragging,
  swallowClickAfterDrag,
  swallowDoubleClickAfterDrag,
  type ClassDragInfo,
  useSmallScreen,
} from "./drag-flag";
import { SAME_SPOT_TITLE, annotateDropCells, annotateStudentBlocks, clearDropCells, markHotCells, placementAt } from "./grid-drop-cell";
import type { StudentBusyWindow } from "@/features/timetable/lib/student-busy";
// 칸 좌표 속성 이름은 **일반 모듈**에서 — 클라 모듈 재-export를 두면 서버 파일이 실수로 그걸 집어
// 런타임 undefined가 된다([[#81]], 실제로 한 번 그렇게 깨졌다).
import { CELL_DAY_ATTR, CELL_OK_ATTR, CLASS_CELL_ID_ATTR, CLASS_CELL_NAME_ATTR } from "@/features/timetable/lib/grid-attrs";
import { toast } from "sonner";
// 🔴 거절·큐잉 문구는 **통합뷰와 공유**한다(move-toast.ts) — 뷰마다 만들면 같은 거절이 다르게 들린다.
import { queued, refuse } from "./move-toast";
import { ClassSplitDialog } from "./class-split-dialog";
import { DropModeTabs } from "./drop-mode-tabs";
import { useClassMoveIndex } from "./class-move-context";
import type { MoveSubject } from "@/features/timetable/lib/class-move";
import { moveClassSlots } from "@/features/timetable/server/move-actions";
import { IndexBadge, ROW_CLASS } from "./student-rows";
import { ReasonFields } from "@/features/withdrawals/reason-fields";

type Queued = PendingMove & {
  fromClassName: string;
  toClassName: string;
  name: string;
  /**
   * 큐잉 시점의 적용 **의도** — 저장이 "지금 보는 주"에 묶이지 않게 하는 앵커(F2).
   * `null` = 즉시(이번 주에서 큐잉 — RPC엔 미지정으로 넘겨 current_date 적용).
   * `'YYYY-MM-DD'` = 그 주 예약(미래 주 월요일).
   * ⚠️ 즉시 의도를 절대 날짜로 얼리면 자정을 넘겨 저장할 때 그 날짜가 과거가 돼 서버 소급 가드에
   * 거부된다(적대 리뷰 확정) — 즉시는 날짜가 아니라 null로 남긴다.
   */
  effectiveOn: string | null;
  /** 휴원 중인 수강인가 — 도착 반 미리보기를 대기 칸에 그릴지 가른다(RPC 0228a가 `on_hold`를 승계). */
  fromHold?: boolean;
  /**
   * 이 **한 건**에만 지정된 적용일 — 드롭 날짜 팝업이 채운다(원장 2026-09-09 *"드랍을 하면 날짜지정 팝업"*).
   * `null` = 지정 안 함 → 툴바 '적용일' > 큐 앵커 순으로 따라간다([`resolveApplyDate`](@/features/timetable/lib/move-date)).
   * 🔴 팝업이 **기본값과 같은 날짜**를 돌려주면 여기 안 채운다 — 즉시 의도를 절대 날짜로 얼리면 자정을
   *    넘긴 저장이 서버 소급 가드에 거부된다(위 `effectiveOn` 주석과 같은 함정).
   */
  moveOn: string | null;
};

/** 도착 셀 slot.id → 반 id 매핑용 드롭 대상 data(요일 존/공통 존 공통). */
type DropData = {
  className?: string;
  classId?: string;
  slotId?: string;
  day?: string;
  /** 합반 카드 드롭존에만 실림(구성 반들) — 멤버 드롭=자기 반 요일편집 재해석 + 외부 드롭=반+요일 팝업 후보. */
  memberClasses?: HapbanMemberClass[];
  /** 합반 셀이 덮는 요일(팝업 요일 토글용). */
  coveringDays?: string[];
  /** 합반 드롭존 종류 — segment=반 미리 선택 팝업, roster=본문/요일존(멤버 재해석 대상). */
  hapbanZone?: "segment" | "roster";
};

/**
 * 시간표 편집 상태 provider — 편집 토글·이동 큐·저장/취소·적용일을 소유하고 context로 제공.
 * 편집 컨트롤(TimetableEditControls, 툴바에 인라인)과 드롭영역(TimetableDndArea, 그리드)이
 * 분리돼 같은 상태를 소비한다.
 * - 권한 없음·과거 주: 학생 드래그 비활성(읽기 전용).
 * - 권한 있음: **모드 없이 곧바로** 학생을 다른 반의 요일 존/공통 존으로 드롭 → 델타 버퍼에 누적(DB 미반영).
 *   요일 존=그 요일만 등원(분리등원), 공통 존=전 요일. '저장' 시 compressMoves 후 moveEnrollmentsBatch(단일 RPC)로
 *   커밋한다(원장 2026-09-04 *"편집모드 없이 바로 드래그 … 대신 저장을 눌러야 반영"*).
 */
export function TimetableEditProvider({
  children,
  effectiveDate,
  today,
  canEdit = true,
  canSplit = false,
  canEndEnrollment = false,
  weekMonday,
}: {
  children: ReactNode;
  /**
   * 학생 위 Delete → '수강 종료' 창을 세울 수 있나 — 서버 `endSingleEnrollment`와 **같은 함수**
   * (`canManageStudentStatusNow` = 원생 '전체' + 학생 상태 담당, page.tsx `canEditRoster`).
   * 🔴 시간표 편집(`canEdit` = 반 관리)만 보던 시절엔 원생이 '읽기'인 계정에도 창이 떠서 사유를 다 쓴 뒤에야
   *    저장이 거절됐다(원장 2026-11-05, write-lock.ts). 없으면(기본) 단축키 자체가 꺼진다.
   */
  canEndEnrollment?: boolean;
  /** 수업 나누기 권한(0351a — 원장 역할 또는 학원 설정에서 지정한 사람 + 수업 관리 권한) — 켜지면 드롭 팝업에 '수업 나누기' 쪽이 선다. 게이트는 서버 액션이 다시 본다(#77). */
  canSplit?: boolean;
  /** 보고 있는 주의 월요일 — 나누기 선택지를 그 주 배치로 만든다. */
  weekMonday?: string;
  /** 이동 적용일(YYYY-MM-DD) — 미래 주 편집 시 그 주 월요일. 미지정=오늘 즉시. (Phase B 주간 이동) */
  effectiveDate?: string;
  /** 오늘(KST, YYYY-MM-DD) — 적용일 입력 기본·최소값. */
  today: string;
  /**
   * 이 주가 편집 가능한가(과거 주=false). ⚠️ **파생으로 강제**한다 — 옛 코드는 페이지가 편집 *컨트롤*만
   * 숨기고 provider·DndArea는 항상 마운트했는데, 주 이동이 soft nav라 `editing` state가 리셋되지 않아
   * **과거 주에서 컨트롤이 안 보이는 채 그리드가 계속 편집 가능**했다(드래그·Delete로 실제 수강 종료까지).
   * 화면에서만 잠그는 건 잠근 게 아니다(#77). 2026-07-17 적대 감사 F1.
   */
  canEdit?: boolean;
}) {
  const router = useRouter();
  // 드래그 가능 = 권한 + 이번/미래 주 + **작은 화면이 아님**. 옛 '편집 모드' state는 없앴다(모드 없이 바로 드래그) —
  // 과거 주로 이동하면 이 값이 그대로 false라 Delete 핸들러·드롭·저장이 함께 잠긴다(#77: 게이트는 UI가 아니라 여기).
  // 🔴 폰(≤640px)에선 원천 봉쇄한다(원장 2026-09-12 *"작은 모바일화면에서는 시간표상의 드래그를 원천봉쇄시켜.
  //    오히려 불편함."*) — 여기 한 곳을 끄면 학생 줄·반 블록·드롭존·Delete·큐잉이 함께 닫힌다.
  const smallScreen = useSmallScreen();
  const canDrag = canEdit && !smallScreen;
  const [queue, setQueue] = useState<Queued[]>([]);
  // 반 블록 이동 대기 — slotId당 한 건(같은 배치를 다시 놓으면 마지막 것만 남는다).
  const [classQueue, setClassQueue] = useState<QueuedClassMove[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  // 사용자가 편집 바에서 정한 적용일(예정일). null이면 기본(조회 주 기준 effectiveDate ?? 오늘).
  const [scheduledDate, setScheduledDate] = useState<string | null>(null);
  const dateFloor = effectiveDate ?? today;
  // 이 주에서 큐잉되는 이동의 적용 의도 — 이번 주=null(즉시), 미래 주=그 주 월요일(예약).
  const queueIntent = effectiveDate ?? null;

  // 편집 모드 Delete = 오늘 수강 종료(그 반만). hover는 ref로 추적(hover마다 리렌더 방지), 확인 팝업만 state.
  const hoveredRef = useRef<HoveredStudent | null>(null);
  const setHovered = useCallback((h: HoveredStudent | null) => {
    hoveredRef.current = h;
  }, []);
  const [endTarget, setEndTarget] = useState<HoveredStudent | null>(null);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);

  // 편집 모드에서 학생 클릭 → 같은 반 요일 편집 팝오버. 적용 시 이동 배치(pending)에 같은 반 변경으로 큐잉.
  const [dayEdit, setDayEdit] = useState<DayEditTarget | null>(null);
  const openDayEdit = useCallback((t: DayEditTarget) => setDayEdit(t), []);
  // 합반 드롭 → 반+요일 선택 팝업(외부 학생 어디든 / 멤버의 다른 세그먼트). 선택해야 큐잉, 취소=무효.
  const [classPick, setClassPick] = useState<ClassPickTarget | null>(null);
  const openClassPick = useCallback((t: ClassPickTarget) => setClassPick(t), []);
  /**
   * 드롭 → **날짜 지정 팝업**(원장 2026-09-09 *"드래그를 놓을때 기본뷰건 통합뷰건 날짜를 지정할 수 있게"*).
   * 🔴 확인해야 큐에 들어간다 — 떨어뜨리는 것만으로는 아무 일도 안 일어난다(취소 = 무효).
   * 🔴 기본뷰·통합뷰가 **같은 팝업**을 쓴다(provider가 소유) — 뷰마다 만들면 날짜 규약이 갈린다.
   */
  const [moveDate, setMoveDate] = useState<MoveDateTarget | null>(null);
  // 같은 드롭의 '수업 나누기' 쪽 — 반 이동 팝업과 **같은 대상**을 들고 전환한다(둘 중 하나만 떠 있다).
  const [splitTarget, setSplitTarget] = useState<MoveDateTarget | null>(null);
  // 반 블록 드롭의 '반 전체 나누기' — 반 이동을 고르면 부를 함수(그 칸으로 못 옮기면 null + 사유)를 함께 든다.
  const [wholeSplit, setWholeSplit] = useState<{ t: WholeSplitTarget; onMove: (() => void) | null; moveRefusal: string | null } | null>(null);
  const openWholeSplit = useCallback(
    (t: WholeSplitTarget, onMove: (() => void) | null, moveRefusal: string | null) => setWholeSplit({ t, onMove, moveRefusal }),
    [],
  );

  // 학생 위에 마우스 올린 채 Delete → 오늘 수강 종료 **확인 팝업**. 입력창 타이핑 중엔 무시.
  // ⚠️ 옛 '편집 모드'가 이 단축키의 문이었는데 모드가 사라졌다 — 이제 편집 권한(canDrag)이 곧 문이고,
  //    실제 종료는 팝업에서 한 번 더 확인해야 일어난다(키 하나로 조용히 지워지지 않는다).
  // 🔴 문은 **둘 다**다 — 편집 가능한 주(canDrag)이면서 학생 기록을 바꿀 수 있어야(canEndEnrollment) 한다.
  const canEndByKey = canDrag && canEndEnrollment;
  useEffect(() => {
    if (!canEndByKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete") return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      const cur = hoveredRef.current;
      if (!cur) return;
      e.preventDefault();
      setEndError(null);
      setEndTarget(cur);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEndByKey]);

  /** `reason` = 확인 창의 사유 칸(대분류 · 세부 · 메모) — 서버가 같은 규칙으로 다시 본다(`readReasonForm`). */
  async function confirmEndEnrollment(reason: FormData) {
    if (!endTarget) return;
    setEnding(true);
    setEndError(null);
    const fd = reason;
    fd.set("enrollmentId", endTarget.enrollmentId);
    if (endTarget.studentId) fd.set("studentId", endTarget.studentId);
    fd.set("date", today); // 오늘 날짜로 종료
    const res = await endSingleEnrollment(undefined, fd);
    setEnding(false);
    if (res?.error) {
      setEndError(res.error);
      return;
    }
    setEndTarget(null);
    notifyTermPlansChanged();
    router.refresh(); // endSingleEnrollment는 /timetable revalidate 안 함 → 클라 새로고침
  }

  // net 압축 결과(이름·출발반명·목적지 셀/요일까지 포함) — 표시용 pending/incoming의 단일 출처.
  const resolved = useMemo<Queued[]>(() => {
    const net = new Map<string, Queued>();
    const order: string[] = [];
    for (const q of queue) {
      const ex = net.get(q.enrollmentId);
      if (ex) {
        ex.toClassId = q.toClassId; // 출발지는 최초 유지, 목적지만 갱신
        ex.toClassName = q.toClassName;
        ex.toSlotId = q.toSlotId;
        ex.toDays = q.toDays;
        // 🔴 건별 적용일도 **마지막 드롭의 것**이 이긴다 — 같은 학생을 다시 끌어 다른 날짜를 고르면
        //    그게 사람의 최신 의도다(목적지만 갱신하고 날짜를 안 갱신하면 화면과 저장이 갈린다).
        ex.moveOn = q.moveOn;
      } else {
        net.set(q.enrollmentId, { ...q });
        order.push(q.enrollmentId);
      }
    }
    // 같은 반이라도 요일이 바뀌면(2일↔1일 편집) 유지. 같은 반+같은 요일만 no-op으로 제거.
    return order
      .map((id) => net.get(id)!)
      .filter((m) => m.fromClassId !== m.toClassId || !sameDaySet(m.fromDays, m.toDays));
  }, [queue]);

  // 대기 배치의 적용 앵커(첫 항목의 큐잉 의도). 저장은 지금 보는 주가 아니라 이 값을 쓴다 — 큐가 주
  // 이동을 넘어 살아남으므로, 저장 시점 화면에 묶으면 미래주 예약이 오늘자로 적용되거나 즉시 이동이
  // 미래로 예약되는 뒤바뀜이 생긴다(적대 감사 F2).
  // ⚠️ "배치가 살아있는가"는 raw 큐가 아니라 **압축본(resolved)** 기준 — A→B→A처럼 전부 되돌린 net no-op
  // 큐를 raw 기준으로 잡으면, 주 이동 후 '대기 0건'인데 편집이 잠기는 유령 잠금이 생긴다(적대 리뷰 확정).
  // 🔴 앵커는 **두 큐의 합집합**에서 잡는다 — 반 블록만 대기 중일 때 학생 큐만 보면 `queueDate`가 null이 되어
  //    화면은 미래 주 날짜를 보여 주는데 저장은 오늘로 나간다(적대 리뷰 2026-09-04, F2와 같은 결함).
  const liveAnchor =
    resolved.length > 0 ? (queue[0]?.effectiveOn ?? null) : classQueue.length > 0 ? classQueue[0]!.effectiveOn : null;
  const hasPending = resolved.length > 0 || classQueue.length > 0;
  const queueDate = hasPending ? liveAnchor : null;
  const weekMismatch = hasPending && liveAnchor !== queueIntent;

  // enrollmentId → 최종 대상. 출발 셀이 취소선+→대상(반이동) 또는 "→요일"(같은 반 요일편집) 마커를 그리는 데 사용.
  const pending = useMemo<Map<string, PendingTarget>>(() => {
    const m = new Map<string, PendingTarget>();
    for (const r of resolved) {
      // 건별 날짜 > 툴바 적용일 > 큐 앵커 — **저장과 같은 함수**를 쓴다(보이는 날짜와 저장되는 날짜가 갈리면
      // 무엇이 반영될지 알 수 없다). 🔴 같은 반 요일 편집은 날짜 축이 없다(attendance_days 즉시 갱신).
      const applyOn = r.fromClassId === r.toClassId ? null : resolveApplyDate(r.moveOn, scheduledDate, queueDate);
      m.set(r.enrollmentId, {
        toClassId: r.toClassId,
        toClassName: r.toClassName,
        toDays: r.toDays,
        sameClass: r.fromClassId === r.toClassId,
        fromClassName: r.fromClassName,
        applyOn,
        frozenOn: r.fromClassId === r.toClassId ? null : (r.moveOn ?? null),
        scheduled: isScheduledMove(applyOn, today),
      });
    }
    return m;
  }, [resolved, scheduledDate, queueDate, today]);

  // 도착 셀 slot.id(=toSlotId) → 전입 예정 학생들. 도착 셀이 초록 미리보기 행을 그리는 데 사용.
  // 마커는 "그 셀"에 붙어야 하므로 반 id가 아니라 셀 slot.id로 키잉(한 반이 여러 셀에 걸쳐도 드롭한 셀만).
  // ⚠️ 같은 반 요일 편집(반 이동 아님)은 '전입 예정'이 아니므로 제외 — 출발 셀의 "→요일" 배지로만 표시.
  const incoming = useMemo<Map<string, IncomingStudent[]>>(() => {
    const m = new Map<string, IncomingStudent[]>();
    for (const r of resolved) {
      if (r.fromClassId === r.toClassId) continue; // 같은 반 요일 편집 → 전입 예정 아님
      const key = r.toSlotId ?? r.toClassId;
      const applyOn = resolveApplyDate(r.moveOn, scheduledDate, queueDate);
      const arr = m.get(key) ?? [];
      arr.push({
        enrollmentId: r.enrollmentId,
        name: r.name,
        fromClassName: r.fromClassName,
        attendanceDays: r.toDays, // 도착 요일 존의 등원 요일([목] 등) — 미리보기 라벨용
        applyOn,
        scheduled: isScheduledMove(applyOn, today),
        landsInHold: isScheduledMove(applyOn, today) || r.fromHold === true,
      });
      m.set(key, arr);
    }
    return m;
  }, [resolved, scheduledDate, queueDate, today]);

  /**
   * 같은 큐를 **반 id**로 묶은 것 — 통합뷰 카드(=반)가 읽는다.
   * 🔴 `incoming`(셀 키)과 따로 만드는 이유: 기본뷰에서 큐잉한 건은 `toSlotId`로만 들어 있어 통합뷰가
   *    못 찾는다(뷰를 오가도 큐는 살아남는다 — 그때 도착 카드가 조용히 비면 "적용이 안 된다"로 읽힌다).
   */
  const incomingByClass = useMemo<Map<string, IncomingStudent[]>>(() => {
    const m = new Map<string, IncomingStudent[]>();
    for (const r of resolved) {
      if (r.fromClassId === r.toClassId) continue;
      const applyOn = resolveApplyDate(r.moveOn, scheduledDate, queueDate);
      const arr = m.get(r.toClassId) ?? [];
      arr.push({
        enrollmentId: r.enrollmentId,
        name: r.name,
        fromClassName: r.fromClassName,
        attendanceDays: r.toDays,
        applyOn,
        scheduled: isScheduledMove(applyOn, today),
        landsInHold: isScheduledMove(applyOn, today) || r.fromHold === true,
      });
      m.set(r.toClassId, arr);
    }
    return m;
  }, [resolved, scheduledDate, queueDate, today]);

  function queueMove(move: {
    enrollmentId: string;
    fromClassId: string;
    fromClassName: string;
    toClassId: string;
    toClassName: string;
    name: string;
    toSlotId?: string;
    toDays?: string[];
    fromDays?: string[];
    /** 드롭 날짜 팝업이 고른 날짜(기본값과 같으면 null로 온다 — 즉시 의도를 얼리지 않는다). */
    moveOn?: string | null;
    /** 휴원 중인 수강인가 — 도착 반 미리보기 자리(재원/대기)를 가른다. */
    fromHold?: boolean;
  }): boolean {
    // ⚠️ 돌려주는 값은 **큐에 들어갔는가** — 호출부가 성공 토스트를 띄울지 가른다(막혔는데 "대기에 넣었다"고
    //    말하면 그게 거짓말이다). 컨텍스트 타입은 `=> void`라 안 읽는 소비처는 그대로 둔다.
    if (!canEdit) return false; // 과거 주 등 편집 불가 주에서는 어떤 경로로도 큐잉되지 않는다(F1).
    // 다른 주의 대기 이동이 남아 있으면 섞지 않는다 — 앵커(`queueDate`)는 큐 전체에 하나뿐이라,
    // 섞이면 날짜를 안 고른 건들이 반드시 틀린 주로 적용된다(F2). 저장/취소로 정리한 뒤 편집하게 한다.
    // ⚠️ 건별 날짜(팝업)는 이 축과 별개다 — 그건 절대 날짜라 주를 옮겨도 안 흔들린다.
    if (weekMismatch) {
      setError("다른 주에서 대기 중인 이동이 있습니다. 저장하거나 취소한 뒤 편집하세요.");
      return false;
    }
    setError(null);
    setFailed([]);
    setNotices([]);
    setQueue((prev) => {
      // 전부 되돌린(net no-op) 낡은 배치는 새 배치를 시작하기 전에 비운다 — 안 비우면 raw 큐에 남은
      // 낡은 앵커(effectiveOn)가 새 이동의 적용일을 오염시킨다(적대 리뷰 확정 결함의 나머지 반쪽).
      const base = compressMoves(prev).length === 0 ? [] : prev;
      return [...base, { ...move, moveOn: move.moveOn ?? null, effectiveOn: queueIntent }];
    });
    return true;
  }

  /**
   * 날짜 팝업을 열기 전에 **큐잉과 같은 두 문**을 지난다(#77: 게이트는 팝업 안이 아니라 여는 자리에).
   * 안 그러면 팝업을 띄워 날짜까지 고르게 한 뒤 조용히 버리게 된다.
   */
  function openMoveDate(t: MoveDateTarget) {
    if (!canEdit) return refuse("과거 주는 편집할 수 없습니다 — 현재 주로 이동한 뒤 옮겨 주세요.");
    if (weekMismatch) {
      setError("다른 주에서 대기 중인 이동이 있습니다. 저장하거나 취소한 뒤 편집하세요.");
      return refuse("다른 주에서 대기 중인 이동이 있습니다 — 저장하거나 취소한 뒤 편집하세요.");
    }
    setMoveDate(t);
  }

  // 합반 반+요일 선택 팝업 적용 → 고른 반·요일·날짜로 이동 큐잉. toSlotId=그 반 세그먼트 slot(전입예정 배지 인덱스 정확).
  // 🔴 합반 드롭엔 팝업을 **하나만** 띄운다 — 반·요일 팝업 뒤에 날짜 팝업을 또 띄우면 드롭 한 번에 창이 둘이다.
  //    그래서 날짜 칸을 그 팝업 안에 넣었다(규약은 같다: 기본값과 같으면 안 얼린다).
  function applyClassPick(picked: ClassPickCandidate, days: string[], moveOn: string | null) {
    if (!classPick) return;
    const ok = queueMove({
      enrollmentId: classPick.enrollmentId,
      fromClassId: classPick.fromClassId,
      fromClassName: classPick.fromClassName,
      toClassId: picked.classId,
      toClassName: picked.className,
      name: classPick.name,
      toSlotId: picked.slotId,
      toDays: days,
      fromDays: classPick.fromDays,
      moveOn,
    });
    if (ok) queued(`${classPick.name} → ${picked.className}`);
    setClassPick(null);
  }

  /** 드롭 날짜 팝업 확인 → 그 날짜로 큐잉. 취소하면 아무 일도 없다(떨어뜨린 것만으로는 안 바뀐다). */
  function applyMoveDate(moveOn: string | null) {
    if (!moveDate) return;
    if (queueMove({ ...moveDate, moveOn })) queued(`${moveDate.name} → ${moveDate.toClassName}`);
    setMoveDate(null);
  }

  // 같은 반 요일 편집(팝오버) → toClassId=fromClassId + 선택 요일로 큐잉(저장 시 반영). fromClassName은 배지에 안 쓰임.
  function applyDayEdit(days: string[]) {
    if (!dayEdit) return;
    queueMove({
      enrollmentId: dayEdit.enrollmentId,
      fromClassId: dayEdit.classId,
      fromClassName: "",
      toClassId: dayEdit.classId,
      toClassName: "",
      name: dayEdit.name,
      toSlotId: dayEdit.slotId,
      toDays: days,
      fromDays: dayEdit.currentDays,
    });
    setDayEdit(null);
  }

  // 미저장 이동이 있는 채로 새로고침·탭 닫기 하면 경고(가져오기 다이얼로그와 동일 패턴).
  // 앱 내 주/과목 이동은 weekMismatch 경고 + queueDate 앵커로 이미 안전하므로 여기선 문서 이탈만 막는다(F7).
  useEffect(() => {
    // 반 블록만 대기 중이어도 경고한다 — 미저장은 미저장이다(학생 큐만 보던 것을 고침, 적대 리뷰 2026-09-04).
    if (resolved.length === 0 && classQueue.length === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [resolved.length, classQueue.length]);

  async function save() {
    if (resolved.length === 0 && classQueue.length === 0) {
      setQueue([]);
      setClassQueue([]);
      setScheduledDate(null);
      return;
    }
    // 편집 불가 주(과거)에서는 저장 경로도 막는다 — 컨트롤이 숨겨져 정상적으론 못 부르지만,
    // 게이트는 UI가 아니라 여기여야 한다(#77).
    if (!canEdit) {
      setError("과거 주는 편집할 수 없습니다. 현재 주로 이동한 뒤 저장하세요.");
      return;
    }
    setSaving(true);
    setError(null);
    setFailed([]);
    setNotices([]);
    // 🔴 실패로 중간에 돌아서도 **이미 나간 쓰기**가 있으면 회차 확정 창에 알린다(성공분 기준, finally).
    let changed = false;
    try {
      // 교차 반 이동 = move_enrollments_batch(적용일 split). 같은 반 요일 편집 = attendance_days 갱신(전입 플래그 없음).
      const moves = resolved.filter((m) => m.fromClassId !== m.toClassId);
      const dayEdits = resolved.filter((m) => m.fromClassId === m.toClassId);
      /**
       * 🔴 이미 서버에 나간 이동 — **어느 경로로 빠져나가든 큐에서 빼야 한다.** 안 빼고 사람이 '저장'을
       *    다시 누르면 그 학생이 **한 번 더** 옮겨진다(목적지가 다른 반이면 GiST도 안 막아 준다).
       *    요일 편집이 실패해 중간에 돌아설 때도 마찬가지라 이 집합은 두 단계가 함께 본다.
       */
      const committed = new Set<string>();
      if (moves.length > 0) {
        /**
         * 🔴 **적용일별로 묶어 한 번씩** 부른다 — RPC 인자가 배치 하나에 날짜 하나라, 건별 날짜가 섞여
         *    있으면 한 번의 호출로는 어느 한쪽이 반드시 틀린 날짜로 나간다(팝업 날짜 지시의 핵심).
         * ⚠️ 적용일 = 건별 > 툴바 > 큐 앵커([`resolveApplyDate`]) — 화면(pending.applyOn)과 **같은 함수**다.
         *    `null`(즉시)은 RPC에 날짜를 안 넘긴다(서버 current_date, 자정 넘긴 저장도 안전).
         */
        const groups = new Map<string, typeof moves>();
        for (const m of moves) {
          const key = resolveApplyDate(m.moveOn, scheduledDate, queueDate) ?? "";
          const list = groups.get(key);
          if (list) list.push(m);
          else groups.set(key, [m]);
        }
        // 🔴 성공한 건은 **큐에서 빼야** 한다 — 한 묶음이 실패해 큐를 통째로 남기면, 다시 저장할 때
        //    이미 옮겨진 학생이 **한 번 더** 옮겨진다(GiST가 다른 반이면 안 막아 준다).
        const groupErrors: string[] = [];
        const groupFails: string[] = [];
        for (const [on, list] of groups) {
          const res = await moveEnrollmentsBatch(
            list.map((m) => ({
              enrollmentId: m.enrollmentId,
              newClassId: m.toClassId,
              attendanceDays: m.toDays ?? [],
            })),
            on || undefined,
          );
          if (res.error) {
            groupErrors.push(on ? `${on} 적용분: ${res.error}` : res.error);
            continue;
          }
          for (const m of list) committed.add(m.enrollmentId);
          if ((res.results ?? []).some((r) => r.ok)) changed = true;
          const fails = (res.results ?? []).filter((r) => !r.ok);
          if (fails.length > 0) groupFails.push(...fails.map((f) => f.error ?? f.enrollmentId));
        }
        if (groupFails.length > 0) setFailed(groupFails);
        if (groupErrors.length > 0) {
          setError(groupErrors.join(" · "));
          setQueue((prev) => prev.filter((q) => !committed.has(q.enrollmentId)));
          return;
        }
      }
      if (dayEdits.length > 0) {
        const r2 = await updateEnrollmentsAttendanceBatch(
          dayEdits.map((m) => ({ enrollmentId: m.enrollmentId, days: m.toDays ?? [] })),
        );
        if ((r2.count ?? 0) > 0) changed = true;
        if (r2.error) {
          setError(r2.error);
          // 반 이동은 이미 나갔다 — 그 건들은 큐에서 뺀다(다시 저장해도 두 번 안 옮겨지게).
          if (committed.size > 0) setQueue((prev) => prev.filter((q) => !committed.has(q.enrollmentId)));
          return;
        }
      }
      // 반 블록 이동 — 학생 이동과 **같은 '저장'**이 반영한다. 배치마다 한 번씩(건수가 한 자릿수라 순차로 충분).
      // 🔴 적용일은 학생 이동과 같은 앵커를 쓴다(지금 보는 주가 아니라 큐가 만들어진 의도, F2).
      if (classQueue.length > 0) {
        const failedMoves: string[] = [];
        // 🔴 실패한 것만 큐에 남긴다 — 남길지 말지는 **배치 id**로 가른다(반 이름으로 가르면 같은 반의
        //    다른 블록·동명 반이 함께 남거나 함께 사라진다, 적대 리뷰 2026-09-04).
        const failedIds = new Set<string>();
        for (const m of classQueue) {
          // 🔴 블록이 담은 배치를 **한 번에** 넘긴다 — 한 줄만 옮기면 나머지 줄이 제자리에 남는다.
          const res = await moveClassSlots({
            moves: m.moves,
            effectiveDate: scheduledDate ?? queueDate ?? undefined,
          });
          if (!res.ok) {
            failedMoves.push(`${m.className}: ${res.error}`);
            failedIds.add(m.slotId);
          } else {
            changed = true;
            // 함께 옮긴 기록(수업 계획·학생 기록 …)을 알린다 — 특히 요일이 앞당겨져 한 주 뒤로 간 경우(원장 2026-10-28 (가)안).
            if (res.carried) setNotices((prev) => [...prev, `${m.className}: ${res.carried}`]);
          }
        }
        if (failedMoves.length > 0) {
          setFailed((prev) => [...prev, ...failedMoves]);
          // 실패한 반 이동은 큐에 남겨 사람이 이유를 보고 다시 시도하게 둔다(성공분만 비운다).
          setClassQueue((prev) => prev.filter((m) => failedIds.has(m.slotId)));
        } else {
          setClassQueue([]);
        }
      }
      setQueue([]);
      setScheduledDate(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (changed) notifyTermPlansChanged();
      setSaving(false);
    }
  }

  function queueClassMove(m: QueuedClassMove) {
    // 학생 이동 큐잉과 **같은 두 문**을 지난다(#77: 게이트는 UI가 아니라 여기).
    if (!canEdit) return; // 과거 주 등 편집 불가 주에서는 어떤 경로로도 큐잉되지 않는다.
    if (weekMismatch) {
      setError("다른 주에서 대기 중인 이동이 있습니다. 저장하거나 취소한 뒤 편집하세요.");
      return;
    }
    setError(null);
    setFailed([]);
    setNotices([]);
    // 🔴 적용 앵커는 **큐잉 시점의 의도**(이번 주=null·미래 주=그 주 월요일) — 저장이 "지금 보는 주"에 묶이지 않게(F2).
    setClassQueue((prev) => [...prev.filter((x) => x.slotId !== m.slotId), { ...m, effectiveOn: queueIntent }]);
  }

  function cancel() {
    setQueue([]);
    setClassQueue([]);
    setScheduledDate(null);
    setError(null);
    setFailed([]);
    setNotices([]);
  }

  return (
    <TimetableEditContext.Provider
      value={{
        canDrag,
        pending,
        incoming,
        incomingByClass,
        queueMove,
        openMoveDate,
        pendingCount: resolved.length + classQueue.length,
        classMoves: new Map(classQueue.map((m) => [m.slotId, m])),
        queueClassMove,
        save,
        cancel,
        saving,
        error,
        failed,
        notices,
        scheduledDate,
        setScheduledDate,
        dateFloor,
        queueDate,
        weekMismatch,
        today,
        setHovered,
        openDayEdit,
        openClassPick,
        canSplit: canSplit && !!weekMonday,
        openWholeSplit,
      }}
    >
      {children}
      {/* 창이 열린 채 문이 닫히면(과거 주로 이동 등) 창도 함께 내린다 — 열 때와 같은 문(canEndByKey). */}
      {endTarget && canEndByKey ? (
        <EndEnrollmentConfirm
          target={endTarget}
          today={today}
          ending={ending}
          error={endError}
          onCancel={() => setEndTarget(null)}
          onConfirm={confirmEndEnrollment}
        />
      ) : null}
      {dayEdit ? (
        <DayEditPopover target={dayEdit} onCancel={() => setDayEdit(null)} onApply={applyDayEdit} />
      ) : null}
      {classPick ? (
        <ClassPickPopover
          target={classPick}
          dateFloor={dateFloor}
          defaultDate={scheduledDate ?? dateFloor}
          onCancel={() => setClassPick(null)}
          onApply={applyClassPick}
        />
      ) : null}
      {wholeSplit && weekMonday ? (
        <ClassSplitDialog
          target={{
            studentId: "",
            wholeClass: true,
            name: `${wholeSplit.t.fromClassName} 전체`,
            fromClassId: wholeSplit.t.fromClassId,
            fromClassName: wholeSplit.t.fromClassName,
            toClassId: wholeSplit.t.toClassId,
            toClassName: wholeSplit.t.toClassName,
          }}
          weekMonday={weekMonday}
          onCancel={() => setWholeSplit(null)}
          onSwitchToMove={() => {
            const w = wholeSplit;
            setWholeSplit(null);
            if (w.onMove) w.onMove();
            else refuse(w.moveRefusal ?? "그 칸으로는 반을 옮길 수 없습니다.");
          }}
        />
      ) : null}
      {splitTarget && splitTarget.studentId && weekMonday ? (
        <ClassSplitDialog
          target={{
            studentId: splitTarget.studentId,
            name: splitTarget.name,
            fromClassId: splitTarget.fromClassId,
            fromClassName: splitTarget.fromClassName,
            toClassId: splitTarget.toClassId,
            toClassName: splitTarget.toClassName,
            dropDay: splitTarget.toDays?.[0],
          }}
          weekMonday={weekMonday}
          onCancel={() => setSplitTarget(null)}
          onSwitchToMove={() => {
            setMoveDate(splitTarget);
            setSplitTarget(null);
          }}
        />
      ) : null}
      {moveDate ? (
        <MoveDatePopover
          target={moveDate}
          onSwitchToSplit={
            canSplit && moveDate.studentId && weekMonday
              ? () => {
                  setSplitTarget(moveDate);
                  setMoveDate(null);
                }
              : undefined
          }
          dateFloor={dateFloor}
          defaultDate={scheduledDate ?? dateFloor}
          today={today}
          onCancel={() => setMoveDate(null)}
          onApply={applyMoveDate}
        />
      ) : null}
    </TimetableEditContext.Provider>
  );
}

/**
 * 드롭 → **적용일 팝업**(기본뷰·통합뷰 공용, 원장 2026-09-09 *"드랍을 하면 날짜지정 팝업"*).
 *
 * 🔴 확인해야 큐에 들어간다 — 떨어뜨린 것만으로는 아무 일도 안 일어난다(취소 = 무효).
 * 🔴 기본값은 **툴바 '적용일'**(안 바꿨으면 이 주의 바닥 날짜)이고, 그대로 확인하면 얼리지 않는다
 *    (`freezeMoveDate` → null → 툴바를 나중에 바꿔도 이 건이 따라온다). 다른 날짜를 고르면 그 건만 고정.
 * 🔴 과거 날짜는 못 고른다(`min`) — 서버도 같은 규칙으로 거절하지만(#77) 여기서 먼저 막아 헛수고를 없앤다.
 * ⚠️ Esc·바깥 클릭 = 취소. 확인 버튼 autofocus(Enter 한 번으로 끝나게 — 드롭마다 뜨는 창이라 손이 무거우면 안 된다).
 */
function MoveDatePopover({
  target,
  onSwitchToSplit,
  dateFloor,
  defaultDate,
  today,
  onCancel,
  onApply,
}: {
  target: MoveDateTarget;
  /** 나누기 권한이 있으면 위에 '반 이동 / 수업 나누기' 전환이 선다. 없으면(undefined) 종전 그대로. */
  onSwitchToSplit?: () => void;
  dateFloor: string;
  defaultDate: string;
  today: string;
  onCancel: () => void;
  onApply: (moveOn: string | null) => void;
}) {
  const [date, setDate] = useState(defaultDate);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const tooEarly = !!date && date < dateFloor;
  const scheduled = isScheduledMove(date, today);
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="bg-card border-line w-[320px] rounded-xl border p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="반 이동 적용일"
      >
        {onSwitchToSplit ? (
          <div className="mb-3">
            <DropModeTabs mode="move" onSplit={onSwitchToSplit} />
          </div>
        ) : null}
        <p className="text-foreground text-sm font-bold">
          <span className="text-text-dim font-normal">{target.name} · </span>반 이동
        </p>
        <p className="text-text-faint mt-1 text-xs">
          <b className="text-text-dim">{target.fromClassName || "현재 반"}</b> →{" "}
          <b className="text-text-dim">{target.toClassName}</b>
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-text-dim shrink-0">적용일</span>
          <input
            type="date"
            aria-label="반 이동 적용일"
            min={dateFloor}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            autoFocus
            className="border-line h-(--control-h) flex-1 rounded-lg border px-2 text-sm"
          />
        </label>
        {/* 🔴 고른 날짜가 **무슨 뜻인지** 그 자리에서 말한다 — 예약이면 그날까지 옛 반에 남고 새 반엔 대기로 앉는다.
            (RPC가 옛 수강 end_date·새 수강 start_date를 그날로 잡는 것을 사람 말로 옮긴 것) */}
        <p className="text-text-faint mt-2 text-xs">
          {scheduled ? (
            <>
              <b className="text-purple">{date}</b>부터 이동합니다 — 그때까지는 <b>{target.fromClassName || "현재 반"}</b>에
              남고, <b>{target.toClassName}</b>에는 <b>대기</b>로 표시됩니다.
            </>
          ) : (
            <>저장하면 바로 이동합니다.</>
          )}
        </p>
        {tooEarly ? <p className="text-chart-4 mt-2 text-xs">적용일은 {dateFloor} 이후여야 합니다.</p> : null}
        <p className="text-text-faint mt-2 text-xs">반영은 &lsquo;저장&rsquo;을 눌러야 일어납니다.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="border-line text-text-dim hover:bg-bg-soft rounded-lg border px-3 py-1.5 text-xs font-medium transition"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => onApply(freezeMoveDate(date, defaultDate))}
            disabled={!date || tooEarly}
            className="bg-primary text-primary-foreground hover:bg-primary/85 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
          >
            이동 예약
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 같은 반 요일 편집 팝오버 — 편집 모드에서 학생 클릭 시. 그 셀이 덮는 요일(월/목 등)을 토글로 보여주고,
 * 적용하면 그 요일만 등원(전부 선택=전 요일)으로 이동 배치에 큐잉(저장 시 반영). 반 이동이 아니라 요일만 편집.
 */
function DayEditPopover({
  target,
  onCancel,
  onApply,
}: {
  target: DayEditTarget;
  onCancel: () => void;
  onApply: (days: string[]) => void;
}) {
  // 현재 등원 요일 — []=전 요일(덮는 요일 전부 선택 상태로 시작).
  const covers = target.coveringDays;
  const initial =
    target.currentDays.length === 0
      ? new Set(covers)
      : new Set(covers.filter((d) => target.currentDays.includes(d)));
  const [sel, setSel] = useState<Set<string>>(initial);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const toggle = (d: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  // 저장값 = 전부 선택이면 [](전 요일), 아니면 선택 요일. 요일순.
  const picked = covers.filter((d) => sel.has(d));
  const toDays = picked.length === covers.length ? [] : picked;
  const none = picked.length === 0;
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="bg-card border-line w-[280px] rounded-xl border p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-foreground text-sm font-bold">
          <span className="text-text-dim font-normal">{target.name} · </span>등원 요일
        </p>
        <p className="text-text-faint mt-1 text-xs">이 반에서 오는 요일만 선택(전부 = 전 요일 등원).</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {covers.map((d) => {
            const on = sel.has(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggle(d)}
                aria-pressed={on}
                className={`min-w-[44px] rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-line text-text-dim hover:bg-bg-soft"
                }`}
              >
                {DAY_LABEL[d] ?? d}
              </button>
            );
          })}
        </div>
        {none ? <p className="text-chart-4 mt-2 text-xs">최소 한 요일은 선택해야 합니다.</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="border-line text-text-dim hover:bg-bg-soft rounded-lg border px-3 py-1.5 text-xs font-medium transition"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => onApply(toDays)}
            disabled={none}
            className="bg-primary text-primary-foreground hover:bg-primary/85 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
          >
            적용
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 합반 드롭 반+요일 선택 팝업 — 외부 학생을 합반 셀에 놓거나 멤버를 다른 세그먼트에 놓으면
 * "어느 반으로, 어느 요일에" 를 한 번에 고른다(DayEditPopover와 동일 문법). 세그먼트 드롭=그 반,
 * 요일존 드롭=그 요일 미리 선택. 이미 열린 수강이 있는 반은 비활성("이미 소속" — 저장 시 GiST 실패 방지).
 */
function ClassPickPopover({
  target,
  dateFloor,
  defaultDate,
  onCancel,
  onApply,
}: {
  target: ClassPickTarget;
  /** 고를 수 있는 가장 이른 날(오늘 또는 조회 주 월요일) — 과거 소급 금지. */
  dateFloor: string;
  /** 팝업 기본 날짜(툴바 '적용일' ?? dateFloor) — 그대로 확인하면 얼리지 않는다. */
  defaultDate: string;
  onCancel: () => void;
  onApply: (picked: ClassPickCandidate, days: string[], moveOn: string | null) => void;
}) {
  // 🔴 합반도 **드롭 한 번에 창 하나** — 반·요일과 같은 팝업에서 날짜까지 고른다(MoveDatePopover와 같은 규약).
  const [date, setDate] = useState(defaultDate);
  const covers = target.coveringDays;
  const showDays = covers.length >= 2; // 단일 요일 셀이면 요일 선택 의미 없음(전 요일)
  const [pickedId, setPickedId] = useState<string | null>(
    target.presetClassId && target.candidates.some((c) => c.classId === target.presetClassId && !c.disabled)
      ? target.presetClassId
      : null,
  );
  const [sel, setSel] = useState<Set<string>>(
    target.presetDay ? new Set([target.presetDay]) : new Set(covers),
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const toggle = (d: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  // 저장값 = 전부 선택이면 [](전 요일), 아니면 선택 요일(요일순).
  const pickedDays = covers.filter((d) => sel.has(d));
  const toDays = !showDays || pickedDays.length === covers.length ? [] : pickedDays;
  const noDay = showDays && pickedDays.length === 0;
  const picked = target.candidates.find((c) => c.classId === pickedId) ?? null;
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="bg-card border-line w-[300px] rounded-xl border p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-foreground text-sm font-bold">
          <span className="text-text-dim font-normal">{target.name} · </span>합반으로 이동
        </p>
        <p className="text-text-faint mt-1 text-xs">
          합반 수업입니다 — 이동할 반{showDays ? "과 등원 요일을" : "을"} 선택하세요.
        </p>
        <div className="mt-3 flex flex-col gap-1.5">
          {target.candidates.map((c) => {
            const on = pickedId === c.classId;
            return (
              <button
                key={c.classId}
                type="button"
                onClick={() => !c.disabled && setPickedId(c.classId)}
                disabled={c.disabled}
                aria-pressed={on}
                className={`flex items-baseline gap-1.5 rounded-md border px-3 py-1.5 text-left text-sm font-medium transition ${
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : c.disabled
                      ? "border-line text-text-faint cursor-not-allowed opacity-60"
                      : "border-line text-foreground hover:bg-bg-soft"
                }`}
              >
                <IndexBadge badge={String(c.index)} />
                <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-clip">{c.className}</span>
                {c.disabled ? <span className="shrink-0 text-xs">이미 소속</span> : null}
              </button>
            );
          })}
        </div>
        {showDays ? (
          <>
            <p className="text-text-dim mt-3 text-xs font-bold">등원 요일 (전부 = 전 요일)</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {covers.map((d) => {
                const on = sel.has(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggle(d)}
                    aria-pressed={on}
                    className={`min-w-[44px] rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-line text-text-dim hover:bg-bg-soft"
                    }`}
                  >
                    {DAY_LABEL[d] ?? d}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
        <label className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-text-dim shrink-0">적용일</span>
          <input
            type="date"
            aria-label="반 이동 적용일"
            min={dateFloor}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border-line h-(--control-h) flex-1 rounded-lg border px-2 text-sm"
          />
        </label>
        {noDay ? <p className="text-chart-4 mt-2 text-xs">최소 한 요일은 선택해야 합니다.</p> : null}
        {date && date < dateFloor ? (
          <p className="text-chart-4 mt-2 text-xs">적용일은 {dateFloor} 이후여야 합니다.</p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="border-line text-text-dim hover:bg-bg-soft rounded-lg border px-3 py-1.5 text-xs font-medium transition"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => picked && onApply(picked, toDays, freezeMoveDate(date, defaultDate))}
            disabled={!picked || noDay || !date || date < dateFloor}
            className="bg-primary text-primary-foreground hover:bg-primary/85 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
          >
            이동
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 편집 모드 Delete → 오늘 수강 종료 확인 팝업(파괴적 동작이라 확인 필수). Esc/바깥클릭=취소.
 * 사유를 고른다(원장 2026-10-15 *"기타는 모든 곳을 일치하게"*) — 상태 전환 창과 같은 칸(`ReasonFields`), 첫 칸(대분류)에 바로 초점.
 */
function EndEnrollmentConfirm({
  target,
  today,
  ending,
  error,
  onCancel,
  onConfirm,
}: {
  target: HoveredStudent;
  today: string;
  ending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: FormData) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    formRef.current?.querySelector<HTMLSelectElement>("select[name=reason]")?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !ending) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ending, onCancel]);
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4"
      onClick={() => !ending && onCancel()}
    >
      <form
        ref={formRef}
        className="bg-card border-line max-h-[calc(100dvh-2rem)] w-[340px] overflow-y-auto rounded-xl border p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!ending) onConfirm(new FormData(e.currentTarget));
        }}
      >
        <p className="text-foreground text-sm font-bold">수강 종료</p>
        <p className="text-text-dim mt-2 text-sm leading-relaxed">
          <b className="text-foreground">{target.name}</b> 학생을{" "}
          <b className="text-foreground">{target.className}</b> 반에서{" "}
          <b className="text-foreground">오늘({today})</b> 수강 종료할까요?
        </p>
        {/* 종전 "이 반의 퇴원 목록으로 이동합니다"는 한 반만 끝나는 학생에게도 '퇴원'이라 말했다(원장 2026-09-14). */}
        <EndScopeNote enrollmentId={target.enrollmentId} date={today} />
        <div className="mt-3 space-y-2">
          <ReasonFields
            reasonLabel="종료 사유"
            initialReason={null}
            memoPlaceholder="배경 정보 (선택)"
            labelClassName="text-foreground block text-xs font-medium"
            controlClassName="border-line bg-card text-foreground w-full rounded-lg border px-2 py-1.5 text-sm"
            idPrefix="timetable-end"
          />
        </div>
        {error ? <p className="text-chart-4 mt-2 text-xs">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={ending}
            className="border-line text-text-dim hover:bg-bg-soft rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={ending}
            className="bg-danger hover:bg-danger/90 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition disabled:opacity-50"
          >
            {ending ? "처리 중…" : "수강 종료"}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * 이동 대기 → 저장/취소 바 — 툴바에 인라인 배치(별도 행 차지 안 함).
 *
 * 🔴 옛 '편집' 토글은 없앴다(원장 2026-09-04 *"편집모드 없이 바로 드래그"*). 권한이 있으면 곧바로 끌 수 있고,
 *    이 바는 **옮긴 게 생겼을 때만** 선다 — 아무것도 안 옮겼는데 저장 버튼이 서 있으면 무엇이 저장될지 모른다.
 *    평소엔 어떻게 쓰는지 한 줄 힌트만(툴바 상시 버튼 수를 늘리지 않는다, §10).
 */
export function TimetableEditControls({ rosterHidden = false }: { rosterHidden?: boolean }) {
  const {
    pending,
    pendingCount,
    save,
    cancel,
    saving,
    error,
    failed,
    notices,
    scheduledDate,
    setScheduledDate,
    dateFloor,
    queueDate,
    weekMismatch,
  } = useTimetableEdit();
  /**
   * 건별로 날짜를 따로 고른 이동 — 툴바 입력 하나만 보여 주면 **저장되는 날짜를 거짓으로 말한다**
   * (원장 2026-09-09 날짜 팝업 지시의 대가: 날짜의 출처가 둘이 됐다).
   * 🔴 툴바는 "고르지 않은 건들의 기본값"이라고 이름을 바꾸고, 따로 고른 건은 날짜별로 몇 건인지 적는다.
   *    각 건이 어느 날짜인지는 **줄 자체**가 `→ 9/15`로 말한다(여기선 요약만).
   */
  const perItem = [...pending.values()].filter((t) => !t.sameClass && !!t.frozenOn);
  const perItemDates = [...new Set(perItem.map((t) => t.frozenOn!))].sort();
  const followsToolbar = pendingCount - perItem.length;
  // 표시·저장 모두 "큐가 만들어진 주"를 앵커로 — 주를 옮겨도 적용일 표시가 실제 적용값과 어긋나지 않게(F2).
  const anchorDate = queueDate ?? dateFloor;
  // 🔴 아무것도 안 옮겼으면 **한 글자도 그리지 않는다**(원장 2026-09-09 *"멘트는 숨겨서 1행으로 만들어"*).
  //    종전엔 여기서 사용법 한 줄을 늘 띄웠는데 그 글이 350px쯤 돼서, 툴바가 상시 두 줄이 되고 학생 집계가
  //    둘째 줄로 밀렸다(원장이 우상단에 두라고 한 그 값이다). 드래그 사용법은 도움말이 이미 설명하고,
  //    실제로 끌어 보면 드롭 칸이 보이므로 상시 안내로 세로 한 줄을 살 이유가 없다.
  // ⚠️ 되살리려면 **툴바 밖**에 둘 것(툴바 줄 수를 늘리지 않는 자리) — 여기로 되돌리면 두 줄이 재발한다.
  if (pendingCount === 0 && !error && failed.length === 0 && notices.length === 0) return null;
  return (
    <div className="print:hidden flex flex-wrap items-center gap-2 text-xs">
      {/* 툴바와 가르는 세로줄 — 그릴 게 생겼을 때만 함께 선다(호출부에 두면 빈 줄만 남는다). */}
      <span className="bg-line h-4 w-px" aria-hidden />
      {pendingCount > 0 ? (
        <>
          <span className="text-primary inline-flex items-center gap-1.5 font-medium">
            <Pencil className="size-3" />
            <span className="num">{pendingCount}건</span> 이동 대기
          </span>
          {/* 적용일(즉시=오늘/조회 주, 예정일=날짜 지정). 이동은 이 날짜에 반영(옛 반은 그날 전까지 유지).
              드롭 팝업에서 날짜를 따로 고른 건은 이 값을 안 따른다 — 그래서 라벨이 '기본'이다. */}
          <label
            className="text-text-dim inline-flex items-center gap-1"
            title="드롭할 때 날짜를 따로 고르지 않은 이동에 적용됩니다"
          >
            {perItem.length > 0 ? "기본 적용일" : "적용일"}
            <input
              type="date"
              aria-label="이동 적용일"
              min={dateFloor}
              value={scheduledDate ?? anchorDate}
              onChange={(e) => setScheduledDate(e.target.value || null)}
              disabled={saving}
              className="border-line h-(--control-h) rounded-lg border px-1.5 text-xs disabled:opacity-50"
            />
          </label>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/85 inline-flex h-(--control-h) shrink-0 items-center gap-1.5 rounded-lg px-2.5 font-medium transition disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            저장
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={saving}
            className={`${TOOLBAR_CHIP} gap-1.5 ${TOOLBAR_CHIP_OFF} disabled:opacity-50`}
          >
            <X className="size-3" />
            취소
          </button>
          {/* 건별 날짜 요약 — 연보라(예약 이동과 같은 뜻의 색). 하나하나는 줄에 붙은 `→ 9/15`가 말한다. */}
          {perItem.length > 0 ? (
            <span
              className="text-purple font-medium"
              title={perItem
                .map((t) => `${t.toClassName} ${shortMoveDate(t.frozenOn)}`)
                .join(" · ")}
            >
              건별 날짜 <span className="num">{perItem.length}건</span>
              {perItemDates.length <= 3 ? ` (${perItemDates.map(shortMoveDate).join("·")})` : null}
              {followsToolbar > 0 ? <span className="text-text-faint"> · 나머지 {followsToolbar}건은 기본 적용일</span> : null}
            </span>
          ) : null}
        </>
      ) : null}
      {/* 대기 이동이 다른 주에서 만들어졌음을 명시 — 저장은 그 앵커 기준으로 나가고, 새 편집은 막혀 있다(F2).
          앵커 null=즉시 의도(이번 주에서 큐잉) — 미래 주로 이동해 온 경우에도 배너는 떠야 한다. */}
      {weekMismatch ? (
        <span className="text-amber">
          다른 주에서 만든 이동 {pendingCount}건이 대기 중입니다 — <b>{queueDate ?? "오늘(즉시)"}</b> 기준으로
          적용됩니다. 저장하거나 취소한 뒤 이 주를 편집하세요.
        </span>
      ) : null}
      {/* 명단을 접어 두면 취소선·전입 예정 미리보기가 화면에 없다 — 무엇이 옮겨졌는지 못 보는 채로 저장하지 않게 알린다. */}
      {rosterHidden && pendingCount > 0 ? (
        <span className="text-amber">학생 명단을 접어 둬서 옮긴 줄이 안 보입니다 — 뷰 설정에서 펼치면 표시됩니다.</span>
      ) : null}
      {error ? <span className="text-chart-4">{error}</span> : null}
      {/* 🔴 실패 **이유**를 그린다 — 종전엔 개수만("시간겹침 등") 그려, 반 옮기기가 늘 실패하던 버그(없는 칸 `date`)도 막힘 안내
          (권장 적용일·분리등원 학생)도 화면에 닿지 않았다(리뷰 2026-10-28). 첫 이유는 글로, 나머지는 마우스를 올리면. */}
      {failed.length > 0 ? (
        <span className="text-amber" title={failed.join("\n")}>
          {failed.length}건 실패 — {failed[0]}
          {failed.length > 1 ? ` 외 ${failed.length - 1}건` : ""} · 나머지는 저장됨
        </span>
      ) : null}
      {/* 반 블록 이동이 함께 옮긴 기록 — 첫 줄은 글로, 나머지는 마우스를 올리면(실패 줄과 같은 꼴). */}
      {notices.length > 0 ? (
        <span className="text-text-dim" title={notices.join("\n")}>
          {notices[0]}
          {notices.length > 1 ? ` 외 ${notices.length - 1}개 반` : ""}
        </span>
      ) : null}
    </div>
  );
}

/**
 * 드롭 대상 우선순위 — 요일 존(class:slotId:day, 콜론 3조각)이 셀(class:slotId, 2조각)과 겹치면 요일 존을 택한다.
 * 그래야 "목 칸에 드롭 = 목만 등원"이 셀 전체 드롭(=전 요일)보다 우선한다. slotId는 UUID라 콜론이 없어 조각 수로 구분.
 */
/** 학생 줄이 드래그에 싣는 것(student-rows.tsx `ArmedStudentRow`의 data) — 고스트·판정에 쓰는 칸. */
type StudentDragData = {
  classId?: string;
  /** 그 학생 id — 집는 순간 **그 학생의 다른 과목 일정**을 받아 못 가는 반에 빗금을 치는 데 쓴다. */
  studentId?: string;
  fromClassName?: string;
  name?: string;
  meta?: string;
  tone?: string;
  badge?: string;
  enrollmentId?: string;
  attendanceDays?: string[];
  blockingClassIds?: string[];
};

const preferDayZone: CollisionDetection = (args) => {
  // 🔴 반 블록을 끌 때는 **학생 드롭존을 고르지 않는다** — 반은 격자 칸(포인터 아래 DOM)으로 놓는데,
  //    dnd-kit이 셀 드롭존을 `over`로 잡으면 그 셀에 학생용 남색 링(`ring-primary`)이 켜져
  //    **갈 수 없는 칸에도 "여기 놓을 수 있다"**는 거짓 표식이 선다(적대 리뷰 2026-09-04).
  if (String(args.active.id).startsWith("block:")) return [];
  const hits = pointerWithin(args);
  const dayZone = hits.find((h) => String(h.id).split(":").length >= 3);
  if (dayZone) return [dayZone];
  return hits.length > 0 ? hits : rectIntersection(args);
};

/** DnD 드롭영역 — 시간표 그리드를 감싼다. 편집 권한이 있으면 모드 없이 곧바로 이동을 큐에 누적.
 * DragOverlay로 잡은 학생 이름 칩이 커서를 따라다녀 "끌고 있다"는 느낌을 준다.
 * ⚠️ 드롭존은 **드래그 시작에 새로 만들지 않는다**(요일 칸도 권한이 있으면 늘 마운트) — dnd-kit은 드롭존
 *    집합이 바뀌면 전부 다시 재서, 픽업 순간 그 비용이 한 프레임에 몰린다(실측 701ms). 그래서 재측정
 *    전략도 기본값(WhileDragging = 시작 시 1회)을 쓴다.
 */
export function TimetableDndArea({ children }: { children: ReactNode }) {
  const { canDrag, queueMove, queueClassMove, openClassPick, openMoveDate, dateFloor, canSplit, openWholeSplit } = useTimetableEdit();
  // 반 이동 판정 재료(서버 색인 → 요일별). 없으면 반 드래그가 없는 화면이다.
  const moveLookup = useClassMoveIndex();
  // 끌리는 줄의 **원본 모습**(이름·학교학년·톤·폭) — 고스트를 셀 안 줄과 똑같이 그리기 위한 재료.
  const [drag, setDrag] = useState<{ name: string; meta: string; tone: string; badge?: string; width: number } | null>(null);
  // 반 블록 고스트 — **원본 머리 그대로**(색·강의실·인원·폭). 학생 줄 고스트와 같은 규약이다.
  const [blockGhost, setBlockGhost] = useState<
    | { className: string; room: string; count: number; headerClass: string; headerStyle: CSSProperties; width: number; height: number }
    | null
  >(null);
  // 반 블록 드래그 — 포인터 아래 칸을 **직접** 찾는다(칸마다 드롭존을 만들면 집는 순간 전부 다시 재느라 멈칫한다).
  // 마지막 좌표를 기억했다가 놓는 순간 그 자리의 칸을 읽고, 지나는 동안은 DOM 속성만 켜고 끈다(리렌더 0).
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const hotRef = useRef<HTMLElement | null>(null);
  /**
   * 좌표 아래의 **갈 수 있는 칸** — 🔴 `elementFromPoint`(단수)를 쓰면 안 된다: 커서를 따라다니는 드래그
   * 고스트가 맨 위라 그것만 잡히고 칸은 영영 안 나온다(실측: 놓아도 아무 일이 없었다). 겹친 것을 전부 받아
   * 그중 칸을 찾는다.
   */
  const okCellAt = useCallback((x: number, y: number): HTMLElement | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const cell = (el as HTMLElement).closest?.(`[${CELL_OK_ATTR}="1"]`) as HTMLElement | null;
      if (cell) return cell;
    }
    return null;
  }, []);
  /**
   * 좌표 아래의 **아무 격자 칸**(막힌 칸 포함) — 놓을 수 없는 칸에 놓았을 때 **이유**를 말하려고 찾는다
   * (막힌 칸은 `annotateDropCells`가 `title`에 이유를 적어 둔다). 갈 수 있는 칸만 찾는 `okCellAt`과 짝.
   */
  const anyCellAt = useCallback((x: number, y: number): HTMLElement | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const cell = (el as HTMLElement).closest?.(`[${CELL_DAY_ATTR}]`) as HTMLElement | null;
      if (cell) return cell;
    }
    return null;
  }, []);
  /** 지금 끌고 있는 블록의 판정 재료 — 하이라이트가 "이 블록이 차지할 칸 전부"를 켜는 데 쓴다. */
  const subjectRef = useRef<MoveSubject | null>(null);
  // 🔴 집는 순간의 학생 드래그 data를 **스냅샷**으로 든다 — dnd-kit은 끌던 줄이 언마운트되면 `active.data`를 빈
  //    객체로 바꾼다(drag-flag.ts `holdArmedRow` 주석). 무장 잠금이 1차 방어고 이 스냅샷은 안전망이다(줄이 어떤
  //    이유로든 다시 그려져도 놓는 순간 출발 반·수강 id가 남아 있게).
  const studentDragRef = useRef<StudentDragData | null>(null);
  /**
   * 지금 끌고 있는 학생이 **못 가는 반** → 이유. 집는 순간 서버에서 그 학생의 다른 일정을 받아 채운다.
   * 🔴 화면(빗금)과 드롭 거절이 **같은 맵**을 읽는다 — 갈리면 빗금 없는 칸이 거절되거나 그 반대가 된다.
   * 🔴 비어 있는 것이 정상 상태다(fail-open) — 조회가 늦거나 실패하면 아무것도 안 막는다.
   */
  const studentBlockRef = useRef<Map<string, string>>(new Map());
  const cellAtPointer = useCallback((): HTMLElement | null => {
    const p = pointerRef.current;
    if (!p) return null;
    return okCellAt(p.x, p.y);
  }, [okCellAt]);
  const trackPointer = useCallback((e: PointerEvent) => {
    pointerRef.current = { x: e.clientX, y: e.clientY };
    const cell = okCellAt(e.clientX, e.clientY);
    if (hotRef.current === cell) return;
    // 블록이 여러 칸이면 그 칸들을 함께 켠다(월목 병합 블록은 두 요일이 함께 옮겨진다).
    markHotCells(document, cell, subjectRef.current);
    hotRef.current = cell;
  }, [okCellAt]);
  const stopTracking = useCallback(() => {
    window.removeEventListener("pointermove", trackPointer);
    hotRef.current = null;
    pointerRef.current = null;
    subjectRef.current = null;
    studentBlockRef.current = new Map();
    clearDropCells(document);
  }, [trackPointer]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function onDragStart(e: DragStartEvent) {
    const data = e.active.data.current as
      | { type?: string; name?: string; meta?: string; tone?: string; badge?: string; className?: string }
      | undefined;
    // 반 블록 — 격자 칸이 "여기로 갈 수 있나"를 판정할 재료를 올린다(칸만 구독해 다시 그린다).
    if (data?.type === "class") {
      const info = e.active.data.current as unknown as ClassDragInfo;
      const g = (e.active.data.current as { ghost?: Omit<NonNullable<typeof blockGhost>, "width" | "height"> }).ghost;
      const rect = e.active.rect.current.initial;
      if (g) {
        setBlockGhost({
          ...g,
          width: Math.round(rect?.width ?? 0),
          height: Math.round(rect?.height ?? 0),
        });
      }
      setTimetableDragging(true, "class");
      subjectRef.current = info.subject;
      // 갈 수 있는 칸을 **DOM에 직접** 칠한다(칸마다 React를 돌리면 그게 곧 픽업 렉 — grid-drop-cell.tsx 주석).
      if (moveLookup) {
        annotateDropCells(document, info.subject, { day: info.fromDay, start: info.fromStart }, moveLookup);
        // 🔴 놓을 수 있는 칸이 **하나도 없으면 집는 순간 말한다** — 초록 칸이 안 켜지는 것을 "표시가 안 된다"로 읽는다
        //    (원장 제보 2026-09-09 *"놓을 수 있는 칸을 미리 구역으로 표시해주면"* — 표시는 있었고 켜질 칸이 없었다).
        //    끌고 있는 동안은 툴팁이 안 뜨므로, 이유는 놓는 순간의 거절 토스트가 말한다.
        if (document.querySelectorAll(`[${CELL_OK_ATTR}="1"]`).length === 0) {
          toast.info(`${info.className} 반을 놓을 수 있는 칸이 지금 없습니다 — 칸에 놓아 보면 막힌 이유를 알려 드립니다`);
        }
      }
      // 놓을 자리는 포인터 아래 칸으로 찾는다(드롭존을 새로 만들지 않는다).
      const act = e.activatorEvent as PointerEvent | undefined;
      pointerRef.current = act ? { x: act.clientX, y: act.clientY } : null;
      window.addEventListener("pointermove", trackPointer);
      return;
    }
    // 폭은 집은 줄의 실측 폭 — 파일 드래그처럼 "그 줄이 그대로 떠 있는" 느낌이 되게(칩으로 줄이면 딴 물건이 된다).
    const width = Math.round(e.active.rect.current.initial?.width ?? 0);
    const sData = (e.active.data.current as StudentDragData | undefined) ?? null;
    studentDragRef.current = sData;
    setDrag({ name: data?.name ?? "학생", meta: data?.meta ?? "", tone: data?.tone ?? "", badge: data?.badge, width });
    setTimetableDragging(true);
    /**
     * 🔴 **못 가는 반을 미리 막는다**(원장 2026-09-09 *"영어를 듣는 학생이면 영어 스케줄 때문에 이동이
     * 불가능한 곳은 [빗금] 이런느낌으로 차단시켜"*). 재료는 그 학생 한 명의 그 주 배치라 가볍고,
     * 화면이 갖고 있지 않은 **다른 과목**이라 집는 순간 한 번 받아 온다(왕복 1회 · 학생-busy 주석 참조).
     * 🔴 늦게 도착해도 괜찮다 — 도착하면 그때 빗금이 서고, 그 전에 놓으면 종전처럼 서버 규칙만 적용된다.
     *    이미 다른 드래그가 시작됐으면 버린다(응답이 뒤늦게 와서 남의 드래그에 빗금을 치지 않게).
     */
    const dragToken = sData;
    // 새 드래그는 **빈 판**에서 시작한다 — 앞 드래그의 답이 남아 있으면 다른 학생에게 그 차단이 적용된다.
    studentBlockRef.current = new Map();
    if (sData?.studentId && dateFloor) {
      // 🔴 **서버 액션이 아니라 라우트 핸들러**다 — 서버 액션 응답은 현재 라우트의 RSC 트리를 다시
      //    적용해서([[#102]]) 드래그 도중이면 끌던 줄이 언마운트되고 드래그가 통째로 죽는다.
      const q = new URLSearchParams({ studentId: sData.studentId, week: dateFloor });
      if (sData.classId) q.set("exclude", sData.classId);
      void fetch(`/api/timetable/student-busy?${q.toString()}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<{ windows: StudentBusyWindow[] }>) : { windows: [] }))
        .then(({ windows }) => {
          // 늦게 온 답은 버린다 — 그 사이 다른 학생을 집었으면 남의 드래그에 빗금을 치게 된다.
          if (studentDragRef.current !== dragToken || windows.length === 0) return;
          studentBlockRef.current = annotateStudentBlocks(document, windows);
        })
        .catch(() => {
          /* 표식은 도움이지 게이트가 아니다 — 실패하면 아무것도 안 막는다 */
        });
    }
  }

  /** 반 블록 이동 큐잉 — 격자 칸에 놓았을 때와, 반 전체 나누기 팝업에서 '반 이동'을 골랐을 때가 같은 함수를 탄다. */
  function queueBlockMove(src: ClassDragInfo, cellHit: HTMLElement) {
    // 블록 전체가 어디로 가는지 — 칸이 들고 있는 좌표로 계산한다(하이라이트와 **같은 함수**).
    const placed = placementAt(cellHit, src.subject, document);
    if (!placed || placed.length === 0) return refuse("그 칸에는 이 반을 놓을 수 없습니다.");
    const anchor = placed.find((w) => w.slotId === src.slotId) ?? placed[0]!;
    if (src.fromDay === anchor.day && src.fromStart.slice(0, 5) === anchor.start.slice(0, 5)) return;
    queued(`${src.className} 반을 옮깁니다`);
    queueClassMove({
      slotId: src.slotId,
      classId: src.classId,
      className: src.className,
      fromDay: src.fromDay,
      fromStart: src.fromStart,
      moves: placed.map((w) => ({ slotId: w.slotId, toDay: w.day, toStart: w.start })),
      toDay: anchor.day,
      toStart: anchor.start,
      toDays: [...new Set(placed.map((w) => w.day))],
      effectiveOn: null, // provider가 큐잉 시점의 의도로 덮어쓴다(주 앵커)
    });
  }

  /** 포인터 아래 **다른 반의 칸**(반 전체 나누기의 받는 반) — 끄는 고스트·자기 반 칸은 건너뛴다. */
  function classCellAt(x: number, y: number, exceptClassId: string): { id: string; name: string } | null {
    for (const el of document.elementsFromPoint(x, y)) {
      const cell = (el as HTMLElement).closest?.(`[${CLASS_CELL_ID_ATTR}]`) as HTMLElement | null;
      const id = cell?.getAttribute(CLASS_CELL_ID_ATTR);
      if (cell && id && id !== exceptClassId) return { id, name: cell.getAttribute(CLASS_CELL_NAME_ATTR) || "다른 반" };
    }
    return null;
  }

  function onDragEnd(e: DragEndEvent) {
    setBlockGhost(null);
    // 🔴 **목적지를 먼저 읽는다** — `stopTracking()`이 `clearDropCells`로 `data-cell-ok` 표식을 지운다.
    //    지운 뒤에 좌표로 칸을 찾으면 항상 빈손이라 드롭이 조용히 사라진다(실측).
    const isBlockDrag = String(e.active.id).startsWith("block:");
    const cellHit = isBlockDrag ? cellAtPointer() : null;
    // 갈 수 있는 칸이 아니면 **그 자리의 아무 칸**을 찾아 이유(`title`)를 미리 읽어 둔다 — `stopTracking()`이 title까지 지운다.
    const blockedCell = isBlockDrag && !cellHit && pointerRef.current ? anyCellAt(pointerRef.current.x, pointerRef.current.y) : null;
    const blockedWhy = blockedCell?.title ?? "";
    // 반 블록을 **다른 반 칸 위에** 놓았나 — 그 반이 '반 전체 나누기'의 받는 반이 된다(포인터는 아래 stopTracking이 지운다).
    const blockSrcId = isBlockDrag ? (e.active.data.current as unknown as ClassDragInfo | undefined)?.classId : undefined;
    const classHit = isBlockDrag && canSplit && blockSrcId && pointerRef.current
      ? classCellAt(pointerRef.current.x, pointerRef.current.y, blockSrcId)
      : null;
    // 학생 드래그 스냅샷은 여기서 한 번 꺼내고 비운다(어느 갈래로 빠져나가든 다음 드래그에 안 남게).
    const studentData = studentDragRef.current;
    studentDragRef.current = null;
    // 🔴 **막힌 반 목록을 먼저 읽는다** — 바로 아래 `stopTracking()`이 맵을 비운다(칸 표식과 같은 함정).
    const studentBlocks = new Map(studentBlockRef.current);
    setDrag(null);
    setTimetableDragging(false);
    stopTracking();
    if (!canDrag) return;
    const { active, over } = e;
    const activeIdStr = String(active.id);
    // ⚠️ 반 블록은 dnd-kit 드롭존이 아니라 **포인터 아래 칸**으로 목적지를 찾는다 → `over`가 없어도 처리한다.
    if (!over && !activeIdStr.startsWith("block:")) return;
    // ── 반 블록을 격자 칸에 놓았을 때 — 큐에만 쌓고 '저장'에서 반영한다(학생 이동과 같은 규약).
    if (activeIdStr.startsWith("block:")) {
      const src = active.data.current as unknown as ClassDragInfo | undefined;
      if (!src) return;
      // 🔑 다른 반 칸 위에 놓았고 나누기 권한이 있으면 **묻는다**(원장 2026-10-06 *"반으로 통으로 … 수업 나누기"*) —
      //    `반 이동`을 고르면 아래 종전 이동을 그대로 탄다(그 칸으로 못 옮기면 사유를 말한다).
      if (classHit) {
        const why = !cellHit
          ? blockedWhy && blockedWhy !== SAME_SPOT_TITLE
            ? `그 칸에는 놓을 수 없습니다 — ${blockedWhy}`
            : "그 칸으로는 반을 옮길 수 없습니다 — 빈 칸에 놓아 주세요."
          : null;
        openWholeSplit(
          { fromClassId: src.classId, fromClassName: src.className, toClassId: classHit.id, toClassName: classHit.name },
          cellHit ? () => queueBlockMove(src, cellHit) : null,
          why,
        );
        return;
      }
      if (!cellHit) {
        // 제자리에 도로 놓은 것 = 취소(말하지 않는다). 막힌 칸이면 **왜** 막혔는지 말한다 — "칸을 찾지 못했다"는
        // 포인터가 격자 밖일 때만 맞는 말이다(원장 제보 2026-09-09: 칸 위에 놓았는데 그 문구가 떴다).
        if (blockedWhy === SAME_SPOT_TITLE) return;
        return refuse(
          blockedWhy ? `그 칸에는 놓을 수 없습니다 — ${blockedWhy}` : "놓을 칸을 찾지 못했습니다 — 격자 칸 위에 놓아 주세요.",
        );
      }
      queueBlockMove(src, cellHit);
      return;
    }
    if (!over || !activeIdStr.startsWith("student:")) return;
    // 도착 정보는 드롭존 data에서 읽는다(id 파싱 금지) — classId=실제 반 id, slotId=셀 id, day=요일 존이면 요일.
    const overData = over.data.current as DropData | undefined;
    if (!overData?.classId) return refuse("반 칸 위에 놓아 주세요.");
    // 스냅샷 우선(집던 줄이 그새 언마운트됐어도 살아 있다) — 없을 때만 dnd-kit의 현재 data.
    const data = studentData ?? (active.data.current as StudentDragData | undefined);
    // 분리등원 요일 칸에서 온 드래그는 id가 `student:{id}:{day}`로 유니크 → id 파싱 대신 data.enrollmentId 우선.
    const enrollmentId = data?.enrollmentId ?? activeIdStr.slice("student:".length);
    const fromClassId = data?.classId ?? ""; // 출발 반 id(실제 반 id)
    if (!fromClassId) return refuse("출발 반을 알 수 없어 옮기지 못했습니다.");
    // 합반 드롭 = 반+요일 선택 팝업(외부 학생 어디든 / 멤버의 다른 세그먼트) — 조용히 대표 반으로 보내지
    // 않고 명시적으로 고르게 한다. 세그먼트 드롭=그 반, 요일존 드롭=그 요일이 미리 선택된 채 열림.
    if (shouldOpenClassPick(fromClassId, overData)) {
      const mc = overData.memberClasses!;
      openClassPick({
        enrollmentId,
        name: data?.name ?? "학생",
        fromClassId,
        fromClassName: data?.fromClassName ?? "다른 반",
        fromDays: data?.attendanceDays ?? [],
        coveringDays: overData.coveringDays ?? [],
        presetClassId: overData.hapbanZone === "segment" ? overData.classId : undefined,
        presetDay: overData.day,
        candidates: mc.map((c, i) => ({
          index: i + 1,
          ...c,
          disabled: data?.blockingClassIds?.includes(c.classId) ?? false,
        })),
      });
      return;
    }
    // 합반 드롭 의미(순수 규칙, lib/hapban.ts): ① 멤버의 카드 내(본문/요일존) 드롭 = 자기 반 요일편집으로
    // 재해석 ② 이미 열린 수강이 있는 반으로의 이동 = no-op(저장 시 GiST 실패 방지) ③ 그 외 기존 동작.
    // ⚠️ 반환 계약: {toClassId, day}만 — toSlotId/toClassName은 overData에서 그대로 유지(전입예정 배지 근거).
    const target = resolveDropTarget(
      { classId: fromClassId, blockingClassIds: data?.blockingClassIds },
      { ...overData, memberClassIds: overData.memberClasses?.map((c) => c.classId) },
    );
    // 규칙 ②(hapban.ts) — 이미 그 반에 열린 수강이 있으면 옮기지 않는다(저장 시 GiST 충돌 방지).
    if (!target) return refuse(`${data?.name ?? "이 학생"}은(는) 이미 그 반 수강이 있습니다.`);
    const toClassId = target.toClassId;
    // 🔴 빗금 친 반은 **놓아도 안 간다** — 화면과 거절이 **같은 맵·같은 문구**를 쓴다(갈리면 "빗금인데 들어가네"가 된다).
    //    맵이 비어 있으면(조회 실패·늦음) 아무것도 안 막는다 — 표식은 도움이지 게이트가 아니다.
    const blockedWhyStudent = studentBlocks.get(toClassId);
    if (blockedWhyStudent)
      return refuse(`${data?.name ?? "이 학생"}은(는) 그 반으로 옮길 수 없습니다 — ${blockedWhyStudent}`);
    const fromDays = data?.attendanceDays ?? []; // 출발 시점 등원 요일(no-op 판정)
    const toDays = zoneAttendanceDays(target.day); // 요일 존=[그 요일], 공통 존=[]
    // 같은 반이면 요일이 바뀔 때만(2일↔1일 편집), 교차 반이면 항상 이동.
    if (fromClassId === toClassId && sameDaySet(fromDays, toDays))
      return refuse("같은 반·같은 요일이라 바뀐 것이 없습니다.");
    // 🔴 **같은 반 요일 편집은 날짜 팝업을 안 띄운다** — `attendance_days`는 날짜 축이 없는 값이라
    //    (RPC도 즉시 갱신) 고를 것이 없다. 물으면 지킬 수 없는 약속이 된다.
    if (fromClassId === toClassId) {
      queued(`${data?.name ?? "학생"} 등원 요일 변경`);
      queueMove({
        enrollmentId,
        fromClassId,
        fromClassName: data?.fromClassName ?? "다른 반",
        toClassId,
        toClassName: overData?.className ?? "다른 반",
        name: data?.name ?? "학생",
        toSlotId: overData?.slotId,
        toDays,
        fromDays,
      });
      return;
    }
    // 🔴 반 이동은 **놓는 순간 날짜를 묻는다**(원장 2026-09-09 *"드랍을 하면 날짜지정 팝업"*) —
    //    확인해야 큐에 들어간다(취소 = 아무 일도 없음). 토스트도 확인 뒤에 뜬다.
    openMoveDate({
      enrollmentId,
      studentId: data?.studentId,
      fromClassId,
      fromClassName: data?.fromClassName ?? "다른 반",
      toClassId,
      toClassName: overData?.className ?? "다른 반",
      name: data?.name ?? "학생",
      toSlotId: overData?.slotId,
      toDays,
      fromDays,
    });
  }

  return (
    <DndContext
      id="timetable-dnd"
      sensors={sensors}
      collisionDetection={preferDayZone}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        studentDragRef.current = null;
        setDrag(null);
        setBlockGhost(null);
        setTimetableDragging(false);
        stopTracking();
      }}
    >
      {/* 드래그 직후의 더블클릭은 창 열기가 아니다 — 캡처에서 삼킨다(drag-flag.ts `swallowDoubleClickAfterDrag`).
          `display: contents`라 격자 레이아웃(flex 사슬)엔 아무 영향이 없다. */}
      <div
        className="contents"
        onDoubleClickCapture={swallowDoubleClickAfterDrag}
        // 끌었다가 **제자리에** 놓은 것도 드래그로 친다(drag-flag `noteDragPointerUp` 주석) — dnd-kit이
        // 활성화 문턱을 못 넘긴 짧은 드래그는 브라우저엔 평범한 클릭이라, 두 번 하면 창이 열렸다.
        // 상세는 이제 **한 번 클릭**으로 열린다(원장 2026-09-09) — 끌었다 놓은 뒤의 클릭은 삼켜야
        // 옮길 때마다 창이 함께 열리지 않는다(drag-flag `swallowClickAfterDrag`).
        onClickCapture={swallowClickAfterDrag}
        onPointerDownCapture={noteDragPointerDown}
        onPointerUpCapture={noteDragPointerUp}
      >
        {children}
      </div>
      {/* 고스트 = **원본 줄 그대로**, 파일 이동처럼 반투명(원장 2026-09-04). 이름만 남긴 칩으로 바꾸면
          "무엇을 끌고 있는지"는 알아도 "어느 줄을 집었는지"가 사라진다 — 같은 이름이 여러 반에 있다. */}
      {/* 🔴 오버레이는 히트테스트를 가로채면 안 된다 — 반 드롭은 포인터 아래 칸을 읽는다(위 `okCellAt`). */}
      <DragOverlay dropAnimation={null} style={{ pointerEvents: "none" }}>
        {/* 반 블록 — 셀 머리를 그대로 복제한다(색·이름·강의실·인원·폭). 학생 줄과 같은 규약: 원본 그대로, 조금 연하게. */}
        {blockGhost ? (
          <div
            className={`pointer-events-none cursor-grabbing overflow-hidden rounded-[3px] opacity-80 shadow-lg ${blockGhost.headerClass}`}
            style={{
              ...blockGhost.headerStyle,
              width: blockGhost.width || undefined,
              height: blockGhost.height || undefined,
            }}
          >
            <div className="flex items-baseline justify-between gap-1.5 px-2 py-1">
              <span className="min-w-0 overflow-hidden text-sm font-bold whitespace-nowrap text-clip">
                {blockGhost.className}
              </span>
              <span className="num shrink-0 text-xs opacity-70">{blockGhost.count}</span>
            </div>
            <div className="flex items-center justify-end px-2 text-xs opacity-75">
              <span className="overflow-hidden whitespace-nowrap text-clip">{blockGhost.room || " "}</span>
            </div>
          </div>
        ) : drag ? (
          <div
            // 🔴 배경색도 원본 그대로(원장 2026-09-04 *"배경색상까지도 같이 고스트되면 같이"*) — 신입 빨강·전입 초록·
            //    퇴원 회색이 곧 그 줄의 뜻이다. tone에 배경이 없을 때만 카드색을 깔아 글자가 뜨는 것을 막는다.
            //    ⚠️ `bg-card`를 항상 깔면 안 된다 — 같은 축 유틸이 겹치면 승자를 CSS 순서가 정한다([[#116]]).
            className={`${ROW_CLASS} ring-primary/50 pointer-events-none cursor-grabbing rounded-[3px] text-sm opacity-80 shadow-lg ring-1 ${/(^|\s)bg-/.test(drag.tone) ? "" : "bg-card"} ${drag.tone}`}
            style={drag.width ? { width: drag.width } : undefined}
          >
            <span className="block overflow-hidden whitespace-nowrap text-clip">
              <IndexBadge badge={drag.badge} />
              {drag.name}
              {drag.meta ? <span className="opacity-90">/{drag.meta}</span> : null}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
