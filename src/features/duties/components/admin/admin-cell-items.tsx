"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CELL_STATE_LABEL, cellItemTitle, cellItemWhen, type CellItem, type CellItemState } from "../../cell-items";
import type { AdminPeriod } from "../../view-admin";
import type { DutyWork } from "../duty-work-context";

const TONE: Record<CellItemState, string> = { ontime: "bg-green-soft text-green", early: "bg-green-soft text-green", late_done: "bg-amber-soft text-amber", late: "bg-danger-soft text-danger", expired: "bg-danger-soft text-danger", upcoming: "bg-bg-soft text-text-dim", waived: "bg-bg-soft text-text-dim" };
export type CellPick = { title: string; studentId: string; kind: string | null; classId: string | null; classNone?: boolean; owner?: string | null; ownerNone?: boolean; subject?: string | null };

/**
 * 칸을 눌렀을 때의 목록 창 — 그 칸(학생 × 반 × 종류)이 센 업무를 한 줄씩: 상태 · 무엇(수업일 · 달 · 항목) · 실제 기록 시각 또는 기한.
 * 줄을 누르면 이 창을 닫고 실제 기록이 있는 화면(출석부 · 상담 기록 · 성적 입력)을 간이 창으로 연다(창 둘을 겹쳐 띄우지 않는다). 갈 화면이 없는 줄은 글만 보인다(원장 2026-11-10).
 */
export function CellItemsDialog({ pick, period, tick = 0, onClose, onWork }: { pick: CellPick; period: AdminPeriod; /** 화면이 다시 받을 때마다 오르는 수 — 목록도 함께 다시 받는다(열어 둔 사이 저장된 것이 보이게). */ tick?: number; onClose: () => void; onWork: (w: DutyWork) => void }) {
  const [state, setState] = useState<{ items: CellItem[] | null; failed: boolean }>({ items: null, failed: false });
  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ period, student: pick.studentId });
    if (pick.kind) q.set("kind", pick.kind);
    if (pick.classNone) q.set("class", "none"); else if (pick.classId) q.set("class", pick.classId);
    if (pick.ownerNone) q.set("owner", "none"); else if (pick.owner) q.set("owner", pick.owner);
    if (pick.subject) q.set("subject", pick.subject);
    fetch(`/api/duties/admin/items?${q.toString()}`, { cache: "no-store" })
      .then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return (await r.json()) as { items: CellItem[] }; })
      .then((d) => { if (alive) setState({ items: d.items, failed: false }); })
      .catch(() => { if (alive) setState((cur) => (cur.items ? cur : { items: null, failed: true })); });
    return () => { alive = false; };
  }, [period, tick, pick.studentId, pick.kind, pick.classId, pick.classNone, pick.owner, pick.ownerNone, pick.subject]);
  const { items, failed } = state;
  const body = (it: CellItem) => <>
    <span className={`w-16 shrink-0 rounded-full px-1.5 py-0.5 text-center text-xs font-bold ${TONE[it.state]}`}>{CELL_STATE_LABEL[it.state]}</span>
    <span className="min-w-0 flex-1 text-sm font-bold break-keep">{cellItemTitle(it)}{it.className && !pick.classId ? <span className="text-text-dim ml-1.5 text-xs font-medium">{it.className}</span> : null}</span>
    <span className="text-text-dim shrink-0 text-xs font-medium tabular-nums">{cellItemWhen(it)}</span>
    {it.href ? <span className="text-primary shrink-0 text-xs font-bold" aria-hidden>›</span> : <span className="w-2 shrink-0" aria-hidden />}
  </>;
  return <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
    <DialogContent className="flex max-h-[min(720px,90dvh)] w-[min(94vw,560px)] flex-col gap-3 sm:max-w-[560px]">
      <DialogHeader><DialogTitle>{pick.title}{items ? <span className="text-text-dim ml-1.5 text-sm font-medium">{items.filter((it) => it.state !== "waived").length}건{items.some((it) => it.state === "waived") ? ` · 면제 ${items.filter((it) => it.state === "waived").length}건` : ""}</span> : null}</DialogTitle></DialogHeader>
      {failed ? <p className="text-text-dim text-sm">목록 조회 실패</p> : !items ? <p className="text-text-dim text-sm">불러오는 중…</p> : !items.length ? <p className="text-text-dim text-sm">해당 업무 없음</p>
        : <ul className="-mx-1 grid min-h-0 gap-0.5 overflow-y-auto px-1">
          {items.map((it) => <li key={it.id}>
            {it.href ? <button type="button" onClick={() => { onClose(); onWork({ href: it.href!, title: `${pick.title} · ${cellItemTitle(it)}` }); }} className="hover:bg-bg-soft flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left">{body(it)}</button>
              : <div className="flex items-center gap-2 px-2 py-1.5">{body(it)}</div>}
          </li>)}
        </ul>}
    </DialogContent>
  </Dialog>;
}
