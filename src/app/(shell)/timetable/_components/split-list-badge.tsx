"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "@/components/icons/aywa-icon-compat";
import { SPLIT_DAY_KO } from "@/features/class-splits/rules";
import type { TimetableSplitLine } from "@/features/class-splits/lines";
import { endClassSplit } from "@/features/class-splits/server/actions";

/**
 * 툴바의 **"나눔 N건"** 배지 — 그 주에 살아 있는 수업 나누기 목록(누가 · 언제 · 어느 반 → 어느 선생님 · 기간).
 * 원장 2026-10-06 *"시간표에서도 해당 학생들이 이동되면 모두 보여야 함"* — 칸 박스는 흩어져 있어 한눈에 안 들어온다.
 *
 * ⚠️ × 노출은 게이트가 아니다 — 서버 액션이 같은 게이트(`canSplitClassNow`)를 다시 본다([[#77]]).
 * ⚠️ 해제는 이미 시작된 나눔이면 **어제까지로 끝낸다**(지난 출결의 귀속이 남는다) — 확인창이 그 사실을 말한다.
 */
export function SplitListBadge({ lines, canEnd }: { lines: readonly TimetableSplitLine[]; canEnd: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function end(l: TimetableSplitLine) {
    const msg = `${l.name} · ${SPLIT_DAY_KO[l.day]} ${l.startTime}~${l.endTime} 나눔을 해제할까요?\n이미 시작된 나눔이면 어제까지로 끝나고, 지난 출결은 그대로 남습니다.`;
    if (!confirm(msg)) return;
    setError(null);
    setBusyId(l.splitId);
    start(async () => {
      const res = await endClassSplit(l.splitId);
      setBusyId(null);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <span ref={ref} className="relative inline-flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="border-blue/40 bg-blue-soft text-blue inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-bold"
      >
        나눔 <span className="num">{lines.length}</span>건
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="이번 주 수업 나누기"
          className="bg-card border-line absolute top-full left-0 z-50 mt-1 w-[22rem] max-w-[90vw] rounded-xl border p-2 shadow-xl"
        >
          <p className="text-text-dim px-1 pb-1 text-xs font-bold">이번 주 수업 나누기</p>
          <ul className="divide-line/50 max-h-[50vh] divide-y overflow-y-auto">
            {lines.map((l) => (
              <li key={l.splitId} className="flex items-start gap-2 px-1 py-1.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-foreground font-bold">
                    {l.name}{" "}
                    <span className="text-text-dim num font-normal">
                      {SPLIT_DAY_KO[l.day]} {l.startTime}~{l.endTime}
                    </span>
                  </p>
                  <p className="text-text-dim text-xs">
                    → {l.otherClassName} ({l.otherLabel}) · {l.periodText}
                  </p>
                </div>
                {canEnd ? (
                  <button
                    type="button"
                    onClick={() => end(l)}
                    disabled={busyId !== null}
                    aria-label={`${l.name} 나눔 해제`}
                    title="해제"
                    className="hover:bg-bg-soft text-text-dim shrink-0 rounded-md p-1 transition disabled:opacity-40"
                  >
                    {busyId === l.splitId ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {error ? <p className="text-danger px-1 pt-1 text-xs">{error}</p> : null}
        </div>
      ) : null}
    </span>
  );
}
