"use client";

// 태스크 상세 — 본문(Notion 블록) + 댓글(읽기/작성). 그리드/리스트에서 업무 클릭 시. 본문·댓글은 열 때 지연 로드.
// eywa에서 남긴 댓글은 서버가 "[eywa · 이름]" 접두를 붙여 출처 보존(API 댓글은 Notion에서 통합=봇으로 표기되므로).
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, ExternalLink, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { getTaskComments, addTaskCommentAction, getTaskContent, toggleTaskDone } from "@/features/staff/server/notion-actions";
import type { ContentLine, NotionTask, RichSpan } from "@/features/staff/notion-tasks";
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

/** 코드 블록은 서식 없이 평문으로. */
function spansPlainInline(spans: RichSpan[]): string {
  return spans.map((s) => s.text).join("");
}

/** rich_text span[] → 서식 보존 렌더(굵게/기울임/취소선/코드/링크). 이모지는 텍스트라 그대로. */
function Spans({ spans }: { spans: RichSpan[] }) {
  return (
    <>
      {spans.map((s, i) => {
        let cls = "";
        if (s.bold) cls += " font-semibold";
        if (s.italic) cls += " italic";
        if (s.strike) cls += " line-through";
        if (s.code) cls += " bg-bg-soft rounded px-1 text-[11px] font-mono";
        if (s.href)
          return (
            <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" className={`text-primary underline${cls}`}>
              {s.text}
            </a>
          );
        return cls ? (
          <span key={i} className={cls.trim()}>
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        );
      })}
    </>
  );
}

/** 업무 본문 라인 렌더 — 순수 매핑된 ContentLine[]을 읽기 좋게. 번호는 연속된 number 라인끼리 매김. */
function ContentBody({ lines }: { lines: ContentLine[] }) {
  // 렌더 중 변수 재할당 금지(react-hooks/immutability) → 번호를 미리 계산.
  const numbers: number[] = [];
  let run = 0;
  for (const l of lines) {
    if (l.kind === "number") {
      run += 1;
      numbers.push(run);
    } else {
      run = 0;
      numbers.push(0);
    }
  }
  return (
    <div className="space-y-1 text-[12px] leading-relaxed">
      {lines.map((l, i) => {
        switch (l.kind) {
          case "heading":
            return (
              <p key={i} className={`text-foreground font-semibold ${l.level === 1 ? "text-[14px]" : "text-[13px]"} ${i > 0 ? "mt-2" : ""}`}>
                <Spans spans={l.spans} />
              </p>
            );
          case "bullet":
            return (
              <p key={i} className="text-text-dim flex gap-1.5">
                <span className="text-text-faint">•</span>
                <span>
                  <Spans spans={l.spans} />
                </span>
              </p>
            );
          case "number":
            return (
              <p key={i} className="text-text-dim flex gap-1.5">
                <span className="text-text-faint num">{numbers[i]}.</span>
                <span>
                  <Spans spans={l.spans} />
                </span>
              </p>
            );
          case "todo":
            return (
              <p key={i} className="flex gap-1.5">
                <span className={l.checked ? "text-primary" : "text-text-faint"}>{l.checked ? "☑" : "☐"}</span>
                <span className={l.checked ? "text-text-faint line-through" : "text-text-dim"}>
                  <Spans spans={l.spans} />
                </span>
              </p>
            );
          case "quote":
            return (
              <p key={i} className="border-line text-text-dim border-l-2 pl-2 italic">
                <Spans spans={l.spans} />
              </p>
            );
          case "code":
            return (
              <pre key={i} className="bg-bg-soft text-text-dim overflow-x-auto rounded-sm px-2 py-1 text-[11px]">
                {spansPlainInline(l.spans)}
              </pre>
            );
          case "divider":
            return <hr key={i} className="border-line my-1.5" />;
          case "image":
            return (
              <p key={i} className="text-text-faint text-[11px]">
                🖼 이미지 (Notion에서 열어 확인)
              </p>
            );
          case "table":
            return (
              <p key={i} className="text-text-faint text-[11px]">
                ▦ 표 (Notion에서 열어 확인)
              </p>
            );
          default:
            return (
              <p key={i} className="text-text-dim">
                <Spans spans={l.spans} />
              </p>
            );
        }
      })}
    </div>
  );
}

