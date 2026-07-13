"use client";

// 태스크 상세 + 댓글(읽기/작성) 다이얼로그 — 그리드/리스트에서 업무 클릭 시 열림. 댓글은 열 때 지연 로드.
// eywa에서 남긴 댓글은 서버가 "[eywa · 이름]" 접두를 붙여 출처 보존(API 댓글은 Notion에서 통합=봇으로 표기되므로).
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getTaskComments, addTaskCommentAction } from "@/features/staff/server/notion-actions";
import type { NotionTask } from "@/features/staff/notion-tasks";
import type { TaskComment } from "@/features/staff/server/notion";

function timeLabel(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function TaskDetailDialog({ task, onClose }: { task: NotionTask; onClose: () => void }) {
  const [comments, setComments] = useState<TaskComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [loading, startLoad] = useTransition();
  const [posting, setPosting] = useState(false);
  const taskId = task.id;

  // 열릴 때 1회 로드(인스턴스는 task별로 key로 새로 마운트 → taskId 고정). 동기 setState는 전이 콜백 안에서만([[#25]]).
  useEffect(() => {
    startLoad(async () => {
      const res = await getTaskComments(taskId);
      if (res.ok) {
        setComments(res.comments);
        setError(null);
      } else {
        setComments([]);
        setError(res.error);
      }
    });
  }, [taskId]);

  async function submit() {
    const t = text.trim();
    if (!t) return;
    setPosting(true);
    const res = await addTaskCommentAction(taskId, t);
    setPosting(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setText("");
    toast.success("댓글을 남겼습니다");
    startLoad(async () => {
      const r = await getTaskComments(taskId);
      if (r.ok) {
        setComments(r.comments);
        setError(null);
      }
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="pr-6 text-[15px] leading-snug">{task.title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          {task.due ? <span className="text-text-dim num">마감 {task.due}</span> : null}
          {task.dept ? <span className="text-text-faint">· {task.dept}</span> : null}
          {task.done ? <span className="text-primary">· 완료</span> : null}
          {task.url ? (
            <a
              href={task.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-faint hover:text-primary ml-auto inline-flex items-center gap-1"
            >
              <ExternalLink size={12} /> Notion에서 열기
            </a>
          ) : null}
        </div>

        <div className="border-line max-h-[40vh] space-y-2.5 overflow-y-auto border-t pt-3">
          {loading && comments === null ? (
            <p className="text-text-faint py-4 text-center text-[12px]">댓글 불러오는 중…</p>
          ) : error ? (
            <p className="text-danger py-4 text-center text-[12px]">{error}</p>
          ) : comments && comments.length > 0 ? (
            comments.map((c) => (
              <div key={c.id} className="text-[12px]">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-foreground font-semibold">{c.author}</span>
                  <span className="text-text-faint text-[11px]">{timeLabel(c.time)}</span>
                </div>
                <p className="text-text-dim whitespace-pre-wrap">{c.text}</p>
              </div>
            ))
          ) : (
            <p className="text-text-faint py-4 text-center text-[12px]">아직 댓글이 없습니다.</p>
          )}
        </div>

        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="댓글 남기기…"
            rows={2}
            className="border-line bg-card focus:border-primary min-h-[38px] flex-1 resize-none rounded-md border px-2 py-1.5 text-[12px] outline-none"
          />
          <Button size="sm" disabled={posting || !text.trim()} onClick={submit}>
            남기기
          </Button>
        </div>
        <p className="text-text-faint text-[11px]">작성 시 이름이 함께 기록됩니다.</p>
      </DialogContent>
    </Dialog>
  );
}
