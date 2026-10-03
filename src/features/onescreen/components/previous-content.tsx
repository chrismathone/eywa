"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { displayLessons } from "../curriculum";
import type { Subject } from "../types";
import { useDisplayOptions } from "./display-options-context";

/** 참고 내용은 두 줄만 차지하며, 마우스·키보드 포커스에서 전문을 읽는다. */
export function PreviousText({ text }: { text: string }) {
  return <Tooltip>
    <TooltipTrigger render={<span tabIndex={0} />} className="block min-w-0 cursor-help">
      <span className="line-clamp-2 whitespace-pre-line break-words">{text}</span>
    </TooltipTrigger>
    <TooltipContent className="max-h-[70vh] max-w-[min(36rem,90vw)] overflow-y-auto whitespace-pre-wrap break-words" side="top">
      {text}
    </TooltipContent>
  </Tooltip>;
}

export function PreviousContent({ subject, onImport }: { subject: Subject; onImport?: () => void }) {
  const { options } = useDisplayOptions();
  const t = useSheetT();
  const tf = useSheetTf();
  const p = subject.prevReport;
  if (options.hidePrevious || !p) return null;
  return <section className="border-line bg-bg-soft/40 rounded-lg border p-3 text-xs">
    <div className="mb-2 flex items-center justify-between gap-2">
      <b>{tf("os.prev.date", { date: p.date })}</b>
      {onImport ? <Button size="sm" variant="outline" onClick={onImport}>{t("os.prev.rowGet")}</Button> : null}
    </div>
    <PreviousText text={[
      displayLessons(p.progress) || p.progress, p.examInfo, p.attitude, p.homeworkScore,
      p.textbook, p.homeworkToday ? tf("os.prev.homework", { text: p.homeworkToday }) : "", p.note,
    ].filter(Boolean).join("\n")} />
  </section>;
}
