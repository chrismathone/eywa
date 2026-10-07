
import { SheetText } from "@/features/teacher-view/interface-label";
import type { ReactNode } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { KIND_LABEL, scorePercent, scoreUnit, type UnifiedKind, type UnifiedRow } from "@/features/grades/unified/model";
import { kindChip, percentTone } from "@/features/grades/unified/kind-color";

/** 탭 안 구획 카드 — 제목 줄(제목·보조·오른쪽 동작) + 본문. 카드 테두리는 팔레트 v4 링. */
export function Panel({ title, sub, right, children, className = "" }: {
  title: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string;
}) {
  return <section className={`bg-card shadow-card min-w-0 rounded-2xl p-5 ${className}`}>
    <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">{typeof title === "string" ? <h3 className="text-lg font-bold">{title}</h3> : title}{sub ? <p className="text-text-dim mt-0.5 text-sm">{sub}</p> : null}</div>
      {right}
    </header>
    {children}
  </section>;
}

export function KindPill({ kind }: { kind: UnifiedKind }) {
  const chip = kindChip(kind);
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${chip.className}`} style={chip.style}>{KIND_LABEL[kind]}</span>;
}

export function DeltaBadge({ row }: { row: Pick<UnifiedRow, "delta" | "deltaUnit"> }) {
  if (row.delta == null) return <span className="text-text-dim">—</span>;
  if (row.delta === 0) return <span className="text-text-dim whitespace-nowrap"><SheetText value={"변화없음"} /></span>;
  const up = row.delta > 0;
  return <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap ${up ? "bg-green-soft text-green" : "bg-danger-soft text-danger"}`}
    aria-label={`직전보다 ${Math.abs(row.delta)}${row.deltaUnit} ${up ? "상승" : "하락"}`}>
    <EyIcon name={up ? "arrowUp" : "arrowDown"} size={12} strokeWidth={2.5} />{Math.abs(row.delta)}{row.deltaUnit}
  </span>;
}

/**
 * 점수 한 줄 — **기록할 때 정한 단위 그대로** `4개 / 5개`(수업보고서) · `84점 / 100점`(성적 입력·레벨테스트).
 * 환산은 적지 않는다(원장 2026-09-24). 100점 만점일 때만 점수 글자에 색(90↑ 초록 · 60↓ 빨강). 점수가 없으면 원문, 원문도 없으면 미입력.
 */
export function ScoreLine({ row }: { row: UnifiedRow }) {
  if (row.score == null || row.maxScore == null) return <span className="text-text-dim" title={row.rawScore ?? ""}>{row.rawScore || "미입력"}</span>;
  const unit = scoreUnit(row);
  return <span className="num whitespace-nowrap"><b className={unit === "점" && row.maxScore === 100 ? percentTone(scorePercent(row)) : undefined}>{row.score}{unit}</b><span className="text-text-dim"> / {row.maxScore}{unit}</span></span>;
}

/** 라벨 + 가로 막대 + 값 한 줄(반·학교·종류 평균 목록). 값·막대 폭 = **평균 정답률(%)** — 만점이 다른 시험을 합친 값이라 점·개로 적지 않는다. */
export function BarRow({ label, sub, value, bar = "bg-primary", active = false }: {
  label: ReactNode; sub?: ReactNode; value: number | null; bar?: string; active?: boolean;
}) {
  return <span className={`grid grid-cols-[minmax(0,1fr)_7rem_4rem] items-center gap-3 rounded-lg px-2 py-2 text-sm transition ${active ? "bg-primary-soft text-primary font-bold" : "hover:bg-bg-soft"}`}>
    <span className="min-w-0 truncate">{label}{sub ? <small className="text-text-dim ml-1 font-normal">{sub}</small> : null}</span>
    <span className="bg-bg-soft h-2 overflow-hidden rounded-full"><span className={`block h-full rounded-full ${bar}`} style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} /></span>
    <b className={`num text-right whitespace-nowrap ${percentTone(value)}`}>{value == null ? "—" : `${value}%`}</b>
  </span>;
}
