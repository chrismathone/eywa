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
import { Check, Loader2, Pencil, X } from "@/components/icons/eywa-icon-compat";
import {
  moveEnrollmentsBatch,
  updateEnrollmentsAttendanceBatch,
} from "@/features/enrollments/server/actions";
import { endSingleEnrollment } from "@/features/students/server/actions";
import { compressMoves, type PendingMove } from "@/features/timetable/lib/move-compress";
import { resolveDropTarget, shouldOpenClassPick, type HapbanMemberClass } from "@/features/timetable/lib/hapban";
import { DAY_LABEL, sameDaySet, zoneAttendanceDays } from "@/features/timetable/lib/split-attendance";
import {
  TimetableEditContext,
  useTimetableEdit,
  type ClassPickCandidate,
  type ClassPickTarget,
  type DayEditTarget,
  type HoveredStudent,
  type IncomingStudent,
  type PendingTarget,
} from "./edit-context";
import { setTimetableDragging } from "./drag-flag";
import { IndexBadge, ROW_CLASS } from "./student-rows";

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
}: {
  children: ReactNode;
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
  // 드래그 가능 = 권한 + 이번/미래 주. 옛 '편집 모드' state는 없앴다(모드 없이 바로 드래그) — 과거 주로
  // 이동하면 이 값이 그대로 false라 Delete 핸들러·드롭·저장이 함께 잠긴다(#77: 게이트는 UI가 아니라 여기).
  const canDrag = canEdit;
  const [queue, setQueue] = useState<Queued[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
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

  // 학생 위에 마우스 올린 채 Delete → 오늘 수강 종료 **확인 팝업**. 입력창 타이핑 중엔 무시.
  // ⚠️ 옛 '편집 모드'가 이 단축키의 문이었는데 모드가 사라졌다 — 이제 편집 권한(canDrag)이 곧 문이고,
  //    실제 종료는 팝업에서 한 번 더 확인해야 일어난다(키 하나로 조용히 지워지지 않는다).
  useEffect(() => {
    if (!canDrag) return;
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
  }, [canDrag]);

  async function confirmEndEnrollment() {
    if (!endTarget) return;
    setEnding(true);
    setEndError(null);
    const fd = new FormData();
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

  // enrollmentId → 최종 대상. 출발 셀이 취소선+→대상(반이동) 또는 "→요일"(같은 반 요일편집) 마커를 그리는 데 사용.
  const pending = useMemo<Map<string, PendingTarget>>(() => {
    const m = new Map<string, PendingTarget>();
    for (const r of resolved)
      m.set(r.enrollmentId, {
        toClassId: r.toClassId,
        toClassName: r.toClassName,
        toDays: r.toDays,
        sameClass: r.fromClassId === r.toClassId,
      });
    return m;
  }, [resolved]);

  // 도착 셀 slot.id(=toSlotId) → 전입 예정 학생들. 도착 셀이 초록 미리보기 행을 그리는 데 사용.
  // 마커는 "그 셀"에 붙어야 하므로 반 id가 아니라 셀 slot.id로 키잉(한 반이 여러 셀에 걸쳐도 드롭한 셀만).
  // ⚠️ 같은 반 요일 편집(반 이동 아님)은 '전입 예정'이 아니므로 제외 — 출발 셀의 "→요일" 배지로만 표시.
  const incoming = useMemo<Map<string, IncomingStudent[]>>(() => {
    const m = new Map<string, IncomingStudent[]>();
    for (const r of resolved) {
      if (r.fromClassId === r.toClassId) continue; // 같은 반 요일 편집 → 전입 예정 아님
      const key = r.toSlotId ?? r.toClassId;
      const arr = m.get(key) ?? [];
      arr.push({
        enrollmentId: r.enrollmentId,
        name: r.name,
        fromClassName: r.fromClassName,
        attendanceDays: r.toDays, // 도착 요일 존의 등원 요일([목] 등) — 미리보기 라벨용
      });
      m.set(key, arr);
    }
    return m;
  }, [resolved]);

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
  }) {
    if (!canEdit) return; // 과거 주 등 편집 불가 주에서는 어떤 경로로도 큐잉되지 않는다(F1).
    // 다른 주의 대기 이동이 남아 있으면 섞지 않는다 — 한 번의 저장은 하나의 적용일로 나가므로,
    // 섞이면 어느 한쪽이 반드시 틀린 날짜로 적용된다(F2). 저장/취소로 정리한 뒤 편집하게 한다.
    if (weekMismatch) {
      setError("다른 주에서 대기 중인 이동이 있습니다. 저장하거나 취소한 뒤 편집하세요.");
      return;
    }
    setError(null);
    setFailed([]);
    setQueue((prev) => {
      // 전부 되돌린(net no-op) 낡은 배치는 새 배치를 시작하기 전에 비운다 — 안 비우면 raw 큐에 남은
      // 낡은 앵커(effectiveOn)가 새 이동의 적용일을 오염시킨다(적대 리뷰 확정 결함의 나머지 반쪽).
      const base = compressMoves(prev).length === 0 ? [] : prev;
      return [...base, { ...move, effectiveOn: queueIntent }];
    });
  }

  // 합반 반+요일 선택 팝업 적용 → 고른 반·요일로 이동 큐잉. toSlotId=그 반 세그먼트 slot(전입예정 배지 인덱스 정확).
  function applyClassPick(picked: ClassPickCandidate, days: string[]) {
    if (!classPick) return;
    queueMove({
      enrollmentId: classPick.enrollmentId,
      fromClassId: classPick.fromClassId,
      fromClassName: classPick.fromClassName,
      toClassId: picked.classId,
      toClassName: picked.className,
      name: classPick.name,
      toSlotId: picked.slotId,
      toDays: days,
      fromDays: classPick.fromDays,
    });
    setClassPick(null);
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

  const compressed = compressMoves(queue);

  // 대기 배치의 적용 앵커(첫 항목의 큐잉 의도). 저장은 지금 보는 주가 아니라 이 값을 쓴다 — 큐가 주
  // 이동을 넘어 살아남으므로, 저장 시점 화면에 묶으면 미래주 예약이 오늘자로 적용되거나 즉시 이동이
  // 미래로 예약되는 뒤바뀜이 생긴다(적대 감사 F2).
  // ⚠️ "배치가 살아있는가"는 raw 큐가 아니라 **compressed** 기준 — A→B→A처럼 전부 되돌린 net no-op
  // 큐를 raw 기준으로 잡으면, 주 이동 후 '대기 0건'인데 편집이 잠기는 유령 잠금이 생긴다(적대 리뷰 확정).
  const queueDate = compressed.length > 0 ? (queue[0]?.effectiveOn ?? null) : null;
  const weekMismatch = compressed.length > 0 && (queue[0]?.effectiveOn ?? null) !== queueIntent;

  // 미저장 이동이 있는 채로 새로고침·탭 닫기 하면 경고(가져오기 다이얼로그와 동일 패턴).
  // 앱 내 주/과목 이동은 weekMismatch 경고 + queueDate 앵커로 이미 안전하므로 여기선 문서 이탈만 막는다(F7).
  useEffect(() => {
    if (compressed.length === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [compressed.length]);

  async function save() {
    if (compressed.length === 0) {
      setQueue([]);
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
    try {
      // 교차 반 이동 = move_enrollments_batch(적용일 split). 같은 반 요일 편집 = attendance_days 갱신(전입 플래그 없음).
      const moves = compressed.filter((m) => m.fromClassId !== m.toClassId);
      const dayEdits = compressed.filter((m) => m.fromClassId === m.toClassId);
      if (moves.length > 0) {
        const res = await moveEnrollmentsBatch(
          moves.map((m) => ({
            enrollmentId: m.enrollmentId,
            newClassId: m.toClassId,
            attendanceDays: m.toDays ?? [],
          })),
          // ⚠️ 적용일 = 사용자가 명시한 날짜 > **큐의 앵커 의도**(null=즉시 → 미지정으로 넘겨 서버
          // current_date). 지금 보는 주(effectiveDate)는 절대 안 쓴다 — 주를 옮겨도 저장 결과가 바뀌면
          // 안 되고(F2), 즉시 의도를 날짜로 얼리면 자정 넘긴 저장이 소급 가드에 거부된다(적대 리뷰 확정).
          scheduledDate ?? queueDate ?? undefined,
        );
        if (res.error) {
          setError(res.error);
          return;
        }
        const fails = (res.results ?? []).filter((r) => !r.ok);
        if (fails.length > 0) setFailed(fails.map((f) => f.error ?? f.enrollmentId));
      }
      if (dayEdits.length > 0) {
        const r2 = await updateEnrollmentsAttendanceBatch(
          dayEdits.map((m) => ({ enrollmentId: m.enrollmentId, days: m.toDays ?? [] })),
        );
        if (r2.error) {
          setError(r2.error);
          return;
        }
      }
      setQueue([]);
      setScheduledDate(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setQueue([]);
    setScheduledDate(null);
    setError(null);
    setFailed([]);
  }

  return (
    <TimetableEditContext.Provider
      value={{
        canDrag,
        pending,
        incoming,
        queueMove,
        pendingCount: compressed.length,
        save,
        cancel,
        saving,
        error,
        failed,
        scheduledDate,
        setScheduledDate,
        dateFloor,
        queueDate,
        weekMismatch,
        setHovered,
        openDayEdit,
        openClassPick,
      }}
    >
      {children}
      {endTarget ? (
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
        <ClassPickPopover target={classPick} onCancel={() => setClassPick(null)} onApply={applyClassPick} />
      ) : null}
    </TimetableEditContext.Provider>
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
  onCancel,
  onApply,
}: {
  target: ClassPickTarget;
  onCancel: () => void;
  onApply: (picked: ClassPickCandidate, days: string[]) => void;
}) {
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
        {noDay ? <p className="text-chart-4 mt-2 text-xs">최소 한 요일은 선택해야 합니다.</p> : null}
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
            onClick={() => picked && onApply(picked, toDays)}
            disabled={!picked || noDay}
            className="bg-primary text-primary-foreground hover:bg-primary/85 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
          >
            이동
          </button>
        </div>
      </div>
    </div>
  );
}

/** 편집 모드 Delete → 오늘 수강 종료 확인 팝업(파괴적 동작이라 확인 필수). Esc/바깥클릭=취소, 확인 버튼 autofocus. */
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
  onConfirm: () => void;
}) {
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
      <div
        className="bg-card border-line w-[340px] rounded-xl border p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-foreground text-sm font-bold">수강 종료</p>
        <p className="text-text-dim mt-2 text-sm leading-relaxed">
          <b className="text-foreground">{target.name}</b> 학생을{" "}
          <b className="text-foreground">{target.className}</b> 반에서{" "}
          <b className="text-foreground">오늘({today})</b> 수강 종료할까요?
        </p>
        <p className="text-text-faint mt-1 text-xs">
          이 반의 퇴원 목록으로 이동합니다. 다른 반 수강은 유지됩니다.
        </p>
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
            type="button"
            autoFocus
            onClick={onConfirm}
            disabled={ending}
            className="bg-danger hover:bg-danger/90 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition disabled:opacity-50"
          >
            {ending ? "처리 중…" : "수강 종료"}
          </button>
        </div>
      </div>
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
    pendingCount,
    save,
    cancel,
    saving,
    error,
    failed,
    scheduledDate,
    setScheduledDate,
    dateFloor,
    queueDate,
    weekMismatch,
  } = useTimetableEdit();
  // 표시·저장 모두 "큐가 만들어진 주"를 앵커로 — 주를 옮겨도 적용일 표시가 실제 적용값과 어긋나지 않게(F2).
  const anchorDate = queueDate ?? dateFloor;
  if (pendingCount === 0 && !error && failed.length === 0) {
    return (
      <span className="print:hidden text-text-faint text-xs">
        {rosterHidden
          ? "학생 명단을 접어 둔 상태입니다 — 뷰 설정에서 펼치면 끌어 옮길 수 있습니다"
          : "학생을 끌어 반을 옮기고, 더블클릭으로 상세를 엽니다"}
      </span>
    );
  }
  return (
    <div className="print:hidden flex flex-wrap items-center gap-2 text-xs">
      {pendingCount > 0 ? (
        <>
          <span className="text-primary inline-flex items-center gap-1.5 font-medium">
            <Pencil className="size-3" />
            <span className="num">{pendingCount}건</span> 이동 대기
          </span>
          {/* 적용일(즉시=오늘/조회 주, 예정일=날짜 지정). 이동은 이 날짜에 반영(옛 반은 그날 전까지 유지). */}
          <label className="text-text-dim inline-flex items-center gap-1">
            적용일
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
      {failed.length > 0 ? (
        <span className="text-amber">{failed.length}건 실패(시간겹침 등) — 나머지는 저장됨</span>
      ) : null}
    </div>
  );
}

/**
 * 드롭 대상 우선순위 — 요일 존(class:slotId:day, 콜론 3조각)이 셀(class:slotId, 2조각)과 겹치면 요일 존을 택한다.
 * 그래야 "목 칸에 드롭 = 목만 등원"이 셀 전체 드롭(=전 요일)보다 우선한다. slotId는 UUID라 콜론이 없어 조각 수로 구분.
 */
const preferDayZone: CollisionDetection = (args) => {
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
  const { canDrag, queueMove, openClassPick } = useTimetableEdit();
  // 끌리는 줄의 **원본 모습**(이름·학교학년·톤·폭) — 고스트를 셀 안 줄과 똑같이 그리기 위한 재료.
  const [drag, setDrag] = useState<{ name: string; meta: string; tone: string; badge?: string; width: number } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function onDragStart(e: DragStartEvent) {
    const data = e.active.data.current as { name?: string; meta?: string; tone?: string; badge?: string } | undefined;
    // 폭은 집은 줄의 실측 폭 — 파일 드래그처럼 "그 줄이 그대로 떠 있는" 느낌이 되게(칩으로 줄이면 딴 물건이 된다).
    const width = Math.round(e.active.rect.current.initial?.width ?? 0);
    setDrag({ name: data?.name ?? "학생", meta: data?.meta ?? "", tone: data?.tone ?? "", badge: data?.badge, width });
    setTimetableDragging(true);
  }

  function onDragEnd(e: DragEndEvent) {
    setDrag(null);
    setTimetableDragging(false);
    if (!canDrag) return;
    const { active, over } = e;
    if (!over) return;
    const activeIdStr = String(active.id);
    if (!activeIdStr.startsWith("student:")) return;
    // 도착 정보는 드롭존 data에서 읽는다(id 파싱 금지) — classId=실제 반 id, slotId=셀 id, day=요일 존이면 요일.
    const overData = over.data.current as DropData | undefined;
    if (!overData?.classId) return;
    const data = active.data.current as
      | {
          classId?: string;
          fromClassName?: string;
          name?: string;
          enrollmentId?: string;
          attendanceDays?: string[];
          blockingClassIds?: string[];
        }
      | undefined;
    // 분리등원 요일 칸에서 온 드래그는 id가 `student:{id}:{day}`로 유니크 → id 파싱 대신 data.enrollmentId 우선.
    const enrollmentId = data?.enrollmentId ?? activeIdStr.slice("student:".length);
    const fromClassId = data?.classId ?? ""; // 출발 반 id(실제 반 id)
    if (!fromClassId) return;
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
    if (!target) return;
    const toClassId = target.toClassId;
    const fromDays = data?.attendanceDays ?? []; // 출발 시점 등원 요일(no-op 판정)
    const toDays = zoneAttendanceDays(target.day); // 요일 존=[그 요일], 공통 존=[]
    // 같은 반이면 요일이 바뀔 때만(2일↔1일 편집), 교차 반이면 항상 이동.
    if (fromClassId === toClassId && sameDaySet(fromDays, toDays)) return;
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
  }

  return (
    <DndContext
      id="timetable-dnd"
      sensors={sensors}
      collisionDetection={preferDayZone}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDrag(null);
        setTimetableDragging(false);
      }}
    >
      {children}
      {/* 고스트 = **원본 줄 그대로**, 파일 이동처럼 반투명(원장 2026-09-04). 이름만 남긴 칩으로 바꾸면
          "무엇을 끌고 있는지"는 알아도 "어느 줄을 집었는지"가 사라진다 — 같은 이름이 여러 반에 있다. */}
      <DragOverlay dropAnimation={null}>
        {drag ? (
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
