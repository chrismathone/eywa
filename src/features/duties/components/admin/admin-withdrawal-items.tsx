"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import type { AdminPeriod } from "../../view-admin";
import { WITHDRAWAL_STATE_LABEL, withdrawalState, type WithdrawalItem, type WithdrawalState } from "../../withdrawal-write";
import type { DutyWork } from "../duty-work-context";

const TONE: Record<WithdrawalState, string> = { ontime: "bg-green-soft text-green", early: "bg-green-soft text-green", late_done: "bg-amber-soft text-amber", late: "bg-danger-soft text-danger", upcoming: "bg-bg-soft text-text-dim" };
export type WithdrawalPick = { owner: string; name: string; subject: string | null };
const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * 퇴원보고서 작성(참고 열) 칸을 눌렀을 때 — 그 선생님의 작성 차례 한 줄씩(상태 · 학생 · 과목 · 작성 시각 또는 기한). 보완 요청으로 다시 열린 차례는 '2차'.
 * 줄을 누르면 이 창을 닫고 그 퇴원보고서를 간이 창으로 연다(보고서 화면은 제 권한을 다시 본다).
 */
export function WithdrawalItemsDialog({ pick, period, tick = 0, onClose, onWork }: { pick: WithdrawalPick; period: AdminPeriod; tick?: number; onClose: () => void; onWork: (w: DutyWork) => void }) {
  const { labelOf } = useSubjectMaps();
  const [state, setState] = useState<{ items: WithdrawalItem[] | null; now: number; error: string | null }>({ items: null, now: 0, error: null });
  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ period, owner: pick.owner });
    if (pick.subject) q.set("subject", pick.subject);
    fetch(`/api/duties/admin/withdrawal-items?${q.toString()}`, { cache: "no-store" })
      .then(async (r) => { const d = (await r.json().catch(() => null)) as { items?: WithdrawalItem[]; now?: string; error?: string } | null; if (!r.ok || !d?.items) throw new Error(d?.error ?? "목록 조회 실패"); return d; })
      .then((d) => { if (alive) setState({ items: d.items!, now: Date.parse(d.now ?? "") || Date.now(), error: null }); })
      .catch((e: Error) => { if (alive) setState((cur) => (cur.items ? cur : { items: null, now: 0, error: e.message })); });
    return () => { alive = false; };
  }, [period, tick, pick.owner, pick.subject]);
  const { items, now, error } = state;
  const title = `${pick.name} · 퇴원보고서`;
  return <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
    <DialogContent className="flex max-h-[min(720px,90dvh)] w-[min(94vw,560px)] flex-col gap-3 sm:max-w-[560px]">
      <DialogHeader><DialogTitle>{title}{items ? <span className="text-text-dim ml-1.5 text-sm font-medium">{items.length}건 · 참고(등급에 안 듦)</span> : null}</DialogTitle></DialogHeader>
      {error ? <p className="text-text-dim text-sm">{error}</p> : !items ? <p className="text-text-dim text-sm">불러오는 중…</p> : !items.length ? <p className="text-text-dim text-sm">해당 기간 작성 차례 없음</p>
        : <ul className="-mx-1 grid min-h-0 gap-0.5 overflow-y-auto px-1">
          {items.map((it) => {
            const s = withdrawalState(it, now);
            const who = [it.studentName ?? "이름 없음", schoolGradeLabel(it.school, it.grade)].filter(Boolean).join(" ");
            return <li key={it.id}>
              <button type="button" onClick={() => { onClose(); onWork({ href: `/withdrawal-reports/${it.reportId}`, title: `${title} · ${it.studentName ?? "퇴원보고서"}` }); }} className="hover:bg-bg-soft flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left">
                <span className={`w-20 shrink-0 rounded-full px-1.5 py-0.5 text-center text-xs font-bold ${TONE[s]}`}>{WITHDRAWAL_STATE_LABEL[s]}</span>
                <span className="min-w-0 flex-1 text-sm font-bold break-keep">{who}<span className="text-text-dim ml-1.5 text-xs font-medium">{it.subjects.map(labelOf).join(" · ")}{it.turnNo > 1 ? ` · ${it.turnNo}차` : ""}</span></span>
                <span className="text-text-dim shrink-0 text-xs font-medium tabular-nums">{it.closedAt ? `${when(it.closedAt)} 작성` : `기한 ${when(it.dueAt)}`}</span>
                <span className="text-primary shrink-0 text-xs font-bold" aria-hidden>›</span>
              </button>
            </li>;
          })}
        </ul>}
    </DialogContent>
  </Dialog>;
}
