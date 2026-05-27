import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Users } from "lucide-react";
import { requireAccess } from "@/lib/auth/require-access";
import { getMeetingById } from "@/features/meetings/server/queries";

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

  return (
    <div className="space-y-6">
      <Link
        href="/meetings"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="size-3.5" />
        회의록으로
      </Link>

      <header className="border-border space-y-3 border-b pb-5">
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
      </header>

      <article className="bg-card border-border rounded-lg border p-6">
        <pre className="text-foreground font-sans text-sm whitespace-pre-wrap leading-relaxed">
          {meeting.content}
        </pre>
      </article>
    </div>
  );
}
