"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/aywa-icon-compat";
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
import { writeLockedNote, writeLockedPlaceholder } from "@/lib/write-lock";

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
 * 내 채점 패널 — 30문항 × 1·2·3·4 세그먼트(클릭 1번).
 * 30문항을 스크롤하는 동안에도 보이도록 **진행 헤더는 상단 sticky, 저장은 하단 고정 바**
 * (창 데이터입력 폼 하우스 규약 + 원장 2026-08-05 "사용자 친화"). 미입력 문항은 점프 버튼으로 찾아간다.
 * 값은 컨트롤드 + hidden input으로 서버 액션에 전달(q0..q29).
 * `canWrite=false`(읽기 권한) — 점수 단추·코멘트를 잠그고 '채점 저장'을 그리지 않는다(원장 2026-11-05).
 */
export function ScorePanel({
  docId,
  areas,
  initialScores,
  initialComment,
  backHref,
  canWrite,
}: {
  docId: string;
  areas: ChecklistArea[];
  initialScores: number[];
  initialComment: string;
  /** 저장 성공 시 돌아갈 곳(채점 전용 페이지 → 상세). 미지정이면 제자리. */
  backHref?: string;
  /** 서버(page)가 canWriteTenant("class_review")로 정한 값 — 저장 액션과 같은 판정. */
  canWrite: boolean;
}) {
  const locked = !canWrite;
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
  const missing = totalItems - totals.answered;

  // 첫 미입력 문항으로 스크롤 — 30문항에서 빼먹은 칸을 눈으로 찾지 않게(원장 2026-08-05).
  const jumpToMissing = () => {
    const idx = scores.findIndex((v) => v === 0);
    if (idx < 0) return;
    document.getElementById(`cr-q-${idx}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <form action={formAction} className="bg-card rounded-2xl p-5 shadow-card">
      <input type="hidden" name="docId" value={docId} />
      {scores.map((v, i) => (
        <input key={i} type="hidden" name={`q${i}`} value={v || ""} />
      ))}

      {/* 진행 헤더 — 스크롤해도 따라온다(현재 위치·합계·등급을 잃지 않게). */}
      <div className="border-line/60 bg-card sticky top-0 z-10 -mx-5 -mt-5 rounded-t-2xl border-b px-5 pt-4 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-foreground text-sm font-bold">내 채점</h2>
          <p className="text-text-dim num text-xs">
            {totals.answered}/{totalItems} 입력 · 총점 {totals.total} · 환산 {totals.percent.toFixed(1)} ·{" "}
            {totals.grade}
          </p>
        </div>
        <div className="bg-bg-soft mt-2 h-1 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-all"
            style={{ width: `${totalItems ? Math.round((totals.answered / totalItems) * 100) : 0}%` }}
          />
        </div>
      </div>

      <p className="text-text-faint mt-3 mb-3 text-xs">
        4점 척도 — 1점(미흡) / 2점(기준 이하) / 3점(기준 충족) / 4점(우수) · 같은 점수를 다시 누르면 해제
      </p>
      {/* 점수 단추는 placeholder가 없어 잠긴 이유를 따로 한 줄로 알린다. */}
      {locked ? <p className="text-text-dim mb-3 text-sm" role="status">{writeLockedNote("class_review")}</p> : null}

      <div className="space-y-4">
        {areas.map((area, ai) => {
          const base = areas.slice(0, ai).reduce((n, a) => n + a.items.length, 0);
          return (
            <section key={area.key}>
              <p className="text-foreground mb-1.5 text-xs font-bold">
                {area.title}
                <span className="num text-text-dim ml-2 font-medium">
                  {area.items.filter((_, i) => scores[base + i] > 0).length}/{area.items.length}
                </span>
              </p>
              <ul className="space-y-1">
                {area.items.map((item, i) => {
                  const qi = base + i;
                  return (
                    <li
                      key={qi}
                      id={`cr-q-${qi}`}
                      className="border-line/60 flex flex-col gap-1.5 rounded-lg border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="min-w-0 text-sm break-keep">
                        <span className="num text-text-dim mr-1.5">{qi + 1}.</span>
                        {item}
                      </span>
                      <span className="flex shrink-0 gap-1" role="radiogroup" aria-label={`${qi + 1}번 점수`}>
                        {Array.from({ length: SCALE_MAX - SCALE_MIN + 1 }, (_, k) => SCALE_MIN + k).map((n) => (
                          <button
                            key={n}
                            type="button"
                            role="radio"
                            aria-checked={scores[qi] === n}
                            disabled={locked}
                            onClick={() =>
                              setScores((prev) => {
                                const next = [...prev];
                                next[qi] = prev[qi] === n ? 0 : n; // 같은 점수 재클릭 = 해제
                                return next;
                              })
                            }
                            className={`num size-8 rounded-lg border text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                              scores[qi] === n
                                ? "border-primary bg-primary font-bold text-white"
                                : "border-line text-text-dim hover:border-primary/40 hover:text-primary font-medium"
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
        평가자 코멘트
      </label>
      <textarea
        id="cr-comment"
        name="comment"
        defaultValue={initialComment}
        rows={3}
        disabled={locked}
        placeholder={
          locked
            ? writeLockedPlaceholder("class_review")
            : "선택 — 이 수업에 대한 의견을 남기세요 (최종 총평은 상세 화면에서 따로 씁니다)"
        }
        className="border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-70"
      />

      {/* 저장 바 — 하단 고정(창 데이터입력 폼 규약). 미입력이 있으면 개수 + 점프를 함께 보여준다.
          sticky-save-bar 마커 = main 하단 패딩 제거(바 밀착, globals.css [[#110]]). */}
      <div className="sticky-save-bar border-line/60 bg-card sticky bottom-0 z-10 -mx-5 -mb-5 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-b-2xl border-t px-5 py-3">
        {missing > 0 ? (
          <button
            type="button"
            onClick={jumpToMissing}
            className="text-text-dim hover:text-primary text-xs font-medium underline-offset-2 transition hover:underline"
          >
            미입력 {missing}문항 — 눌러서 이동
          </button>
        ) : (
          <span className="text-text-dim text-xs">모든 문항을 입력했습니다.</span>
        )}
        {/* 읽기 권한이면 저장 단추를 그리지 않는다(비활성으로 남기지 않는다). */}
        {canWrite ? <SubmitButton /> : null}
      </div>
    </form>
  );
}
