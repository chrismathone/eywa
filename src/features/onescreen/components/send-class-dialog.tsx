"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { ClassnoteSyncNowButton } from "@/features/report-admin/components/classnote-sync-now-button";

export type SendClassAsk = {
  studentName: string;
  candidates: { id: string; name: string }[];
  /** 처음 골라 둘 반(서버가 정한 메인 수업) — 없거나 후보 밖이면 첫 반. */
  defaultId?: string | null;
  /** 보강 추가한 반인데 이 학생의 반 보드가 없어 **다른 반으로 가는** 경우 그 반 이름 — 경고 한 줄을 띄운다. */
  makeupClassName?: string | null;
  /** 반만 바꾸고 보내지는 않는 자리(보강 반 고르기) — 확인 버튼 글자를 '이 반으로 정하기'로. */
  pickOnly?: boolean;
  /** 보고서 전달 경로만 고른다. 보강 반과 출결은 그대로 둔다. */
  deliveryOnly?: boolean;
  resolve: (classId: string | null) => void;
};

/**
 * 반 정보 없는 보강 보고서의 'ClassNote로 보낼 반' 고르기(A안, 원장 2026-09-29 *"보낼 곳이 없으면 '선택'"*).
 * 서버가 메인 수업을 정하지 못했을 때, 또는 🔴 **보강 추가한 반과 다른 반으로 가야 할 때**(그 반에 이 학생의 반 보드가 없다 —
 * 원장 2026-09-30) 뜬다(send-class.ts `decideSendClass`). 고르면 그 반 보드로 보낸다 — 저장은 이미 끝났다.
 * ⚠️ 반 이름은 aywa 반 이름 그대로(원스크린은 학부모 보고서를 짓는 표면 — student-list.tsx 반 헤더와 같은 규약).
 */
export function SendClassDialog({ ask, onClose }: { ask: SendClassAsk; onClose: () => void }) {
  const t = useSheetT();
  const tf = useSheetTf();
  const preset = ask.defaultId && ask.candidates.some((c) => c.id === ask.defaultId) ? ask.defaultId : null;
  const [pick, setPick] = useState<string>(preset ?? ask.candidates[0]?.id ?? "");
  const finish = (id: string | null) => {
    ask.resolve(id);
    onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => (!open ? finish(null) : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t(ask.deliveryOnly ? "os.sendClass.deliveryTitle" : "os.sendClass.title")} · {ask.studentName}
          </DialogTitle>
          <DialogDescription>{t(ask.deliveryOnly ? "os.sendClass.deliveryDesc" : "os.sendClass.desc")}</DialogDescription>
        </DialogHeader>
        {ask.makeupClassName ? (
          <p role="alert" className="bg-amber-soft text-foreground rounded-lg px-3 py-2 text-sm font-bold">
            {tf(ask.deliveryOnly ? "os.sendClass.deliveryMismatch" : "os.sendClass.makeupMismatch", { name: ask.makeupClassName })}
          </p>
        ) : null}
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
        {/* 반 보드가 새벽 동기화 전이라 없는 경우 — 지금 맞춘다(0313a). 끝나면 다시 발송을 누르면 된다.
            보고서 쓰기 권한이 있는 계정에게만 선다 — 선생님에게는 버튼이 그려지지 않는다(2026-10-06, 서버가 상태를 숨긴다).
            선생님은 발송이 배정 보류로 막힐 때 서버가 그 반·학생만 대신 요청한다(send-class.ts). */}
        <ClassnoteSyncNowButton source="onescreen_send_class" className="mt-2" />
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => finish(null)}>
            {t("os.sendClass.cancel")}
          </Button>
          <Button type="button" disabled={!pick} onClick={() => finish(pick)}>
            {ask.pickOnly ? t("os.sendClass.pick") : t(ask.deliveryOnly ? "os.sendClass.deliverySend" : "os.sendClass.send")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
