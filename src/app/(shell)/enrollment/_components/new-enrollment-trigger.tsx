"use client";

import { useState } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ModeTabs } from "../new/mode-tabs";
import { NewConsultationForm } from "../new/form";
import { NewConsultationRecordingForm } from "../new/recording-form";

type Mode = "manual" | "recording";

export function NewEnrollmentTrigger() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("manual");

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <EyIcon name="plus" size={13} className="mr-1" />
        신규 등록
      </Button>
      <SheetContent
        side="right"
        className="bg-background w-full max-w-[800px] sm:max-w-[800px] overflow-y-auto p-7"
      >
        <header className="border-line space-y-2 border-b pb-4">
          <p className="micro">신규 등록상담</p>
          <h2 className="text-foreground text-xl font-bold">
            {mode === "recording" ? "녹음 업로드 + 13섹션 AI 분석" : "수동 입력"}
          </h2>
          <p className="text-text-dim text-xs leading-relaxed">
            {mode === "recording"
              ? "MP3/M4A/WAV 음성 파일을 올리면 한국어 전사 후 13개 섹션 자동 분석. 학생/학부모 정보도 전사에서 자동 추출."
              : "신입생 정보를 직접 입력. 저장 후 상세 페이지에서 텍스트 기반 AI 분석을 실행할 수 있습니다."}
          </p>
        </header>
        <div className="mt-4">
          <ModeTabs active={mode} onSelect={setMode} />
        </div>
        <div className="mt-5">
          {mode === "recording" ? <NewConsultationRecordingForm /> : <NewConsultationForm />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
