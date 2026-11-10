"use client";

import { cellTitle, cellTone, MATRIX_COLUMNS, progressText, type Cell, type CellTone, type MatrixRow } from "../../view-admin";
import { judge, type Avg } from "../../view-admin-levels";
import { VerdictBadge } from "./admin-verdict";

/** 칸 색 — 등급의 색 묶음(1~2등급 초록 · 3~4 주황 · 5 이하 빨강 — `cellTone`) · 기한 전(평가 대기)·의무 없음은 중립. */
export const TONE: Record<CellTone, string> = { good: "bg-green-soft text-green", warn: "bg-amber-soft text-amber", bad: "bg-danger-soft text-danger", wait: "bg-bg-soft text-text-dim", none: "bg-bg-soft text-text-placeholder" };
const TH = "text-text-dim px-2 py-1.5 text-xs font-semibold";
/**
 * 표 열 너비(선생님 · 반 · 학생 표 한 벌) — 이름 열 · 등급 열은 고정, 숫자 칸은 **모두 같은 너비**. 표 전체는 칸 수만큼만 넓어진다
 * (칸이 둘뿐인데 화면 끝까지 늘어나 숫자가 흩어지지 않게 · 좁으면 100%에서 멈춘다).
 */
const NAME_W = 260, GRADE_W = 88, CELL_W = 132;
const CELL_MIN = 76;
export const gridStyle = (cells: number) => ({ width: `min(100%, ${NAME_W + GRADE_W + cells * CELL_W}px)`, minWidth: NAME_W + GRADE_W + cells * CELL_MIN });
export function GridCols({ count }: { count: number }) {
  return <colgroup><col style={{ width: NAME_W }} /><col style={{ width: GRADE_W }} />{Array.from({ length: count }, (_, i) => <col key={i} />)}</colgroup>;
}

/**
 * 선생님 × 의무 종류 매트릭스 — 칸 = **기한 준수율**(기한이 온 것 중 제때 끝낸 비율) + 붉은 '지연 n'(지금 열린 지연). 기한이 아직 안 온 종류는 진행(완료/전체 · 중립색).
 * 이름을 누르면 그 선생님 · 칸을 누르면 그 선생님의 **그 종류만**. 둘째 열 = 판정(`judge`). 마지막 줄 = 전체(누르지 않는다).
 */
export function AdminMatrix({ rows, total, avg = null, onCell }: { rows: MatrixRow[]; total: MatrixRow | null; avg?: Avg | null; onCell: (ownerId: string, kind: string | null) => void }) {
  if (!rows.length) return <p className="text-text-dim px-3 py-6 text-center text-sm">해당 기간 업무 없음</p>;
  // 이 표에 실제로 있는 종류만 열로 세운다(발송 길이 있는 지점엔 '보고서 작성' 열이 없다 — 빈 열을 세우지 않는다).
  const cols = MATRIX_COLUMNS.filter((c) => rows.some((r) => r.cells[c.kind]?.total));
  return <div className="overflow-x-auto">
    <table className="table-fixed border-separate border-spacing-1 text-center text-sm [&_th:first-child]:text-left" style={gridStyle(cols.length + 1)}>
            <GridCols count={cols.length + 1} />
      <thead><tr>
        <th className={TH}>선생님</th>
        <th className={TH}>등급</th>
        {cols.map((c) => <th key={c.kind} className={TH}>{c.label}</th>)}
        <th className={TH}>전체</th>
      </tr></thead>
      <tbody>
        {rows.map((r) => <tr key={r.ownerId}>
          <td className="px-2 py-0.5 text-left"><button type="button" onClick={() => onCell(r.ownerId, null)} className="hover:text-primary text-sm font-bold">{r.name}</button>{r.meta ? <span className="text-text-dim ml-1.5 text-xs font-medium whitespace-nowrap">{r.meta}</span> : null}</td>
          <td className="px-1"><VerdictBadge v={judge(r.all, avg)} /></td>
          {cols.map((c) => <td key={c.kind} className="p-0"><CountBox cell={r.cells[c.kind] ?? null} onClick={r.cells[c.kind] ? () => onCell(r.ownerId, c.kind) : undefined} /></td>)}
          <td className="p-0"><CountBox cell={r.all} onClick={() => onCell(r.ownerId, null)} /></td>
        </tr>)}
        {total ? <tr className="bg-bg-soft">
          <td className="rounded-l-lg px-2 py-1 text-left text-sm font-bold">{total.name}</td>
          <td />
          {cols.map((c) => <td key={c.kind} className="p-0"><CountBox cell={total.cells[c.kind] ?? null} plain /></td>)}
          <td className="rounded-r-lg p-0"><CountBox cell={total.all} plain /></td>
        </tr> : null}
      </tbody>
    </table>
    <p className="text-text-dim px-2 pt-1 text-xs font-medium">칸 = 기한 준수율 · <span className="text-danger font-bold">지연 n</span> = 기간 내 미처리 · 회색 3/10 = 기한 전(완료/전체)</p>
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
