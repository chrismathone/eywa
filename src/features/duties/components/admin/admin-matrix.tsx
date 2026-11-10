"use client";

import { cellTitle, cellTone, MATRIX_COLUMNS, progressText, type Cell, type CellTone, type MatrixRow } from "../../view-admin";
import { judge, type Avg } from "../../view-admin-levels";
import { VerdictBadge } from "./admin-verdict";

/** 칸 색 — 기한 준수율 90%+ 초록 · 70~89 주황 · 70 미만 빨강 · 기한 전(평가 대기)·의무 없음은 중립. */
export const TONE: Record<CellTone, string> = { good: "bg-green-soft text-green", warn: "bg-amber-soft text-amber", bad: "bg-danger-soft text-danger", wait: "bg-bg-soft text-text-dim", none: "bg-bg-soft text-text-placeholder" };
const TH = "text-text-dim px-2 py-1.5 text-xs font-semibold";

/**
 * 선생님 × 의무 종류 매트릭스 — 칸 = **기한 준수율**(기한이 온 것 중 제때 끝낸 비율) + 붉은 '지연 n'(지금 열린 지연). 기한이 아직 안 온 종류는 진행(완료/전체 · 중립색).
 * 이름을 누르면 그 선생님 · 칸을 누르면 그 선생님의 **그 종류만**. 둘째 열 = 판정(`judge`). 마지막 줄 = 전체(누르지 않는다).
 */
export function AdminMatrix({ rows, total, avg = null, onCell }: { rows: MatrixRow[]; total: MatrixRow | null; avg?: Avg | null; onCell: (ownerId: string, kind: string | null) => void }) {
  if (!rows.length) return <p className="text-text-dim px-3 py-6 text-center text-sm">이 기간의 의무가 없습니다.</p>;
  return <div className="overflow-x-auto">
    <table className="w-full border-separate border-spacing-1 text-center text-sm [&_th:first-child]:text-left">
      <thead><tr>
        <th className={TH}>선생님</th>
        <th className={TH}>판정</th>
        {MATRIX_COLUMNS.map((c) => <th key={c.kind} className={TH}>{c.label}</th>)}
        <th className={TH}>전체</th>
      </tr></thead>
      <tbody>
        {rows.map((r) => <tr key={r.ownerId}>
          <td className="px-2 py-0.5 text-left"><button type="button" onClick={() => onCell(r.ownerId, null)} className="hover:text-primary text-sm font-bold">{r.name}</button></td>
          <td className="px-1"><VerdictBadge v={judge(r.all, avg)} /></td>
          {MATRIX_COLUMNS.map((c) => <td key={c.kind} className="p-0"><CountBox cell={r.cells[c.kind] ?? null} onClick={r.cells[c.kind] ? () => onCell(r.ownerId, c.kind) : undefined} /></td>)}
          <td className="p-0"><CountBox cell={r.all} onClick={() => onCell(r.ownerId, null)} /></td>
        </tr>)}
        {total ? <tr className="bg-bg-soft">
          <td className="rounded-l-lg px-2 py-1 text-left text-sm font-bold">{total.name}</td>
          <td />
          {MATRIX_COLUMNS.map((c) => <td key={c.kind} className="p-0"><CountBox cell={total.cells[c.kind] ?? null} plain /></td>)}
          <td className="rounded-r-lg p-0"><CountBox cell={total.all} plain /></td>
        </tr> : null}
      </tbody>
    </table>
    <p className="text-text-dim px-2 pt-1 text-xs font-medium">칸 = 기한이 온 것 중 제때 끝낸 비율 · <span className="text-danger font-bold">지연 n</span> = 이 기간 의무 중 기한이 지난 채 열린 것 · 회색 3/10 = 아직 기한 전(완료/전체)</p>
  </div>;
}

/**
 * 한 칸 — 기한이 온 것이 있으면 준수율(% 또는 frac이면 제때/기한 온 것) + '지연 n', 없으면 진행(완료/전체). 선생님·반·학생 표가 같은 부품을 쓴다.
 */
export function CountBox({ cell, onClick, plain, frac }: { cell: Cell | null; onClick?: () => void; plain?: boolean; frac?: boolean }) {
  if (!cell || !cell.total) return <span className={`block rounded-lg px-1 py-1.5 text-sm font-semibold tabular-nums ${plain ? "text-text-placeholder" : TONE.none}`}>—</span>;
  const tone = plain ? "font-bold" : `${TONE[cellTone(cell)]} font-semibold`;
  const body = cell.pct === null
    ? <span className="text-xs font-medium">{progressText(cell)}</span>
    : <>
      <span>{frac ? `${cell.ontime}/${cell.due}` : <>{cell.pct}<span className="text-xs font-medium">%</span></>}</span>
      {cell.late ? <span className="text-danger ml-1 text-xs font-bold">지연 {cell.late}</span> : null}
    </>;
  const cls = `block w-full rounded-lg px-1 py-1.5 text-sm tabular-nums ${tone}`;
  const title = cellTitle(cell);
  return onClick ? <button type="button" onClick={onClick} className={`${cls} hover:brightness-95`} title={title}>{body}</button> : <span className={cls} title={title}>{body}</span>;
}
