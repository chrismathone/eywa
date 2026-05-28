"use client";

import { useState } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { NewMeetingForm } from "./new/new-meeting-form";

/**
 * /meetings 목록 페이지에서 "새 회의록" 우측 슬라이드 패널 트리거.
 * 폼 컴포넌트는 /meetings/new와 공유.
 */
export function NewMeetingTrigger() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <EyIcon name="plus" size={13} className="mr-1" />
        새 회의록
      </Button>
      <SheetContent
        side="right"
        className="bg-background w-full max-w-[640px] sm:max-w-[640px] overflow-y-auto p-7"
      >
        <header className="border-line space-y-1 border-b pb-4">
          <p className="micro">새 회의록</p>
          <h2 className="text-foreground text-xl font-bold">녹음 업로드 + 자동 분석</h2>
          <p className="text-text-dim text-xs leading-relaxed">
            MP3/M4A/WAV 음성 파일을 올리면 한국어 전사 후 8개 섹션 자동 분석. 또는 별도 창에서 바로 녹음.
          </p>
        </header>
        <div className="mt-5">
          <NewMeetingForm onSuccess={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
