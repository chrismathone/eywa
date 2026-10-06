"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "@/components/icons/aywa-icon-compat";
import { SPLIT_DAY_KO } from "@/features/class-splits/rules";
import { groupSplitLines, type SplitLineGroup, type TimetableSplitLine } from "@/features/class-splits/lines";
import { endClassSplit } from "@/features/class-splits/server/actions";

/**
 * 툴바의 **"나눔 N건"** 배지 — 그 주에 살아 있는 수업 나누기 목록(어느 반 → 어느 선생님 · 언제 · 누구 · 기간).
 * 원장 2026-10-06 *"시간표에서도 해당 학생들이 이동되면 모두 보여야 함"* — 칸 박스는 흩어져 있어 한눈에 안 들어온다.
 *
 * 🔑 같은 반 → 같은 반 · 같은 요일·시간·기간은 **한 건으로 묶는다**(반 전체 나누기가 학생 수만큼 줄을 만들기 때문).
 *    × 하나가 그 묶음 전체를 해제한다.
 * ⚠️ × 노출은 게이트가 아니다 — 서버 액션이 같은 게이트(`canSplitClassNow`)를 다시 본다([[#77]]).
 * ⚠️ 해제는 이미 시작된 나눔이면 **어제까지로 끝낸다**(지난 출결의 귀속이 남는다) — 확인창이 그 사실을 말한다.
 */
export function SplitListBadge({ lines, canEnd }: { lines: readonly TimetableSplitLine[]; canEnd: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const ref = useRef<HTMLSpanElement>(null);
  const groups = groupSplitLines(lines);

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

  function end(g: SplitLineGroup) {
    const who = g.names.length > 1 ? `${g.names.length}명` : g.names[0];
    const msg = `${who} · ${SPLIT_DAY_KO[g.day]} ${g.startTime}~${g.endTime} 나눔을 해제할까요?\n이미 시작된 나눔이면 어제까지로 끝나고, 지난 출결은 그대로 남습니다.`;
    if (!confirm(msg)) return;
    setError(null);
    setBusyKey(g.key);
    start(async () => {
      const res = await endClassSplit(g.splitIds);
      setBusyKey(null);
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
        나눔 <span className="num">{groups.length}</span>건
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="이번 주 수업 나누기"
          className="bg-card border-line absolute top-full left-0 z-50 mt-1 w-[24rem] max-w-[90vw] rounded-xl border p-2 shadow-xl"
        >
          <p className="text-text-dim px-1 pb-1 text-xs font-bold">이번 주 수업 나누기</p>
          <ul className="divide-line/50 max-h-[50vh] divide-y overflow-y-auto">
            {groups.map((g) => (
              <li key={g.key} className="flex items-start gap-2 px-1 py-1.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-foreground font-bold">
                    {g.hereClassName || "원래 반"} → {g.otherClassName}{" "}
                    <span className="text-text-dim num font-normal">
                      {SPLIT_DAY_KO[g.day]} {g.startTime}~{g.endTime}
                    </span>
                  </p>
                  <p className="text-text-dim text-xs">
                    {g.otherLabel} · {g.periodText} · {g.names.length > 3 ? `${g.names.slice(0, 3).join(", ")} 외 ${g.names.length - 3}명` : g.names.join(", ")}
                  </p>
                </div>
                {canEnd ? (
                  <button
                    type="button"
                    onClick={() => end(g)}
                    disabled={busyKey !== null}
                    aria-label={`${g.hereClassName} 나눔 해제`}
                    title="해제"
                    className="hover:bg-bg-soft text-text-dim shrink-0 rounded-md p-1 transition disabled:opacity-40"
                  >
                    {busyKey === g.key ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
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
