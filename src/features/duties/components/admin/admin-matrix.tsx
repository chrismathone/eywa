"use client";

import { cellTitle, MATRIX_COLUMNS, type Cell, type CellTone, type MatrixRow, wellDoneOf, addRating, MIN_RATED, type Rating } from "../../view-admin";
import { judge, type Avg } from "../../view-admin-levels";
import { VerdictBadge } from "./admin-verdict";

/** 칸 색 — 등급의 색 묶음(1~2등급 초록 · 3~4 주황 · 5 이하 빨강 — `cellTone`) · 기한 전(평가 대기)·의무 없음은 중립. */
export const TONE: Record<CellTone, string> = { good: "bg-green-soft text-green", warn: "bg-amber-soft text-amber", bad: "bg-danger-soft text-danger", wait: "bg-bg-soft text-text-dim", none: "bg-bg-soft text-text-placeholder" };
export const TH = "text-text-dim px-2 py-1.5 text-xs font-semibold whitespace-nowrap";
const n = (v: number) => v.toLocaleString("ko-KR");

/**
 * 표 열 너비(선생님 · 반 · 학생 표 한 벌) — 이름 열 · 등급 열은 고정, 숫자 칸은 **모두 같은 너비**로 남은 폭을 나눠 갖는다. 표는 늘 카드 폭을 채운다.
 * 🔴 가로 스크롤을 만들지 않는다(원장 2026-11-11 *"가로 스크롤이 안생기게 열너비 적절하게 조정해"* · *"1920x1080에 최적화"*): 표가 제 폭을 고집하지 않고
 *   카드 폭에 맞춰 칸이 줄어든다. 칸에 드는 글자는 '55%'와 그 아래 작은 '기한 초과 n'뿐이라 `CELL_FIT`이면 한 줄에 선다.
 *   · `tableBasis` = 이 표가 편하게 서는 카드 폭 — 옆에 다른 카드(기한 초과)가 설 수 있는지를 이 값으로 가린다(모자라면 표가 한 줄을 다 쓰고 옆 카드는 아래로).
 *   · `CELL_MIN` 아래로는 줄이지 않는다 — 아주 좁은 창에서만 카드 안에서 옆으로 민다(화면 전체가 밀리지는 않는다).
 */
const NAME_W = 232, GRADE_W = 80, CELL_FIT = 96, CELL_MIN = 88, GAP = 4, CARD_PAD = 26;
const fixedW = (cells: number, grade: boolean) => NAME_W + (grade ? GRADE_W : 0) + (cells + (grade ? 2 : 1) + 1) * GAP;
export const gridStyle = (cells: number, grade = true) => ({ width: "100%", minWidth: fixedW(cells, grade) + cells * CELL_MIN });
export const tableBasis = (cells: number, grade = true) => fixedW(cells, grade) + cells * CELL_FIT + CARD_PAD;
export function GridCols({ count, grade = true }: { count: number; grade?: boolean }) {
  return <colgroup><col style={{ width: NAME_W }} />{grade ? <col style={{ width: GRADE_W }} /> : null}{Array.from({ length: count }, (_, i) => <col key={i} />)}</colgroup>;
}

/**
 * 선생님 × 업무 종류 표 — 칸 = 그 종류를 **기한 안에 끝낸 비율**(`CountBox`). 이름을 누르면 그 선생님 · 칸을 누르면 그 선생님의 그 종류만.
 * 둘째 열 = 등급(`judge` — '전체' 칸의 숫자로 매긴다). 마지막 줄 = 전체(누르지 않는다).
 * 열(`columns`)과 평점 열(`rated`)은 **부모가 정한다** — 과목마다 표를 나눠 세워도 열이 같아야 세로줄이 맞는다.
 */
