"use client";
/**
 * '출결 모드' 본체 — 내 반 카드 목록 + 낙관 반영 + 저장.
 *
 * 🔴 **새 저장 경로를 만들지 않는다**(원장 2026-08-20: *"배선 철저히해서 다른 출결 시스템과 잘 연동되게"*).
 *    개별 = `setAttendanceCell`, 일괄 = `setAttendanceBulk` — 권한·담당 반·수강생·7일 잠금·데스크 유예·
 *    교차 알림·'전원 기록 완료' 전이가 전부 그 안에 있다. 여기서 새 경로를 파면 그 전부를 다시 만들어야
 *    하고, 하나만 빠뜨려도 조용히 갈린다(#77).
 * 🔴 **저장 축**은 `slotStart: student.writeSlot` · `periodStart: klass.firstStart` — 좌석표 칸과 같은 값이다
 *    (seating-cell.tsx). 화면에 보이는 교시(`firstStart`)를 저장 축으로 쓰면 영어에서 시수가 두 배가 된다.
 * 🔴 서버가 거절하면 **낙관 반영을 되돌리고 한글 사유를 띄운다** — 조용히 되돌리면 "눌렀는데 아무 일도
 *    없다"가 된다(월별 출석부에서 방금 고친 그 결함). 토스트는 지나가므로 **띠로도** 남긴다.
 * 🔴 **한 칸의 저장은 순서대로 나간다**(`chainRef`). 결석은 '상태 저장 → 사유 메모(noteOnly)' 두 번인데,
 *    사유를 빨리 누르면 메모가 **행이 생기기 전에** 도착해 "그날 출결 기록이 없어 메모만 남길 수 없습니다"로
 *    거절된다 — 그러면 2터치로 찍은 결석에 사유만 조용히 안 붙는다.
 * ⚠️ 성공했을 땐 `router.refresh()`를 부르지 않는다 — 서버 액션 응답이 이미 이 라우트의 RSC 트리를
 *    다시 적용하고([[#102]]), 화면 숫자는 전부 낙관 반영을 덮은 목록에서 나온다. 실패했거나 **일괄이
 *    일부만 적용됐을 때만** 서버 진실로 되맞춘다. 폴링도 없다(강사 한 사람의 화면이다).
 */
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { CalendarDays } from "@/components/icons/eywa-icon-compat";
import { publishAttendanceApplied } from "@/features/attendance/live/attendance-applied-bus";
import { setAttendanceBulk, setAttendanceCell } from "@/features/attendance/server/actions";
import {
  applyQuickMarks,
  bulkPlan,
  initiallyCollapsed,
  quickCellKey,
  quickSummary,
  type QuickClass,
  type QuickMark,
} from "../board";
import { QuickClassCard } from "./quick-class-card";
import { QuickMarkSheet, type QuickSaveInput } from "./quick-mark-sheet";

const SAVE_FAILED = "저장하지 못했습니다 — 다시 눌러 주세요";

