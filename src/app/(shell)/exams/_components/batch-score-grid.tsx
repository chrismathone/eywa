"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Loader2, Save } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { batchSaveScores, type ExamActionState } from "@/features/exams/server/actions";
import { examStats, rankByScore } from "@/features/exams/calc";
import { pct } from "@/lib/calc/grades";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { submitAction } from "@/components/forms/submit-action";

export type GridRow = {
  studentId: string;
  name: string;
  grade: string | null;
  school: string | null;
  score: number | null;
};

const parseScore = (v: string): number | null => {
  const t = v.trim();
  if (t === "") return null;
  return Number.isFinite(Number(t)) ? Number(t) : null;
};

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      점수 저장
    </Button>
  );
}

export function BatchScoreGrid({
  examId,
  maxScore,
  rows,
}: {
  examId: string;
  maxScore: number | null;
  rows: GridRow[];
}) {
  const [scores, setScores] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.studentId, r.score == null ? "" : String(r.score)])),
  );
  const [state, formAction] = useActionState<ExamActionState, FormData>(batchSaveScores, undefined);

  const parsed = useMemo(
    () => rows.map((r) => ({ ...r, score: parseScore(scores[r.studentId] ?? "") })),
    [rows, scores],
  );
  const ranked = useMemo(() => rankByScore(parsed), [parsed]);
  const live = useMemo(() => examStats(parsed.map((r) => ({ score: r.score, maxScore }))), [parsed, maxScore]);
  const entriesJson = useMemo(
    () => JSON.stringify(parsed.map((r) => ({ studentId: r.studentId, score: r.score }))),
    [parsed],
  );

  return (
    <form onSubmit={(e) => submitAction(e, formAction)} className="space-y-3">
      <input type="hidden" name="examId" value={examId} />
      <input type="hidden" name="entries" value={entriesJson} />

      {/* 실시간 요약 */}
      <div className="bg-bg-soft border-line flex flex-wrap items-center gap-4 rounded-2xl border px-4 py-2.5 text-xs">
        <span className="text-text-dim">
          응시 <span className="text-foreground num font-bold">{live.count}</span>/{rows.length}명
        </span>
        <span className="text-text-dim">
          평균 <span className="text-foreground num font-bold">{live.avg ?? "—"}</span>
          {live.avgPct != null ? <span className="text-text-faint"> ({live.avgPct}%)</span> : null}
        </span>
        <span className="text-text-dim">
          최고 <span className="text-foreground num font-bold">{live.max ?? "—"}</span>
        </span>
        <span className="text-text-dim">
          최저 <span className="text-foreground num font-bold">{live.min ?? "—"}</span>
        </span>
      </div>

      <DragScrollArea className="bg-card border-line shadow-card rounded-2xl border">
        <table className="w-full text-sm [&_td]:whitespace-nowrap">
          <thead className="border-line border-b [&_th]:whitespace-nowrap">
            <tr>
              <th className="micro px-4 py-3 text-left">학생</th>
              <th className="micro px-4 py-3 text-left">학년</th>
              <th className="micro px-4 py-3 text-left">학교</th>
              <th className="micro px-4 py-3 text-right">
                점수{maxScore != null ? ` / ${maxScore}` : ""}
              </th>
              <th className="micro px-4 py-3 text-right">백분율</th>
              <th className="micro px-4 py-3 text-right">석차</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {ranked.map((r) => {
              const p = pct(r.score, maxScore);
              return (
                <tr key={r.studentId} className="hover:bg-bg-soft/50">
                  <td className="text-foreground px-4 py-2 text-sm font-medium">{r.name}</td>
                  <td className="text-text-dim px-4 py-2 text-xs">{r.grade ?? "—"}</td>
                  <td className="text-text-dim px-4 py-2 text-xs">{r.school ?? "—"}</td>
                  <td className="px-4 py-1.5 text-right">
                    <input
                      type="number"
                      inputMode="numeric"
                      step="1"
                      min="0"
                      value={scores[r.studentId] ?? ""}
                      onChange={(e) =>
                        setScores((prev) => ({ ...prev, [r.studentId]: e.target.value }))
                      }
                      placeholder="—"
                      className="border-line bg-background text-foreground num w-20 rounded-md border px-2 py-1 text-right text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </td>
                  <td className="text-text-dim num px-4 py-2 text-right text-xs">
                    {p == null ? "—" : `${p}%`}
                  </td>
                  <td className="text-text-dim num px-4 py-2 text-right text-xs">
                    {r.rank == null ? "—" : `${r.rank}위`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DragScrollArea>

      <div className="flex items-center justify-end gap-3">
        {state?.error ? (
          <p className="text-danger inline-flex items-center gap-1.5 text-xs">
            <AlertCircle className="size-4" />
            {state.error}
          </p>
        ) : state?.ok ? (
          <p className="text-primary inline-flex items-center gap-1.5 text-xs">
            <Check className="size-4" />
            저장되었습니다
          </p>
        ) : null}
        <SaveBtn />
      </div>
    </form>
  );
}
