"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DUTY_NOTE_ACTIONS, DUTY_NOTE_HINT, DUTY_NOTE_LABEL, NOTE_LIMIT, type DutyNote, type DutyNoteAction } from "../../notes";
import { addDutyNote } from "../../server/note-actions";
import type { LateItem } from "../../view-admin";

const md = (iso: string) => { const d = new Date(Date.parse(iso) + 9 * 3_600_000).toISOString(); return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`; };
/** 묶음의 기록 — 같은 기록(한 번에 남긴 것)은 한 줄로, 최근 것부터. */
const historyOf = (items: readonly LateItem[]) => [...new Map(items.flatMap((it) => (it.note ? [[`${it.note.at}|${it.note.action}|${it.note.by}`, it.note] as const] : []))).values()].sort((a, b) => b.at.localeCompare(a.at));

/**
 * 관리 기록 단추 + 창 — 그 줄(선생님 · 반 · 학생 묶음)의 의무 전부에 확인 · 사유 · 면제를 남긴다(s2_0078).
 * 단추 글 = 기록이 없으면 '기록', 있으면 가장 최근 기록('확인 11/10' — 묶음 일부에만 있으면 건수). 면제는 그 의무를 집계와 지연에서 뺀다(되돌리는 길이 없어 사유가 필수).
 * 저장하면 부모가 화면을 다시 받는다(`onSaved`).
 */
export function NoteButton({ title, items, onSaved }: { title: string; items: readonly LateItem[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  const history = historyOf(items);
  const noted = items.filter((it) => it.note).length;
  const label = !history.length ? "기록" : `${DUTY_NOTE_LABEL[history[0]!.action]} ${md(history[0]!.at)}${noted < items.length ? ` · ${noted}/${items.length}` : ""}`;
  return <>
    <button type="button" onClick={() => setOpen(true)} className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold whitespace-nowrap ${history.length ? "border-line text-text-dim" : "border-line"} hover:text-primary`}>{label}</button>
    {open ? <NoteDialog title={title} items={items} history={history} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); onSaved(); }} /> : null}
  </>;
}

function NoteDialog({ title, items, history, onClose, onSaved }: { title: string; items: readonly LateItem[]; history: DutyNote[]; onClose: () => void; onSaved: () => void }) {
  const [action, setAction] = useState<DutyNoteAction>("ack");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [partial, setPartial] = useState(false);
  const needNote = action !== "ack";
  const submit = async () => {
    if (needNote && !note.trim()) { setError("사유를 적어 주세요"); return; }
    // 면제는 되돌릴 수 없다 — 건수를 보여 주고 한 번 더 누르게 한다.
    if (action === "waive" && !armed) { setArmed(true); return; }
    setBusy(true); setError(null);
    // 한 번에 500건까지라(서버 · DB 함수) 큰 묶음은 나눠 보낸다. 중간에 막히면 거기서 멈추고, 앞서 남긴 것은 화면을 다시 받아 보여 준다.
    const ids = items.map((it) => it.id);
    let failed: string | null = null; let saved = 0;
    for (let i = 0; i < ids.length && !failed; i += 500) {
      const res = await addDutyNote({ ids: ids.slice(i, i + 500), action, note }).catch(() => ({ ok: false as const, error: "연결이 끊겼습니다. 다시 해 주세요." }));
      if (res.ok) saved += res.count; else failed = res.error;
    }
    setBusy(false);
    if (failed && !saved) { setError(failed); return; }
    // 일부만 저장됐으면 창을 닫지 않고 알린다(닫으면 전부 된 줄 안다) — 닫을 때 화면을 다시 받는다.
    if (failed) { setPartial(true); setError(`${ids.length}건 중 ${saved}건만 저장됐습니다. ${failed}`); return; }
    onSaved();
  };
  return <Dialog open onOpenChange={(o) => (!o ? (partial ? onSaved() : onClose()) : undefined)}>
    <DialogContent className="grid w-[min(94vw,520px)] gap-3 sm:max-w-[520px]">
      <DialogHeader><DialogTitle>{title} <span className="text-text-dim text-sm font-medium">· 업무 {items.length}건</span></DialogTitle></DialogHeader>
      {history.length ? <ul className="bg-bg-soft grid gap-1 rounded-lg px-3 py-2 text-sm">
        {history.slice(0, 5).map((h) => <li key={`${h.at}|${h.action}`} className="break-keep"><span className="font-bold">{DUTY_NOTE_LABEL[h.action]}</span> <span className="text-text-dim text-xs">{md(h.at)}{h.by ? ` · ${h.by}` : ""}</span>{h.note ? <span className="ml-1.5">{h.note}</span> : null}</li>)}
      </ul> : null}
      <div className="grid grid-cols-3 gap-1" role="group" aria-label="처리">
        {DUTY_NOTE_ACTIONS.map((a) => <button key={a} type="button" aria-pressed={action === a} onClick={() => { setAction(a); setError(null); setArmed(false); }}
          className={`rounded-lg border px-2 py-1.5 text-sm font-bold ${action === a ? (a === "waive" ? "border-danger bg-danger-soft text-danger" : "border-primary bg-primary text-primary-foreground") : "border-line"}`}>{DUTY_NOTE_LABEL[a]}</button>)}
      </div>
      <p className="text-text-dim text-xs font-medium">{DUTY_NOTE_HINT[action]}</p>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_LIMIT} rows={3} aria-label="사유"
        className="border-line w-full rounded-lg border px-3 py-2 text-sm" placeholder={needNote ? "사유(필수)" : "남길 말(선택)"} />
      {armed ? <p className="bg-danger-soft text-danger rounded-lg px-3 py-2 text-sm font-semibold" role="alert">업무 {items.length}건을 면제합니다. 집계와 미처리에서 빠지고 되돌릴 수 없습니다. 맞으면 한 번 더 눌러 주세요.</p> : null}
      {error ? <p className="text-danger text-sm font-semibold" role="alert">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={partial ? onSaved : onClose} className="border-line rounded-lg border px-3 py-1.5 text-sm font-semibold">닫기</button>
        <button type="button" onClick={() => void submit()} disabled={busy} className={`rounded-lg px-3 py-1.5 text-sm font-bold text-white disabled:opacity-60 ${action === "waive" ? "bg-danger" : "bg-primary"}`}>{busy ? "저장 중…" : armed ? `${items.length}건 면제 확정` : `${items.length}건 ${DUTY_NOTE_LABEL[action]}`}</button>
      </div>
    </DialogContent>
  </Dialog>;
}
