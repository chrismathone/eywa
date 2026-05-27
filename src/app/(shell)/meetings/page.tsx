import Link from "next/link";
import { Mic, NotebookPen, Plus, Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getMeetings,
  type MeetingProcessingStatus,
  type MeetingRow,
} from "@/features/meetings/server/queries";

export const metadata = { title: "회의록 — eywa" };

const STATUS_BADGE: Record<MeetingProcessingStatus, { label: string; class: string } | null> = {
  idle: null,
  uploaded: { label: "대기", class: "text-chart-3 bg-chart-3/10 border-chart-3/20" },
  transcribing: { label: "전사 중", class: "text-chart-3 bg-chart-3/10 border-chart-3/20" },
  analyzing: { label: "분석 중", class: "text-chart-3 bg-chart-3/10 border-chart-3/20" },
  completed: { label: "완료", class: "text-chart-2 bg-chart-2/10 border-chart-2/20" },
  failed: { label: "실패", class: "text-chart-4 bg-chart-4/10 border-chart-4/20" },
};

function formatHeldAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function MeetingItem({ m }: { m: MeetingRow }) {
  const badge = STATUS_BADGE[m.processingStatus];
  return (
    <li className="bg-card border-border rounded-lg border">
      <Link href={`/meetings/${m.id}`} className="block p-5 transition hover:bg-accent/40">
        <header className="flex items-baseline justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-foreground text-base font-semibold">{m.title}</h3>
            {m.hasAudio ? <Mic className="text-muted-foreground size-3.5 shrink-0" /> : null}
            {badge ? (
              <span
                className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${badge.class}`}
              >
                {badge.label}
              </span>
            ) : null}
          </div>
          <span className="text-muted-foreground num shrink-0 text-xs">
            {formatHeldAt(m.heldAt)}
          </span>
        </header>

        <p className="text-muted-foreground mt-2 line-clamp-2 text-sm leading-relaxed">
          {m.excerpt}
        </p>

        <footer className="text-muted-foreground mt-3 flex items-center gap-3 text-xs">
          {m.attendees.length > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Users className="size-3" />
              <span className="num">{m.attendees.length}명</span>
              <span className="ml-1 truncate">· {m.attendees.join(", ")}</span>
            </span>
          ) : null}
          {m.authorName ? (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span>{m.authorName}</span>
            </>
          ) : null}
        </footer>
      </Link>
    </li>
  );
}

export default async function MeetingsPage() {
  await requireAccess("meetings");
  const meetings = await getMeetings();

  return (
    <div className="space-y-6">
      <PageHeader
        title="회의록"
        description={`전체 ${meetings.length}건. 음성 녹음을 올리면 자동 전사 + AI 분석.`}
        actions={
          <Button render={<Link href="/meetings/new" />}>
            <Plus className="size-4" />
            새 회의록
          </Button>
        }
      />

      {meetings.length === 0 ? (
        <EmptyState icon={NotebookPen} title="기록된 회의가 없습니다" />
      ) : (
        <ul className="space-y-3">
          {meetings.map((m) => (
            <MeetingItem key={m.id} m={m} />
          ))}
        </ul>
      )}
    </div>
  );
}
