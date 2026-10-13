"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ManualMetricItem, StoredPeriod } from "@/features/teacher-portfolio/model/types";
import { loadEvaluationEntries, saveEvaluationEntries, type EntryDraft } from "@/features/teacher-portfolio/server/evaluation-actions";
import { itemLabel, monthName } from "@/features/teacher-portfolio/view";

type Draft = Record<string, { value: string; note: string }>;
const NUMBER = /^-?\d+(\.\d+)?$/;
const keyOf = (m: ManualMetricItem) => m.id.slice("manual:".length);

/**
 * 직접 입력 지표 — 그 강사 · 그 달의 값을 원장이 넣는다(원장 2026-10-13 *"수동 지표는 수동으로 입력"*).
 * 마감한 달은 점수가 그때 값으로 굳어 있어 받지 않는다. 저장하면 진행 중인 달을 다시 매긴다.
 * 🔴 값은 **열 때 입력 표에서** 읽고, 저장은 **바뀐 칸만** 보낸다 — 포트폴리오 행은 다시 매기기(after)가 끝나기 전엔
 *    옛 값이라, 그 값을 시작점으로 전부 돌려보내면 방금 저장한 칸이 빈 값으로 덮여 지워진다(적대적 리뷰 2026-10-13).
 */
export function ManualEntryDialog({ open, onClose, period, teacherId, teacherName }: {
  open: boolean; onClose: () => void; period: StoredPeriod; teacherId: string; teacherName: string;
}) {
  const router = useRouter();
  const items = period.items.filter((m): m is ManualMetricItem => m.id.startsWith("manual:") && !m.off);
  const [base, setBase] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    let live = true;
    loadEvaluationEntries(teacherId, period.month).then(
      (r) => {
        if (!live) return;
        if (!r.ok) { setLoadError(r.error); return; }
        const next = toDraft(r.entries);
        setBase(next);
        setDraft(next);
      },
      () => { if (live) setLoadError("입력한 값을 불러오지 못했습니다. 잠시 후 다시 열어 주세요"); },
    );
    return () => { live = false; };
  }, [teacherId, period.month]);
  const closed = Boolean(period.closing.closedAt);
  const cell = (m: ManualMetricItem) => draft[keyOf(m)] ?? { value: "", note: "" };
  const invalid = items.filter((m) => { const t = cell(m).value.trim(); return t !== "" && !NUMBER.test(t); });
  const changed = base ? items.filter((m) => {
    const was = base[keyOf(m)] ?? { value: "", note: "" };
    return cell(m).value.trim() !== was.value.trim() || cell(m).note.trim() !== was.note.trim();
  }) : [];
  const edit = (m: ManualMetricItem, patch: Partial<Draft[string]>) => setDraft((d) => ({ ...d, [keyOf(m)]: { ...cell(m), ...patch } }));
  const save = () => startTransition(async () => {
    const rows = changed.map((m) => {
      const t = cell(m).value.trim();
      return { teacherId, metricKey: keyOf(m), value: t === "" ? null : Number(t), note: cell(m).note.trim() || null };
    });
    const result = await saveEvaluationEntries(period.month, rows);
    if (!result.ok) { toast.error(result.error ?? "저장하지 못했습니다"); return; }
    toast.success(result.notice ?? "저장했습니다");
    onClose();
    router.refresh();
  });
  const ready = base !== null;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent showCloseButton={false} className="flex max-h-[min(90dvh,48rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <div className="border-line flex items-center justify-between gap-3 border-b px-5 py-3.5">
          <DialogTitle className="text-base font-bold">직접 입력 지표 · {teacherName} · {monthName(period.month)}</DialogTitle>
          <DialogClose aria-label="닫기" className="hover:bg-muted focus-visible:outline-primary rounded-lg p-1.5 focus-visible:outline-2">
            <EyIcon name="close" size={18} />
          </DialogClose>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {closed ? <p role="status" className="bg-amber-soft rounded-lg px-3.5 py-2.5 text-sm">마감한 달이라 값을 바꿀 수 없습니다(점수가 그때 값으로 굳어 있습니다).</p> : null}
          {loadError ? <p role="alert" className="text-danger text-sm">{loadError}</p> : !ready ? <p role="status" className="text-sm">입력한 값을 불러오는 중…</p> : null}
          {items.map((m) => (
            <fieldset key={m.id} disabled={closed || !ready} className="space-y-2">
              <legend className="text-sm font-bold">{itemLabel(m)} <span className="text-xs font-medium">({m.unit || "값"} · 만점 {m.max}점)</span></legend>
              {m.reason ? <p className="text-xs">{m.reason}</p> : null}
              <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
                <Input aria-label={`${itemLabel(m)} 값`} inputMode="decimal" value={cell(m).value} placeholder="비우면 입력 없음"
                  className="num text-right" onChange={(e) => edit(m, { value: e.target.value })} />
                <Input aria-label={`${itemLabel(m)} 메모`} value={cell(m).note} maxLength={500} placeholder="근거 메모(선택)"
                  onChange={(e) => edit(m, { note: e.target.value })} />
              </div>
            </fieldset>
          ))}
          {invalid.length ? <p role="alert" className="text-danger text-xs">{invalid.map(itemLabel).join(", ")} 칸에는 숫자만 넣을 수 있습니다.</p> : null}
        </div>
        <div className="border-line flex justify-end gap-2 border-t px-5 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>닫기</Button>
          <Button type="button" onClick={save} disabled={closed || !ready || pending || invalid.length > 0 || changed.length === 0} aria-busy={pending}>{pending ? "저장 중…" : "저장"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function toDraft(entries: EntryDraft): Draft {
  return Object.fromEntries(Object.entries(entries).map(([key, e]) => [key, { value: e.value === null ? "" : String(e.value), note: e.note ?? "" }]));
}
