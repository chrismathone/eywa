"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { fillSeatSlot, setSeatCell, type SeatStatus } from "@/features/attendance/seat/server/actions";
import type { SeatClassRoster } from "@/features/attendance/seat/server/queries";
import type { SeatKey } from "@/features/attendance/seat/seat";
import { schoolGradeLabel } from "@/lib/format/school-grade";

type PeriodChip = { start: string; ends: string[]; classIds: string[] };

const TONE: Record<SeatStatus, string> = {
  present: "bg-att-present text-att-present-ink border-transparent",
  absent: "bg-att-absent text-att-absent-ink border-transparent",
  late: "bg-att-late text-att-late-ink border-transparent",
};
const LABEL: Record<SeatStatus, string> = { present: "출석", absent: "결석", late: "지각" };

/**
 * 자리 출석부 본문 — 교시 하나의 명단(반 그룹)을 그리고 그 자리에서 출결을 찍는다.
 *
 * 🔴 미체크는 **결석이 아니다**(아직 안 온 것). 자동 결석 판정은 없고, 결석은 사람이 누를 때만 찍힌다.
 * ⚠️ 낙관적 반영 — 32명을 훑는 화면이라 왕복을 기다리면 입실 줄이 밀린다. 실패하면 그 카드만 되돌린다.
 */
export function SeatBoard({
  seat,
  date,
  periods,
  activeStart,
  rosters,
  readOnly,
  hrefFor,
}: {
  seat: SeatKey;
  date: string;
  periods: PeriodChip[];
  activeStart: string;
  rosters: SeatClassRoster[];
  readOnly: boolean;
  hrefFor: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [over, setOver] = useState<Record<string, SeatStatus | null>>({});
  const [error, setError] = useState<string | null>(null);

  const key = (classId: string, studentId: string) => `${classId}|${studentId}`;
  const statusOf = (classId: string, s: SeatClassRoster["students"][number]) =>
    key(classId, s.id) in over ? over[key(classId, s.id)]! : s.status;

  const all = rosters.flatMap((r) => r.students.map((s) => statusOf(r.classId, s)));
  const total = all.length;
  const checked = all.filter((v) => v !== null).length;
  const waiting = total - checked;

  function save(classId: string, studentId: string, next: SeatStatus | null, prev: SeatStatus | null) {
    setOver((m) => ({ ...m, [key(classId, studentId)]: next }));
    setError(null);
    startTransition(async () => {
      const res = await setSeatCell({ seat, date, slotStart: activeStart, classId, studentId, status: next });
      if ("error" in res) {
        setOver((m) => ({ ...m, [key(classId, studentId)]: prev })); // 실패한 카드만 원복
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function fill(status: "present" | "absent", classId?: string) {
    setError(null);
    startTransition(async () => {
      const res = await fillSeatSlot({ seat, date, slotStart: activeStart, status, classId });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setOver({});
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* 교시 — 좁은 창에선 가로 레일로 접힌다(.toolbar-rail 규약). */}
      <div className="toolbar-rail flex shrink-0 items-center gap-1.5 overflow-x-auto">
        {periods.map((p) => (
          <Link
            key={p.start}
            href={`${hrefFor}${p.start}`}
            className={`shrink-0 rounded-full border px-3 py-1 text-[13px] font-semibold tabular-nums transition ${
              p.start === activeStart
                ? "border-primary bg-primary text-primary-foreground"
                : "border-line text-text-dim hover:bg-bg-soft"
            }`}
          >
            {p.start}
            <span className="ml-1.5 text-[11px] font-medium opacity-80">{p.classIds.length}개 반</span>
          </Link>
        ))}
      </div>

      <div className="bg-card shadow-card flex shrink-0 flex-wrap items-center gap-3 rounded-2xl px-4 py-2.5">
        <span className="text-foreground text-[15px] font-bold tabular-nums">
          {activeStart}
          {rosters.length > 0 ? <span className="text-text-dim ml-2 text-xs font-medium">{rosters.length}개 반 · {total}명</span> : null}
        </span>
        <span className="text-text-dim text-xs">
          체크 <strong className="text-foreground tabular-nums">{checked}</strong> / {total}
          {waiting > 0 ? <span className="ml-2">대기 {waiting}명</span> : null}
        </span>
        {!readOnly && waiting > 0 ? (
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => fill("present")}
              className="border-primary bg-primary text-primary-foreground rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50"
            >
              남은 {waiting}명 출석
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => fill("absent")}
              className="border-att-absent text-att-absent-ink rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50"
            >
              남은 {waiting}명 결석
            </button>
          </div>
        ) : null}
      </div>

      {readOnly ? (
        <p className="text-text-dim bg-bg-soft/60 border-line rounded-xl border px-3 py-2 text-xs">
          지난 날짜는 보기만 가능합니다 — 수정이 필요하면 관리자에게 요청하세요.
        </p>
      ) : null}
      {error ? (
        <p className="text-att-absent-ink bg-att-absent/30 border-att-absent rounded-xl border px-3 py-2 text-xs">{error}</p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
        {rosters.map((r) => {
          const left = r.students.filter((s) => statusOf(r.classId, s) === null).length;
          return (
            <section key={r.classId} className="border-line overflow-hidden rounded-2xl border">
              <header className="bg-bg-soft border-line flex items-center gap-2 border-b px-3 py-1.5 text-[13px]">
                <span className="font-bold">{r.className}</span>
                <span className="text-text-faint text-[11px] tabular-nums">{r.students.length}명</span>
                <span className="text-text-faint text-[11px] tabular-nums">~{r.end}</span>
                {!readOnly && left > 0 ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => fill("present", r.classId)}
                    className="border-line bg-card text-primary ml-auto rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold disabled:opacity-50"
                  >
                    이 반 출석
                  </button>
                ) : null}
              </header>
              <ul className="grid gap-2 p-3 [grid-template-columns:repeat(auto-fill,minmax(148px,1fr))]">
                {r.students.map((s) => {
                  const cur = statusOf(r.classId, s);
                  return (
                    <li key={s.id} className="relative">
                      <button
                        type="button"
                        disabled={readOnly || pending}
                        onClick={() => save(r.classId, s.id, cur === "present" ? null : "present", cur)}
                        className={`border-line flex min-h-[54px] w-full flex-col items-start rounded-xl border px-2.5 py-2 text-left transition disabled:cursor-default ${
                          cur ? TONE[cur] : "bg-card border-dashed"
                        }`}
                      >
                        <span className="text-sm font-bold">{s.name}</span>
                        <span className="text-[11.5px] opacity-80">
                          {schoolGradeLabel(s.school, s.grade) || " "}
                        </span>
                      </button>
                      {cur ? (
                        <span className="pointer-events-none absolute top-1.5 right-2 text-[10px] font-extrabold">
                          {LABEL[cur]}
                        </span>
                      ) : null}
                      {!readOnly && cur !== "absent" ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => save(r.classId, s.id, "absent", cur)}
                          aria-label={`${s.name} 결석`}
                          className="border-line bg-card text-text-faint hover:text-att-absent-ink absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full border text-[10px] font-bold"
                        >
                          결
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
