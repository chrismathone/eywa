"use client";

import { cellTitle, MATRIX_COLUMNS, type Cell, type CellTone, type MatrixRow, upcomingOf, overallPct, duePct, wellDoneOf } from "../../view-admin";
import { judge, type Avg } from "../../view-admin-levels";
import { VerdictBadge } from "./admin-verdict";

/** 칸 색 — 등급의 색 묶음(1~2등급 초록 · 3~4 주황 · 5 이하 빨강 — `cellTone`) · 기한 전(평가 대기)·의무 없음은 중립. */
export const TONE: Record<CellTone, string> = { good: "bg-green-soft text-green", warn: "bg-amber-soft text-amber", bad: "bg-danger-soft text-danger", wait: "bg-bg-soft text-text-dim", none: "bg-bg-soft text-text-placeholder" };
const TH = "text-text-dim px-2 py-1.5 text-xs font-semibold";
/**
 * 표 열 너비(선생님 · 반 · 학생 표 한 벌) — 이름 열 · 등급 열은 고정, 숫자 칸은 **모두 같은 너비**. 표 전체는 칸 수만큼만 넓어진다
 * (칸이 둘뿐인데 화면 끝까지 늘어나 숫자가 흩어지지 않게 · 좁으면 100%에서 멈춘다).
 */
const NAME_W = 240, GRADE_W = 80, CELL_W = 148;
const CELL_MIN = 76;
export const gridStyle = (cells: number, grade = true) => ({ width: NAME_W + (grade ? GRADE_W : 0) + cells * CELL_W, maxWidth: "100%", minWidth: NAME_W + (grade ? GRADE_W : 0) + cells * CELL_MIN });
export function GridCols({ count, grade = true }: { count: number; grade?: boolean }) {
  return <colgroup><col style={{ width: NAME_W }} />{grade ? <col style={{ width: GRADE_W }} /> : null}{Array.from({ length: count }, (_, i) => <col key={i} />)}</colgroup>;
}

/**
 * 선생님 × 의무 종류 매트릭스 — 칸 = **기한 준수율**(기한이 온 것 중 제때 끝낸 비율) + 붉은 '지연 n'(지금 열린 지연). 기한이 아직 안 온 종류는 진행(완료/전체 · 중립색).
 * 이름을 누르면 그 선생님 · 칸을 누르면 그 선생님의 **그 종류만**. 둘째 열 = 판정(`judge`). 마지막 줄 = 전체(누르지 않는다).
 */
export function AdminMatrix({ rows, total, avg = null, grade = true, title = "선생님", kind = null, pad = 0, onCell }: { /** 옆 표와 합계 줄 높이를 맞출 빈 줄 수. */ pad?: number; rows: MatrixRow[]; total: MatrixRow | null; avg?: Avg | null; /** 첫 열 머리(과목별로 나눈 표는 과목 이름). */ title?: string; /** 한 종류만 보기(항목 필터) — 그 종류 열과 전체 열만. */ kind?: string | null; /** 등급 열을 세울지 — 하루 보기에는 없다. */ grade?: boolean; onCell: (ownerId: string, kind: string | null) => void }) {
  if (!rows.length) return <p className="text-text-dim px-3 py-6 text-center text-sm">해당 기간 업무 없음</p>;
  // 이 표에 실제로 있는 종류만 열로 세운다(발송 길이 있는 지점엔 '보고서 작성' 열이 없다 — 빈 열을 세우지 않는다).
  const cols = MATRIX_COLUMNS.filter((c) => rows.some((r) => r.cells[c.kind]?.total));
  // 항목 필터는 표를 다시 짜지 않는다 — 다른 항목 열을 잠시 감출 뿐이라 자리와 크기가 그대로다(원장 2026-11-11 *"창이 변경되거나 하지말고 그냥 잠시 해당 항목을 숨기는 효과"*).
  const off = (k: string) => (kind && k !== kind ? " invisible" : "");
  return <div className="overflow-x-auto">
    <table className="table-fixed border-separate border-spacing-1 text-center text-sm [&_th:first-child]:text-left" style={gridStyle(cols.length + 1, grade)}>
            <GridCols count={cols.length + 1} grade={grade} />
      <thead><tr>
        <th className={TH}>{title}</th>
        {grade ? <th className={TH}>등급</th> : null}
        {cols.map((c) => <th key={c.kind} className={TH + off(c.kind)}>{c.label}</th>)}
        <th className={TH}>전체</th>
      </tr></thead>
      <tbody>
        {rows.map((r) => <tr key={r.ownerId}>
          <td className="px-2 py-0.5 text-left"><button type="button" onClick={() => onCell(r.ownerId, null)} className="hover:text-primary text-sm font-bold">{r.name}</button>{r.meta ? <span className="text-text-dim ml-1.5 text-xs font-medium whitespace-nowrap">{r.meta}</span> : null}</td>
          {grade ? <td className="px-1"><VerdictBadge v={judge(r.all, avg)} /></td> : null}
          {cols.map((c) => <td key={c.kind} className={`p-0${off(c.kind)}`}><CountBox cell={r.cells[c.kind] ?? null} onClick={r.cells[c.kind] ? () => onCell(r.ownerId, c.kind) : undefined} /></td>)}
          <td className="p-0"><CountBox cell={r.all} overall onClick={() => onCell(r.ownerId, null)} /></td>
        </tr>)}
        {Array.from({ length: pad }, (_, i) => <tr key={`pad${i}`} aria-hidden className="invisible"><td className="px-2 py-0.5 text-left text-sm font-bold">&nbsp;</td><td colSpan={cols.length + (grade ? 2 : 1)} className="p-0"><span className="block rounded-lg px-1 py-1.5 text-sm font-semibold">&nbsp;</span></td></tr>)}
        {/* 합계 줄 — 배경 없이 윗줄 하나로 가른다(원장 2026-11-11). */}
        {total ? <tr aria-hidden><td colSpan={cols.length + (grade ? 3 : 2)} className="p-0"><div className="border-line mt-1 border-t" /></td></tr> : null}
        {total ? <tr className="whitespace-nowrap">
          <td className="px-2 py-1 text-left text-sm font-bold">{total.name}</td>
          {grade ? <td /> : null}
          {cols.map((c) => <td key={c.kind} className={`p-0${off(c.kind)}`}><CountBox cell={total.cells[c.kind] ?? null} plain /></td>)}
          <td className="p-0"><CountBox cell={total.all} plain overall /></td>
        </tr> : null}
      </tbody>
    </table>
  </div>;
}