export function TaskDetailDialog({
  task,
  canEdit = false,
  onChanged,
  onClose,
}: {
  task: NotionTask;
  canEdit?: boolean;
  onChanged?: () => void;
  onClose: () => void;
}) {
  const [comments, setComments] = useState<TaskComment[] | null>(null);
  const [content, setContent] = useState<ContentLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [loading, startLoad] = useTransition();
  const [posting, setPosting] = useState(false);
  const [done, setDone] = useState(task.done); // 낙관적 반영
  const [confirmDone, setConfirmDone] = useState(false);
  const [toggling, setToggling] = useState(false);
  const taskId = task.id;

  async function applyToggle() {
    setConfirmDone(false);
    setToggling(true);
    const res = await toggleTaskDone(taskId, !done);
    setToggling(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setDone((d) => !d);
    toast.success(done ? "미완료로 되돌렸습니다" : "완료로 표시했습니다 · Notion 반영됨");
    onChanged?.();
  }

  // 열릴 때 본문+댓글 병렬 로드(인스턴스는 task별 key로 새 마운트 → taskId 고정). setState는 전이 콜백 안에서만([[#25]]).
  useEffect(() => {
    startLoad(async () => {
      const [c, b] = await Promise.all([getTaskComments(taskId), getTaskContent(taskId)]);
      if (c.ok) setComments(c.comments);
      else {
        setComments([]);
        setError(c.error);
      }
      if (b.ok) setContent(b.lines);
      else setContent([]);
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
      if (r.ok) setComments(r.comments);
    });
  }

  const hasRange = task.start && task.due && task.start !== task.due;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="pr-6 text-[15px] leading-snug">{task.title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          {hasRange ? (
            <span className="text-text-dim num">기간 {task.start} ~ {task.due}</span>
          ) : task.due ? (
            <span className="text-text-dim num">마감 {task.due}</span>
          ) : null}
          {task.dept ? <span className="text-text-faint">· {task.dept}</span> : null}
          {done ? <span className="text-primary">· 완료</span> : null}
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

        {/* 완료 토글 — 편집 권한 시. 누르면 확인 후 Notion 반영(안전장치). */}
        {canEdit ? (
          <Button
            size="sm"
            variant={done ? "outline" : "default"}
            disabled={toggling}
            onClick={() => setConfirmDone(true)}
            className="w-full"
          >
            {done ? (
              <>
                <RotateCcw className="size-3.5" /> 미완료로 되돌리기
              </>
            ) : (
              <>
                <Check className="size-3.5" /> 완료로 표시
              </>
            )}
          </Button>
        ) : null}

        {/* 본문 */}
        <div className="border-line max-h-[38vh] overflow-y-auto border-t pt-3">
          {loading && content === null ? (
            <p className="text-text-faint py-4 text-center text-[12px]">내용 불러오는 중…</p>
          ) : content && content.length > 0 ? (
            <ContentBody lines={content} />
          ) : (
            <p className="text-text-faint py-2 text-center text-[12px]">본문 내용이 없습니다.</p>
          )}
        </div>

        {/* 댓글 */}
        <div className="border-line max-h-[28vh] space-y-2.5 overflow-y-auto border-t pt-3">
          <p className="text-text-faint text-[11px] font-semibold">댓글</p>
          {loading && comments === null ? (
            <p className="text-text-faint py-2 text-center text-[12px]">댓글 불러오는 중…</p>
          ) : error ? (
            <p className="text-danger py-2 text-center text-[12px]">{error}</p>
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
            <p className="text-text-faint py-2 text-center text-[12px]">아직 댓글이 없습니다.</p>
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

      <ConfirmDialog
        open={confirmDone}
        title={done ? "미완료로 되돌리기" : "완료로 표시"}
        message={`이 업무를 ${done ? "미완료로 되돌리면" : "완료로 표시하면"} Notion에도 바로 반영됩니다. 진행할까요?`}
        confirmLabel={done ? "되돌리기" : "완료 처리"}
        onConfirm={applyToggle}
        onCancel={() => setConfirmDone(false)}
      />
    </Dialog>
  );
}
