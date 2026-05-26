import { Pin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AnnouncementRow } from "@/features/dashboard/server/queries";

const AUDIENCE_LABEL: Record<string, string> = {
  all: "전체",
  staff: "전체 직원",
  teachers: "강사",
  counselors: "상담",
  accounting: "회계",
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "어제";
  if (days < 7) return `${days}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

export function AnnouncementsCard({ announcements }: { announcements: AnnouncementRow[] }) {
  return (
    <section className="bg-card border-border flex h-full flex-col rounded-lg border">
      <header className="border-border flex items-center justify-between border-b px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">공지사항</h2>
          <p className="text-muted-foreground num mt-0.5 text-xs">최근 {announcements.length}건</p>
        </div>
        <a
          href="#"
          className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 transition hover:underline"
        >
          전체 보기 →
        </a>
      </header>

      {announcements.length === 0 ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center px-5 py-10 text-sm">
          등록된 공지가 없습니다
        </div>
      ) : (
        <ul className="divide-border flex-1 divide-y">
          {announcements.map((a) => (
            <li
              key={a.id}
              className="hover:bg-accent/40 group cursor-pointer px-5 py-4 transition-colors"
            >
              <div className="flex items-start gap-3">
                {a.pinned ? (
                  <Pin className="text-chart-4 mt-1 size-3.5 shrink-0 -rotate-45 fill-current" />
                ) : (
                  <span className="bg-muted-foreground/30 mt-2.5 size-1.5 shrink-0 rounded-full" />
                )}

                <div className="min-w-0 flex-1 space-y-1">
                  <h3 className="text-sm font-medium leading-snug">{a.title}</h3>
                  <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
                    {a.content}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-[11px]">
                    <Badge
                      variant="secondary"
                      className="h-5 rounded-sm px-1.5 text-[10px] font-normal"
                    >
                      {AUDIENCE_LABEL[a.audience] ?? a.audience}
                    </Badge>
                    {a.authorName ? (
                      <span className="text-muted-foreground">{a.authorName}</span>
                    ) : null}
                    <span className="text-muted-foreground/40">·</span>
                    <span className="text-muted-foreground num">{relativeTime(a.createdAt)}</span>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
