"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSheetT } from "@/features/teacher-view/lang-context";

export type SendClassAsk = {
  studentName: string;
  candidates: { id: string; name: string }[];
  resolve: (classId: string | null) => void;
};

/**
 * 반 정보 없는 보강 보고서의 'ClassNote로 보낼 반' 고르기(A안, 원장 2026-09-29 *"보낼 곳이 없으면 '선택'"*).
 * 서버가 메인 수업을 정하지 못했을 때만 뜬다(send-class.ts). 고르면 그 반 보드로 보낸다 — 저장은 이미 끝났다.
 * ⚠️ 반 이름은 aywa 반 이름 그대로(원스크린은 학부모 보고서를 짓는 표면 — student-list.tsx 반 헤더와 같은 규약).
 */
export function SendClassDialog({ ask, onClose }: { ask: SendClassAsk; onClose: () => void }) {
  const t = useSheetT();
  const [pick, setPick] = useState<string>(ask.candidates[0]?.id ?? "");
  const finish = (id: string | null) => {
    ask.resolve(id);
    onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => (!open ? finish(null) : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("os.sendClass.title")} · {ask.studentName}
          </DialogTitle>
          <DialogDescription>{t("os.sendClass.desc")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          {ask.candidates.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="send-class"
                className="accent-primary"
                checked={pick === c.id}
                onChange={() => setPick(c.id)}
              />
              <span className="text-foreground font-bold">{c.name}</span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => finish(null)}>
            {t("os.sendClass.cancel")}
          </Button>
          <Button type="button" disabled={!pick} onClick={() => finish(pick)}>
            {t("os.sendClass.send")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