export function AdminMatrix({ rows, total, avg = null, grade = true, title = "선생님", kind = null, columns, rated = false, onCell }: {
  rows: MatrixRow[]; total: MatrixRow | null; avg?: Avg | null; /** 첫 열 머리(과목별로 나눈 표는 과목 이름). */ title?: string;
  /** 한 종류만 보기(항목 필터) — 다른 종류 열은 자리를 둔 채 감춘다. */ kind?: string | null; /** 등급 열을 세울지 — 하루 보기에는 없다. */ grade?: boolean;
  /** 세울 종류 열(없으면 이 표에 있는 종류). */ columns?: readonly { kind: string; label: string }[]; /** 수업보고서 평점 열을 세울지. */ rated?: boolean;
  onCell: (ownerId: string, kind: string | null) => void;
}) {
  if (!rows.length) return <p className="text-text-dim px-3 py-6 text-center text-sm">해당 기간 업무 없음</p>;
  // 이 표에 실제로 있는 종류만 열로 세운다(발송 길이 있는 지점엔 '보고서 작성' 열이 없다 — 빈 열을 세우지 않는다).
  const cols = columns ?? MATRIX_COLUMNS.filter((c) => rows.some((r) => r.cells[c.kind]?.total));
  // 항목 필터는 표를 다시 짜지 않는다 — 다른 항목 열을 잠시 감출 뿐이라 자리와 크기가 그대로다(원장 2026-11-11 *"창이 변경되거나 하지말고 그냥 잠시 해당 항목을 숨기는 효과"*).
  const off = (k: string) => (kind && k !== kind ? " invisible" : "");
  // 수업보고서 평점 — 준수율과 섞지 않는 참고 열(볼 수 있는 사람에게만 내려온다).
  const count = cols.length + 1 + (rated ? 1 : 0);
  return <div className="overflow-x-auto">
    <table className="table-fixed border-separate border-spacing-1 text-center text-sm [&_th:first-child]:text-left" style={gridStyle(count, grade)}>
      <GridCols count={count} grade={grade} />
      <thead><tr>
        <th className={TH}>{title}</th>
        {grade ? <th className={TH}>등급</th> : null}
        {cols.map((c) => <th key={c.kind} className={TH + off(c.kind)}>{c.label}</th>)}
        <th className={TH}>전체</th>
        {rated ? <th className={TH}>보고서 평점</th> : null}
      </tr></thead>
      <tbody>
        {rows.map((r) => <tr key={r.ownerId}>
          <td className="px-2 py-0.5 text-left"><button type="button" onClick={() => onCell(r.ownerId, null)} className="hover:text-primary text-sm font-bold">{r.name}</button>{r.meta ? <span className="text-text-dim ml-1.5 text-xs font-medium whitespace-nowrap">{r.meta}</span> : null}</td>
          {grade ? <td className="px-1"><VerdictBadge v={judge(r.all, avg)} /></td> : null}
          {cols.map((c) => <td key={c.kind} className={`p-0${off(c.kind)}`}><CountBox cell={r.cells[c.kind] ?? null} onClick={r.cells[c.kind] ? () => onCell(r.ownerId, c.kind) : undefined} /></td>)}
          <td className="p-0"><CountBox cell={r.all} overall onClick={() => onCell(r.ownerId, null)} /></td>
          {rated ? <td className="p-0"><RatingBox rating={r.rating} /></td> : null}
        </tr>)}
        {/* 합계 줄 — 배경 없이 윗줄 하나로 가른다(원장 2026-11-11). */}
        {total ? <tr aria-hidden><td colSpan={count + (grade ? 2 : 1)} className="p-0"><div className="border-line mt-1 border-t" /></td></tr> : null}
        {total ? <tr>
          <td className="px-2 py-1 text-left text-sm font-bold">{total.name}</td>
          {grade ? <td /> : null}
          {cols.map((c) => <td key={c.kind} className={`p-0${off(c.kind)}`}><CountBox cell={total.cells[c.kind] ?? null} plain /></td>)}
          <td className="p-0"><CountBox cell={total.all} plain overall /></td>
          {rated ? <td className="p-0"><RatingBox rating={rows.reduce<Rating | undefined>((acc, r) => addRating(acc, r.rating), undefined)} plain /></td> : null}
        </tr> : null}
      </tbody>
    </table>
  </div>;
}

