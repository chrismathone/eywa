"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
// 🔴 `server/queries.ts`를 직접 import하지 않는다([[#61]]) — 읽기도 서버 액션을 탄다.
import { deleteClassTextbookPlan, loadClassTextbookPlans } from "@/features/textbooks/server/plan-actions";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { sheetDowLabel } from "@/features/teacher-view/i18n";
import type { ClassTextbookPlanRow } from "@/features/textbooks/types";

/** `"mon|17:20"` → 사전의 요일 글자 + 시각. 요일이 없는 옛 값은 시각만. */
function pickLabel(pick: string, lang: ReturnType<typeof useSheetLang>): string {
  const bar = pick.indexOf("|");
  if (bar < 0) return pick;
  return `${sheetDowLabel(pick.slice(0, bar), lang)} ${pick.slice(bar + 1)}`;
}

/**
 * 교재 배정 창 맨 위 — **이 반에 이미 걸린 배정**과 [배정 삭제](감사 F4).
 *
 * 잘못 건 배정의 '계획'이 월간 달력에 계속 떴는데 지울 곳이 없었다. 지우면 배정(=월간계획)만 사라지고
 * 이미 시트에 옮겨 적은 **실제 진도는 그대로** 남는다(계획은 배정에서 계산되는 파생값이라).
 * 🔴 게이트는 서버(`deleteClassTextbookPlan` → 그 반 ECS 쓰기)다 — 이 화면 조건은 게이트가 아니다([[#77]]).
 * ⚠️ 원어민 강사도 이 창을 연다 — 문구는 전부 사전(`fill.existing.*`)이다.
 */
export function TextbookFillExisting({ classId }: { classId: string }) {
  const router = useRouter();
  const t = useSheetT();
  const tf = useSheetTf();
  const lang = useSheetLang();
  const [rows, setRows] = useState<ClassTextbookPlanRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await loadClassTextbookPlans(classId);
      if (!res.ok) {
        setError(res.error);
        setRows([]);
        return;
      }
      setError(null);
      setRows(res.rows);
    } catch {
      setError(null);
      setRows([]);
    }
  }, [classId]);

  useEffect(() => {
    let alive = true;
    void loadClassTextbookPlans(classId)
      .then((res) => {
        if (!alive) return;
        if (!res.ok) {
          setError(res.error);
          setRows([]);
        } else setRows(res.rows);
      })
      .catch(() => {
        if (alive) setRows([]);
      });
    return () => {
      alive = false;
    };
  }, [classId]);

  async function onDelete(planId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await deleteClassTextbookPlan(planId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(t("fill.existing.deleted"));
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
                <span className="num text-text-dim">{p.slotPicks.map((s) => pickLabel(s, lang)).join(" · ")}</span>
              ) : null}
              <span className="num text-text-dim">
                {tf("fill.existing.from", { date: p.startDate.slice(5).replace("-", "/") })}
              </span>
              <span className="ml-auto inline-flex items-center gap-1.5">
                {confirming === p.id ? (
                  <>
                    <span className="text-text-dim">{t("fill.existing.confirm")}</span>
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
