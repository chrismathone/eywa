"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { undoPlanImport } from "@/features/textbooks/server/import-undo-actions";
import type { LastImport } from "@/features/textbooks/server/import-batch";
import { useSheetFeedback, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { sheetPill } from "../chrome";

/** `2026-09-28T05:30:00Z` → `9/28 14:30`(KST) — 무엇을 되돌리는지 사람이 알아보게. */
function importStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const v = (type: string) => p.find((x) => x.type === type)?.value ?? "";
  return `${v("month")}/${v("day")} ${v("hour")}:${v("minute")}`;
}

/**
 * **되돌리기**(원장 2026-10-15 *"실행취소 하는 방법이 필요"* → 2026-10-22 *"월간계획 전체가져오기 없어도될듯
 * 대신 되돌리기 실행취소이런것들로 채우면되겠다"*).
 *
 * 🔑 계획이 실제에 들어가는 길은 이제 **교재 배정 하나**다(배정 = 계획 + 가져오기, 2026-10-22). 그래서 툴바의
 *    [월간계획 전체 가져오기] 자리엔 그 반영을 **되돌리는 버튼만** 남는다 — 되돌릴 기록이 있을 때만 선다.
 *    배정 직후 알림의 [실행 취소]와 같은 서버 액션(`undoPlanImport`)이다.
 * 🔑 메뉴를 한 번 거친다(무엇을 되돌리는지 = 언제·몇 줄) — 툴바 버튼 한 번에 수십 칸이 지워지면 안 된다.
 * 🔴 Ctrl+Z는 쓰지 않는다 — 시트 칸마다 글자 입력이 있어 Ctrl+Z가 이미 "방금 친 글자 되돌리기"다.
 * ⚠️ 되돌리기 전에 **저장 큐를 먼저 비운다**(`flushEdits`) — 안 그러면 "손대지 않은 칸"을 잘못 판정한다.
 */
export function ImportUndoButton({
  classId,
  lastImport,
  flushEdits,
}: {
  classId: string;
  lastImport: LastImport | null;
  flushEdits: () => Promise<void>;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const feedback = useSheetFeedback();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const undo = (batchId: string) => {
    if (busy) return;
    setBusy(true);
    void flushEdits()
      .then(() => undoPlanImport({ classId, batchId }))
      .then((r) => {
        if (!r.ok) return void toast.error(feedback(r.error));
        toast.success(
          r.kept > 0
            ? tf("month.importUndo.doneKept", { n: r.restored, kept: r.kept })
            : tf("month.importUndo.done", { n: r.restored }),
        );
        router.refresh();
      })
      .finally(() => setBusy(false));
  };

  if (!lastImport) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        disabled={busy}
        aria-label={t("month.importUndo.more")}
        title={t("month.importUndo.more")}
        className={`${sheetPill(false)} inline-flex items-center gap-1 disabled:opacity-60`}
      >
        {busy ? t("month.importUndo.busy") : t("month.importUndo.button")} ▾
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuItem className="cursor-pointer" onClick={() => undo(lastImport.id)}>
          {tf("month.importUndo.menu", { at: importStamp(lastImport.at), n: lastImport.count })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
