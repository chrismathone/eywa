"use client";

/**
 * 데스크 확인 큐 — **두 레인**. 원장 지시의 "데스크에서 학부모 혹은 학생 확인이 바로 이어지게".
 *
 * 🔴 레인을 가르는 이유(이 기능의 안전장치): 매일 200명 이상이 '미확인'인데(실측) 그걸 전부 학생
 *    카드로 쏟으면 데스크가 하루 200통을 걸어야 하고 대부분은 교실에 앉아 있다. 한 통의 헛전화가
 *    학부모 신뢰를 깎는다.
 *      · **레인 A(먼저)** = 그 교시 출결이 통째로 비었다 → 걸 곳은 **강사**. 한 통이 12명분을 대신한다.
 *      · **레인 B** = 결석으로 찍혔거나 그 교시에서 이 학생만 빈 칸 → **학부모·학생**.
 *
 * 처리한 건은 목록에서 지우지 않고 아래 '오늘 처리함'으로 내린다(#105 — 조치 목록이 조용히 증발하면
 * 처리한 건과 놓친 건이 구분되지 않는다).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "@/components/icons/eywa-icon-compat";
import { EmptyState } from "@/components/empty-state";
import { recordFollowup } from "@/features/attendance/live/server/actions";
import { setAttendanceCell } from "@/features/attendance/server/actions";
import { FOLLOWUP_OUTCOMES, OUTCOME_LABEL, suggestedStatus, type DeskQueue, type QueueStudent } from "@/features/attendance/live/queue";
import { SIGNAL_HINT, SIGNAL_LABEL } from "@/features/attendance/live/signals";

export function DeskView({ queue, date }: { queue: DeskQueue; date: string }) {
  const empty = queue.counts.classes === 0 && queue.counts.students === 0;
  const absentRows = queue.lanes.students.filter((s) => s.signal === "absent");
  const unmarkedRows = queue.lanes.students.filter((s) => s.signal !== "absent");
  return (
    <div className="space-y-6">
      {empty && queue.counts.done === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="확인할 건이 없습니다"
          description="수업 시작 15분이 지나도 출결이 비어 있으면 여기에 뜹니다."
        />
      ) : null}

      {queue.lanes.classes.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold">
            출결 미입력 반 <span className="num text-text-dim">{queue.lanes.classes.length}</span>
            <span className="text-text-faint ml-2 text-xs font-normal">
              학생이 아니라 담당 강사에게 확인합니다 — 한 통이 반 전체를 대신합니다
            </span>
          </h2>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {queue.lanes.classes.map((c) => (
              <div
                key={`${c.classId}@${c.slotStart}`}
                className="border-line bg-surface flex items-center justify-between gap-2 rounded-2xl border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{c.className}</p>
                  <p className="text-text-dim num text-xs">
                    {c.slotStart} · {c.slotTeacherLabel ?? c.teacherName ?? "담당 미지정"} · 예정{" "}
                    {c.expected}명
                  </p>
                </div>
                <CallButton phone={c.teacherPhone} label="강사" />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 🔴 학생 레인을 확실도로 한 번 더 가른다. 실측(2026-08-14 시뮬레이션): 하루 학생 레인이 20~59건인데
          그중 강사가 결석으로 **찍은** 것은 6~10건뿐이고 나머지는 '부분 기록의 빈 칸'이다. 한 목록에 섞으면
          데스크가 확실한 10건보다 불확실한 40건에 먼저 시간을 쓴다 — 그리고 그 40건 대부분은 교실에 있다. */}
      {absentRows.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold">
            결석 확인 <span className="num text-danger">{absentRows.length}</span>
            <span className="text-text-faint ml-2 text-xs font-normal">
              강사가 결석으로 입력했습니다 — 학부모 확인 대상
            </span>
          </h2>
          <div className="grid gap-2 lg:grid-cols-2">
            {absentRows.map((s) => (
              <StudentCard key={`${s.studentId}@${s.slotStart}`} row={s} date={date} />
            ))}
          </div>
        </section>
      )}

      {unmarkedRows.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-text-dim text-sm font-bold">
            미확인 <span className="num">{unmarkedRows.length}</span>
            <span className="text-text-faint ml-2 text-xs font-normal">
              같은 교시 다른 학생은 입력됐는데 이 학생만 비어 있습니다 — 교실에 있을 수도 있으니 강사 확인이
              먼저입니다
            </span>
          </h2>
          <div className="grid gap-2 lg:grid-cols-2">
            {unmarkedRows.map((s) => (
              <StudentCard key={`${s.studentId}@${s.slotStart}`} row={s} date={date} />
            ))}
          </div>
        </section>
      )}

      {queue.done.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-text-dim text-sm font-bold">
            오늘 처리함 <span className="num">{queue.done.length}</span>
          </h2>
          <ul className="border-line divide-line divide-y rounded-2xl border">
            {queue.done.map((s) => (
              <li key={`${s.studentId}@${s.slotStart}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 p-2.5 text-sm">
                <span className="font-semibold">{s.studentName}</span>
                <span className="text-text-faint num text-xs">
                  {s.className} · {s.slotStart}
                </span>
                <span className="bg-bg-soft text-text-dim ml-auto rounded-full px-2 py-0.5 text-xs">
                  {s.followup?.outcome ? (OUTCOME_LABEL[s.followup.outcome] ?? s.followup.outcome) : "확인 완료"}
                </span>
                {s.followup?.handledByName && (
                  <span className="text-text-faint text-xs">{s.followup.handledByName}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CallButton({ phone, label }: { phone: string | null; label: string }) {
  if (!phone) return <span className="text-text-faint text-xs whitespace-nowrap">{label} 번호 없음</span>;
  return (
    <a
      href={`tel:${phone.replace(/[^\d+]/g, "")}`}
      className="border-primary text-primary hover:bg-primary/5 num flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold whitespace-nowrap"
      title={`${label}에게 전화 — ${phone}`}
    >
      {label} {phone}
    </a>
  );
}

function StudentCard({ row, date }: { row: QueueStudent; date: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<string>("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  // 결과에 따라 출결 정정을 **제안만** 한다 — 급여·청구 재료라 사람이 명시로 누른다.
  const suggestion = outcome ? suggestedStatus(outcome) : null;
  const [applyStatus, setApplyStatus] = useState(true);

  function submit(state: "resolved" | "dismissed") {
    setError(null);
    startTransition(() => {
      recordFollowup({
        studentId: row.studentId,
        classId: row.classId,
        sessionDate: date,
        slotStart: row.slotStart,
        signal: row.signal === "absent" ? "absent" : "unmarked",
        state,
        outcome: outcome || null,
        note: note || null,
        contactedVia: outcome === "no_answer" || outcome ? "phone" : null,
      })
        .then(async (res) => {
          if ("error" in res) return setError(res.error);
          if (state === "resolved" && suggestion && applyStatus) {
            const applied = await setAttendanceCell({
              studentId: row.studentId,
              classId: row.classId,
              sessionDate: date,
              status: suggestion,
              slotStart: row.slotStart,
              note: note || null,
              quiet: true,
            }).catch(() => ({ error: "출결 정정에 실패했습니다" }) as const);
            if ("error" in applied) {
              setError(`확인은 저장했지만 출결 정정에 실패했습니다 — ${applied.error}`);
              router.refresh();
              return;
            }
          }
          setOpen(false);
          router.refresh();
        })
        .catch(() => setError("저장하지 못했습니다 — 다시 시도해 주세요"));
    });
  }

  return (
    <article className="border-line bg-surface space-y-2 rounded-2xl border p-3">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
            row.signal === "absent" ? "bg-danger text-white" : "bg-amber/15 text-amber-strong"
          }`}
          title={SIGNAL_HINT[row.signal]}
        >
          {SIGNAL_LABEL[row.signal]}
        </span>
        <span className="text-sm font-bold">{row.studentName}</span>
        {row.schoolGrade && <span className="text-text-faint text-xs">{row.schoolGrade}</span>}
        <span className="text-text-dim num ml-auto text-xs">
          {row.className} · {row.slotStart}
          {row.teacherName ? ` · ${row.teacherName}` : ""}
        </span>
      </header>

      {/* 🔴 강사가 적어 둔 사유는 전화 **전에** 읽혀야 한다 — "감기로 결석"이 이미 적혀 있는데 집에
          또 거는 것이 이 기능이 만들 수 있는 가장 나쁜 경험이다. 보강 연결 흔적도 여기 남는다. */}
      {row.note && (
        <p className="bg-bg-soft text-text-dim rounded-lg px-2 py-1 text-xs">
          강사 메모 — {row.note}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <CallButton phone={row.parentPhone} label="학부모" />
        {row.studentPhone && <CallButton phone={row.studentPhone} label="학생" />}
        {row.followup?.state === "open" && (
          <span className="bg-bg-soft text-text-dim rounded-full px-2 py-0.5 text-xs">확인 중</span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="border-line hover:bg-bg-soft ml-auto rounded-lg border px-2.5 py-1.5 text-xs font-bold"
        >
          {open ? "닫기" : "확인 기록"}
        </button>
      </div>

      {open && (
        <div className="border-line space-y-2 rounded-xl border p-2.5">
          <div className="flex flex-wrap gap-1">
            {FOLLOWUP_OUTCOMES.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setOutcome(o.value)}
                aria-pressed={outcome === o.value}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  outcome === o.value ? "bg-primary text-primary-foreground" : "border-line text-text-dim border"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="통화 내용 메모 (선택)"
            className="border-line w-full rounded-lg border px-2.5 py-1.5 text-sm"
          />
          {suggestion && (
            <label className="text-text-dim flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={applyStatus} onChange={(e) => setApplyStatus(e.target.checked)} />
              출결도 &lsquo;{suggestion === "present" ? "출석" : "결석"}&rsquo;으로 정정
              <span className="text-text-faint">(체크를 풀면 확인 기록만 남깁니다)</span>
            </label>
          )}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={busy || !outcome}
              onClick={() => submit("resolved")}
              className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50"
            >
              확인 완료
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => submit("dismissed")}
              className="border-line hover:bg-bg-soft rounded-lg border px-3 py-1.5 text-xs font-bold"
              title="확인이 필요 없는 건(오탐 등) — 큐에서 내립니다"
            >
              확인 불필요
            </button>
          </div>
          {error && <p className="text-danger text-xs">{error}</p>}
        </div>
      )}
    </article>
  );
}
