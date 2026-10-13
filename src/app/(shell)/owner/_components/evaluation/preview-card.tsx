"use client";

import { useMemo } from "react";
import type { EvaluationConfig } from "@/features/teacher-portfolio/evaluation/config";
import { previewScore, settingOf } from "@/features/teacher-portfolio/evaluation/preview";

export type PreviewData = { month: string; rows: { teacherId: string; name: string; raws: Record<string, number | null> }[] };

const fmt = (n: number) => n.toFixed(1);

/**
 * 미리보기 — 그 달 강사별 원래 수치에 **지금 저장된 설정**과 **고친 설정**을 각각 얹은 총점.
 * 저장 전에 "이렇게 바꾸면 누가 몇 점"을 본다(엑셀 평가표의 시뮬레이션 시트 역할).
 */
export function PreviewCard({ saved, draft, preview }: { saved: EvaluationConfig; draft: EvaluationConfig; preview: PreviewData }) {
  const rows = useMemo(() => preview.rows.map((r) => ({ ...r, before: previewScore(r.raws, saved), after: previewScore(r.raws, draft) })), [preview.rows, saved, draft]);
  const max = draft.order.reduce((n, id) => { const s = settingOf(draft, id); return s?.enabled ? n + s.max : n; }, 0);
  return (
    <section aria-label="미리보기" className="bg-card shadow-card rounded-2xl p-5 xl:sticky xl:top-4">
      <h3 className="text-base font-bold">미리보기</h3>
      <p className="mt-1 mb-3 text-xs leading-relaxed">
        {Number(preview.month.slice(5))}월 강사별 원래 수치에 설정을 얹어 다시 낸 총점입니다. 저장하기 전에 바뀌는 점수를 봅니다.
        직접 입력 지표는 그 달에 넣은 값이 있어야 반영됩니다.
      </p>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="num w-full border-collapse text-sm">
            <thead>
              <tr className="bg-bg-soft [&_th]:px-2 [&_th]:py-2 [&_th]:font-bold">
                <th scope="col" className="text-left">강사</th>
                <th scope="col" className="text-right">지금</th>
                <th scope="col" className="text-right">바꾸면</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const diff = Math.round((r.after.total - r.before.total) * 10) / 10;
                return (
                  <tr key={r.teacherId} className="border-line-faint border-b last:border-b-0 [&_td]:px-2 [&_td]:py-2">
                    <td className="text-left">{r.name}</td>
                    <td className="text-right">{fmt(r.before.total)}</td>
                    <td className="text-right font-bold">
                      {fmt(r.after.total)}
                      {diff ? <small className={`ml-1 text-xs ${diff > 0 ? "text-danger" : "text-blue"}`}>{diff > 0 ? "+" : "−"}{fmt(Math.abs(diff))}</small> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs">바꾼 설정의 만점 합계 {fmt(max)}점(켠 지표 기준 · ‘합계에서 빼기’로 빠진 지표가 있으면 강사마다 더 작다).</p>
        </div>
      ) : (
        <p className="text-sm">아직 미리볼 집계가 없습니다. 직원 포트폴리오를 한 번 집계하면 여기서 바로 비교할 수 있습니다.</p>
      )}
    </section>
  );
}
