import Link from "next/link";
import { NotebookPen, Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { getMeetings } from "@/features/meetings/server/queries";

export const metadata = { title: "회의록 — eywa" };

function formatHeldAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

export default async function MeetingsPage() {
  const meetings = await getMeetings();

  return (
    <div className="space-y-6">
      <PageHeader
        title="회의록"
        description={`전체 ${meetings.length}건. 회의 제목/일자/참석자/요약을 한 줄로 훑어볼 수 있게.`}
      />

      {meetings.length === 0 ? (
        <EmptyState icon={NotebookPen} title="기록된 회의가 없습니다" />
      ) : (
        <ul className="space-y-3">
          {meetings.map((m) => (
            <li key={m.id} className="bg-card border-border rounded-lg border">
              <Link href={`/meetings/${m.id}`} className="block p-5 transition hover:bg-accent/40">
                <header className="flex items-baseline justify-between gap-3">
                  <h3 className="text-foreground text-base font-semibold">{m.title}</h3>
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
          ))}
        </ul>
      )}
    </div>
  );
}
