"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pill } from "@/components/atoms/pill";
import { Button } from "@/components/ui/button";
import { toneColor } from "@/lib/design/semantic-color";
import { ParentReplyDialog } from "@/features/classnote-reply/components/parent-reply-dialog";
import { REPLY_MODE } from "@/features/classnote-reply/reply-policy";
import type { ParentThreadsView } from "@/features/classnote-reply/reply-types";

function kstDateTime(iso: string | null): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t));
}

/**
 * 수업보고서 '학부모 글·답글' 면(0317a) — 최근 학부모 글·댓글과 답글 상태. '답글'은 벨과 **같은 창**을 연다.
 * 창을 닫으면 목록을 다시 받는다(상태 칸이 서버 조회라서).
 */
export function ParentRepliesFace({ view }: { view: ParentThreadsView }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const shown = view.rows.length;
  return (
    <section className="space-y-3">
      <p className="text-text-dim text-xs break-keep">
        최근 {view.days}일 학부모 글·댓글 {view.total}건{view.total > shown ? ` 중 최근 ${shown}건` : ""} · 답글은 연동 PC가 ClassNote 그 글에 댓글로 올립니다.
        {view.replyReady && REPLY_MODE === "test" ? " 지금은 시험 단계라 학원이 테스트 보드의 글에만 답글을 쓸 수 있습니다." : ""}
      </p>
      {shown === 0 ? (
        <p className="text-text-faint py-8 text-center text-sm">최근 {view.days}일 동안 들어온 학부모 글·댓글이 없습니다.</p>
      ) : (
        <ul className="divide-line border-line divide-y rounded-2xl border">
          {view.rows.map((r) => (
            <li key={r.messageId} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span className="text-text-faint tabular-nums">{kstDateTime(r.postedAt)}</span>
                  <span className="text-foreground font-bold">{r.studentName ?? "학생 미확인"}</span>
                  <span className="text-text-dim">{r.boardName ?? ""}</span>
                  <span className="text-text-faint">{r.source === "comment" ? "댓글" : "새 글"}</span>
                </div>
                <p className="text-foreground mt-1 text-sm leading-relaxed break-keep [overflow-wrap:anywhere]">{r.content}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {r.latest ? <Pill color={toneColor(r.latest.tone)}>{r.replyCount > 1 ? `${r.latest.label} 외 ${r.replyCount - 1}` : r.latest.label}</Pill> : null}
                {r.replyable ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => setOpen(r.messageId)}>
                    답글
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <ParentReplyDialog
          key={open}
          messageId={open}
          onClose={() => {
            setOpen(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}
