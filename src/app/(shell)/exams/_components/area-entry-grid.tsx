"use client";

import { SheetText } from "@/features/teacher-view/interface-label";

import { AREA_KEYS, AREA_LABEL, areasMatch, parseAreas, sameAreas, sumAreas, type AreaKey, type AreaScores } from "@/features/grades/area-scores";
import { schoolGradeLabel } from "@/features/grades/unified/model";
import type { EntryGridRow, EntryResult } from "./entry-grid";

/** 화면이 들고 있는 영역 칸(친 글자 그대로). */
export type AreaDraft = Partial<Record<AreaKey, string>>;
export type AreaGridRow = EntryGridRow & { areas: AreaScores | null };

/** 저장된 영역 → 칸 글자. 총합과 어긋난 옛 값(다른 경로가 총합만 고친 것)은 채우지 않는다. */
export function draftFromSaved(score: number | null, areas: AreaScores | null): AreaDraft {
  if (!areasMatch(score, areas)) return {};
  return Object.fromEntries(AREA_KEYS.filter((k) => areas?.[k] != null).map((k) => [k, String(areas![k])]));
}

export const draftAreas = (d: AreaDraft | undefined): AreaScores | null => parseAreas(d ?? {});
export const draftHasValue = (d: AreaDraft | undefined) => AREA_KEYS.some((k) => (d?.[k] ?? "").trim() !== "");

/** 저장할 줄 — 영역 값이 저장된 것과 달라진 학생만. 점수는 서버가 영역의 합으로 다시 정한다. */
export function areaEntriesFor(rows: AreaGridRow[], draft: Record<string, AreaDraft>) {
  return rows.filter((r) => !r.lockedReason).flatMap((r) => {
    const want = draftAreas(draft[r.studentId]);
    const saved = areasMatch(r.existing ?? null, r.areas) ? r.areas : null;
    // 총합만 있고 영역이 없는 옛 칸을 아무것도 안 친 채로 두면 건드리지 않는다(총합을 지우지 않게).
    if (!want && !saved) return [];
    if (sameAreas(want, saved)) return [];
    return [{ studentId: r.studentId, score: sumAreas(want), areas: want }];
  });
}

/**
 * 영어 Monthly Test 입력 명단 — 한 줄 = 학생 한 명, **듣기·읽기·말하기·쓰기**를 치면 총합이 저절로 더해진다
 * (원장 2026-11-04). Enter = 오른쪽 칸 → 줄 끝이면 다음 학생 첫 칸(시트처럼). 영역 만점을 넘으면 칸이 빨갛다.
 */
export function AreaEntryGrid({ rows, draft, areaMax, results, onArea, disabled, emptyText }: {
  rows: AreaGridRow[]; draft: Record<string, AreaDraft>; areaMax: number; results: Record<string, EntryResult>;
  onArea: (studentId: string, key: AreaKey, value: string) => void; disabled: boolean; emptyText?: string;
}) {
  if (!rows.length) return <p className="text-text-dim py-10 text-center text-sm">{emptyText ?? "명단이 비어 있습니다. 반을 고르거나 학생을 추가해 주세요."}</p>;
  // 잠긴 줄(퇴원 등)은 칸이 없으니 문서 순서로 다음 칸을 찾는다.
  const next = (from: HTMLInputElement) => {
    const cells = [...document.querySelectorAll<HTMLInputElement>("[data-area-cell]")];
    const el = cells[cells.indexOf(from) + 1];
    el?.focus(); el?.select();
  };
  return <div className="border-line max-h-[50vh] overflow-auto rounded-xl border">
    <table className="w-full table-fixed text-sm">
      <colgroup><col className="w-10" /><col className="w-24" /><col className="w-24" /><col />
        {AREA_KEYS.map((k) => <col key={k} className="w-20" />)}<col className="w-24" /><col className="w-20" /></colgroup>
      <thead className="bg-bg-soft sticky top-0 z-[1]"><tr>
        {["#", "이름", "학교학년", "반"].map((h, i) => <th key={h} className={`px-2 py-2 font-bold ${i === 3 ? "text-left" : "text-center"}`}>{h}</th>)}
        {AREA_KEYS.map((k) => <th key={k} className="px-1 py-2 text-center font-bold">{AREA_LABEL[k]}</th>)}
        <th className="px-2 py-2 text-center font-bold"><SheetText value={"총합"} /></th>
        <th className="px-2 py-2 text-center font-bold"><SheetText value={"결과"} /></th>
      </tr></thead>
      <tbody>{rows.map((row, index) => {
        const d = draft[row.studentId];
        const total = sumAreas(draftAreas(d));
        const result = results[row.studentId];
        return <tr key={row.studentId} className={`border-line-faint border-t ${row.lockedReason ? "opacity-50" : ""}`}>
          <td className="text-text-dim num px-2 py-1.5 text-center">{index + 1}</td>
          <td className="px-2 py-1.5 text-center font-semibold">{row.name}</td>
          <td className="px-2 py-1.5 text-center">{schoolGradeLabel(row.school, row.grade)}</td>
          <td className="max-w-0 truncate px-2 py-1.5" title={row.className}>{row.className ?? "—"}</td>
          {row.lockedReason ? <td colSpan={AREA_KEYS.length + 1} className="text-text-dim px-2 py-1.5 text-center text-xs">{row.lockedReason}</td>
            : <>{AREA_KEYS.map((k) => {
              const v = d?.[k] ?? "";
              const over = v !== "" && (Number(v) > areaMax || Number(v) < 0);
              return <td key={k} className="px-1 py-1.5 text-center">
                <input type="number" inputMode="decimal" min="0" step="0.5" value={v} data-area-cell="" disabled={disabled}
                  onChange={(e) => onArea(row.studentId, k, e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); next(e.currentTarget); } }}
                  aria-label={`${row.name} ${AREA_LABEL[k]}`}
                  className={`num w-full rounded-md border bg-background px-1 py-1 text-center ${over ? "border-danger text-danger" : "border-line"}`} />
              </td>;
            })}
              <td className="num px-2 py-1.5 text-center font-bold" title={row.existing != null && total == null ? `저장된 총합 ${row.existing}` : undefined}>
                {total ?? (row.existing != null ? <span className="text-text-dim font-normal">{row.existing}</span> : "—")}
                <span className="text-text-dim font-normal"> / {areaMax * AREA_KEYS.length}</span>
              </td></>}
          <td className="px-2 py-1.5 text-center text-xs">
            {result ? result.ok ? <span className="text-green font-bold"><SheetText value={"저장됨"} /></span>
              : <span className="text-danger" title={result.error}>{result.error}</span> : null}
          </td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
