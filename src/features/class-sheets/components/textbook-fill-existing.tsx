"use client";

import { useSheetFeedback } from "@/features/teacher-view/lang-context";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
// 🔴 `server/queries.ts`를 직접 import하지 않는다([[#61]]) — 읽기도 서버 액션을 탄다.
import { deleteClassTextbookPlan, loadClassTextbookPlans } from "@/features/textbooks/server/plan-actions";
import { undoPlanDelete } from "@/features/textbooks/server/plan-delete-actions";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { sheetDowLabel } from "@/features/teacher-view/i18n";
import { groupSlotPicks } from "@/features/textbooks/lesson-schedule";
import type { ClassTextbookPlanRow } from "@/features/textbooks/types";

/**
 * 고른 칸 → 사전의 요일 글자 + 시각 + 자리(`화 17:20 1·2`). 자리가 없는 옛 값은 요일·시각만,
 * 요일도 없는 더 옛 값은 시각만. 묶음은 교재목록과 같은 [`groupSlotPicks`] 한 벌이다.
 */
function picksLabel(picks: readonly string[], lang: ReturnType<typeof useSheetLang>, posLabel: (n: number) => string): string {
  return groupSlotPicks(picks)
    .map((g) => {
      const head = g.dow ? `${sheetDowLabel(g.dow, lang)} ${g.start}` : g.start;
      return g.positions.length > 0 ? `${head} ${g.positions.map(posLabel).join("·")}` : head;
    })
    .join(" · ");
}

/**
 * 교재 배정 창 맨 위 — **이 반에 이미 걸린 배정**과 [배정 삭제](감사 F4).
 *
 * 잘못 건 배정의 '계획'이 월간 달력에 계속 떴는데 지울 곳이 없었다. 지우면 배정(=월간계획)이 사라지고,
 * **[진도 줄도 함께 지우기]**(기본 켬, 원장 2026-10-19)면 그 교재로 들어간 손대지 않은 진도 줄(오늘 이후)과
 * 그 칸의 미룸·당김 표식도 함께 지운다. 지운 뒤 토스트 [되돌리기]가 배정·줄·표식을 원래대로 돌린다.
 * 🔴 게이트는 서버(`deleteClassTextbookPlan` → 그 반 ECS 쓰기)다 — 이 화면 조건은 게이트가 아니다([[#77]]).
 * ⚠️ 원어민 강사도 이 창을 연다 — 문구는 전부 사전(`fill.existing.*`)이다.
 */
export function TextbookFillExisting({ classId }: { classId: string }) {
  const feedback = useSheetFeedback();
  const router = useRouter();
  const t = useSheetT();
  const tf = useSheetTf();
  const lang = useSheetLang();
  const [rows, setRows] = useState<ClassTextbookPlanRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [withLines, setWithLines] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await loadClassTextbookPlans(classId);
      if (!res.ok) {
        setError(feedback(res.error));
        setRows([]);
        return;
      }
      setError(null);
      setRows(res.rows);
    } catch {
      setError(null);
      setRows([]);
    }
  }, [classId, feedback]);

  useEffect(() => {
    let alive = true;
    void loadClassTextbookPlans(classId)
      .then((res) => {
        if (!alive) return;
        if (!res.ok) {
          setError(feedback(res.error));
          setRows([]);
        } else setRows(res.rows);
      })
      .catch(() => {
        if (alive) setRows([]);
      });
    return () => {
      alive = false;
    };
  }, [classId, feedback]);

  async function onDelete(planId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await deleteClassTextbookPlan(planId, { withLines });
      if (!res.ok) {
        setError(feedback(res.error));
        return;
      }
      const undo = res.undo;
      const undoAction = undo
        ? {
            duration: 10_000,
            action: {
              label: t("fill.existing.undo"),
              onClick: () => {
                void undoPlanDelete({ classId, plan: undo.plan, lines: undo.lines, historyId: res.historyId }).then(async (u) => {
                  if (!u.ok) return void toast.error(feedback(u.error));
                  if (u.warning) toast.warning(feedback(u.warning));
                  else toast.success(t("fill.existing.undone"));
                  await reload();
                  router.refresh();
                });
              },
            },
          }
        : undefined;
      if (res.warning) toast.warning(feedback(res.warning), undoAction);
      else if (res.cleared) toast.success(tf("fill.existing.deletedLines", { n: res.cleared.lines }), undoAction);
      else toast.success(t("fill.existing.deleted"), undoAction);
      setConfirming(null);
      await reload();
      router.refresh();
    } catch {
      setError(t("fill.err.generic"));
    } finally {
      setBusy(false);
    }
  }

  if (rows === null) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-text-dim text-xs font-bold">{t("fill.existing")}</span>
      {error ? (
        <p role="alert" className="bg-danger-soft/40 text-danger rounded-lg px-3 py-1.5 text-xs">
          {error}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-text-faint text-xs">{t("fill.existing.none")}</p>
      ) : (
        <ul className="border-line-faint divide-line-faint flex flex-col divide-y rounded-lg border">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 text-xs">
              <span className="font-bold">{p.textbookTitle}</span>
              {p.slotPicks ? (
                <span className="num text-text-dim">{picksLabel(p.slotPicks, lang, (n) => tf("fill.slots.pos", { n }))}</span>
              ) : null}
              <span className="num text-text-dim">
                {tf("fill.existing.from", { date: p.startDate.slice(5).replace("-", "/") })}
              </span>
              <span className="ml-auto inline-flex flex-wrap items-center justify-end gap-1.5">
                {confirming === p.id ? (
                  <>
                    <span className="text-text-dim">{t("fill.existing.confirm")}</span>
                    <label className="text-text-dim inline-flex basis-full items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={withLines}
                        disabled={busy}
                        onChange={(e) => setWithLines(e.target.checked)}
                      />
                      {t("fill.existing.withLines")}
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => void onDelete(p.id)}
                    >
                      {t("fill.existing.confirmYes")}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>
                      {t("fill.existing.cancel")}
                    </Button>
                  </>
                ) : (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(p.id)}>
                    {t("fill.existing.delete")}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
