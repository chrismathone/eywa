"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  computeTotals,
  itemCountOf,
  normalizeScore,
  SCALE_MAX,
  SCALE_MIN,
  type ChecklistArea,
} from "@/features/class-review/checklist";
import { submitClassReviewScores, type ReviewActionState } from "@/features/class-review/server/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      채점 저장
    </Button>
  );
}

/**
 * 내 채점 패널 — 30문항 × 1·2·3·4 세그먼트(클릭 1번). 상단에 진행률과 실시간 합계.
 * 값은 컨트롤드 + hidden input으로 서버 액션에 전달(q0..q29).
 */
export function ScorePanel({
  docId,
  areas,
  initialScores,
  initialComment,
  backHref,
}: {
  docId: string;
  areas: ChecklistArea[];
  initialScores: number[];
  initialComment: string;
  /** 저장 성공 시 돌아갈 곳(채점 전용 페이지 → 상세). 미지정이면 제자리. */
  backHref?: string;
}) {
  const router = useRouter();
  const totalItems = itemCountOf(areas);
  const [scores, setScores] = useState<number[]>(() =>
    Array.from({ length: totalItems }, (_, i) => normalizeScore(initialScores[i])),
  );
  const [state, formAction] = useActionState<ReviewActionState, FormData>(submitClassReviewScores, undefined);
  const seenRef = useRef<ReviewActionState>(undefined);
  useEffect(() => {
    if (!state || state === seenRef.current) return;
    seenRef.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) {
      toast.success(state.notice ?? "저장했습니다");
      if (backHref) router.push(backHref);
    }
  }, [state, backHref, router]);

  const totals = useMemo(() => computeTotals({ scores }, areas), [scores, areas]);

  return (
    <form action={formAction} className="border-line bg-card rounded-2xl border p-5 shadow-card">
      <input type="hidden" name="docId" value={docId} />
      {scores.map((v, i) => (
        <input key={i} type="hidden" name={`q${i}`} value={v || ""} />
      ))}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-foreground text-sm font-bold">내 채점</h2>
        <p className="text-text-dim num text-xs">
          {totals.answered}/{totalItems} 입력 · 총점 {totals.total} · 환산 {totals.percent.toFixed(1)} ·{" "}
          {totals.grade}
        </p>
      </div>
      <p className="text-text-faint mb-3 text-[11px]">
        4점 척도 — 1점(미흡) / 2점(기준 이하) / 3점(기준 충족) / 4점(우수)
      </p>

      <div className="space-y-4">
        {areas.map((area, ai) => {
          const base = areas.slice(0, ai).reduce((n, a) => n + a.items.length, 0);
          return (
            <section key={area.key}>
              <p className="text-primary mb-1.5 text-xs font-bold">{area.title}</p>
              <ul className="space-y-1">
                {area.items.map((item, i) => {
                  const qi = base + i;
                  return (
                    <li
                      key={qi}
                      className="border-line/60 flex flex-col gap-1.5 rounded-lg border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="min-w-0 text-[13px] break-keep">
                        <span className="num text-text-faint mr-1.5">{qi + 1}.</span>
                        {item}
                      </span>
                      <span className="flex shrink-0 gap-1" role="radiogroup" aria-label={`${qi + 1}번 점수`}>
                        {Array.from({ length: SCALE_MAX - SCALE_MIN + 1 }, (_, k) => SCALE_MIN + k).map((n) => (
                          <button
                            key={n}
                            type="button"
                            role="radio"
                            aria-checked={scores[qi] === n}
                            onClick={() =>
                              setScores((prev) => {
                                const next = [...prev];
                                next[qi] = prev[qi] === n ? 0 : n; // 같은 점수 재클릭 = 해제
                                return next;
                              })
                            }
                            className={`num size-8 rounded-lg border text-sm font-semibold transition ${
                              scores[qi] === n
                                ? "border-primary bg-primary text-white"
                                : "border-line text-text-dim hover:border-primary/40 hover:text-primary"
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <label htmlFor="cr-comment" className="micro mt-4 mb-1 block">
        참관자 코멘트
      </label>
      <textarea
        id="cr-comment"
        name="comment"
        defaultValue={initialComment}
        rows={3}
        placeholder="선택 — 종합 의견을 남기세요"
        className="border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition"
      />

      <div className="mt-3 flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
