"use client";

// 직접 발송 탭 — 개별 학생(ComposeFace) ↔ 반 단위 대량(BulkComposeFace) 모드 토글.
import { useState } from "react";
import type { NoticeClassOption } from "@/features/report-admin/server/notice-actions";
import { ComposeFace, type ComposeStudent } from "./compose-face";
import { BulkComposeFace } from "./bulk-compose-face";

type Mode = "single" | "bulk";

export function ComposeTab({
  students,
  classes,
  sendEnabled,
  showDailyTest,
  showCheckTest,
  showAttachments,
}: {
  students: ComposeStudent[];
  classes: NoticeClassOption[];
  sendEnabled: boolean;
  showDailyTest: boolean;
  showCheckTest: boolean;
  showAttachments: boolean;
}) {
  const [mode, setMode] = useState<Mode>("single");

  return (
    <div className="space-y-4">
      <div className="border-line inline-flex rounded-full border p-0.5 text-[13px]">
        {(
          [
            ["single", "개별 학생"],
            ["bulk", "반 단위(대량)"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-full px-3 py-1.5 font-medium ${
              mode === m ? "bg-primary/10 text-primary" : "text-text-dim hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "single" ? (
        <ComposeFace
          students={students}
          sendEnabled={sendEnabled}
          showDailyTest={showDailyTest}
          showCheckTest={showCheckTest}
          showAttachments={showAttachments}
        />
      ) : (
        <BulkComposeFace classes={classes} sendEnabled={sendEnabled} />
      )}
    </div>
  );
}
