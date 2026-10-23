"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { addDays } from "@/lib/date-kst";
import { SITE_HOMEWORK_DAYS } from "@/features/video-submit/site";
import { issueExtraVideoHomework } from "../server/issue-actions";
import { cancelVideoHomework } from "../server/cancel-homework";
import type { VideoHomeworkLedgerRow } from "../types";
import { useLedgerRefresh } from "./ledger-refresh";

/** 칸에서 연 메뉴 — `issue` = 숙제없음 칸에 숙제 내기, `cancel` = 따로 낸 숙제 거두기(`cancel-homework.ts` — 칸 편집 창의 '숙제 취소'와 같다). 좌표는 누른 자리(화면 기준). */
export type IssueMenuTarget = { kind: "issue" | "cancel"; row: VideoHomeworkLedgerRow; date: string; x: number; y: number };

const shortDate = (date: string) => date.slice(5).replace("-", ".");
const WIDTH = 256;

/**
 * 영상 제출 현황 칸의 우클릭 메뉴(원장 2026-10-13 *"그냥 단순히 숙제 없음을 우클릭해서 숙제 출제로"*).
 * 낼 수 있는지(다음 수업 전인가 등)는 서버가 정한다 — 메뉴는 늘 뜨고, 안 되면 까닭이 뜬다(`issue-window.ts`).
 * 🔴 보고서는 다시 나가지 않는다 — 학생에게 직접 알려야 한다는 것을 누르기 전에 읽게 한다.
 * 화면 전체를 덮는 바닥이 깔려 있어, 처리하는 동안 표의 다른 칸은 눌리지 않는다.
 */
export function IssueMenu({ target, onClose, onAssign }: { target: IssueMenuTarget; onClose: () => void;
  /**
   * 숙제없음 칸에 **이미 올라온 영상을 붙인다**(원장 2026-10-22 '숙제없음 칸에 바로 배정') — 그 날짜를 골라 둔 배정 창을 연다. 붙지 않은 영상이 있고
   * 배정할 수 있는 줄에서만 준다. 출제 기한(다음 수업 전)과 상관없다 — 새 숙제를 내는 것이 아니라 올라온 영상을 그 수업의 숙제로 기록한다.
   */
  onAssign?: () => void }) {
  const refresh = useLedgerRefresh();
  const [busy, setBusy] = useState(false);
  const action = useRef<HTMLButtonElement>(null);
  useEffect(() => { action.current?.focus(); }, []);
  const issue = target.kind === "issue";
  const assign = issue && onAssign ? onAssign : undefined;
  const left = Math.max(8, Math.min(target.x, (typeof window === "undefined" ? 9999 : window.innerWidth) - WIDTH - 8));
  const top = Math.max(8, Math.min(target.y, (typeof window === "undefined" ? 9999 : window.innerHeight) - (assign ? 260 : 170)));
  const title = `${target.row.studentName} · ${shortDate(target.date)} 수업`;
  const close = () => { if (!busy) onClose(); };
  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const input = { classId: target.row.classId, studentId: target.row.studentId, date: target.date };
      // 취소 = 칸 편집 창의 '숙제 취소'와 같은 길(원장 2026-10-16 — 미확인 · 미수행만 · 그날 보고서의 영상 과제도 '없음'으로).
      const result = issue ? await issueExtraVideoHomework(input) : await cancelVideoHomework({ classId: input.classId, studentId: input.studentId, homeworkDate: input.date });
      if (!result.ok) { toast.error(result.error ?? "처리하지 못했습니다."); return; }
      toast.success(issue
        ? `${target.row.studentName} 학생에게 ${target.date} 영상 숙제를 냈습니다${"deadline" in result && result.deadline ? ` · 기한 ${result.deadline}` : ""}. 수업보고서는 다시 나가지 않으니 학생에게 직접 알려 주세요.`
        : "kept" in result && result.kept ? `${target.date} 수업보고서에 다른 선생님이 낸 영상 과제가 있어 따로 낸 표시만 지웠습니다(숙제는 그대로입니다).`
        : `${target.row.studentName} 학생의 ${target.date} 숙제를 취소했습니다.`);
      refresh();
    } catch { toast.error("연결을 확인한 뒤 다시 시도해 주세요."); }
    finally { setBusy(false); onClose(); }
  }
  return <>
    <div className="fixed inset-0 z-40" onClick={close} onContextMenu={(event) => { event.preventDefault(); close(); }} aria-hidden />
    <div role="menu" aria-label={title} className="bg-card border-line fixed z-50 flex flex-col gap-0.5 rounded-lg border p-1 shadow-lg"
      style={{ left, top, width: WIDTH }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
      <p className="truncate px-2 py-1 text-xs font-semibold">{title}</p>
      {/* 붙지 않은 영상이 있는 줄이면 배정이 먼저다 — 숙제 0건 반의 줄은 그 영상 때문에 선 줄이다. */}
      {assign ? <>
        <button ref={action} type="button" role="menuitem" disabled={busy} onClick={() => { assign(); onClose(); }}
          className="hover:bg-bg-soft rounded-md px-2 py-1.5 text-left text-sm font-semibold disabled:opacity-50">이 수업에 영상 배정</button>
        <p className="text-text-dim px-2 pb-1 text-xs leading-snug break-keep">학생이 이미 올린 영상을 이 수업의 숙제로 붙이고 완료로 셉니다. 학생에게 새 숙제가 나가지 않습니다.</p>
      </> : null}
      <button ref={assign ? undefined : action} type="button" role="menuitem" disabled={busy} onClick={() => void run()}
        className="hover:bg-bg-soft rounded-md px-2 py-1.5 text-left text-sm font-semibold disabled:opacity-50">
        {busy ? "처리 중…" : issue ? "숙제 출제" : "출제 취소"}
      </button>
      <p className="text-text-dim px-2 pb-1 text-xs leading-snug break-keep">{issue
        ? `이 날짜의 영상 숙제로 냅니다. 제출 기한은 ${shortDate(addDays(target.date, SITE_HOMEWORK_DAYS))}까지(${SITE_HOMEWORK_DAYS}일)입니다. 수업보고서는 다시 나가지 않으니 학생에게 직접 알려 주세요. 다음 수업 전까지만 낼 수 있습니다.`
        : "따로 낸 숙제입니다. 취소하면 이 회차가 사라집니다(그날 수업보고서에 영상 과제가 있으면 '없음'으로 바뀌고 검사 기록도 지워집니다). 영상이 붙었거나 완료로 찍힌 숙제는 취소할 수 없습니다."}</p>
    </div>
  </>;
}
