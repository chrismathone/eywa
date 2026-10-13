"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { addDays } from "@/lib/date-kst";
import { SITE_HOMEWORK_DAYS } from "@/features/video-submit/site";
import { cancelExtraVideoHomework, issueExtraVideoHomework } from "../server/issue-actions";
import type { VideoHomeworkLedgerRow } from "../types";

/** 칸에서 연 메뉴 — `issue` = 숙제없음 칸에 숙제 내기, `cancel` = 따로 낸 숙제 거두기. 좌표는 누른 자리(화면 기준). */
export type IssueMenuTarget = { kind: "issue" | "cancel"; row: VideoHomeworkLedgerRow; date: string; x: number; y: number };

const shortDate = (date: string) => date.slice(5).replace("-", ".");
const WIDTH = 256;

/**
 * 영상 제출 현황 칸의 우클릭 메뉴(원장 2026-10-13 *"그냥 단순히 숙제 없음을 우클릭해서 숙제 출제로"*).
 * 낼 수 있는지(다음 수업 전인가 등)는 서버가 정한다 — 메뉴는 늘 뜨고, 안 되면 까닭이 뜬다(`issue-window.ts`).
 * 🔴 보고서는 다시 나가지 않는다 — 학생에게 직접 알려야 한다는 것을 누르기 전에 읽게 한다.
 * 화면 전체를 덮는 바닥이 깔려 있어, 처리하는 동안 표의 다른 칸은 눌리지 않는다.
 */
export function IssueMenu({ target, onClose }: { target: IssueMenuTarget; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const action = useRef<HTMLButtonElement>(null);
  useEffect(() => { action.current?.focus(); }, []);
  const issue = target.kind === "issue";
  const left = Math.max(8, Math.min(target.x, (typeof window === "undefined" ? 9999 : window.innerWidth) - WIDTH - 8));
  const top = Math.max(8, Math.min(target.y, (typeof window === "undefined" ? 9999 : window.innerHeight) - 170));
  const title = `${target.row.studentName} · ${shortDate(target.date)} 수업`;
  const close = () => { if (!busy) onClose(); };
  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const input = { classId: target.row.classId, studentId: target.row.studentId, date: target.date };
      const result = issue ? await issueExtraVideoHomework(input) : await cancelExtraVideoHomework(input);
      if (!result.ok) { toast.error(result.error ?? "처리하지 못했습니다."); return; }
      toast.success(issue
        ? `${target.row.studentName} 학생에게 ${target.date} 영상 숙제를 냈습니다${result.deadline ? ` · 기한 ${result.deadline}` : ""}. 수업보고서는 다시 나가지 않으니 학생에게 직접 알려 주세요.`
        : "kept" in result && result.kept ? `따로 낸 표시만 지웠습니다. ${target.date} 수업보고서에도 영상 과제가 있어 숙제는 그대로입니다.`
        : `${target.row.studentName} 학생의 ${target.date} 숙제를 취소했습니다.`);
      router.refresh();
    } catch { toast.error("연결을 확인한 뒤 다시 시도해 주세요."); }
    finally { setBusy(false); onClose(); }
  }
  return <>
    <div className="fixed inset-0 z-40" onClick={close} onContextMenu={(event) => { event.preventDefault(); close(); }} aria-hidden />
    <div role="menu" aria-label={title} className="bg-card border-line fixed z-50 flex flex-col gap-0.5 rounded-lg border p-1 shadow-lg"
      style={{ left, top, width: WIDTH }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
      <p className="truncate px-2 py-1 text-xs font-semibold">{title}</p>
      <button ref={action} type="button" role="menuitem" disabled={busy} onClick={() => void run()}
        className="hover:bg-bg-soft rounded-md px-2 py-1.5 text-left text-sm font-semibold disabled:opacity-50">
        {busy ? "처리 중…" : issue ? "숙제 출제" : "출제 취소"}
      </button>
      <p className="text-text-dim px-2 pb-1 text-xs leading-snug break-keep">{issue
        ? `이 날짜의 영상 숙제로 냅니다. 제출 기한은 ${shortDate(addDays(target.date, SITE_HOMEWORK_DAYS))}까지(${SITE_HOMEWORK_DAYS}일)입니다. 수업보고서는 다시 나가지 않으니 학생에게 직접 알려 주세요. 다음 수업 전까지만 낼 수 있습니다.`
        : "따로 낸 숙제입니다. 취소하면 이 회차가 사라집니다(그날 수업보고서에도 영상 과제가 있으면 따로 낸 표시만 지워집니다). 영상이 올라왔거나 직접 찍은 기록이 있으면 취소할 수 없습니다."}</p>
    </div>
  </>;
}