/**
 * 칸 색 = **기한 안에 끝낸 비율의 구간**(원장 2026-11-11 *"구간별로 색상을 나눠야겠어. 빨간색에서 초록색으로 점점 이동하도록"*):
 * 20% 미만 빨강 → 40% 미만 주홍 → 60% 미만 주황 → 80% 미만 연두 → 100% 미만 연초록 → 100% 초록.
 */
// 흐린 파스텔이 아니라 **또렷한 색**으로 칠한다(원장 *"애매한 파스텔 색상 말고 … 거의 원색에 가까운색으로"*) — 구간마다 [상한 %, 바탕, 글자].
const BANDS: [number, string, string][] = [
  [20, "#e5252a", "#ffffff"],
  [40, "#f2622c", "#ffffff"],
  [60, "#f6a21b", "#1f1300"],
  [80, "#b6cf2a", "#1a2400"],
  [100, "#4fc04a", "#06220a"],
];
export function bandStyle(pct: number): { background: string; color: string } {
  const [, background, color] = BANDS.find(([upTo]) => pct < upTo) ?? [100, "#12a150", "#ffffff"];
  return { background, color };
}

/**
 * 한 칸 — 선생님 · 반 · 학생 표가 같은 부품을 쓴다. 색은 기한 안에 끝낸 비율의 구간(`bandStyle` — 빨강 → 초록).
 *   · 종류 칸 = 잘 끝낸 것/전체(frac) 또는 기한 준수율(전부 기한이 됐을 때) · 아직 남은 것이 있으면 완료/전체.
 *   · '전체' 칸(`overall`) = 기한 준수율 %(기한 안에 끝낸 것 ÷ 기한이 온 것 · 등급과 같은 기준) — 기한이 온 것이 없으면 '—'.
 */
export function CountBox({ cell, onClick, plain, frac, overall }: { cell: Cell | null; onClick?: () => void; plain?: boolean; frac?: boolean; overall?: boolean; }) {
  if (cell && cell.total && overall && duePct(cell) === null) {
    // 기한이 온 것이 없어도 눌러서 업무 목록은 볼 수 있다.
    const dash = `block w-full rounded-lg px-1 py-1.5 text-sm font-semibold tabular-nums ${plain ? "text-text-placeholder" : TONE.none}`;
    return onClick ? <button type="button" onClick={onClick} className={`${dash} hover:brightness-95`} title={cellTitle(cell)}>—</button> : <span className={dash} title={cellTitle(cell)}>—</span>;
  }
  if (!cell || !cell.total) return <span className={`block rounded-lg px-1 py-1.5 text-sm font-semibold tabular-nums ${plain ? "text-text-placeholder" : TONE.none}`}>—</span>;
  const tone = plain ? "font-bold" : "font-semibold";
  const pending = cell.pct === null || upcomingOf(cell) > 0;
  // 색은 **칸에 적힌 숫자**의 구간이다 — 글자(기한이 온 것 기준 %)와 색(전체 기준)이 다른 비율을 말하지 않게(Claude · Codex 합의 2026-11-11).
  const band = plain ? undefined : bandStyle(overall ? duePct(cell) ?? 0 : pending ? overallPct(cell) ?? 0 : frac ? (cell.due ? (cell.ontime / cell.due) * 100 : 0) : cell.pct ?? 0);
  // 기한 초과 수는 종류 칸에만 적는다(전체 칸은 %만 — 원장 *"전체에서는 기한 초과 멘트 제거"*). 색 바탕 위라 글자색은 칸 색을 따른다.
  const late = cell.late ? <span className="ml-1 text-xs font-bold">기한 초과 {cell.late}</span> : null;
  const body = overall
    ? <span>{duePct(cell)}<span className="text-xs font-medium">%</span></span>
    : pending || frac
      ? <><span>{frac && !pending ? `${cell.ontime}/${cell.due}` : `${wellDoneOf(cell)}/${cell.total}`}</span>{late}</>
      : <><span>{cell.pct}<span className="text-xs font-medium">%</span></span>{late}</>;
  const cls = `block w-full rounded-lg px-1 py-1.5 text-sm tabular-nums ${tone}`;
  const title = cellTitle(cell);
  return onClick ? <button type="button" onClick={onClick} className={`${cls} hover:brightness-95`} style={band} title={title}>{body}</button> : <span className={cls} style={band} title={title}>{body}</span>;
}
