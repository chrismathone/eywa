import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckSquare, Sparkles, Users } from "lucide-react";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getMeetingById,
  type MeetingActionItem,
} from "@/features/meetings/server/queries";
import { RunMeetingAiButton } from "./run-ai-button";

export const metadata = { title: "회의록 상세 — eywa" };

function formatHeldAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("meetings");
  const { id } = await params;
  const meeting = await getMeetingById(id);
  if (!meeting) notFound();

  const hasAi = meeting.aiSummary !== null;

  return (
    <div className="space-y-6">
      <Link
        href="/meetings"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="size-3.5" />
        회의록으로
      </Link>

      <header className="border-border flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="eyebrow">{formatHeldAt(meeting.heldAt)}</p>
          <h1 className="display text-foreground text-3xl">{meeting.title}</h1>
          <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
            <span className="num">{formatTime(meeting.heldAt)}</span>
            {meeting.attendees.length > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-3.5" />
                <span className="num">{meeting.attendees.length}명</span>
                <span className="text-muted-foreground/80">· {meeting.attendees.join(", ")}</span>
              </span>
            ) : null}
            {meeting.authorName ? <span>· 작성 {meeting.authorName}</span> : null}
          </div>
        </div>
        <RunMeetingAiButton meetingId={meeting.id} hasExisting={hasAi} />
      </header>

      {hasAi ? (
        <section className="bg-card border-border space-y-5 rounded-lg border p-5">
          <header className="flex items-baseline justify-between">
            <div className="inline-flex items-center gap-2">
              <Sparkles className="text-chart-4 size-4" />
              <h2 className="text-foreground text-sm font-semibold">AI 분석</h2>
            </div>
            {meeting.aiModelVersion ? (
              <span className="text-muted-foreground num font-mono text-[10px]">
                {meeting.aiModelVersion}
              </span>
            ) : null}
          </header>

          <div className="space-y-2">
            <p className="eyebrow">요약</p>
            <p className="text-foreground text-sm leading-relaxed">{meeting.aiSummary}</p>
          </div>

          {meeting.aiActionItems && meeting.aiActionItems.length > 0 ? (
            <div className="space-y-2">
              <p className="eyebrow">액션 아이템</p>
              <ul className="space-y-2">
                {meeting.aiActionItems.map((item: MeetingActionItem, i) => (
                  <li
                    key={i}
                    className="border-border bg-muted/30 flex items-start gap-3 rounded-md border px-3 py-2.5 text-sm"
                  >
                    <CheckSquare className="text-chart-2 mt-0.5 size-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground">{item.action}</p>
                      {item.assignee || item.due ? (
                        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                          {item.assignee ? <span>담당: {item.assignee}</span> : null}
                          {item.due ? (
                            <>
                              {item.assignee ? <span className="opacity-40">·</span> : null}
                              <span className="num">기한 {item.due}</span>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <article className="bg-card border-border rounded-lg border p-6">
        <pre className="text-foreground font-sans text-sm whitespace-pre-wrap leading-relaxed">
          {meeting.content}
        </pre>
      </article>
    </div>
  );
}
