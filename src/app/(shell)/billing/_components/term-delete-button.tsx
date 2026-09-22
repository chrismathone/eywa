"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { deleteSessionTerm, getSessionTermDeletePreview, type SessionTermDeletePreview } from "@/features/billing/session-terms/server/delete-actions";
import { publishRecordSaved } from "@/lib/realtime/record-channel";

export function TermDeleteButton({ id, period, studentName, className, disabled, onDeleted }: {
  id: string; period: string; studentName: string; className: string | null; disabled: boolean; onDeleted: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<SessionTermDeletePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, start] = useTransition();
  const request = useRef(0);
  const saving = useRef(false);

  async function changeOpen(next: boolean) {
    if (saving.current) return;
    const token = ++request.current;
    setOpen(next);
    if (!next) return;
    setPreview(null);
    setError(null);
    setLoading(true);
    try {
      const result = await getSessionTermDeletePreview(id, period);
      if (request.current !== token) return;
      setPreview(result.preview ?? null);
      setError(result.error ?? null);
    } catch {
      if (request.current === token) setError("회차 정보를 불러오지 못했습니다. 창을 닫고 다시 시도해 주세요");
    } finally {
      if (request.current === token) setLoading(false);
    }
  }

  function remove() {
    if (!preview || preview.blockedReason || saving.current) return;
    saving.current = true;
    setError(null);
    start(async () => {
      try {
        const result = await deleteSessionTerm(id, period, preview.updatedAt);
        if (!result.ok) {
          setError(result.error ?? "회차를 삭제하지 못했습니다");
          return;
        }
        setOpen(false);
        onDeleted();
        toast.success("회차를 삭제했습니다");
        publishRecordSaved("billing:session-terms");
        router.refresh();
      } catch {
        setError("회차를 삭제하지 못했습니다. 창을 닫고 내역을 다시 확인해 주세요");
      } finally {
        saving.current = false;
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger render={<button type="button" disabled={disabled || pending} aria-label={`${studentName} ${className ?? ""} 회차 삭제`} className="text-danger ml-2 text-xs underline-offset-2 hover:underline disabled:opacity-50" />}>삭제</DialogTrigger>
      <DialogContent className="whitespace-normal sm:max-w-md" showCloseButton={!pending}>
        <DialogTitle>회차 삭제</DialogTitle>
        <DialogDescription>{period} · {studentName} · {className ?? "반 미지정"}</DialogDescription>
        {loading ? <p role="status" className="text-text-dim text-sm">삭제할 회차를 확인하는 중…</p> : null}
        {preview ? <>
          <p className="text-sm">{preview.confirmedSessions === null ? "미확정 회차" : `확정 ${preview.confirmedSessions}시수 · ${Number(preview.amount ?? 0).toLocaleString("ko-KR")}원`}를 삭제합니다. 저장된 회차·확정값·메모는 복구할 수 없습니다.</p>
          {preview.note ? <p className="text-text-dim max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-sm">메모: {preview.note}</p> : null}
          <p className="text-text-dim text-sm">청구서·수납 원본·출석 기록은 유지됩니다. 출석부에 있는 학생·반은 ‘회차 없음’으로 남으며, 계획 갱신이나 확정·배분 저장 시 회차가 다시 생성될 수 있습니다.</p>
          {preview.blockedReason ? <p role="alert" className="text-danger text-sm">{preview.blockedReason}</p> : null}
        </> : null}
        {error ? <p role="alert" className="text-danger text-sm">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => void changeOpen(false)}>취소</Button>
          <Button type="button" variant="destructive" disabled={loading || pending || !preview || !!preview.blockedReason} onClick={remove}>{pending ? "삭제 중…" : "회차 삭제"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
