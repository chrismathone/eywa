"use client";

// 새 업무 생성 — 담당자=이 직원(자동)으로 Notion DB에 업무 추가. 편집 권한(사무실) + Notion 매핑된 직원만.
import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createStaffTask } from "@/features/staff/server/notion-actions";

export function NewTaskDialog({
  staffId,
  staffName,
  defaultDue,
  onCreated,
  onClose,
}: {
  staffId: string;
  staffName: string;
  defaultDue: string; // YYYY-MM-DD
  onCreated: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(defaultDue);
  const [start, setStart] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!title.trim()) {
      toast.error("업무명을 입력하세요");
      return;
    }
    if (!due) {
      toast.error("마감일을 선택하세요");
      return;
    }
    if (start && start > due) {
      toast.error("시작일이 마감일보다 늦을 수 없습니다");
      return;
    }
    setSaving(true);
    const res = await createStaffTask(staffId, { title: title.trim(), due, start: start || null });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("업무를 만들었습니다 · Notion 반영됨");
    onCreated();
    onClose();
  }

  const inputCls = "border-line bg-card focus:border-primary w-full rounded-md border px-2 py-1.5 text-sm outline-none";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">새 업무 · {staffName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-text-dim mb-1 block text-xs">업무명</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 7월 상담 리포트 정리"
              className={inputCls}
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-text-dim mb-1 block text-xs">시작일 (선택)</label>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
            </div>
            <div className="flex-1">
              <label className="text-text-dim mb-1 block text-xs">마감일</label>
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputCls} />
            </div>
          </div>
          <p className="text-text-faint text-xs">담당자는 {staffName}(으)로 자동 지정되어 Notion에 등록됩니다.</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button size="sm" disabled={saving} onClick={submit}>
            만들기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