/**
 * 칸 상자 — 높이가 **하나**다(원장 2026-11-11 *"행높이 바뀌지 않게"*): 숫자 한 줄뿐이어도, 그 아래 작은 '기한 초과 n'이 붙어도 같은 높이라 줄이 들쭉날쭉하지 않다.
 * 선생님 · 반 · 학생 표와 평점 · 결석 칸이 같은 상자를 쓴다.
 */
export const BOX = "flex h-10 w-full flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-sm leading-none tabular-nums";

/** 수업보고서 평점 칸 — 평균(5점 만점)만 적는다(건수는 적지 않는다 — 원장 2026-11-11). 색은 다른 칸과 같은 구간(1점 = 0% · 5점 = 100%). 건수가 모자라면(`MIN_RATED` 미만) 색 없이. */
export function RatingBox({ rating, plain }: { rating: Rating | undefined; plain?: boolean }) {
  if (!rating) return <span className={`${BOX} font-semibold ${plain ? "text-text-placeholder" : TONE.none}`}>—</span>;
  const few = rating.rated < MIN_RATED;
  return <span className={`${BOX} ${plain ? "font-bold" : `font-semibold ${few ? TONE.none : ""}`}`} style={plain || few ? undefined : bandStyle(((rating.avg - 1) / 4) * 100)} title={`보고서 ${n(rating.rated)}건의 평점 평균`}>{rating.avg.toFixed(1)}</span>;
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
 * 한 칸 — 선생님 · 반 · 학생 표가 같은 부품을 쓴다(원장 2026-11-11 *"전부다 %로 바꾸고, 마우스 올렸을때 분자/분모 형태로. 기한초과1은 %랑 분자/분모 밑에 작은 글씨로"*).
 *   · 숫자 = **기한 내 완료율**(`cell.pct` — 그 기간에 때가 된 업무 가운데 기한 안에 끝낸 비율 · 남은 것도 분모라 남은 것이 있으면 100%가 아니다).
 *     종류 칸도 · '전체' 칸도 · 합계 줄도 · 등급도 같은 숫자다(한 줄 안의 숫자가 서로 다른 것을 말하지 않게 — 종류 칸은 붉은데 전체만 97%이던 것).
 *   · 마우스를 올리면(초점이 가도) 그 자리에 분자/분모(끝낸 것/전체).
 *   · 지금 열린 '기한 초과 n'은 숫자 아래 작은 글씨 — 칸 높이는 그대로다. '전체' 칸에는 적지 않는다.
 *   · 색 = 적힌 숫자의 구간(`bandStyle`).
 */
export function CountBox({ cell, onClick, plain, overall }: { cell: Cell | null; onClick?: () => void; plain?: boolean; overall?: boolean }) {
  if (!cell || !cell.total) return <span className={`${BOX} font-semibold ${plain ? "text-text-placeholder" : TONE.none}`}>—</span>;
  const pct = cell.pct ?? 0;
  const body = <>
    <span className="whitespace-nowrap">
      <span className="group-hover:hidden group-focus-visible:hidden">{pct}<span className="text-xs leading-none font-medium">%</span></span>
      <span className="hidden group-hover:inline group-focus-visible:inline">{n(wellDoneOf(cell))}/{n(cell.total)}</span>
    </span>
    {!overall && cell.late ? <span className="text-xs leading-none font-bold whitespace-nowrap">기한 초과 {n(cell.late)}</span> : null}
  </>;
  const cls = `group ${BOX} ${plain ? "font-bold" : "font-semibold"}`;
  const band = plain ? undefined : bandStyle(pct);
  const title = cellTitle(cell);
  return onClick ? <button type="button" onClick={onClick} className={`${cls} hover:brightness-95`} style={band} title={title}>{body}</button> : <span className={cls} style={band} title={title}>{body}</span>;
}
