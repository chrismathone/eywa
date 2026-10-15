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
import { importPlannedRange } from "@/features/textbooks/server/plan-actions";
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
 * **[월간계획 전체 가져오기] + 되돌리기**(원장 2026-10-15 *"월간계획 전체 가져왔을때 실행취소 하는 방법이 필요"*).
 *
 * 🔑 되돌리는 문은 둘이다 — ① 가져온 직후 알림의 [실행 취소] ② 알림을 놓쳤을 때 버튼 옆 **▾ 메뉴**의
 *    "마지막 가져오기 되돌리기". 툴바에 상시 버튼으로 두지 않는다(원장 *"상단 툴바에도 계속 남으면 이상"*) —
 *    ▾는 되돌릴 가져오기가 있을 때만 서고, 열어야 보인다.
 * 🔴 Ctrl+Z는 쓰지 않는다 — 시트 칸마다 글자 입력이 있어 Ctrl+Z가 이미 "방금 친 글자 되돌리기"다.
 * ⚠️ 가져오기·되돌리기 모두 **저장 큐를 먼저 비운다**(`flushEdits`) — 방금 친 글자가 빈 칸으로 보이면 계획이 덮고,
 *    되돌리기는 "손대지 않은 칸"을 잘못 판정한다.
 */
export function ImportPlanButton({
  classId,
  from,
  to,
  lastImport,
  flushEdits,
}: {
  classId: string;
  from: string;
  to: string;
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

  const importAll = () => {
    if (busy) return;
    setBusy(true);
    void flushEdits()
      .then(() => importPlannedRange({ classId, from, to }))
      .then((r) => {
        if (!r.ok) return void toast.error(feedback(r.error));
        // 🔴 "가져왔다"고만 말하지 않는다 — 빈 칸이 없어 아무것도 안 바뀐 경우가 흔하다.
        const touched = r.result.added + r.result.filled;
        const tail = r.result.truncated > 0 ? tf("month.importAll.truncated", { n: r.result.truncated }) : "";
        if (touched === 0) toast.info(t("month.importAll.none") + tail);
        else {
          const batchId = r.undoBatchId;
          toast.success(
            tf("month.importAll.done", { n: touched }) + tail,
            batchId
              ? { duration: 10_000, action: { label: t("month.importUndo.action"), onClick: () => undo(batchId) } }
              : undefined,
          );
        }
        router.refresh();
      })
      .finally(() => setBusy(false));
  };

  return (
    <span className="inline-flex items-center gap-0.5">
      <button
        type="button"
        disabled={busy}
        onClick={importAll}
        className={`${sheetPill(false)} inline-flex items-center gap-1 disabled:opacity-60`}
        title={t("month.importAll.title")}
      >
        {busy ? t("month.importAll.busy") : t("month.importAll")}
      </button>
      {lastImport ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            disabled={busy}
            aria-label={t("month.importUndo.more")}
            title={t("month.importUndo.more")}
            className={`${sheetPill(false)} px-1.5 disabled:opacity-60`}
          >
            ▾
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto">
            <DropdownMenuItem className="cursor-pointer" onClick={() => undo(lastImport.id)}>
              {tf("month.importUndo.menu", { at: importStamp(lastImport.at), n: lastImport.count })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </span>
  );
}
