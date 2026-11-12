"use client";

import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { setSentNoticeHidden, useSentNoticeHidden } from "./use-sent-notice";

export function SentReportNotice({ count }: { count: number }) {
  const hidden = useSentNoticeHidden();
  const t = useSheetT();
  const tf = useSheetTf();
  if (hidden || count <= 0) return null;
  return (
    <aside className="border-primary/30 bg-primary-soft/40 text-foreground rounded-md border px-3 py-1.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span>{tf("os.sentNotice.summary", { n: count })}</span>
        <button type="button" className="text-text-dim shrink-0 underline underline-offset-2"
          title={t("os.sentNotice.localHint")} onClick={() => setSentNoticeHidden(true)}>
          {t("os.sentNotice.hide")}
        </button>
      </div>
    </aside>
  );
}
