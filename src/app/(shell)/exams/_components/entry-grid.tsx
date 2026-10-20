"use client";

import { SheetText } from "@/features/teacher-view/interface-label";

import { schoolGradeLabel } from "@/features/grades/unified/model";
import { TodaysMathChip } from "./todays-math-chip";

export type EntryGridRow = {
  studentId: string; name: string; school: string | null; grade: string | null; className?: string;
  /** 이미 저장된 점수(학교 시험 명단) — 칸에 미리 채워진다. */
  existing?: number | null;
  /** 제도상 안 치는 시험·퇴원 등 — 칸을 잠그고 이유를 적는다. */
  lockedReason?: string | null;
  /** 같은 만점의 오늘 수학 월말평가 점수 — 칸 값이 이것과 같을 때만 '오늘 수학' 표시(고치면 사라진다). */
  todaysMath?: number | null;
};
export type EntryResult = { ok: true } | { ok: false; error: string };

/**
 * 성적 입력 명단 — 한 줄 = 학생 한 명, 점수 칸만 친다. **Enter = 다음 학생**(엑셀처럼 세로로 내려간다).
 * 만점을 넘는 값은 칸을 빨갛게 — 저장 전에 보인다(서버도 다시 막는다).
 */
export function EntryGrid({ rows, scores, max, results, onScore, onRemove, disabled, emptyText }: {
  rows: EntryGridRow[]; scores: Record<string, string>; max: number; results: Record<string, EntryResult>;
  onScore: (studentId: string, value: string) => void; onRemove?: (studentId: string) => void; disabled: boolean;
  /** 빈 명단 문구 — 이유가 화면마다 다르다(미입력만 보기로 다 걸러짐 · 그 학교·학년에 학생 없음). */
  emptyText?: string;
}) {
  if (!rows.length) return <p className="text-text-dim py-10 text-center text-sm">{emptyText ?? "명단이 비어 있습니다. 반을 고르거나 학생을 추가해 주세요."}</p>;
  const focusNext = (index: number) => {
    const next = document.querySelector<HTMLInputElement>(`[data-entry-index="${index + 1}"]`);
    next?.focus(); next?.select();
  };
  return <div className="border-line max-h-[50vh] overflow-auto rounded-xl border">
    <table className="w-full table-fixed text-sm">
      <colgroup><col className="w-10" /><col className="w-28" /><col className="w-28" /><col /><col className="w-36" /><col className="w-40" /></colgroup>
      <thead className="bg-bg-soft sticky top-0 z-[1]"><tr>
        {["#", "이름", "학교학년", "반", "점수", "결과"].map((h, i) => <th key={h} className={`px-2 py-2 font-bold ${i === 3 ? "text-left" : "text-center"}`}>{h}</th>)}
      </tr></thead>
      <tbody>{rows.map((row, index) => {
        const value = scores[row.studentId] ?? "";
        const over = value !== "" && (Number(value) > max || Number(value) < 0);
        const result = results[row.studentId];
        return <tr key={row.studentId} className={`border-line-faint border-t ${row.lockedReason ? "opacity-50" : ""}`}>
          <td className="text-text-dim num px-2 py-1.5 text-center">{index + 1}</td>
          <td className="px-2 py-1.5 text-center font-semibold">{row.name}</td>
          <td className="px-2 py-1.5 text-center">{schoolGradeLabel(row.school, row.grade)}</td>
          <td className="max-w-0 truncate px-2 py-1.5" title={row.className}>{row.className ?? "—"}</td>
          <td className="px-2 py-1.5 text-center">
            {row.lockedReason ? <span className="text-text-dim text-xs">{row.lockedReason}</span> : <span className="inline-flex items-center gap-1">
              <input type="number" inputMode="decimal" min="0" step="0.01" value={value} data-entry-index={index} disabled={disabled}
                onChange={(e) => onScore(row.studentId, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusNext(index); } }}
                aria-label={`${row.name} 점수`} placeholder={row.existing != null ? String(row.existing) : "—"}
                className={`num w-20 rounded-md border bg-background px-2 py-1 text-center ${over ? "border-danger text-danger" : "border-line"}`} />
              <span className="text-text-dim num">/ {max}</span>
              {row.todaysMath != null && value.trim() !== "" && Number(value) === row.todaysMath ? <TodaysMathChip /> : null}
            </span>}
          </td>
          <td className="px-2 py-1.5 text-center text-xs">
            {result ? result.ok ? <span className="text-green font-bold"><SheetText value={"저장됨"} /></span> : <span className="text-danger" title={result.error}>{result.error}</span>
              : onRemove ? <button type="button" className="text-text-dim hover:text-danger" onClick={() => onRemove(row.studentId)}><SheetText value={"빼기"} /></button> : null}
          </td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
