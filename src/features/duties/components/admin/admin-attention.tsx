"use client";

import type { ReactNode } from "react";
import { lateLabel, type AttentionRow } from "../../view-admin";

/** 기한 날짜(사람 눈의 그날 — 기한은 '다음 날 0시'처럼 적혀 있다). 지연은 고른 기간과 무관하게 뜨므로 언제 것인지 적는다. */
const dueDay = (iso: string) => { const d = new Date(Date.parse(iso) - 1 + 9 * 3_600_000).toISOString(); return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`; };
const pill = (days: number, muted: boolean) => (muted ? "bg-bg-soft text-text-dim" : days >= 7 ? "bg-danger-soft text-danger" : days >= 1 ? "bg-amber-soft text-amber" : "bg-bg-soft text-text-dim");

/**
 * 지연 목록 — 열린 채 기한이 지난 의무 묶음(선생님 · 반 · 학생 단위). 표식 = 가장 오래된 것의 지난 날 수(7일 이상 붉게). 요약 = 종류별 지연 수.
 * 줄을 누르면 부모가 정한다(그 단계로 이동 · 학생 열기 · 제자리에서 펼치기). `expand` = 펼쳐 보일 묶음과 그 안의 줄(트리에 없는 선생님·반일 때).
 * `muted` = 이관된 미확인(평가 시작 전 기한) — 붉게 칠하지 않는다. `action` = 줄 오른쪽에 붙는 동작(처리 요청) — 줄 단추 밖에 둔다(단추 안에 단추를 넣지 않는다).
 */
export function AdminAttention({ rows, onOpen, expand = null, onOpenChild, muted = false, action, empty = "기한 초과 없음" }: {
  rows: AttentionRow[]; onOpen: (row: AttentionRow) => void; expand?: { key: string; rows: AttentionRow[] } | null; onOpenChild?: (row: AttentionRow) => void; muted?: boolean; action?: (row: AttentionRow) => ReactNode; empty?: string;
}) {
  if (!rows.length) return <p className="text-text-dim px-3 py-6 text-center text-sm">{empty}</p>;
  // 줄 양식은 하나다(원장 2026-11-11 *"같은 카드인데 줄바꿈이 달라지지 않게"*) — 두 줄 고정 · 줄바꿈 없음(넘치면 말줄임):
  //   첫 줄 = 지난 날 표식 · 이름 · 인원  /  둘째 줄 = 무엇이 몇 건 · 기한 · 담당(선생님 · 반 — 이름과 겹치는 것은 뺀다).
  const who = (r: AttentionRow) => [r.teacher, r.className].filter((x) => x && x !== r.title).join(" · ");
  const line = (r: AttentionRow, open: (row: AttentionRow) => void, child = false) => <button type="button" onClick={() => open(r)} title={[r.title, r.sub, r.summary, who(r)].filter(Boolean).join(" · ")} className={`hover:bg-bg-soft grid w-full grid-cols-1 gap-0.5 rounded-lg px-2.5 py-1.5 text-left ${child ? "pl-6" : ""}`}>
    <span className="flex min-w-0 items-center gap-1.5">
      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums ${pill(r.days, muted)}`}>{muted ? "이관" : lateLabel(r.days)}</span>
      <span className="shrink-0 text-sm font-bold whitespace-nowrap">{r.title}</span>
      {r.sub ? <span className="text-text-dim min-w-0 overflow-hidden text-xs font-medium text-ellipsis whitespace-nowrap">{r.sub}</span> : null}
    </span>
    <span className="flex min-w-0 items-center gap-1.5 text-xs">
      <span className={`min-w-0 overflow-hidden font-semibold text-ellipsis whitespace-nowrap ${muted ? "text-text-dim" : "text-danger"}`}>{r.summary}</span>
      <span className="text-text-dim shrink-0 font-medium whitespace-nowrap">기한 {dueDay(r.oldest)}{r.count > 1 ? "부터" : ""}</span>
      {who(r) ? <span className="text-text-dim min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium">· {who(r)}</span> : null}
    </span>
  </button>;
  // 열은 넓게(원장 2026-11-11 *"기한 초과 열너비를 늘리는게 좋을지도"* · *"버튼에 가려지는 문구들"*) — 한 줄에 이름 · 건수 · 기한과 단추가 다 서는 폭(520px)부터 한 열이다.
  //   그래도 모자란 글자는 단추 밑으로 들어가지 않고 줄 끝에서 줄인다(전체 글자는 마우스 오버).
  return <ul className="grid items-start gap-1 [grid-template-columns:repeat(auto-fill,minmax(min(100%,520px),1fr))]">
    {rows.map((r) => <li key={r.key}>
      <div className="flex items-center gap-1"><div className="min-w-0 flex-1">{line(r, onOpen)}</div>{action?.(r)}</div>
      {expand && expand.key === r.key ? <ul className="grid gap-0.5">{expand.rows.map((c) => <li key={c.key}>{line(c, onOpenChild ?? onOpen, true)}</li>)}</ul> : null}
    </li>)}
  </ul>;
}
