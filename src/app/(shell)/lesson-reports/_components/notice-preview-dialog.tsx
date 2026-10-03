"use client";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { NOTICE_SKIP_LABEL } from "@/features/report-admin/notice-targets";
import type { ClassNoticeInput, ClassNoticePreview } from "@/features/report-admin/class-notice-preview";
export type NoticeReview = { input: ClassNoticeInput; preview: ClassNoticePreview };

export function NoticePreviewDialog({ review, busy, onClose, onConfirm }: {
  review: NoticeReview; busy: boolean; onClose: () => void; onConfirm: () => void;
}) {
  const { preview, input } = review;
  const skipped = [...new Map(preview.skipped.map((s) => [`${s.name}:${s.reason}`, s])).values()];
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="sm:max-w-xl" showCloseButton={!busy}>
      <DialogTitle>공지 발송 대상 확인</DialogTitle>
      <DialogDescription>선택 {preview.classCount}반 · 실제 대상 {preview.studentCount}명 · 게시 {preview.targets.length}건 · 개별 내용 {preview.individualCount}명 · 첨부 {preview.attachmentCount}개</DialogDescription>
      <p className="bg-bg-soft max-h-32 overflow-y-auto rounded p-2 whitespace-pre-wrap">{input.body}</p>
      <div className="max-h-60 space-y-2 overflow-y-auto">
        <p className="font-bold">발송 대상</p>
        {preview.targets.length ? <ul className="grid gap-1 sm:grid-cols-2">{preview.targets.map((target, i) => <li key={i}>{target.name}{target.className ? ` · ${target.className}` : ""}</li>)}</ul> : <p>발송 가능한 학생이 없습니다.</p>}
        {skipped.length ? <><p className="text-amber font-bold">제외 대상</p><ul>{skipped.map((s, i) => <li key={i}>{s.name} · {NOTICE_SKIP_LABEL[s.reason]}</li>)}</ul></> : null}
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>돌아가기</Button>
        <Button disabled={busy || !preview.targets.length} onClick={onConfirm}>{busy ? "요청 중…" : `${preview.targets.length}건 발송 요청`}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
