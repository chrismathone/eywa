"use client";

/**
 * 당일 출결 보드 — **강사별 → 교시별 카드**. 원장 표현 그대로의 "당일 선생님별 출석부".
 *
 * 이 화면의 성공 조건은 하나다: **수업 시작 직후 30초 안에 끝난다.** 그래서
 *  · 기본 동작은 「나머지 N명 출석」 **한 번**(실측상 결석은 하루 6~10건뿐 — 대부분의 반은 전원 출석)
 *  · 예외만 이름 옆 알약으로 1클릭(결석·지각은 사유 창)
 *  · 시수·메모·보강 같은 정밀 편집은 여기 없다(출석부·원스크린 몫)
 *
 * 알약은 ECS 오늘 보드와 **같은 컴포넌트**(TodayAttendancePills)를 쓴다 — 강사가 화면마다 다른
 * 제스처를 외우지 않게. 저장도 기존 액션(setAttendanceCell/setAttendanceBulk)만 쓴다(#77).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TodayAttendancePills } from "@/features/class-sheets/components/today-attendance-pills";
import { setAttendanceBulk, setAttendanceCell } from "@/features/attendance/server/actions";
import { EmptyState } from "@/components/empty-state";
import { CalendarDays } from "@/components/icons/eywa-icon-compat";
import type { LiveBoard, LiveBoardSlot } from "@/features/attendance/live/types";
import type { BasicAttendance } from "@/features/class-sheets/lib/mark-cycle";

export function BoardView({ board }: { board: LiveBoard }) {
  if (board.teachers.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="이 날은 수업이 없습니다"
        description={board.scopedToSelf ? "담당 수업이 없는 날입니다." : "시간표에 열린 수업이 없습니다."}
      />
    );
  }
  return (
    <div className="space-y-6">
      {board.teachers.map((t) => (
        <section key={t.teacherId ?? "none"} className="space-y-2.5">
          <header className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-base font-bold">{t.teacherName}</h2>
            <span
              className={`num rounded-full px-2 py-0.5 text-xs font-bold ${
                t.recorded >= t.expected ? "bg-primary/10 text-primary" : "bg-amber/15 text-amber-strong"
              }`}
            >
              {t.recorded}/{t.expected}
            </span>
            {t.recorded < t.expected && (
              <span className="text-text-faint text-xs">미입력 {t.expected - t.recorded}명</span>
            )}
          </header>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {t.slots.map((slot) => (
              <SlotCard key={slot.key} slot={slot} date={board.date} canEdit={board.canEdit} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const PHASE_BADGE: Record<string, { label: string; cls: string }> = {
  before: { label: "예정", cls: "bg-bg-soft text-text-faint" },
  grace: { label: "진행 중", cls: "bg-primary/10 text-primary" },
  due: { label: "진행 중", cls: "bg-primary/10 text-primary" },
  ended: { label: "종료", cls: "bg-bg-soft text-text-dim" },
};

function SlotCard({ slot, date, canEdit }: { slot: LiveBoardSlot; date: string; canEdit: boolean }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // 낙관 갱신 — 누른 즉시 색이 바뀐다. ⚠️ 서버가 거절하면 되돌린다(.catch 없으면 거짓 성공이 남는다).
  const [optimistic, setOptimistic] = useState<Record<string, string | null>>({});

  const statusOf = (studentId: string, base: string | null) =>
    studentId in optimistic ? optimistic[studentId] : base;

  const pending = slot.students.filter((s) => statusOf(s.studentId, s.status) == null);
  const badge = PHASE_BADGE[slot.phase] ?? PHASE_BADGE.before;
  const done = slot.students.length - pending.length;

  function save(studentId: string, status: BasicAttendance | null, note?: string | null) {
    setError(null);
    setOptimistic((m) => ({ ...m, [studentId]: status }));
    startTransition(() => {
      setAttendanceCell({
        studentId,
        classId: slot.classId,
        sessionDate: date,
        status,
        slotStart: slot.slotStart,
        ...(note !== undefined ? { note } : {}),
        quiet: true,
      })
        .then((res) => {
          if ("error" in res) {
            setOptimistic((m) => {
              const next = { ...m };
              delete next[studentId];
              return next;
            });
            setError(res.error);
            return;
          }
          router.refresh();
        })
        .catch(() => {
          setOptimistic((m) => {
            const next = { ...m };
            delete next[studentId];
            return next;
          });
          setError("저장하지 못했습니다 — 네트워크를 확인하고 다시 눌러 주세요");
        });
    });
  }

  function fillRest() {
    if (pending.length === 0) return;
    setError(null);
    const ids = pending.map((s) => s.studentId);
    setOptimistic((m) => ({ ...m, ...Object.fromEntries(ids.map((id) => [id, "present"])) }));
    startTransition(() => {
      setAttendanceBulk({
        sessionDate: date,
        status: "present",
        cells: ids.map((id) => ({ studentId: id, classId: slot.classId })),
        // 🔴 서버 강제 '빈 칸만' — 낡은 탭이 딴 곳에서 방금 찍힌 결석을 출석으로 뒤집는 것을 막는다.
        fillEmptyOnly: true,
        slotStart: slot.slotStart,
      })
        .then((res) => {
          if ("error" in res) {
            setOptimistic({});
            setError(res.error);
            return;
          }
          if (res.blocked > 0) setError(`${res.blocked}명은 이미 기록이 있어 건너뛰었습니다`);
          router.refresh();
        })
        .catch(() => {
          setOptimistic({});
          setError("저장하지 못했습니다 — 다시 눌러 주세요");
        });
    });
  }

  return (
    <article className="border-line bg-surface flex flex-col gap-2.5 rounded-2xl border p-3.5">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}>{badge.label}</span>
        <h3 className="text-sm font-bold">{slot.className}</h3>
        <span className="num text-text-dim text-xs">
          {slot.periodLabel ? `${slot.periodLabel} · ` : ""}
          {slot.slotStart}
          {slot.slotEnd ? `~${slot.slotEnd}` : ""}
        </span>
        <span className={`num ml-auto text-xs font-bold ${done >= slot.students.length ? "text-primary" : "text-amber-strong"}`}>
          {done}/{slot.students.length}
        </span>
      </header>

      <ul className="flex flex-col gap-1">
        {slot.students.map((s) => (
          <li key={s.studentId} className="flex items-center justify-between gap-2">
            <span className="truncate text-sm">
              {s.studentName}
              {s.schoolGrade && <span className="text-text-faint ml-1 text-xs">{s.schoolGrade}</span>}
            </span>
            <TodayAttendancePills
              status={statusOf(s.studentId, s.status)}
              note={null}
              studentName={s.studentName}
              canMark={canEdit && !busy}
              onSet={(status, note) => save(s.studentId, status, note)}
              onClear={() => save(s.studentId, null)}
            />
          </li>
        ))}
      </ul>

      {canEdit && pending.length > 0 && (
        <button
          type="button"
          onClick={fillRest}
          disabled={busy}
          className="bg-primary text-primary-foreground hover:bg-primary/90 mt-auto rounded-lg px-3 py-2 text-sm font-bold disabled:opacity-60"
        >
          {done === 0 ? `전원 출석 (${pending.length}명)` : `나머지 ${pending.length}명 출석`}
        </button>
      )}
      {error && <p className="text-danger text-xs">{error}</p>}
    </article>
  );
}