export function QuickBoard({
  date,
  classes,
  canEdit,
}: {
  date: string;
  classes: QuickClass[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [marks, setMarks] = useState<Record<string, QuickMark>>({});
  const [open, setOpen] = useState<{ classId: string; studentId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 처음 열 때 다 찍은 반만 접는다 — **첫 렌더 한 번**이라 작업 중 카드가 눈앞에서 접히지 않는다.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => initiallyCollapsed(classes));
  /**
   * 진행 중인 저장 수 — 반(`bulk:반`) 단위 **카운터**다.
   * ⚠️ Set으로 두면 저장이 겹쳤을 때 **먼저 끝난 쪽이 잠금을 풀어** 아직 나가 있는 요청을 끝난 것으로
   *    만든다(상단 스트립 동기화에서 겪은 그대로).
   */
  const [pending, setPending] = useState<Record<string, number>>({});
  /** 칸마다의 저장 순서 보장 — 결석(상태) → 사유(noteOnly)가 뒤집히지 않게. */
  const chainRef = useRef<Map<string, Promise<void>>>(new Map());

  const view = useMemo(() => applyQuickMarks(classes, marks), [classes, marks]);
  const sum = quickSummary(view);
  const targetClass = open ? view.find((c) => c.classId === open.classId) : undefined;
  const target = open ? targetClass?.students.find((s) => s.studentId === open.studentId) : undefined;

  function bump(key: string, delta: number) {
    setPending((prev) => {
      const next = { ...prev };
      const value = (next[key] ?? 0) + delta;
      if (value <= 0) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  /** 낙관 반영 한 칸 — 실패하면 이 항목을 지워 **서버가 내려준 값**으로 되돌아간다. */
  function put(classId: string, studentId: string, mark: QuickMark) {
    setMarks((prev) => ({ ...prev, [quickCellKey(classId, studentId)]: mark }));
  }
  function revert(classId: string, studentId: string) {
    setMarks((prev) => {
      const next = { ...prev };
      delete next[quickCellKey(classId, studentId)];
      return next;
    });
  }
  function fail(message: string) {
    setError(message);
    toast.error(message);
    router.refresh(); // 거절 뒤에는 서버 진실로 되맞춘다(낙관값이 남아 있지 않게)
  }

  /**
   * 같은 칸의 저장을 **직렬로** 잇는다(앞 요청이 실패해도 뒤는 계속 나간다 — 거절 안내는 각자 한다).
   * ⚠️ 실제 호출이 마이크로태스크로 밀리므로 `startTransition`으로 감싸도 스코프 밖에서 나간다 —
   *    진행 표시는 위 `pending` 카운터가 맡는다(있지도 않은 transition에 기대지 않는다).
   */
  function chain(key: string, run: () => Promise<void>) {
    const prev = chainRef.current.get(key) ?? Promise.resolve();
    chainRef.current.set(key, prev.catch(() => {}).then(run));
  }

  function saveCell(klass: QuickClass, studentId: string, input: QuickSaveInput) {
    const student = klass.students.find((s) => s.studentId === studentId);
    if (!student) return;
    const key = quickCellKey(klass.classId, studentId);
    setError(null);
    put(klass.classId, studentId, {
      status: input.status,
      note: input.note === undefined ? student.note : input.note,
    });
    bump(key, 1);
    chain(key, () =>
      setAttendanceCell({
        studentId,
        classId: klass.classId,
        sessionDate: date,
        status: input.status,
        // 메모를 안 넘기면 서버가 기존 메모를 그대로 둔다 — undefined와 null은 뜻이 다르다.
        ...(input.note === undefined ? {} : { note: input.note }),
        // 🔴 저장 축 — 화면 교시가 아니라 그 칸의 writeSlot(좌석표와 같은 값).
        slotStart: student.writeSlot,
        periodStart: klass.firstStart,
        source: "live",
      })
        .then((res) => {
          if ("error" in res) {
            revert(klass.classId, studentId);
            fail(res.error);
            return;
          }
          // 같은 문서에 열려 있는 화면(원스크린·ECS)이 새로고침 없이 따라오게 — 저장 축 그대로 싣는다.
          publishAttendanceApplied({
            date,
            status: input.status,
            slot: student.writeSlot,
            cells: [{ studentId, classId: klass.classId }],
          });
        })
        .catch(() => {
          revert(klass.classId, studentId);
          fail(SAVE_FAILED);
        })
        .finally(() => bump(key, -1)),
    );
  }

  /**
   * 사유 메모만 갱신 — 이미 저장된 결석에 사유를 덧붙이는 경로(`noteOnly`).
   * 🔴 상태·시수를 다시 보내지 않는다 — 다시 보내면 방금 저장한 값을 덮어쓰고 `recorded_at`도 바뀐다.
   */
  function saveNote(klass: QuickClass, studentId: string, note: string) {
    const student = klass.students.find((s) => s.studentId === studentId);
    if (!student) return;
    const key = quickCellKey(klass.classId, studentId);
    const prevNote = student.note;
    setError(null);
    put(klass.classId, studentId, { status: student.status, note });
    bump(key, 1);
    chain(key, () =>
      setAttendanceCell({
        studentId,
        classId: klass.classId,
        sessionDate: date,
        // noteOnly면 서버가 상태를 읽지도 쓰지도 않는다 — 화면 값을 그대로 되보낸다(cell-popover와 같은 규약).
        status: null,
        note,
        noteOnly: true,
        slotStart: student.writeSlot,
      })
        .then((res) => {
          if ("error" in res) {
            // 상태는 이미 저장돼 있다 — 메모만 원래대로 되돌린다(결석을 지우지 않는다).
            put(klass.classId, studentId, { status: student.status, note: prevNote });
            fail(res.error);
          }
        })
        .catch(() => {
          put(klass.classId, studentId, { status: student.status, note: prevNote });
          fail(SAVE_FAILED);
        })
        .finally(() => bump(key, -1)),
    );
  }

  function saveBulk(klass: QuickClass) {
    const plan = bulkPlan(klass);
    if (plan.cells.length === 0) return;
    const key = `bulk:${klass.classId}`;
    setError(null);
    for (const c of plan.cells) put(klass.classId, c.studentId, { status: "present", note: null });
    bump(key, 1);
    setAttendanceBulk({
      sessionDate: date,
      status: "present",
      cells: plan.cells,
      fillEmptyOnly: true, // 서버 강제 — 낡은 화면이 남이 찍은 결석을 뒤집지 못한다
      slotStart: plan.slot,
      periodStart: klass.firstStart,
      source: "live",
    })
      .then((res) => {
        if ("error" in res) {
          for (const c of plan.cells) revert(klass.classId, c.studentId);
          fail(res.error);
          return;
        }
        // 서버가 **실제로 기록한** 칸만 남긴다 — 걸러진 칸(이미 입력·유예)은 서버 값으로 되돌린다.
        const applied = new Set(res.applied.map((a) => `${a.classId}::${a.studentId}`));
        for (const c of plan.cells) {
          if (!applied.has(`${c.classId}::${c.studentId}`)) revert(klass.classId, c.studentId);
        }
        if (res.applied.length > 0) {
          publishAttendanceApplied({
            date,
            status: "present",
            slot: plan.slot,
            cells: res.applied.map((a) => ({ studentId: a.studentId, classId: a.classId })),
          });
        }
        if (res.applied.length < plan.cells.length) {
          // 🔴 걸러진 칸을 되돌리면 화면이 **낡은 서버 값**(빈 칸)으로 돌아간다 — 정작 서버엔 남이 찍은
          //    기록이 있다. "건너뛰었습니다"라고만 말하고 빈 칸을 보여 주면 그 안내가 거짓처럼 읽힌다.
          if (res.blocked > 0) toast.info(`${res.blocked}명은 이미 입력되어 있어 건너뛰었습니다`);
          router.refresh();
        }
      })
      .catch(() => {
        for (const c of plan.cells) revert(klass.classId, c.studentId);
        fail(SAVE_FAILED);
      })
      .finally(() => bump(key, -1));
  }

  if (view.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="오늘은 담당 수업이 없습니다"
        description="시간표에 오늘 열린 내 수업이 없습니다. 지난 날짜는 월별 출석부에서 고칠 수 있습니다."
      />
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-text-dim px-1 text-sm">
        미출결 <span className="text-danger num font-bold">{sum.unmarked}</span>명 · 입력{" "}
        <span className="num font-bold">
          {sum.recorded}/{sum.expected}
        </span>
        {canEdit ? null : <span className="text-amber ml-2 font-bold">읽기 전용</span>}
      </p>
      {/* 거절 띠 — 토스트는 몇 초 뒤 사라지고 시트는 이미 닫혀 있을 수 있다. 다음 입력을 시작하면
          (`setError(null)`) 스스로 사라진다. 시트가 열려 있으면 시트 안에 같은 문장이 있어 생략. */}
      {error && !open ? (
        <p className="bg-danger-soft text-danger rounded-xl px-3 py-2 text-sm font-medium">{error}</p>
      ) : null}
      {view.map((klass) => (
        <QuickClassCard
          key={klass.classId}
          klass={klass}
          collapsed={collapsed.has(klass.classId)}
          canEdit={canEdit}
          bulkCount={bulkPlan(klass).cells.length}
          bulkBusy={(pending[`bulk:${klass.classId}`] ?? 0) > 0}
          onToggle={() =>
            setCollapsed((prev) => {
              const next = new Set(prev);
              if (next.has(klass.classId)) next.delete(klass.classId);
              else next.add(klass.classId);
              return next;
            })
          }
          onBulk={() => saveBulk(klass)}
          onPick={(studentId) => {
            setError(null);
            setOpen({ classId: klass.classId, studentId });
          }}
        />
      ))}
      {open && target && targetClass ? (
        <QuickMarkSheet
          studentName={target.studentName}
          schoolGrade={target.schoolGrade}
          className={targetClass.className}
          status={target.status}
          note={target.note}
          error={error}
          onSave={(input) => saveCell(targetClass, target.studentId, input)}
          onSaveNote={(note) => saveNote(targetClass, target.studentId, note)}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
