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
import type { ImportHistoryItem } from "@/features/textbooks/server/import-batch";
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
 * 🔑 메뉴를 한 번 거친다(무엇을 되돌리는지 = 언제·무슨 교재·몇 줄) — 툴바 버튼 한 번에 수십 칸이 지워지면 안 된다.
 * 🔑 **최근 5건**(원장 2026-10-26 *"최근 5회 작업한거중에 껄로 돌아갈수있게"*) — 고르면 그것과 **그 뒤 반영 전부**가
 *    되돌아간다(서버 `undoChain`). 그래서 둘째 줄부터는 "+ 그 뒤 N건 함께"를 적는다(모르고 여러 건을 지우지 않게).
 *    되돌리기는 배정까지 지운다(빈 칸에 `계획`이 다시 그려져 안 된 것처럼 보이던 문제, 같은 날).
 * 🔴 Ctrl+Z는 쓰지 않는다 — 시트 칸마다 글자 입력이 있어 Ctrl+Z가 이미 "방금 친 글자 되돌리기"다.
 * ⚠️ 되돌리기 전에 **저장 큐를 먼저 비운다**(`flushEdits`) — 안 그러면 "손대지 않은 칸"을 잘못 판정한다.
 */
export function ImportUndoButton({
  classId,
  recent,
  flushEdits,
}: {
  classId: string;
  /** 최신 먼저, 최대 5건(`loadRecentImports`). */
  recent: readonly ImportHistoryItem[];
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
          r.batches > 1 || r.plansRemoved > 0
            ? tf("month.importUndo.doneMany", { b: r.batches, p: r.plansRemoved, n: r.restored })
            : r.kept > 0
              ? tf("month.importUndo.doneKept", { n: r.restored, kept: r.kept })
              : tf("month.importUndo.done", { n: r.restored }),
        );
        router.refresh();
      })
      .finally(() => setBusy(false));
  };

  if (recent.length === 0) return null;
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
      <DropdownMenuContent align="end" className="w-auto min-w-64">
        <p className="text-text-faint px-2 py-1 text-xs font-bold">{t("month.importUndo.head")}</p>
        {recent.map((b, i) => (
          <DropdownMenuItem key={b.id} className="cursor-pointer flex-col items-start gap-0" onClick={() => undo(b.id)}>
            <span>
              {i === 0 ? <span className="text-primary mr-1 font-bold">{t("month.importUndo.latest")}</span> : null}
              {tf("month.importUndo.menu", {
                at: importStamp(b.at),
                title: b.title ?? t("month.importUndo.untitled"),
                n: b.count,
              })}
            </span>
            {i > 0 ? <span className="text-text-faint text-xs">{tf("month.importUndo.alsoNewer", { n: i })}</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
